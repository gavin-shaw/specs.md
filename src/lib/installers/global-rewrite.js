const path = require('path');

const FLOW_PREFIX = '.specsmd/fire/';
const GLOBAL_ARTIFACT_ROOT = '~/.specs-fire/<project-name>';
const RUN_EXECUTE_SCRIPT_PATTERN = /(^\s*)(?!SPECSMD_ARTIFACT_ROOT=)(node scripts\/(?:init-run|complete-run|update-checkpoint|update-phase)\.cjs\b)/gm;

// The artifact root is keyed on the MAIN worktree (worktree-invariant), so the wrapper
// shells the bundled resolver rather than a bare basename of the current worktree.
function scriptArtifactEnv(flowRoot) {
    return `SPECSMD_ARTIFACT_ROOT="$(node "${flowRoot}/resolve-artifact-root.cjs" "{rootPath}")"`;
}

function normalizeGlobalFlowRoot(globalFlowRoot) {
    if (!globalFlowRoot || typeof globalFlowRoot !== 'string') {
        throw new Error('globalFlowRoot is required');
    }

    return path.resolve(globalFlowRoot).replace(/[\\/]+$/, '');
}

function rewriteFireArtifactPaths(content, flowRoot) {
    return content
        .split('.specs-fire/standards/').join('.docs/')
        .split('.specs-fire/standards').join('.docs')
        .split('.specs-fire/state.yaml').join(`${GLOBAL_ARTIFACT_ROOT}/state.yaml`)
        .split('.specs-fire/intents/').join(`${GLOBAL_ARTIFACT_ROOT}/intents/`)
        .split('.specs-fire/intents').join(`${GLOBAL_ARTIFACT_ROOT}/intents`)
        .split('.specs-fire/runs/').join(`${GLOBAL_ARTIFACT_ROOT}/runs/`)
        .split('.specs-fire/runs').join(`${GLOBAL_ARTIFACT_ROOT}/runs`)
        .replace(RUN_EXECUTE_SCRIPT_PATTERN, `$1${scriptArtifactEnv(flowRoot)} $2`);
}

function rewriteGlobalFirePaths(content, globalFlowRoot, options = {}) {
    if (typeof content !== 'string') {
        return content;
    }

    const normalizedRoot = normalizeGlobalFlowRoot(globalFlowRoot);
    const rewritten = content.split(FLOW_PREFIX).join(`${normalizedRoot}/`);
    return options.rewriteArtifacts ? rewriteFireArtifactPaths(rewritten, normalizedRoot) : rewritten;
}

module.exports = {
    FLOW_PREFIX,
    GLOBAL_ARTIFACT_ROOT,
    scriptArtifactEnv,
    rewriteFireArtifactPaths,
    rewriteGlobalFirePaths
};
