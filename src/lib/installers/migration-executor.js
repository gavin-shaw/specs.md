const fs = require('fs-extra');
const path = require('path');

const MARKER_NAME = '.specsmd-migration.json';

function markerPath(plan) {
    return path.join(plan.globalArtifactRoot, MARKER_NAME);
}

function defaultOps() {
    return {
        copy: fs.copy,
        ensureDir: fs.ensureDir,
        pathExists: fs.pathExists,
        readdir: fs.readdir,
        readJson: fs.readJson,
        remove: fs.remove,
        writeJson: fs.writeJson
    };
}

async function readMarker(plan, ops) {
    const filePath = markerPath(plan);
    if (!await ops.pathExists(filePath)) {
        return { completed: [], finalized: false };
    }

    return ops.readJson(filePath);
}

async function writeMarker(plan, marker, ops) {
    await ops.ensureDir(plan.globalArtifactRoot);
    await ops.writeJson(markerPath(plan), marker, { spaces: 2 });
}

function safeRelative(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function isDirectoryEmpty(dirPath, ops) {
    if (!await ops.pathExists(dirPath)) {
        return true;
    }

    const entries = await ops.readdir(dirPath);
    return entries.length === 0;
}

async function verifyCopy(source, target, ops) {
    if (!await ops.pathExists(target)) {
        throw new Error(`Migration copy verification failed: ${target} does not exist`);
    }

    const sourceIsDir = (await fs.stat(source)).isDirectory();
    if (!sourceIsDir) {
        return;
    }

    const sourceEntries = await ops.readdir(source);
    const targetEntries = await ops.readdir(target);
    if (sourceEntries.length !== targetEntries.length) {
        throw new Error(`Migration copy verification failed: ${target} entry count mismatch`);
    }
}

function moveKey(move) {
    return `${move.type}:${move.from}->${move.to}`;
}

async function executeMove(move, marker, plan, ops) {
    const key = moveKey(move);
    if (marker.completed.includes(key) || !await ops.pathExists(move.from)) {
        return;
    }

    await ops.ensureDir(path.dirname(move.to));
    await ops.copy(move.from, move.to, { overwrite: false, errorOnExist: true });
    await verifyCopy(move.from, move.to, ops);
    marker.completed.push(key);
    await writeMarker(plan, marker, ops);
    await ops.remove(move.from);
}

async function removeEntryPoint(removal, plan, ops) {
    if (!safeRelative(plan.repoRoot, removal.path)) {
        throw new Error(`Refusing to remove path outside repo: ${removal.path}`);
    }

    await ops.remove(removal.path);
}

async function retireSpecsFire(removal, plan, ops) {
    if (!safeRelative(plan.repoRoot, removal.path)) {
        throw new Error(`Refusing to retire path outside repo: ${removal.path}`);
    }

    if (await isDirectoryEmpty(removal.path, ops)) {
        await ops.remove(removal.path);
    }
}

async function executeMigration(plan, options = {}) {
    const ops = options.ops || defaultOps();
    const marker = await readMarker(plan, ops);

    if (marker.finalized) {
        return { status: 'noop', completed: marker.completed.length };
    }

    const hasExistingTarget = await ops.pathExists(plan.globalArtifactRoot);
    const emptyTarget = await isDirectoryEmpty(plan.globalArtifactRoot, ops);
    const hasMarker = await ops.pathExists(markerPath(plan));
    if (plan.collision && hasExistingTarget && !emptyTarget && !hasMarker && !options.allowCollision) {
        return {
            status: 'blocked',
            reason: 'global-artifact-collision',
            globalArtifactRoot: plan.globalArtifactRoot
        };
    }

    for (const move of plan.moves || []) {
        await executeMove(move, marker, plan, ops);
    }

    for (const removal of plan.removals || []) {
        if (removal.type === 'entry-point' || removal.type === 'repo-local-flow') {
            await removeEntryPoint(removal, plan, ops);
        }
    }

    for (const removal of plan.removals || []) {
        if (removal.type === 'retire-specs-fire') {
            await retireSpecsFire(removal, plan, ops);
        }
    }

    marker.finalized = true;
    await writeMarker(plan, marker, ops);

    return { status: 'completed', completed: marker.completed.length };
}

module.exports = {
    MARKER_NAME,
    executeMigration,
    markerPath
};
