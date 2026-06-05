/**
 * Unit tests for main-worktree.js (resolveMainWorktreeRoot)
 *
 * The git runner is injected so tests never shell out or depend on the developer's
 * real worktrees. Resolution must reuse the dashboard porcelain parser and return the
 * main worktree path from any linked worktree, falling back to the input when not git.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveMainWorktreeRoot } = require('../../../lib/installers/main-worktree');

const PORCELAIN = [
  'worktree /repo/proj',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /wt/feature-x',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature-x',
  '',
].join('\n');

describe('resolveMainWorktreeRoot', () => {
  it('returns the main worktree path when called from a linked worktree', () => {
    const result = resolveMainWorktreeRoot('/wt/feature-x', {
      gitRunner: () => PORCELAIN,
    });
    expect(result).toBe(resolve('/repo/proj'));
  });

  it('returns the main worktree path when called from the main worktree itself', () => {
    const result = resolveMainWorktreeRoot('/repo/proj', {
      gitRunner: () => PORCELAIN,
    });
    expect(result).toBe(resolve('/repo/proj'));
  });

  it('reuses the porcelain parser: first parsed entry is the main worktree', () => {
    // Three worktrees; the resolver must pick the first regardless of input order.
    const porcelain = [
      'worktree /main/root',
      'branch refs/heads/main',
      '',
      'worktree /linked/a',
      'branch refs/heads/a',
      '',
      'worktree /linked/b',
      'branch refs/heads/b',
      '',
    ].join('\n');
    expect(resolveMainWorktreeRoot('/linked/b', { gitRunner: () => porcelain })).toBe(resolve('/main/root'));
  });

  it('returns the input path unchanged when git reports no repo (null output)', () => {
    const result = resolveMainWorktreeRoot('/some/dir', { gitRunner: () => null });
    expect(result).toBe(resolve('/some/dir'));
  });

  it('returns the input path unchanged when the git runner throws', () => {
    const result = resolveMainWorktreeRoot('/some/dir', {
      gitRunner: () => {
        throw new Error('git not found');
      },
    });
    expect(result).toBe(resolve('/some/dir'));
  });

  it('returns the input path when porcelain output is empty', () => {
    expect(resolveMainWorktreeRoot('/some/dir', { gitRunner: () => '   ' })).toBe(resolve('/some/dir'));
  });
});
