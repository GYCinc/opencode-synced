import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedSyncConfig } from './config.js';
import { isPlainObject, isTursoSessionBackend, pathExists, writeJsonFile } from './config.js';
import { SyncCommandError } from './errors.js';
import type { SyncLocations } from './paths.js';

const SESSION_SYNC_TABLE = 'opencode_session_sync_snapshot';
const CREDENTIAL_VERSION = 1;
const TURSO_INSTALL_SCRIPT = 'curl -sSfL https://get.tur.so/install.sh | bash';
const TURSO_EXECUTABLE_CANDIDATES = [
  'turso',
  '/opt/homebrew/bin/turso',
  '/usr/local/bin/turso',
  '~/.turso/turso',
  '~/.local/bin/turso',
] as const;

type TursoSqlArg = { type: 'text'; value: string } | { type: 'null' };

interface TursoPipelineExecuteRequest {
  type: 'execute';
  stmt: {
    sql: string;
    args?: TursoSqlArg[];
  };
}

interface TursoPipelineCloseRequest {
  type: 'close';
}

interface SessionSnapshot {
  db: Buffer;
  wal: Buffer | null;
  shm: Buffer | null;
  sha256: string;
}

interface TursoSessionCredential {
  version: number;
  database: string;
  url: string;
  httpUrl: string;
  token: string;
  machineId: string;
  createdAt: string;
  updatedAt: string;
}

interface TursoCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TursoSyncLogger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface TursoSetupResult {
  ready: boolean;
  changed: boolean;
  message: string;
  loginUrl?: string;
  loginCode?: string;
}

export interface TursoSessionSyncResult {
  status: 'synced' | 'unchanged' | 'skipped';
  message: string;
  sha256?: string;
}

export interface TursoSessionSyncCycleResult {
  pullBefore: TursoSessionSyncResult;
  push: TursoSessionSyncResult;
  pullAfter: TursoSessionSyncResult;
}

export interface TursoSessionSetupOptions {
  allowLogin?: boolean;
  allowAutoInstall?: boolean;
  forceTokenRefresh?: boolean;
}

export interface TursoSessionBackend {
  ensureSetup: (_options?: TursoSessionSetupOptions) => Promise<TursoSetupResult>;
  status: () => Promise<string>;
  pull: () => Promise<TursoSessionSyncResult>;
  push: () => Promise<TursoSessionSyncResult>;
  syncCycle: () => Promise<TursoSessionSyncCycleResult>;
}

