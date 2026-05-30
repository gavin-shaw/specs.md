const fs = require('fs-extra');
const path = require('path');
const { SUPPORTED_GLOBAL_TOOLS } = require('./global-tools');
const { resolveArtifactPaths } = require('./artifact-paths');

// The repo-local install writes entry points into one or more per-tool dirs.
// claude historically wrote BOTH .claude/commands AND .claude/agents, so both
// must be detected and cleaned (scope: commands + agents only, NOT skills).
function toolEntryDirs(toolKey) {
    if (toolKey === 'codex') {
        return [path.join('.codex', 'skills')];
    }

    if (toolKey === 'claude') {
        return [path.join('.claude', 'commands'), path.join('.claude', 'agents')];
    }

    if (toolKey === 'cursor') {
        return [path.join('.cursor', 'commands')];
    }

    return [];
}

async function existingPaths(repoRoot, relativePaths) {
    const found = [];
    for (const relativePath of relativePaths) {
        const absolutePath = path.join(repoRoot, relativePath);
        if (await fs.pathExists(absolutePath)) {
            found.push({ relativePath, path: absolutePath });
        }
    }
    return found;
}

async function detectRepoLocalInstall(repoRoot) {
    const specsFireSignals = await existingPaths(repoRoot, [
        path.join('.specs-fire', 'state.yaml'),
        path.join('.specs-fire', 'intents'),
        path.join('.specs-fire', 'runs'),
        path.join('.specs-fire', 'standards')
    ]);
    const specsmdSignals = await existingPaths(repoRoot, ['.specsmd']);
    const entryPointSignals = [];

    for (const toolKey of SUPPORTED_GLOBAL_TOOLS) {
        for (const relativeDir of toolEntryDirs(toolKey)) {
            const absoluteDir = path.join(repoRoot, relativeDir);
            if (!await fs.pathExists(absoluteDir)) {
                continue;
            }

            const entries = await fs.readdir(absoluteDir);
            for (const entry of entries.filter(item => item.startsWith('specsmd-'))) {
                const relativePath = path.join(relativeDir, entry);
                entryPointSignals.push({
                    tool: toolKey,
                    relativePath,
                    path: path.join(repoRoot, relativePath)
                });
            }
        }
    }

    const detected = specsFireSignals.length > 0 || specsmdSignals.length > 0 || entryPointSignals.length > 0;
    return {
        detected,
        specsFire: specsFireSignals,
        specsmd: specsmdSignals,
        entryPoints: entryPointSignals
    };
}

async function buildMigrationPlan(repoRoot, options = {}) {
    const artifactPaths = resolveArtifactPaths(repoRoot, { baseHome: options.baseHome });
    const detection = await detectRepoLocalInstall(repoRoot);
    const globalArtifactExists = await fs.pathExists(artifactPaths.globalArtifactRoot);

    const moves = [];
    const removals = [];

    const standardsSource = path.join(repoRoot, '.specs-fire', 'standards');
    if (await fs.pathExists(standardsSource)) {
        moves.push({
            type: 'standards',
            from: standardsSource,
            to: artifactPaths.standardsRoot
        });
    }

    for (const artifactName of ['state.yaml', 'intents', 'runs']) {
        const source = path.join(repoRoot, '.specs-fire', artifactName);
        if (await fs.pathExists(source)) {
            moves.push({
                type: artifactName,
                from: source,
                to: path.join(artifactPaths.globalArtifactRoot, artifactName)
            });
        }
    }

    for (const entryPoint of detection.entryPoints) {
        removals.push({
            type: 'entry-point',
            tool: entryPoint.tool,
            path: entryPoint.path
        });
    }

    for (const specsmd of detection.specsmd) {
        removals.push({
            type: 'repo-local-flow',
            path: specsmd.path
        });
    }

    if (detection.specsFire.length > 0) {
        removals.push({
            type: 'retire-specs-fire',
            path: path.join(repoRoot, '.specs-fire')
        });
    }

    return {
        detected: detection.detected,
        projectKey: artifactPaths.projectKey,
        repoRoot: path.resolve(repoRoot),
        globalArtifactRoot: artifactPaths.globalArtifactRoot,
        standardsRoot: artifactPaths.standardsRoot,
        collision: globalArtifactExists,
        detection,
        moves,
        removals
    };
}

function migrationPromptMessage(plan) {
    const collisionWarning = plan.collision
        ? ` Warning: ${plan.globalArtifactRoot} already exists.`
        : '';
    return `Migrate repo-local specsmd artifacts for ${plan.projectKey}?${collisionWarning}`;
}

async function confirmMigrationPlan(plan, options = {}) {
    if (!plan.detected) {
        return { status: 'not_needed', confirmed: false, plan };
    }

    const promptFn = options.prompt || require('prompts');
    const response = await promptFn({
        type: 'confirm',
        name: 'confirm',
        message: migrationPromptMessage(plan),
        initial: false
    });

    if (!response.confirm) {
        return { status: 'skipped', confirmed: false, plan };
    }

    return { status: 'confirmed', confirmed: true, plan };
}

async function planRepoLocalMigration(repoRoot, options = {}) {
    const plan = await buildMigrationPlan(repoRoot, options);
    const result = await confirmMigrationPlan(plan, options);
    if (typeof options.onMigrationPlan === 'function') {
        options.onMigrationPlan(result);
    }
    return result;
}

module.exports = {
    SUPPORTED_GLOBAL_TOOLS,
    buildMigrationPlan,
    confirmMigrationPlan,
    detectRepoLocalInstall,
    migrationPromptMessage,
    planRepoLocalMigration
};
