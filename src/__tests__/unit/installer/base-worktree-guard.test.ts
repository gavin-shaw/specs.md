/**
 * Unit + integration tests for the migration base-worktree guard.
 *
 * Migration must refuse to run from a linked worktree (git-dir != git-common-dir) before
 * any plan is built or file moved. Git is injected so tests never shell out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { guardBaseWorktree, checkBaseWorktree } = require('../../../lib/installers/base-worktree-guard');
const migrate = require('../../../lib/installers/migrate.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

const PORCELAIN = [
  'worktree /repo/proj',
  'branch refs/heads/main',
  '',
  'worktree /wt/feature-x',
  'branch refs/heads/feature-x',
  '',
].join('\n');

// A linked worktree: --git-dir points inside the main repo's worktrees/, --git-common-dir
// points at the main .git. A main worktree: both equal.
const linkedGitDirs = () => ({ gitDir: '/repo/proj/.git/worktrees/feature-x', commonDir: '/repo/proj/.git' });
const mainGitDirs = () => ({ gitDir: '.git', commonDir: '.git' });

describe('guardBaseWorktree', () => {
  it('blocks from a linked worktree and names the resolved base-worktree path', () => {
    const result = guardBaseWorktree('/wt/feature-x', {
      gitDirRunner: linkedGitDirs,
      gitRunner: () => PORCELAIN,
    });

    expect(result.blocked).toBe(true);
    expect(result.baseWorktreePath).toBe(resolve('/repo/proj'));
    expect(result.message).toContain(resolve('/repo/proj'));
  });

  it('does not block from the main worktree', () => {
    expect(guardBaseWorktree('/repo/proj', { gitDirRunner: mainGitDirs }).blocked).toBe(false);
  });

  it('treats a non-git directory as base (no crash, not blocked)', () => {
    const check = checkBaseWorktree('/plain/dir', { gitDirRunner: () => null });
    expect(check.isGit).toBe(false);
    expect(check.isBase).toBe(true);
    expect(guardBaseWorktree('/plain/dir', { gitDirRunner: () => null }).blocked).toBe(false);
  });
});

describe('migrate.cjs base-worktree guard', () => {
  let repoRoot: string;
  let baseHome: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'specsmd-guard-repo-'));
    baseHome = mkdtempSync(join(tmpdir(), 'specsmd-guard-home-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(baseHome, { recursive: true, force: true });
  });

  function createRepoLocalInstall() {
    mkdirSync(join(repoRoot, '.specs-fire', 'intents'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'runs'), { recursive: true });
    writeFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'project:\n  name: demo\n', 'utf8');
  }

  it('refuses --yes from a linked worktree without building a plan or moving files', async () => {
    createRepoLocalInstall();
    const projectKey = repoRoot.split('/').pop() as string;

    const result = await migrate.run(['node', 'migrate', '--yes', repoRoot], {
      baseHome,
      gitDirRunner: linkedGitDirs,
      gitRunner: () => PORCELAIN,
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('linked_worktree');
    expect(result.baseWorktreePath).toBe(resolve('/repo/proj'));
    // buildMigrationPlan output never surfaced.
    expect(result.moves).toBeUndefined();
    expect(result.removals).toBeUndefined();
    // No filesystem mutation occurred.
    expect(existsSync(join(repoRoot, '.specs-fire', 'state.yaml'))).toBe(true);
    expect(existsSync(join(baseHome, '.specs-fire', projectKey))).toBe(false);
    expect(existsSync(join(baseHome, '.specs-fire'))).toBe(false);
  });

  it('proceeds and builds a plan from the main worktree', async () => {
    createRepoLocalInstall();

    const result = await migrate.run(['node', 'migrate', '--check', repoRoot], {
      baseHome,
      gitDirRunner: mainGitDirs,
    });

    expect(result.status).toBe('pending');
    expect(result.moves.length).toBeGreaterThan(0);
  });
});
