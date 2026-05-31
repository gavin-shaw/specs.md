import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/* eslint-disable @typescript-eslint/no-require-imports */
const { checkInitialization, run } = require('../../../lib/installers/init-check.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('init-check', () => {
  let repoRoot: string;
  let baseHome: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'specsmd-init-repo-'));
    baseHome = mkdtempSync(join(tmpdir(), 'specsmd-init-home-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(baseHome, { recursive: true, force: true });
  });

  function projectKey() {
    return repoRoot.split('/').pop() as string;
  }

  it('detects a repo with only global FIRE state as initialized', () => {
    mkdirSync(join(baseHome, '.specs-fire', projectKey()), { recursive: true });
    writeFileSync(join(baseHome, '.specs-fire', projectKey(), 'state.yaml'), 'project:\n  name: demo\n', 'utf8');

    const result = checkInitialization(repoRoot, { baseHome });

    expect(result.status).toBe('initialized');
    expect(result.initialized).toBe(true);
    expect(result.globalStateExists).toBe(true);
    expect(result.repoLocalStateExists).toBe(false);
  });

  it('detects a repo with only repo-local FIRE state as initialized', () => {
    mkdirSync(join(repoRoot, '.specs-fire'), { recursive: true });
    writeFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'project:\n  name: demo\n', 'utf8');

    const result = checkInitialization(repoRoot, { baseHome });

    expect(result.status).toBe('initialized');
    expect(result.initialized).toBe(true);
    expect(result.globalStateExists).toBe(false);
    expect(result.repoLocalStateExists).toBe(true);
  });

  it('classifies a repo with neither FIRE state file as uninitialized', () => {
    const result = checkInitialization(repoRoot, { baseHome });

    expect(result.status).toBe('uninitialized');
    expect(result.initialized).toBe(false);
    expect(result.globalStatePath).toBe(join(baseHome, '.specs-fire', projectKey(), 'state.yaml'));
    expect(result.standardsRoot).toBe(join(repoRoot, '.docs'));
  });

  it('prints deterministic CLI-style output without touching the filesystem', async () => {
    const result = await run(['node', 'init-check', repoRoot], { baseHome });

    expect(result).toMatchObject({
      status: 'uninitialized',
      initialized: false,
      projectKey: projectKey(),
      repoRoot,
      globalArtifactRoot: join(baseHome, '.specs-fire', projectKey()),
      standardsRoot: join(repoRoot, '.docs')
    });
    expect(existsSync(join(repoRoot, '.specs-fire'))).toBe(false);
    expect(existsSync(join(baseHome, '.specs-fire'))).toBe(false);
  });
});