export function createTursoSessionBackend(options: {
  locations: SyncLocations;
  config: NormalizedSyncConfig;
  log: TursoSyncLogger;
}): TursoSessionBackend {
  const { locations, config, log } = options;
  const paths = resolveSessionDbPaths(locations);
  const credentialPath = resolveTursoCredentialPath(locations);
  const backendConfig = config.sessionBackend.turso;

  const ensureSetup = async (
    setupOptions: TursoSessionSetupOptions = {}
  ): Promise<TursoSetupResult> => {
    if (!isTursoSessionBackend(config)) {
      throw new SyncCommandError('Turso session backend is not enabled.');
    }

    const expectedDatabase = resolveTursoDatabaseName(config);
    const allowAutoInstall = setupOptions.allowAutoInstall ?? backendConfig.autoSetup;
    const existing = await readTursoCredential(credentialPath);
    if (
      existing &&
      existing.database === expectedDatabase &&
      !setupOptions.forceTokenRefresh &&
      (await isCredentialUsable(existing))
    ) {
      return {
        ready: true,
        changed: false,
        message: `Turso session backend ready (${existing.database}).`,
      };
    }

    const executable = await ensureTursoExecutable(locations, allowAutoInstall);
    const authenticated = await isTursoAuthenticated(executable);
    if (!authenticated) {
      if (!setupOptions.allowLogin) {
        return {
          ready: false,
          changed: false,
          message:
            'Turso CLI is not authenticated. Run /sync-sessions-setup-turso to complete headless login.',
        };
      }

      const headlessAuth = await runTursoHeadlessAuth(executable);
      if (!headlessAuth.ready) {
        return {
          ready: false,
          changed: false,
          message: headlessAuth.message,
          loginUrl: headlessAuth.loginUrl,
          loginCode: headlessAuth.loginCode,
        };
      }

      const authenticatedAfterLogin = await isTursoAuthenticated(executable);
      if (!authenticatedAfterLogin) {
        return {
          ready: false,
          changed: false,
          message:
            'Turso CLI login did not complete successfully. Re-run /sync-sessions-setup-turso.',
        };
      }
    }

    await ensureTursoDatabaseExists(executable, expectedDatabase);
    const detectedUrl = await resolveDatabaseUrl(executable, expectedDatabase);
    const configuredUrl = backendConfig.url?.trim() || detectedUrl;
    const httpUrl = await resolveHttpUrl(executable, expectedDatabase, configuredUrl);

    let token = existing?.token ?? '';
    if (!token || setupOptions.forceTokenRefresh) {
      token = await createTursoToken(executable, expectedDatabase);
    }

    let credential: TursoSessionCredential = {
      version: CREDENTIAL_VERSION,
      database: expectedDatabase,
      url: configuredUrl,
      httpUrl,
      token,
      machineId: resolveMachineId(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!(await isCredentialUsable(credential))) {
      token = await createTursoToken(executable, expectedDatabase);
      credential = {
        ...credential,
        token,
        updatedAt: new Date().toISOString(),
      };
      if (!(await isCredentialUsable(credential))) {
        throw new SyncCommandError(
          'Failed to validate Turso session credentials after token provisioning.'
        );
      }
    }

    await writeJsonFile(credentialPath, credential, { jsonc: false, mode: 0o600 });

    return {
      ready: true,
      changed: true,
      message: `Turso session backend is configured for database "${expectedDatabase}".`,
    };
  };

  const requireCredential = async (): Promise<TursoSessionCredential> => {
    const setup = await ensureSetup({ allowLogin: false });
    if (!setup.ready) {
      throw new SyncCommandError(setup.message);
    }

    const credential = await readTursoCredential(credentialPath);
    if (!credential) {
      throw new SyncCommandError('Turso credentials are missing after setup.');
    }
    return credential;
  };

  const pull = async (): Promise<TursoSessionSyncResult> => {
    const credential = await requireCredential();
    await ensureSnapshotTable(credential);

    const remoteSnapshot = await fetchRemoteSnapshot(credential);
    if (!remoteSnapshot) {
      return {
        status: 'skipped',
        message: 'No remote session snapshot found in Turso yet.',
      };
    }

    const localSnapshot = await readLocalSessionSnapshot(paths);
    if (localSnapshot && localSnapshot.sha256 === remoteSnapshot.sha256) {
      return {
        status: 'unchanged',
        sha256: remoteSnapshot.sha256,
        message: 'Local sessions already match Turso snapshot.',
      };
    }

    await writeLocalSessionSnapshot(paths, remoteSnapshot);
    return {
      status: 'synced',
      sha256: remoteSnapshot.sha256,
      message: `Pulled sessions from Turso snapshot (${remoteSnapshot.machineId}).`,
    };
  };

  const push = async (): Promise<TursoSessionSyncResult> => {
    const localSnapshot = await readLocalSessionSnapshot(paths);
    if (!localSnapshot) {
      return {
        status: 'skipped',
        message: `Local session database not found at ${paths.dbPath}.`,
      };
    }

    const credential = await requireCredential();
    await ensureSnapshotTable(credential);

    const remoteSnapshot = await fetchRemoteSnapshot(credential);
    if (remoteSnapshot && remoteSnapshot.sha256 === localSnapshot.sha256) {
      return {
        status: 'unchanged',
        sha256: localSnapshot.sha256,
        message: 'Turso snapshot already matches local sessions.',
      };
    }

    await upsertRemoteSnapshot(credential, localSnapshot, resolveMachineId());
    return {
      status: 'synced',
      sha256: localSnapshot.sha256,
      message: 'Pushed local sessions to Turso.',
    };
  };

  const status = async (): Promise<string> => {
    const credential = await readTursoCredential(credentialPath);
    if (!credential) {
      return 'Turso backend selected, but machine-local credentials are not set up.';
    }

    const usable = await isCredentialUsable(credential);
    if (!usable) {
      return `Turso credential exists for "${credential.database}", but token validation failed.`;
    }

    return `Turso backend ready (${credential.database}); concurrent-safe backend enabled.`;
  };

  const syncCycle = async (): Promise<TursoSessionSyncCycleResult> => {
    const pullBefore = await pull();
    const pushResult = await push();
    const pullAfter = await pull();
    log.debug('Completed Turso session sync cycle', {
      pullBefore: pullBefore.status,
      push: pushResult.status,
      pullAfter: pullAfter.status,
    });
    return {
      pullBefore,
      push: pushResult,
      pullAfter,
    };
  };

  return {
    ensureSetup,
    status,
    pull,
    push,
    syncCycle,
  };
}

export function resolveTursoCredentialPath(locations: SyncLocations): string {
  return path.join(locations.xdg.dataDir, 'opencode', 'opencode-synced', 'turso-session.json');
}

export function resolveSessionDbPaths(locations: SyncLocations): {
  dbPath: string;
  walPath: string;
  shmPath: string;
} {
  const dataRoot = path.join(locations.xdg.dataDir, 'opencode');
  const dbPath = path.join(dataRoot, 'opencode.db');
  return {
    dbPath,
    walPath: `${dbPath}-wal`,
    shmPath: `${dbPath}-shm`,
  };
}

export function resolveTursoDatabaseName(config: NormalizedSyncConfig): string {
  const explicit = config.sessionBackend.turso.database?.trim();
  if (explicit) {
    return sanitizeDatabaseName(explicit);
  }

  const repoName = config.repo?.name?.trim() || 'opencode-config';
  return sanitizeDatabaseName(`${repoName}-sessions`);
}

export function extractHeadlessLoginHints(text: string): { url?: string; code?: string } {
  const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
  const codeMatch =
    text.match(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/) ?? text.match(/\b[A-Z0-9]{6,}\b/);
  return {
    url: urlMatch?.[0],
    code: codeMatch?.[0],
  };
}

export function isRetryableTursoError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'busy',
    'timeout',
    'temporar',
    'connection reset',
    'connection refused',
    'econnreset',
    'etimedout',
    '429',
    '500',
    '502',
    '503',
    '504',
    'rate limit',
  ].some((token) => message.includes(token));
}

