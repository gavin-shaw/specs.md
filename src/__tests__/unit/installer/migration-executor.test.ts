import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { executeMigration, MARKER_NAME } = require('../../../lib/installers/migration-executor');
const { buildMigrationPlan } = require('../../../lib/installers/storage-migration');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('executeMigration', () => {
  let repoRoot: string;
  let baseHome: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'specsmd-exec-repo-'));
    baseHome = mkdtempSync(join(tmpdir(), 'specsmd-exec-home-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(baseHome, { recursive: true, force: true });
  });

  function createRepoLocalInstall() {
    mkdirSync(join(repoRoot, '.specs-fire', 'standards'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'intents', 'demo'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'runs', 'run-001'), { recursive: true });
    writeFileSync(join(repoRoot, '.specs-fire', 'standards', 'constitution.md'), '# Constitution\n', 'utf8');
    writeFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'project:\n  name: demo\n', 'utf8');
    writeFileSync(join(repoRoot, '.specs-fire', 'intents', 'demo', 'brief.md'), '# Brief\n', 'utf8');
    writeFileSync(join(repoRoot, '.specs-fire', 'runs', 'run-001', 'run.md'), '# Run\n', 'utf8');

    mkdirSync(join(repoRoot, '.claude', 'commands'), { recursive: true });
    mkdirSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire'), { recursive: true });
    mkdirSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire-builder'), { recursive: true });
    mkdirSync(join(repoRoot, '.cursor', 'commands'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'commands', 'specsmd-fire.md'), '# fire\n', 'utf8');
    writeFileSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'), '# fire\n', 'utf8');
    writeFileSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire-builder', 'SKILL.md'), '# builder\n', 'utf8');
    writeFileSync(join(repoRoot, '.cursor', 'commands', 'specsmd-fire.md'), '# fire\n', 'utf8');
  }

  it('moves standards and artifacts, removes entry points, and retires .specs-fire', async () => {
    createRepoLocalInstall();
    const plan = await buildMigrationPlan(repoRoot, { baseHome });

    const result = await executeMigration(plan);

    expect(result.status).toBe('completed');
    expect(existsSync(join(repoRoot, '.docs', 'constitution.md'))).toBe(true);
    expect(existsSync(join(plan.globalArtifactRoot, 'state.yaml'))).toBe(true);
    expect(existsSync(join(plan.globalArtifactRoot, 'intents', 'demo', 'brief.md'))).toBe(true);
    expect(existsSync(join(plan.globalArtifactRoot, 'runs', 'run-001', 'run.md'))).toBe(true);
    expect(existsSync(join(repoRoot, '.specs-fire'))).toBe(false);
    expect(existsSync(join(repoRoot, '.claude', 'commands', 'specsmd-fire.md'))).toBe(false);
    expect(existsSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire'))).toBe(false);
    expect(existsSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire-builder'))).toBe(false);
    expect(existsSync(join(repoRoot, '.cursor', 'commands', 'specsmd-fire.md'))).toBe(false);
    expect(existsSync(join(plan.globalArtifactRoot, MARKER_NAME))).toBe(true);
  });

  it('keeps source intact when a copy fails mid-migration', async () => {
    createRepoLocalInstall();
    const plan = await buildMigrationPlan(repoRoot, { baseHome });
    const ops = {
      ...require('fs-extra'),
      copy: async (from: string, to: string, options: unknown) => {
        if (from.endsWith('state.yaml')) {
          throw new Error('injected failure');
        }
        return require('fs-extra').copy(from, to, options);
      }
    };

    await expect(executeMigration(plan, { ops })).rejects.toThrow('injected failure');

    expect(existsSync(join(repoRoot, '.specs-fire', 'state.yaml'))).toBe(true);
    expect(readFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'utf8')).toContain('demo');
  });

  it('is a safe no-op when re-run after completion', async () => {
    createRepoLocalInstall();
    const plan = await buildMigrationPlan(repoRoot, { baseHome });

    await executeMigration(plan);
    const rerun = await executeMigration(plan);

    expect(rerun.status).toBe('noop');
    expect(readdirSync(join(plan.globalArtifactRoot, 'runs'))).toEqual(['run-001']);
  });

  it('blocks when the global artifact target collides', async () => {
    createRepoLocalInstall();
    const projectKey = repoRoot.split('/').pop();
    mkdirSync(join(baseHome, '.specs-fire', projectKey), { recursive: true });
    writeFileSync(join(baseHome, '.specs-fire', projectKey, 'state.yaml'), 'existing: true\n', 'utf8');
    const plan = await buildMigrationPlan(repoRoot, { baseHome });

    const result = await executeMigration(plan);

    expect(result.status).toBe('blocked');
    expect(existsSync(join(repoRoot, '.specs-fire', 'state.yaml'))).toBe(true);
  });
});
