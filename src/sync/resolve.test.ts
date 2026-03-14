import { describe, expect, it } from 'vitest';
import { applyOverridesToRuntimeConfig } from './config.js';

describe('applyOverridesToRuntimeConfig environment resolution', () => {
  it('resolves {env:VAR} placeholders from process.env', () => {
    process.env.TEST_VAR = 'secret-value';
    process.env.OTHER_VAR = 'other-value';

    const config: Record<string, unknown> = {
      mcp: {
        github: {
          headers: {
            Authorization: 'Bearer {env:TEST_VAR}',
          },
          other: '{env:OTHER_VAR}',
        },
      },
      unrelated: 'keep-me',
    };

    const overrides = {
      mcp: {
        github: {
          headers: {
            Authorization: 'Bearer {env:TEST_VAR}',
          },
        },
      },
    };

    // We apply overrides (which might already contain placeholders)
    applyOverridesToRuntimeConfig(config, overrides);

    const mcp = config.mcp as Record<string, Record<string, Record<string, string>>>;
    expect(mcp.github.headers.Authorization).toBe('Bearer secret-value');
    expect(mcp.github.other).toBe('other-value');
    expect(config.unrelated).toBe('keep-me');

    delete process.env.TEST_VAR;
    delete process.env.OTHER_VAR;
  });

  it('handles missing environment variables by leaving placeholder intact', () => {
    process.env.PRESENT_VAR = 'present';
    delete process.env.ABSENT_VAR;

    const config: Record<string, unknown> = {
      val: '{env:PRESENT_VAR}',
      missing: '{env:ABSENT_VAR}',
    };

    applyOverridesToRuntimeConfig(config, {});

    expect(config.val).toBe('present');
    // If it's missing, we keep it as is to avoid breaking things silently or passing empty strings
    // that might be harder to debug.
    expect(config.missing).toBe('{env:ABSENT_VAR}');

    delete process.env.PRESENT_VAR;
  });
});
