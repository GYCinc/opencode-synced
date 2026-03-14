import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  chmodIfExists,
  deepMerge,
  hasOwn,
  parseJsonc,
  pathExists,
  stripOverrides,
  writeJsonFile,
} from './config.js';
import {
  extractMcpSecrets,
  hasOverrides,
  mergeOverrides,
  stripOverrideKeys,
} from './mcp-secrets.js';
import type { ExtraPathPlan, SyncItem, SyncPlan } from './paths.js';
import { normalizePath } from './paths.js';

type ExtraPathType = 'file' | 'dir';

interface ExtraPathManifestItem {
  relativePath: string;
  type: ExtraPathType;
  mode?: number;
}

interface ExtraPathManifestEntry {
  sourcePath: string;
  repoPath: string;
  type?: ExtraPathType;
  mode?: number;
  items?: ExtraPathManifestItem[];
}

interface ExtraPathManifest {
  entries: ExtraPathManifestEntry[];
}

export let CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
export const CHUNK_SUFFIX = '.ocsync-chunk.';

export function setChunkSizeForTesting(size: number) {
  CHUNK_SIZE = size;
}

export async function syncRepoToLocal(
  plan: SyncPlan,
  overrides: Record<string, unknown> | null
): Promise<void> {
  for (const item of plan.items) {
    await copyItem(item.repoPath, item.localPath, item.type, false, false);
  }

  await applyExtraPaths(plan, plan.extraConfigs);
  await applyExtraPaths(plan, plan.extraSecrets);

  if (overrides && Object.keys(overrides).length > 0) {
    await applyOverridesToLocalConfig(plan, overrides);
  }
}

export async function syncLocalToRepo(
  plan: SyncPlan,
  overrides: Record<string, unknown> | null,
  options: { overridesPath?: string; allowMcpSecrets?: boolean } = {}
): Promise<void> {
  const configItems = plan.items.filter((item) => item.isConfigFile);
  const sanitizedConfigs = new Map<string, Record<string, unknown>>();
  let secretOverrides: Record<string, unknown> = {};
  const allowMcpSecrets = Boolean(options.allowMcpSecrets);

  for (const item of configItems) {
    if (!(await pathExists(item.localPath))) continue;

    const content = await fs.readFile(item.localPath, 'utf8');
    const parsed = parseJsonc<Record<string, unknown>>(content);
    const { sanitizedConfig, secretOverrides: extracted } = extractMcpSecrets(parsed);
    if (!allowMcpSecrets) {
      sanitizedConfigs.set(item.localPath, sanitizedConfig);
    }
    if (hasOverrides(extracted)) {
      secretOverrides = mergeOverrides(secretOverrides, extracted);
    }
  }

  let overridesForStrip = overrides;
  if (hasOverrides(secretOverrides)) {
    if (!allowMcpSecrets) {
      const baseOverrides = overrides ?? {};
      const mergedOverrides = mergeOverrides(baseOverrides, secretOverrides);
      if (options.overridesPath && !isDeepEqual(baseOverrides, mergedOverrides)) {
        await writeJsonFile(options.overridesPath, mergedOverrides, { jsonc: true });
      }
    }
    overridesForStrip = overrides ? stripOverrideKeys(overrides, secretOverrides) : overrides;
  }

  for (const item of plan.items) {
    if (item.isConfigFile) {
      const sanitized = sanitizedConfigs.get(item.localPath);
      await copyConfigForRepo(item, overridesForStrip, plan.repoRoot, sanitized);
      continue;
    }

    await copyItem(item.localPath, item.repoPath, item.type, true, true);
  }

  await writeExtraPathManifest(plan, plan.extraConfigs);
  await writeExtraPathManifest(plan, plan.extraSecrets);
}