function sanitizeDatabaseName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const fallback = cleaned || 'opencode-sessions';
  return fallback.slice(0, 58);
}

function resolveMachineId(): string {
  const user = process.env.USER ?? process.env.USERNAME ?? 'unknown';
  const host = os.hostname() || 'unknown-host';
  return `${user}@${host}`;
}

async function readTursoCredential(filePath: string): Promise<TursoSessionCredential | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return null;

    const credential = parsed as Partial<TursoSessionCredential>;
    if (
      typeof credential.database !== 'string' ||
      typeof credential.url !== 'string' ||
      typeof credential.httpUrl !== 'string' ||
      typeof credential.token !== 'string' ||
      typeof credential.machineId !== 'string'
    ) {
      return null;
    }

    return {
      version: Number(credential.version ?? CREDENTIAL_VERSION),
      database: credential.database,
      url: credential.url,
      httpUrl: trimTrailingSlash(credential.httpUrl),
      token: credential.token,
      machineId: credential.machineId,
      createdAt: typeof credential.createdAt === 'string' ? credential.createdAt : '',
      updatedAt: typeof credential.updatedAt === 'string' ? credential.updatedAt : '',
    };
  } catch {
    return null;
  }
}

async function isCredentialUsable(credential: TursoSessionCredential): Promise<boolean> {
  try {
    await executeSql(credential, 'SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function ensureTursoExecutable(
  locations: SyncLocations,
  allowAutoInstall: boolean
): Promise<string> {
  const detected = await detectTursoExecutable(locations);
  if (detected) {
    return detected;
  }

  if (!allowAutoInstall) {
    throw new SyncCommandError(
      'Turso CLI not found. Run /sync-sessions-setup-turso to install it.'
    );
  }

  if (process.platform !== 'win32') {
    const installScript = await runCommand('bash', ['-lc', TURSO_INSTALL_SCRIPT], {
      timeoutMs: 120000,
    });
    if (installScript.code !== 0) {
      // Optional fallback when Homebrew is already present.
      const brewInstalled = await isCommandExecutable('brew');
      if (brewInstalled) {
        await runCommand('brew', ['tap', 'libsql/sqld'], { timeoutMs: 60000 });
        await runCommand('brew', ['tap', 'tursodatabase/tap'], { timeoutMs: 60000 });
        const brewInstall = await runCommand('brew', ['install', 'turso'], { timeoutMs: 120000 });
        if (brewInstall.code !== 0) {
          throw new SyncCommandError(
            'Failed to install Turso CLI with install script and Homebrew fallback: ' +
              `${combineCommandOutput(installScript)}\n${combineCommandOutput(brewInstall)}`
          );
        }
      } else {
        throw new SyncCommandError(
          `Failed to install Turso CLI with install script: ${combineCommandOutput(installScript)}`
        );
      }
    }
  } else {
    throw new SyncCommandError(
      'Automatic Turso CLI install is not supported on this platform. Install Turso manually, then retry.'
    );
  }

  const afterInstall = await detectTursoExecutable(locations);
  if (!afterInstall) {
    throw new SyncCommandError(
      'Turso CLI installation completed, but executable was not found in PATH or standard install locations.'
    );
  }

  return afterInstall;
}

async function runTursoHeadlessAuth(
  executable: string
): Promise<{ ready: boolean; message: string; loginUrl?: string; loginCode?: string }> {
  const loginResult = await runTursoCommand(executable, ['auth', 'login', '--headless'], {
    timeoutMs: 180000,
  });
  if (loginResult.code === 0 && !loginResult.timedOut) {
    const authenticated = await isTursoAuthenticated(executable);
    if (authenticated) {
      return {
        ready: true,
        message: 'Turso CLI login completed.',
      };
    }
  }

  const loginCombined = combineCommandOutput(loginResult);
  const loginHints = extractHeadlessLoginHints(loginCombined);
  const signupResult = await runTursoCommand(executable, ['auth', 'signup', '--headless'], {
    timeoutMs: 180000,
  });
  const signupCombined = combineCommandOutput(signupResult);
  const signupHints = extractHeadlessLoginHints(signupCombined);

  const loginUrl = loginHints.url ?? signupHints.url;
  const loginCode = loginHints.code ?? signupHints.code;
  return {
    ready: false,
    message:
      'Turso login/signup requires browser authorization. Complete the headless auth URL and rerun /sync-sessions-setup-turso.',
    loginUrl,
    loginCode,
  };
}

async function detectTursoExecutable(locations: SyncLocations): Promise<string | null> {
  for (const candidate of TURSO_EXECUTABLE_CANDIDATES) {
    const resolved = candidate.startsWith('~')
      ? path.resolve(candidate.replace(/^~(?=\/)/, locations.xdg.homeDir))
      : candidate;
    if (await isCommandExecutable(resolved)) {
      return resolved;
    }
  }
  return null;
}

async function isCommandExecutable(command: string): Promise<boolean> {
  try {
    const probe = await runCommand(command, ['--version'], { timeoutMs: 10000 });
    return probe.code === 0;
  } catch {
    return false;
  }
}

async function isTursoAuthenticated(executable: string): Promise<boolean> {
  const status = await runTursoCommand(executable, ['auth', 'whoami']);
  return status.code === 0;
}

async function ensureTursoDatabaseExists(executable: string, database: string): Promise<void> {
  const show = await runTursoCommand(executable, ['db', 'show', database, '--url']);
  if (show.code === 0) {
    return;
  }

  const create = await runTursoCommand(executable, ['db', 'create', database], {
    timeoutMs: 120000,
  });
  if (create.code !== 0) {
    throw new SyncCommandError(
      `Failed to create Turso database "${database}": ${combineCommandOutput(create)}`
    );
  }
}

async function resolveDatabaseUrl(executable: string, database: string): Promise<string> {
  const result = await runTursoCommand(executable, ['db', 'show', database, '--url']);
  if (result.code !== 0) {
    throw new SyncCommandError(
      `Failed to resolve Turso database URL: ${combineCommandOutput(result)}`
    );
  }
  return result.stdout.trim();
}

async function resolveHttpUrl(
  executable: string,
  database: string,
  baseUrl: string
): Promise<string> {
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return trimTrailingSlash(baseUrl);
  }
  if (baseUrl.startsWith('libsql://')) {
    return trimTrailingSlash(`https://${baseUrl.slice('libsql://'.length)}`);
  }

  const result = await runTursoCommand(executable, ['db', 'show', database, '--http-url']);
  if (result.code !== 0) {
    throw new SyncCommandError(`Failed to resolve Turso HTTP URL: ${combineCommandOutput(result)}`);
  }

  return trimTrailingSlash(result.stdout.trim());
}

async function createTursoToken(executable: string, database: string): Promise<string> {
  let result = await runTursoCommand(executable, [
    'db',
    'tokens',
    'create',
    database,
    '--expiration',
    'never',
  ]);
  if (result.code !== 0) {
    result = await runTursoCommand(executable, ['db', 'tokens', 'create', database]);
  }

  if (result.code !== 0) {
    throw new SyncCommandError(`Failed to create Turso token: ${combineCommandOutput(result)}`);
  }

  const combined = combineCommandOutput(result);
  const jwtMatch = combined.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch) {
    return jwtMatch[0];
  }

  const lines = combined
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = lines[lines.length - 1];
  if (!candidate) {
    throw new SyncCommandError('Turso token command did not return a token value.');
  }
  return candidate;
}

