import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  buildMigrationPlan,
  detectRepoLocalInstall,
  planRepoLocalMigration
} = require('../../../lib/installers/storage-migration');
const { installFlowGlobal } = require('../../../lib/installers/global-install');
/* eslint-enable @typescript-eslint/no-require-imports */

function snapshot(root: string): string[] {
  const entries: string[] = [];

  function visit(dir: string, prefix = '') {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? join(prefix, entry.name) : entry.name;
      entries.push(relative);
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), relative);
      }
    }
  }

  visit(root);
  return entries.sort();
}

describe('storage migration detection and confirmation', () => {
  let repoRoot: string;
  let baseHome: string;
  let originalCwd: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'specsmd-migration-repo-'));
    baseHome = mkdtempSync(join(tmpdir(), 'specsmd-migration-home-'));
    originalCwd = process.cwd();
    process.chdir(repoRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(baseHome, { recursive: true, force: true });
  });

  function createSpecsFire() {
    mkdirSync(join(repoRoot, '.specs-fire', 'standards'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'intents'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'runs'), { recursive: true });
    writeFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'project:\n  name: demo\n', 'utf8');
  }

  it('detects a repo-local .specs-fire install', async () => {
    createSpecsFire();

    const result = await detectRepoLocalInstall(repoRoot);

    expect(result.detected).toBe(true);
    expect(result.specsFire.map((item: { relativePath: string }) => item.relativePath)).toContain(join('.specs-fire', 'state.yaml'));
  });

  it('does not detect a clean repo', async () => {
    const result = await detectRepoLocalInstall(repoRoot);

    expect(result.detected).toBe(false);
    expect(result.specsFire).toEqual([]);
    expect(result.entryPoints).toEqual([]);
  });

  it('detects repo-local specsmd entry points without .specs-fire', async () => {
    mkdirSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire'), { recursive: true });
    mkdirSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire-builder'), { recursive: true });
    writeFileSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'), 'name: specsmd-fire\n', 'utf8');
    writeFileSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire-builder', 'SKILL.md'), 'name: specsmd-fire-builder\n', 'utf8');

    const result = await detectRepoLocalInstall(repoRoot);

    expect(result.detected).toBe(true);
    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'codex', relativePath: join('.codex', 'skills', 'specsmd-fire') }),
      expect.objectContaining({ tool: 'codex', relativePath: join('.codex', 'skills', 'specsmd-fire-builder') })
    ]));
  });

  it('builds a migration plan with moves and removals from resolver paths', async () => {
    createSpecsFire();
    mkdirSync(join(repoRoot, '.specsmd'), { recursive: true });
    mkdirSync(join(repoRoot, '.cursor', 'commands'), { recursive: true });
    writeFileSync(join(repoRoot, '.cursor', 'commands', 'specsmd-fire.md'), '# fire\n', 'utf8');

    const plan = await buildMigrationPlan(repoRoot, { baseHome });

    expect(plan.detected).toBe(true);
    expect(plan.projectKey).toBe(repoRoot.split('/').pop());
    expect(plan.globalArtifactRoot).toBe(join(baseHome, '.specs-fire', plan.projectKey));
    expect(plan.standardsRoot).toBe(join(repoRoot, '.docs'));
    expect(plan.moves).toEqual(expect.arrayContaining([
      { type: 'standards', from: join(repoRoot, '.specs-fire', 'standards'), to: join(repoRoot, '.docs') },
      { type: 'state.yaml', from: join(repoRoot, '.specs-fire', 'state.yaml'), to: join(plan.globalArtifactRoot, 'state.yaml') },
      { type: 'intents', from: join(repoRoot, '.specs-fire', 'intents'), to: join(plan.globalArtifactRoot, 'intents') },
      { type: 'runs', from: join(repoRoot, '.specs-fire', 'runs'), to: join(plan.globalArtifactRoot, 'runs') }
    ]));
    expect(plan.removals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'entry-point', tool: 'cursor' }),
      expect.objectContaining({ type: 'repo-local-flow', path: join(repoRoot, '.specsmd') }),
      expect.objectContaining({ type: 'retire-specs-fire', path: join(repoRoot, '.specs-fire') })
    ]));
  });

  it('flags a collision when the global artifact target already exists', async () => {
    createSpecsFire();
    const projectKey = repoRoot.split('/').pop();
    mkdirSync(join(baseHome, '.specs-fire', projectKey), { recursive: true });

    const plan = await buildMigrationPlan(repoRoot, { baseHome });

    expect(plan.collision).toBe(true);
  });

  it('decline returns skipped and performs no filesystem mutation', async () => {
    createSpecsFire();
    const beforeRepo = snapshot(repoRoot);
    const beforeHome = snapshot(baseHome);

    const result = await planRepoLocalMigration(repoRoot, {
      baseHome,
      prompt: async () => ({ confirm: false })
    });

    expect(result.status).toBe('skipped');
    expect(snapshot(repoRoot)).toEqual(beforeRepo);
    expect(snapshot(baseHome)).toEqual(beforeHome);
    expect(readFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'utf8')).toContain('demo');
  });

  it('global install does NOT migrate repo-local installs (orchestrator-triggered now)', async () => {
    createSpecsFire();
    const projectKey = repoRoot.split('/').pop() as string;
    const beforeRepo = snapshot(repoRoot);
    let migrationObserved = false;

    await installFlowGlobal('fire', ['codex'], {
      baseHome,
      repoRoot,
      // If install still called migration it would invoke prompt / onMigrationPlan.
      prompt: async () => {
        migrationObserved = true;
        return { confirm: true };
      },
      onMigrationPlan: () => {
        migrationObserved = true;
      }
    });

    expect(migrationObserved).toBe(false);
    // Repo-local artifacts untouched: nothing moved or removed.
    expect(snapshot(repoRoot)).toEqual(beforeRepo);
    expect(existsSync(join(repoRoot, '.specs-fire', 'state.yaml'))).toBe(true);
    // No global artifact root created for the project.
    expect(existsSync(join(baseHome, '.specs-fire', projectKey))).toBe(false);
    // Global skill still installed.
    expect(existsSync(join(baseHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'))).toBe(true);
  });
});