async function copyItem(
  sourcePath: string,
  destinationPath: string,
  type: SyncItem['type'],
  removeWhenMissing = false,
  toRepo = false
): Promise<void> {
  const sourceExists = await pathExists(sourcePath);
  const sourceChunks = type === 'file' ? await findChunks(sourcePath) : [];

  if (!sourceExists && sourceChunks.length === 0) {
    if (removeWhenMissing) {
      await removePath(destinationPath);
      if (toRepo) {
        await removeChunks(destinationPath);
      }
    }
    return;
  }

  if (type === 'file') {
    if (toRepo) {
      const stat = await fs.stat(sourcePath);
      if (stat.size > CHUNK_SIZE) {
        await removePath(destinationPath);
        await removeChunks(destinationPath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await splitIntoChunks(sourcePath, destinationPath);
        return;
      }
      await removeChunks(destinationPath);
    } else {
      if (sourceChunks.length > 0) {
        await reassembleChunks(path.dirname(sourcePath), sourceChunks, destinationPath);
        const firstChunkStat = await fs.stat(path.join(path.dirname(sourcePath), sourceChunks[0]));
        await chmodIfExists(destinationPath, firstChunkStat.mode & 0o777);
        return;
      }
    }

    await copyFileWithMode(sourcePath, destinationPath);
    return;
  }

  await removePath(destinationPath);
  if (toRepo) {
    await removeChunks(destinationPath);
  }
  await copyDirRecursive(sourcePath, destinationPath, toRepo);
}

async function copyConfigForRepo(
  item: SyncItem,
  overrides: Record<string, unknown> | null,
  repoRoot: string,
  configOverride?: Record<string, unknown>
): Promise<void> {
  if (!(await pathExists(item.localPath))) {
    await removePath(item.repoPath);
    return;
  }

  const localConfig =
    configOverride ??
    parseJsonc<Record<string, unknown>>(await fs.readFile(item.localPath, 'utf8'));
  const baseConfig = await readRepoConfig(item, repoRoot);
  const effectiveOverrides = overrides ?? {};
  if (baseConfig) {
    const expectedLocal = deepMerge(baseConfig, effectiveOverrides) as Record<string, unknown>;
    if (isDeepEqual(localConfig, expectedLocal)) {
      return;
    }
  }
  const stripped = stripOverrides(localConfig, effectiveOverrides, baseConfig);
  const stat = await fs.stat(item.localPath);
  await fs.mkdir(path.dirname(item.repoPath), { recursive: true });
  await writeJsonFile(item.repoPath, stripped, {
    jsonc: item.localPath.endsWith('.jsonc'),
    mode: stat.mode & 0o777,
  });
}

async function readRepoConfig(
  item: SyncItem,
  repoRoot: string
): Promise<Record<string, unknown> | null> {
  if (!item.repoPath.startsWith(repoRoot)) {
    return null;
  }
  if (!(await pathExists(item.repoPath))) {
    return null;
  }
  const content = await fs.readFile(item.repoPath, 'utf8');
  return parseJsonc<Record<string, unknown>>(content);
}

async function applyOverridesToLocalConfig(
  plan: SyncPlan,
  overrides: Record<string, unknown>
): Promise<void> {
  const configFiles = plan.items.filter((item) => item.isConfigFile);
  for (const item of configFiles) {
    if (!(await pathExists(item.localPath))) continue;

    const content = await fs.readFile(item.localPath, 'utf8');
    const parsed = parseJsonc<Record<string, unknown>>(content);
    const merged = deepMerge(parsed, overrides) as Record<string, unknown>;
    const stat = await fs.stat(item.localPath);
    await writeJsonFile(item.localPath, merged, {
      jsonc: item.localPath.endsWith('.jsonc'),
      mode: stat.mode & 0o777,
    });
  }
}

async function copyFileWithMode(sourcePath: string, destinationPath: string): Promise<void> {
  const stat = await fs.stat(sourcePath);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  await chmodIfExists(destinationPath, stat.mode & 0o777);
}

async function copyDirRecursive(
  sourcePath: string,
  destinationPath: string,
  toRepo = false
): Promise<void> {
  const stat = await fs.stat(sourcePath);
  await fs.mkdir(destinationPath, { recursive: true });
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });

  const processedFiles = new Set<string>();

  if (!toRepo) {
    const chunksByBaseFile = new Map<string, string[]>();
    for (const entry of entries) {
      if (entry.isFile() && entry.name.includes(CHUNK_SUFFIX)) {
        const baseName = entry.name.split(CHUNK_SUFFIX)[0];
        if (baseName) {
          const chunks = chunksByBaseFile.get(baseName) ?? [];
          chunks.push(entry.name);
          chunksByBaseFile.set(baseName, chunks);
        }
      }
    }

    for (const [baseName, chunks] of chunksByBaseFile.entries()) {
      const destFile = path.join(destinationPath, baseName);
      await reassembleChunks(sourcePath, chunks, destFile);
      const firstChunkStat = await fs.stat(path.join(sourcePath, chunks[0]));
      await chmodIfExists(destFile, firstChunkStat.mode & 0o777);
      for (const chunk of chunks) processedFiles.add(chunk);
    }
  }

  for (const entry of entries) {
    if (processedFiles.has(entry.name)) continue;

    const entrySource = path.join(sourcePath, entry.name);
    const entryDest = path.join(destinationPath, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(entrySource, entryDest, toRepo);
      continue;
    }

    if (entry.isFile()) {
      if (toRepo) {
        const fileStat = await fs.stat(entrySource);
        if (fileStat.size > CHUNK_SIZE) {
          await splitIntoChunks(entrySource, entryDest);
          continue;
        }
        await removeChunks(entryDest);
      }
      await copyFileWithMode(entrySource, entryDest);
    }
  }

  await chmodIfExists(destinationPath, stat.mode & 0o777);
}