async function runTursoCommand(
  executable: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<TursoCommandResult> {
  return await runCommand(executable, args, options);
}

async function runCommand(
  executable: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<TursoCommandResult> {
  return await new Promise<TursoCommandResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeout: NodeJS.Timeout | null = null;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function combineCommandOutput(result: TursoCommandResult): string {
  const parts = [result.stdout.trim(), result.stderr.trim()].filter(Boolean);
  const joined = parts.join('\n');
  if (result.timedOut) {
    return joined ? `${joined}\n(command timed out)` : 'command timed out';
  }
  return joined;
}

async function readLocalSessionSnapshot(paths: {
  dbPath: string;
  walPath: string;
  shmPath: string;
}): Promise<SessionSnapshot | null> {
  if (!(await pathExists(paths.dbPath))) {
    return null;
  }

  const db = await fs.readFile(paths.dbPath);
  const wal = (await pathExists(paths.walPath)) ? await fs.readFile(paths.walPath) : null;
  const shm = (await pathExists(paths.shmPath)) ? await fs.readFile(paths.shmPath) : null;
  return {
    db,
    wal,
    shm,
    sha256: computeSnapshotSha256(db, wal, shm),
  };
}

async function writeLocalSessionSnapshot(
  paths: { dbPath: string; walPath: string; shmPath: string },
  snapshot: {
    db: Buffer;
    wal: Buffer | null;
    shm: Buffer | null;
    sha256: string;
    machineId: string;
    updatedAt: string;
  }
): Promise<void> {
  await writeBufferAtomically(paths.dbPath, snapshot.db);
  if (snapshot.wal) {
    await writeBufferAtomically(paths.walPath, snapshot.wal);
  } else {
    await fs.rm(paths.walPath, { force: true });
  }

  if (snapshot.shm) {
    await writeBufferAtomically(paths.shmPath, snapshot.shm);
  } else {
    await fs.rm(paths.shmPath, { force: true });
  }
}

async function writeBufferAtomically(targetPath: string, payload: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tempPath, payload, { mode: 0o600 });
  await fs.rename(tempPath, targetPath);
}

function computeSnapshotSha256(db: Buffer, wal: Buffer | null, shm: Buffer | null): string {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(String(db.byteLength)));
  hash.update(Buffer.from([0]));
  hash.update(db);
  hash.update(Buffer.from([0]));
  if (wal) {
    hash.update(Buffer.from(String(wal.byteLength)));
    hash.update(Buffer.from([0]));
    hash.update(wal);
  }
  hash.update(Buffer.from([0]));
  if (shm) {
    hash.update(Buffer.from(String(shm.byteLength)));
    hash.update(Buffer.from([0]));
    hash.update(shm);
  }
  return hash.digest('hex');
}

async function ensureSnapshotTable(credential: TursoSessionCredential): Promise<void> {
  const sql = [
    `CREATE TABLE IF NOT EXISTS ${SESSION_SYNC_TABLE} (`,
    'id INTEGER PRIMARY KEY CHECK (id = 1),',
    'updated_at TEXT NOT NULL,',
    'machine_id TEXT NOT NULL,',
    'payload_sha256 TEXT NOT NULL,',
    'payload_db_b64 TEXT NOT NULL,',
    'payload_wal_b64 TEXT,',
    'payload_shm_b64 TEXT',
    ')',
  ].join(' ');
  await executeSql(credential, sql);
}

async function fetchRemoteSnapshot(credential: TursoSessionCredential): Promise<{
  db: Buffer;
  wal: Buffer | null;
  shm: Buffer | null;
  sha256: string;
  machineId: string;
  updatedAt: string;
} | null> {
  const query = [
    `SELECT json_object(`,
    "'updatedAt', updated_at,",
    "'machineId', machine_id,",
    "'sha256', payload_sha256,",
    "'db', payload_db_b64,",
    "'wal', payload_wal_b64,",
    "'shm', payload_shm_b64",
    `) FROM ${SESSION_SYNC_TABLE} WHERE id = 1`,
  ].join(' ');

  const payload = await querySingleText(credential, query);
  if (!payload) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    throw new SyncCommandError('Turso snapshot payload is not valid JSON.');
  }

  if (!isPlainObject(parsed)) {
    throw new SyncCommandError('Turso snapshot payload has unexpected structure.');
  }

  const dbB64 = typeof parsed.db === 'string' ? parsed.db : '';
  const walB64 = typeof parsed.wal === 'string' ? parsed.wal : null;
  const shmB64 = typeof parsed.shm === 'string' ? parsed.shm : null;
  const sha256 = typeof parsed.sha256 === 'string' ? parsed.sha256 : '';
  const machineId = typeof parsed.machineId === 'string' ? parsed.machineId : 'unknown';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';

  if (!dbB64 || !sha256) {
    throw new SyncCommandError('Turso snapshot payload is missing required session data.');
  }

  return {
    db: Buffer.from(dbB64, 'base64'),
    wal: walB64 ? Buffer.from(walB64, 'base64') : null,
    shm: shmB64 ? Buffer.from(shmB64, 'base64') : null,
    sha256,
    machineId,
    updatedAt,
  };
}

