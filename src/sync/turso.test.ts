import { describe, expect, it } from 'vitest';
import { normalizeSyncConfig } from './config.js';
import type { SyncLocations } from './paths.js';
import {
  extractHeadlessLoginHints,
  isRetryableTursoError,
  resolveSessionDbPaths,
  resolveTursoCredentialPath,
  resolveTursoDatabaseName,
} from './turso.js';

function createLocations(): SyncLocations {
  return {
    xdg: {
      homeDir: '/home/test',
      configDir: '/home/test/.config',
      dataDir: '/home/test/.local/share',
      stateDir: '/home/test/.local/state',
    },
    configRoot: '/home/test/.config/opencode',
    syncConfigPath: '/home/test/.config/opencode/opencode-synced.jsonc',
    overridesPath: '/home/test/.config/opencode/opencode-synced.overrides.jsonc',
    statePath: '/home/test/.local/share/opencode/sync-state.json',
    defaultRepoDir: '/home/test/.local/share/opencode/opencode-synced/repo',
  };
}

describe('resolveTursoDatabaseName', () => {
  it('uses explicit database name when configured', () => {
    const config = normalizeSyncConfig({
      repo: { owner: 'acme', name: 'my-opencode-config' },
      includeSessions: true,
      sessionBackend: {
        type: 'turso',
        turso: {
          database: 'Custom DB Name',
        },
      },
    });

    expect(resolveTursoDatabaseName(config)).toBe('custom-db-name');
  });

  it('derives database name from repo when not explicitly configured', () => {
    const config = normalizeSyncConfig({
      repo: { owner: 'acme', name: 'my-opencode-config' },
      includeSessions: true,
      sessionBackend: { type: 'turso' },
    });

    expect(resolveTursoDatabaseName(config)).toBe('my-opencode-config-sessions');
  });
});

describe('extractHeadlessLoginHints', () => {
  it('extracts login url and code from headless output', () => {
    const text = [
      'To authenticate, open:',
      'https://auth.turso.tech/activate',
      'Then enter code: ABCD-EFGH',
    ].join('\n');

    expect(extractHeadlessLoginHints(text)).toEqual({
      url: 'https://auth.turso.tech/activate',
      code: 'ABCD-EFGH',
    });
  });
});

describe('isRetryableTursoError', () => {
  it('detects retryable errors', () => {
    expect(isRetryableTursoError(new Error('database is busy'))).toBe(true);
    expect(isRetryableTursoError(new Error('HTTP 503'))).toBe(true);
    expect(isRetryableTursoError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('does not mark non-retryable errors as retryable', () => {
    expect(isRetryableTursoError(new Error('invalid auth token'))).toBe(false);
  });
});

describe('path helpers', () => {
  it('resolves credential path and session db paths', () => {
    const locations = createLocations();
    expect(resolveTursoCredentialPath(locations)).toBe(
      '/home/test/.local/share/opencode/opencode-synced/turso-session.json'
    );
    expect(resolveSessionDbPaths(locations)).toEqual({
      dbPath: '/home/test/.local/share/opencode/opencode.db',
      walPath: '/home/test/.local/share/opencode/opencode.db-wal',
      shmPath: '/home/test/.local/share/opencode/opencode.db-shm',
    });
  });
});