async function removePath(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function applyExtraPaths(plan: SyncPlan, extra: ExtraPathPlan): Promise<void> {
  const allowlist = extra.allowlist;
  if (allowlist.length === 0) return;

  if (!(await pathExists(extra.manifestPath))) return;

  const manifestContent = await fs.readFile(extra.manifestPath, 'utf8');
  const manifest = parseJsonc<ExtraPathManifest>(manifestContent);

  for (const entry of manifest.entries) {
    const normalized = normalizePath(entry.sourcePath, plan.homeDir, plan.platform);
    const isAllowed = allowlist.includes(normalized);
    if (!isAllowed) continue;

    const repoPath = path.isAbsolute(entry.repoPath)
      ? entry.repoPath
      : path.join(plan.repoRoot, entry.repoPath);
    const localPath = entry.sourcePath;
    const entryType: ExtraPathType = entry.type ?? 'file';

    const repoExists = await pathExists(repoPath);
    const repoChunks = entryType === 'file' ? await findChunks(repoPath) : [];

    if (!repoExists && repoChunks.length === 0) continue;

    await copyItem(repoPath, localPath, entryType, false, false);
    await applyExtraPathModes(localPath, entry);
  }
}

async function writeExtraPathManifest(plan: SyncPlan, extra: ExtraPathPlan): Promise<void> {
  const allowlist = extra.allowlist;
  const extraDir = path.join(path.dirname(extra.manifestPath), 'extra');
  if (allowlist.length === 0) {
    await removePath(extra.manifestPath);
    await removePath(extraDir);
    return;
  }

  await removePath(extraDir);

  const entries: ExtraPathManifestEntry[] = [];

  for (const entry of extra.entries) {
    const sourcePath = entry.sourcePath;
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await copyItem(sourcePath, entry.repoPath, 'dir', true, true);
      const items = await collectExtraPathItems(sourcePath, sourcePath);
      entries.push({
        sourcePath,
        repoPath: path.relative(plan.repoRoot, entry.repoPath),
        type: 'dir',
        mode: stat.mode & 0o777,
        items,
      });
      continue;
    }
    if (stat.isFile()) {
      await copyItem(sourcePath, entry.repoPath, 'file', true, true);
      entries.push({
        sourcePath,
        repoPath: path.relative(plan.repoRoot, entry.repoPath),
        type: 'file',
        mode: stat.mode & 0o777,
      });
    }
  }

  await fs.mkdir(path.dirname(extra.manifestPath), { recursive: true });
  await writeJsonFile(extra.manifestPath, { entries }, { jsonc: false });
}

async function collectExtraPathItems(
  sourcePath: string,
  basePath: string
): Promise<ExtraPathManifestItem[]> {
  const items: ExtraPathManifestItem[] = [];
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const entrySource = path.join(sourcePath, entry.name);
    const relativePath = path.relative(basePath, entrySource);

    if (entry.isDirectory()) {
      const stat = await fs.stat(entrySource);
      items.push({
        relativePath,
        type: 'dir',
        mode: stat.mode & 0o777,
      });
      const nested = await collectExtraPathItems(entrySource, basePath);
      items.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      const stat = await fs.stat(entrySource);
      items.push({
        relativePath,
        type: 'file',
        mode: stat.mode & 0o777,
      });
    }
  }

  return items;
}

