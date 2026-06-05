const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('yaml');
const { writeFileAtomic } = require('./atomic-write.cjs');

// Bump when the shard on-disk layout changes; g3code reads this to detect drift.
// Kept in sync with src/docs/shard-layout-contract.md.
const SHARD_VERSION = 1;

function fireDir(rootPath) {
    return process.env.SPECSMD_ARTIFACT_ROOT
        ? path.resolve(process.env.SPECSMD_ARTIFACT_ROOT)
        : path.join(rootPath, '.specs-fire');
}

function realResolve(rootPath) {
    const resolved = path.resolve(String(rootPath || ''));
    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
}

function sanitizeToken(value) {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || 'workspace';
}

// Collision-safe per-worktree id: basename for readability + an 8-hex hash of the
// real path so two worktrees sharing a basename but at different paths never collide.
function worktreeId(rootPath) {
    const real = realResolve(rootPath);
    const base = sanitizeToken(path.basename(real));
    const hash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 8);
    return `${base}-${hash}`;
}

function shardDir(rootPath) {
    return path.join(fireDir(rootPath), 'worktrees', worktreeId(rootPath));
}

function shardStatePath(rootPath) {
    return path.join(shardDir(rootPath), 'run-state.yaml');
}

function defaultShardState(rootPath) {
    return {
        shard_version: SHARD_VERSION,
        worktree_id: worktreeId(rootPath),
        worktree_path: realResolve(rootPath),
        runs: { active: [], completed: [] }
    };
}

function normalizeShardState(shardState, rootPath) {
    if (!shardState || typeof shardState !== 'object') {
        return defaultShardState(rootPath);
    }
    if (!shardState.runs || typeof shardState.runs !== 'object') {
        shardState.runs = { active: [], completed: [] };
    }
    if (!Array.isArray(shardState.runs.active)) {
        shardState.runs.active = [];
    }
    if (!Array.isArray(shardState.runs.completed)) {
        shardState.runs.completed = [];
    }
    if (!shardState.shard_version) {
        shardState.shard_version = SHARD_VERSION;
    }
    return shardState;
}

function readShardState(rootPath) {
    const statePath = shardStatePath(rootPath);
    if (!fs.existsSync(statePath)) {
        return defaultShardState(rootPath);
    }
    try {
        return normalizeShardState(yaml.parse(fs.readFileSync(statePath, 'utf8')), rootPath);
    } catch {
        return defaultShardState(rootPath);
    }
}

function writeShardState(rootPath, shardState) {
    fs.mkdirSync(shardDir(rootPath), { recursive: true });
    writeFileAtomic(shardStatePath(rootPath), yaml.stringify(normalizeShardState(shardState, rootPath)));
}

module.exports = {
    SHARD_VERSION,
    fireDir,
    sanitizeToken,
    worktreeId,
    shardDir,
    shardStatePath,
    defaultShardState,
    readShardState,
    writeShardState
};
