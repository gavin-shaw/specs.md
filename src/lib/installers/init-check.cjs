#!/usr/bin/env node
// Global FIRE init-state checker.
//
// Used by the emitted global orchestrator before project-init. It treats a repo
// as initialized when either the global artifact state or the repo-local state
// exists, and makes the global init destination explicit for fresh repos.
const fs = require('fs');
const path = require('path');
const { resolveArtifactPaths } = require('./artifact-paths');

function statePaths(repoRoot, options = {}) {
    const artifactPaths = resolveArtifactPaths(repoRoot, options);
    return {
        ...artifactPaths,
        repoRoot: path.resolve(repoRoot),
        globalStatePath: path.join(artifactPaths.globalArtifactRoot, 'state.yaml'),
        repoLocalStatePath: path.join(path.resolve(repoRoot), '.specs-fire', 'state.yaml')
    };
}

function checkInitialization(repoRoot, options = {}) {
    const paths = statePaths(repoRoot, options);
    const globalStateExists = fs.existsSync(paths.globalStatePath);
    const repoLocalStateExists = fs.existsSync(paths.repoLocalStatePath);

    return {
        status: globalStateExists || repoLocalStateExists ? 'initialized' : 'uninitialized',
        initialized: globalStateExists || repoLocalStateExists,
        projectKey: paths.projectKey,
        repoRoot: paths.repoRoot,
        globalArtifactRoot: paths.globalArtifactRoot,
        standardsRoot: paths.standardsRoot,
        globalStatePath: paths.globalStatePath,
        repoLocalStatePath: paths.repoLocalStatePath,
        globalStateExists,
        repoLocalStateExists
    };
}

async function run(argv, options = {}) {
    const args = (argv || process.argv).slice(2);
    const repoRoot = args.find(arg => !arg.startsWith('--')) || process.cwd();
    return checkInitialization(repoRoot, options);
}

async function main() {
    let result;
    try {
        result = await run(process.argv);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main();
}

module.exports = { checkInitialization, run, statePaths };
