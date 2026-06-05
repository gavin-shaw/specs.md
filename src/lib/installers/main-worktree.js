const path = require('path');
const { spawnSync } = require('child_process');

// Reuse the canonical porcelain parser from dashboard/git. When this module is
// flat-bundled into the global flow root, worktrees.js sits beside it (./worktrees);
// in the source tree it lives under dashboard/git. Try the bundled sibling first.
function loadPorcelainParser() {
    try {
        return require('./worktrees').parseGitWorktreePorcelain;
    } catch {
        return require('../dashboard/git/worktrees').parseGitWorktreePorcelain;
    }
}

function defaultGitRunner(startPath) {
    const result = spawnSync('git', ['-C', startPath, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8'
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    return String(result.stdout || '');
}

// Map any path inside a working tree to the MAIN worktree root (the first entry of
// `git worktree list --porcelain`). Falls back to the input path when not in a git
// repo so non-git projects keep working. Pure aside from the injected git runner.
function resolveMainWorktreeRoot(startPath, options = {}) {
    const input = path.resolve(String(startPath || '').trim() || process.cwd());
    const runGit = options.gitRunner || defaultGitRunner;

    let raw;
    try {
        raw = runGit(input);
    } catch {
        raw = null;
    }

    if (!raw || String(raw).trim() === '') {
        return input;
    }

    const parseGitWorktreePorcelain = loadPorcelainParser();
    const worktrees = parseGitWorktreePorcelain(raw, input);
    if (!Array.isArray(worktrees) || worktrees.length === 0) {
        return input;
    }

    return worktrees[0].path;
}

module.exports = { resolveMainWorktreeRoot, defaultGitRunner };
