/**
 * Unit tests for worktree-invariant project-key wiring.
 *
 * A worktree and its main tree must resolve to the same global artifact root, keyed on
 * the MAIN worktree basename. resolveArtifactPaths stays pure; the worktree lookup lives
 * in its callers (resolve-artifact-root.cjs, init-check.cjs). The git runner is injected
 * so tests never shell out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { tmpdir } from 'os';

/* eslint-disable @typescript-eslint/no-require-imports */
const { resolveArtifactRoot } = require('../../../lib/installers/resolve-artifact-root.cjs');
const { scriptArtifactEnv } = require('../../../lib/installers/global-rewrite');
const { checkInitialization } = require('../../../lib/installers/init-check.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

const PORCELAIN = [
  'worktree /repo/proj',
  'branch refs/heads/main',
  '',
  'worktree /wt/feature-x',
  'branch refs/heads/feature-x',
  '',
].join('\n');

describe('worktree-invariant project key', () => {
  it('keys the global artifact root on the main worktree from any linked worktree', () => {
    const fromLinked = resolveArtifactRoot('/wt/feature-x', {
      gitRunner: () => PORCELAIN,
      baseHome: '/home/me',
    });
    const fromMain = resolveArtifactRoot('/repo/proj', {
      gitRunner: () => PORCELAIN,
      baseHome: '/home/me',
    });

    expect(fromLinked).toBe(join('/home/me', '.specs-fire', 'proj'));
    expect(fromMain).toBe(fromLinked);
    expect(fromLinked).not.toContain('feature-x');
  });

  it('keeps resolveArtifactPaths filesystem-free (invariance lives in the caller)', () => {
    const source = readFileSync(join(__dirname, '../../../lib/installers/artifact-paths.js'), 'utf8');
    const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    for (const forbidden of ['fs', 'fs-extra', 'child_process']) {
      expect(requires).not.toContain(forbidden);
    }
  });

  it('emits a wrapper that calls the resolver and resolves to the main-worktree key', () => {
    const env = scriptArtifactEnv('/flow/root');
    expect(env).toContain('/flow/root/resolve-artifact-root.cjs');
    expect(env).toContain('{rootPath}');

    // The resolver the wrapper invokes yields the main-worktree-keyed root from a linked tree.
    const resolved = resolveArtifactRoot('/wt/feature-x', {
      gitRunner: () => PORCELAIN,
      baseHome: '/home/me',
    });
    expect(resolved).toBe(join('/home/me', '.specs-fire', 'proj'));
  });

  it('does not change the key for a plain single-tree repo (key == basename(repoRoot))', () => {
    const single = ['worktree /repo/solo', 'branch refs/heads/main', ''].join('\n');
    const withGit = resolveArtifactRoot('/repo/solo', { gitRunner: () => single, baseHome: '/home/me' });
    const nonGit = resolveArtifactRoot('/repo/solo', { gitRunner: () => null, baseHome: '/home/me' });

    expect(withGit).toBe(join('/home/me', '.specs-fire', 'solo'));
    expect(nonGit).toBe(join('/home/me', '.specs-fire', 'solo'));
  });

  describe('init-check from a linked worktree', () => {
    let baseHome: string;

    beforeEach(() => {
      baseHome = mkdtempSync(join(tmpdir(), 'wt-invariant-home-'));
    });

    afterEach(() => {
      rmSync(baseHome, { recursive: true, force: true });
    });

    it('reports initialized from a linked worktree with no local .specs-fire', () => {
      // Global state exists only under the MAIN worktree's key.
      mkdirSync(join(baseHome, '.specs-fire', 'proj'), { recursive: true });
      writeFileSync(join(baseHome, '.specs-fire', 'proj', 'state.yaml'), 'project:\n  name: proj\n', 'utf8');

      const result = checkInitialization('/wt/feature-x', {
        baseHome,
        gitRunner: () => PORCELAIN,
      });

      expect(result.initialized).toBe(true);
      expect(result.status).toBe('initialized');
      expect(result.globalStateExists).toBe(true);
      expect(result.repoLocalStateExists).toBe(false);
      expect(result.projectKey).toBe('proj');
      expect(result.globalArtifactRoot).toBe(join(baseHome, '.specs-fire', 'proj'));
      // The reported repoRoot is still the linked worktree itself.
      expect(result.repoRoot).toBe(resolve('/wt/feature-x'));
    });
  });
});
