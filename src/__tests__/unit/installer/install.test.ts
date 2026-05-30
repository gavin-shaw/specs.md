import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { parseFlowFlag, parseToolsFlag } = require('../../../lib/installer');
const CLIUtils = require('../../../lib/cli-utils');
/* eslint-enable @typescript-eslint/no-require-imports */

// Note on testing strategy:
// vitest's vi.mock does not intercept Node CJS `require()` calls (only ESM
// imports). Since installer.js is CJS and pulls in prompts/fs-extra/etc via
// require(), we can't sandbox the full `install()` flow through module mocks.
// Instead we test the two pure helpers directly (covers all flag validation
// branches incl. error paths), plus a subprocess test that exercises the
// happy-path flag wiring end-to-end against the real CLI.

describe('parseFlowFlag', () => {
  let displayErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    displayErrorSpy = vi.spyOn(CLIUtils, 'displayError').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    displayErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('returns the value when it is a valid flow key', () => {
    expect(parseFlowFlag('fire')).toBe('fire');
    expect(parseFlowFlag('simple')).toBe('simple');
    expect(parseFlowFlag('aidlc')).toBe('aidlc');
  });

  it('exits 1 with a helpful message when the value is unknown', () => {
    expect(() => parseFlowFlag('bogus')).toThrow('exit:1');

    expect(displayErrorSpy).toHaveBeenCalledOnce();
    const msg = displayErrorSpy.mock.calls[0][0] as string;
    expect(msg).toContain('bogus');
    expect(msg).toContain('fire');
    expect(msg).toContain('simple');
    expect(msg).toContain('aidlc');
  });
});

describe('parseToolsFlag', () => {
  let displayErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const installers = [
    { key: 'claude' },
    { key: 'cursor' },
    { key: 'codex' }
  ];

  beforeEach(() => {
    displayErrorSpy = vi.spyOn(CLIUtils, 'displayError').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    displayErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('parses a comma-separated list', () => {
    expect(parseToolsFlag('claude,cursor', installers)).toEqual(['claude', 'cursor']);
  });

  it('trims whitespace around entries', () => {
    expect(parseToolsFlag(' claude , cursor ', installers)).toEqual(['claude', 'cursor']);
  });

  it('accepts a single tool', () => {
    expect(parseToolsFlag('codex', installers)).toEqual(['codex']);
  });

  it('exits 1 listing the bad keys and the valid keys when an entry is invalid', () => {
    expect(() => parseToolsFlag('claude,bogus', installers)).toThrow('exit:1');

    expect(displayErrorSpy).toHaveBeenCalledOnce();
    const msg = displayErrorSpy.mock.calls[0][0] as string;
    expect(msg).toContain('bogus');
    expect(msg).toContain('claude');
    expect(msg).toContain('cursor');
  });

  it('exits 1 when the value is empty', () => {
    expect(() => parseToolsFlag('', installers)).toThrow('exit:1');

    expect(displayErrorSpy).toHaveBeenCalledOnce();
    expect(displayErrorSpy.mock.calls[0][0]).toContain('at least one tool');
  });

  it('exits 1 when the value is only whitespace and commas', () => {
    expect(() => parseToolsFlag(' , , ', installers)).toThrow('exit:1');
  });
});

describe('install CLI (subprocess integration)', () => {
  const CLI_PATH = join(__dirname, '..', '..', '..', 'bin', 'cli.js');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'specsmd-install-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runInstall(args: string[], extraEnv: Record<string, string> = {}): ReturnType<typeof spawnSync> {
    return spawnSync('node', [CLI_PATH, 'install', ...args], {
      cwd: tmpDir,
      // No stdin — if the install tries to prompt, it would hang or fail.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv, SPECSMD_ANALYTICS_DISABLED: '1' },
      timeout: 30_000
    });
  }

  it('runs unattended with --flow and --tools and writes the expected manifest', () => {
    const result = runInstall(['--flow', 'fire', '--tools', 'claude,cursor,codex']);

    expect(result.status).toBe(0);

    const manifestPath = join(tmpDir, '.specsmd', 'manifest.yaml');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('flow: fire');
    expect(manifest).toContain('claude');
    expect(manifest).toContain('cursor');
    expect(manifest).toContain('codex');

    // Each tool gets a per-tool command directory.
    expect(existsSync(join(tmpDir, '.claude'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cursor'))).toBe(true);
    expect(existsSync(join(tmpDir, '.codex'))).toBe(true);
  });

  it('exits non-zero with a valid-flow list and touches nothing on an invalid --flow', () => {
    const result = runInstall(['--flow', 'bogus', '--tools', 'claude']);

    expect(result.status).not.toBe(0);
    expect(String(result.stdout) + String(result.stderr)).toMatch(/bogus/);
    expect(String(result.stdout) + String(result.stderr)).toMatch(/fire/);

    // No directories should have been written.
    expect(readdirSync(tmpDir)).toEqual([]);
  });

  it('exits non-zero with a valid-tool list and touches nothing on an invalid --tools', () => {
    const result = runInstall(['--flow', 'fire', '--tools', 'claude,bogus']);

    expect(result.status).not.toBe(0);
    expect(String(result.stdout) + String(result.stderr)).toMatch(/bogus/);
    expect(String(result.stdout) + String(result.stderr)).toMatch(/claude/);

    expect(readdirSync(tmpDir)).toEqual([]);
  });

  it('installs globally with --global without creating per-repo specsmd artifacts', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'specsmd-global-cli-home-'));
    try {
      const result = runInstall(['--global', '--flow', 'fire', '--tools', 'codex'], { HOME: tmpHome });

      expect(result.status).toBe(0);
      expect(existsSync(join(tmpDir, '.specsmd'))).toBe(false);
      expect(existsSync(join(tmpHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('rejects unsupported tools for --global and leaves no partial global install', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'specsmd-global-cli-home-'));
    try {
      const result = runInstall(['--global', '--flow', 'fire', '--tools', 'gemini'], { HOME: tmpHome });

      expect(result.status).not.toBe(0);
      expect(String(result.stdout) + String(result.stderr)).toMatch(/Global install supports only/);
      expect(existsSync(join(tmpHome, '.gemini'))).toBe(false);
      expect(existsSync(join(tmpDir, '.specsmd'))).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
