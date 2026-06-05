const path = require('path');
const { spawnSync } = require('child_process');
const { resolveMainWorktreeRoot } = require('./main-worktree');

// A worktree is the MAIN worktree iff `git rev-parse --git-dir` equals
// `--git-common-dir`. A linked worktree's --git-dir is `.git/worktrees/<name>` while
// its --git-common-dir points at the main `.git`, so they differ.
function defaultGitDirRunner(cwd) {
    const gitDir = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
    const commonDir = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
    if (gitDir.error || gitDir.status !== 0 || commonDir.error || commonDir.status !== 0) {
        return null;
    }
    return {
        gitDir: String(gitDir.stdout || '').trim(),
        commonDir: String(commonDir.stdout || '').trim()
    };
}

function checkBaseWorktree(cwd, options = {}) {
    const runGitDirs = options.gitDirRunner || defaultGitDirRunner;
    const dirs = runGitDirs(cwd);
    if (!dirs) {
        // Not a git repo: nothing to guard, treat as base so migration logic proceeds.
        return { isGit: false, isBase: true };
    }
    const isBase = path.resolve(cwd, dirs.gitDir) === path.resolve(cwd, dirs.commonDir);
    return { isGit: true, isBase, gitDir: dirs.gitDir, commonDir: dirs.commonDir };
}

// Returns { blocked: false } from the main worktree (or a non-git dir), or
// { blocked: true, baseWorktreePath, message } from a linked worktree. Pure aside from
// the injected git runner — performs no filesystem mutation.
function guardBaseWorktree(cwd, options = {}) {
    const check = checkBaseWorktree(cwd, options);
    if (check.isBase) {
        return { blocked: false };
    }

    const baseWorktreePath = resolveMainWorktreeRoot(cwd, options);
    return {
        blocked: true,
        baseWorktreePath,
        message:
            'Migration must run from the main worktree, not a linked worktree. ' +
            `Re-run it from: ${baseWorktreePath}`
    };
}

module.exports = { checkBaseWorktree, guardBaseWorktree, defaultGitDirRunner };