async function upsertRemoteSnapshot(
  credential: TursoSessionCredential,
  snapshot: SessionSnapshot,
  machineId: string
): Promise<void> {
  const upsert = [
    `INSERT INTO ${SESSION_SYNC_TABLE} (`,
    'id, updated_at, machine_id, payload_sha256, payload_db_b64, payload_wal_b64, payload_shm_b64',
    `) VALUES (1, ?, ?, ?, ?, ?, ?)`,
    'ON CONFLICT(id) DO UPDATE SET',
    'updated_at = excluded.updated_at,',
    'machine_id = excluded.machine_id,',
    'payload_sha256 = excluded.payload_sha256,',
    'payload_db_b64 = excluded.payload_db_b64,',
    'payload_wal_b64 = excluded.payload_wal_b64,',
    'payload_shm_b64 = excluded.payload_shm_b64',
  ].join(' ');

  const args: TursoSqlArg[] = [
    { type: 'text', value: new Date().toISOString() },
    { type: 'text', value: machineId },
    { type: 'text', value: snapshot.sha256 },
    { type: 'text', value: snapshot.db.toString('base64') },
    snapshot.wal ? { type: 'text', value: snapshot.wal.toString('base64') } : { type: 'null' },
    snapshot.shm ? { type: 'text', value: snapshot.shm.toString('base64') } : { type: 'null' },
  ];

  await executeSql(credential, upsert, args);
}

