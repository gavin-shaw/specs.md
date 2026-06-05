#!/usr/bin/env node
// Worktree-invariant artifact-root resolver.
//
// Invoked by the global run-execute wrapper to set SPECSMD_ARTIFACT_ROOT:
//   SPECSMD_ARTIFACT_ROOT="$(node <flowRoot>/resolve-artifact-root.cjs <rootPath>)"
//
// Resolves <rootPath> to its MAIN worktree root, then keys the global artifact root on
// that main worktree's basename — so a linked worktree and its main tree share one root.
// Falls back to the input path (today's basename behaviour) when not in a git repo.
//
// Bundled flat at the flow root alongside main-worktree.js, worktrees.js, and
// artifact-paths.js so its `require('./...')` siblings resolve after bundling.
const { resolveMainWorktreeRoot } = require('./main-worktree');
const { resolveArtifactPaths } = require('./artifact-paths');

function resolveArtifactRoot(rootPath, options = {}) {
    const mainWorktreeRoot = resolveMainWorktreeRoot(rootPath, options);
    const { globalArtifactRoot } = resolveArtifactPaths(mainWorktreeRoot, {
        baseHome: options.baseHome
    });
    return globalArtifactRoot;
}

if (require.main === module) {
    const rootPath = process.argv[2] || process.cwd();
    process.stdout.write(resolveArtifactRoot(rootPath));
}

module.exports = { resolveArtifactRoot };