async function applyExtraPathModes(
  targetPath: string,
  entry: ExtraPathManifestEntry
): Promise<void> {
  if (entry.mode !== undefined) {
    await chmodIfExists(targetPath, entry.mode);
  }

  if (entry.type !== 'dir') {
    return;
  }

  if (!entry.items || entry.items.length === 0) {
    return;
  }

  for (const item of entry.items) {
    if (item.mode === undefined) continue;
    const itemPath = resolveExtraPathItem(targetPath, item.relativePath);
    if (!itemPath) continue;
    await chmodIfExists(itemPath, item.mode);
  }
}

function resolveExtraPathItem(basePath: string, relativePath: string): string | null {
  if (!relativePath) return null;
  if (path.isAbsolute(relativePath)) return null;

  const resolvedBase = path.resolve(basePath);
  const resolvedPath = path.resolve(basePath, relativePath);
  const relative = path.relative(resolvedBase, resolvedPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  if (path.isAbsolute(relative)) {
    return null;
  }

  return resolvedPath;
}

export async function splitIntoChunks(sourcePath: string, destinationBase: string): Promise<void> {
  const stat = await fs.stat(sourcePath);
  const fd = await fs.open(sourcePath, 'r');
  try {
    let chunkIndex = 0;
    let bytesRead = 0;
    const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, 1024 * 1024));

    while (bytesRead < stat.size) {
      const chunkPath = `${destinationBase}${CHUNK_SUFFIX}${chunkIndex}`;
      const chunkFd = await fs.open(chunkPath, 'w');
      try {
        let currentChunkBytes = 0;
        while (currentChunkBytes < CHUNK_SIZE && bytesRead < stat.size) {
          const toRead = Math.min(
            buffer.length,
            CHUNK_SIZE - currentChunkBytes,
            stat.size - bytesRead
          );
          const { bytesRead: n } = await fd.read(buffer, 0, toRead, bytesRead);
          await chunkFd.write(buffer, 0, n);
          bytesRead += n;
          currentChunkBytes += n;
        }
      } finally {
        await chunkFd.close();
      }
      chunkIndex++;
    }
  } finally {
    await fd.close();
  }
}

export async function reassembleChunks(
  sourceDir: string,
  chunkNames: string[],
  destinationPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const destFd = await fs.open(destinationPath, 'w');
  try {
    const sortedChunks = [...chunkNames].sort((a, b) => {
      const partsA = a.split(CHUNK_SUFFIX);
      const partsB = b.split(CHUNK_SUFFIX);
      const idxA = Number.parseInt(partsA[partsA.length - 1] ?? '0', 10);
      const idxB = Number.parseInt(partsB[partsB.length - 1] ?? '0', 10);
      return idxA - idxB;
    });

    for (const chunkName of sortedChunks) {
      const chunkPath = path.join(sourceDir, chunkName);
      const chunkContent = await fs.readFile(chunkPath);
      await destFd.write(chunkContent);
    }
  } finally {
    await destFd.close();
  }
}

async function removeChunks(basePath: string): Promise<void> {
  const dir = path.dirname(basePath);
  const baseName = path.basename(basePath);
  if (!(await pathExists(dir))) return;

  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith(baseName + CHUNK_SUFFIX)) {
      await fs.rm(path.join(dir, entry), { force: true });
    }
  }
}

async function findChunks(basePath: string): Promise<string[]> {
  const dir = path.dirname(basePath);
  const baseName = path.basename(basePath);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries.filter((e) => e.startsWith(baseName + CHUNK_SUFFIX));
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (!left || !right) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!isDeepEqual(left[i], right[i])) return false;
    }
    return true;
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left as Record<string, unknown>);
    const rightKeys = Object.keys(right as Record<string, unknown>);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!hasOwn(right as Record<string, unknown>, key)) return false;
      if (
        !isDeepEqual(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key]
        )
      ) {
        return false;
      }
    }
    return true;
  }

  return false;
}