async function querySingleText(
  credential: TursoSessionCredential,
  sql: string,
  args: TursoSqlArg[] = []
): Promise<string | null> {
  const results = await executeSql(credential, sql, args);
  if (results.length === 0) {
    return null;
  }
  const first = results[0];
  const rows = extractRows(first);
  if (rows.length === 0) {
    return null;
  }

  const firstRow = rows[0];
  if (Array.isArray(firstRow)) {
    return decodeSqlCellToText(firstRow[0] ?? null);
  }
  if (isPlainObject(firstRow)) {
    const values = Object.values(firstRow);
    return decodeSqlCellToText(values[0] ?? null);
  }
  return null;
}

async function executeSql(
  credential: TursoSessionCredential,
  sql: string,
  args: TursoSqlArg[] = []
): Promise<unknown[]> {
  const body = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql,
          ...(args.length > 0 ? { args } : {}),
        },
      } satisfies TursoPipelineExecuteRequest,
      { type: 'close' } satisfies TursoPipelineCloseRequest,
    ],
  };

  const response = await fetch(`${credential.httpUrl}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new SyncCommandError(
      `Turso SQL request failed (${response.status}): ${text.slice(0, 500)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new SyncCommandError('Turso SQL response was not valid JSON.');
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.results)) {
    throw new SyncCommandError('Turso SQL response had unexpected shape.');
  }

  for (const result of parsed.results) {
    if (!isPlainObject(result)) continue;
    const resultError = result.error;
    if (resultError) {
      throw new SyncCommandError(`Turso SQL error: ${String(resultError)}`);
    }
  }

  return parsed.results;
}

function extractRows(result: unknown): unknown[] {
  if (!isPlainObject(result)) return [];
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

function decodeSqlCellToText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'bigint') return String(cell);

  if (!isPlainObject(cell)) return null;
  if (cell.type === 'null') return null;
  if (typeof cell.value === 'string') return cell.value;
  if (typeof cell.value === 'number' || typeof cell.value === 'bigint') return String(cell.value);
  if (typeof cell.base64 === 'string') {
    return Buffer.from(cell.base64, 'base64').toString('utf8');
  }

  return null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
