const path = require('path');

const FLOW_PREFIX = '.specsmd/fire/';
const GLOBAL_ARTIFACT_ROOT = '~/.specs-fire/<project-name>';
const SCRIPT_ARTIFACT_ENV = 'SPECSMD_ARTIFACT_ROOT="$HOME/.specs-fire/$(basename "{rootPath}")"';
const RUN_EXECUTE_SCRIPT_PATTERN = /(^\s*)(?!SPECSMD_ARTIFACT_ROOT=)(node scripts\/(?:init-run|complete-run|update-checkpoint|update-phase)\.cjs\b)/gm;

function normalizeGlobalFlowRoot(globalFlowRoot) {
    if (!globalFlowRoot || typeof globalFlowRoot !== 'string') {
        throw new Error('globalFlowRoot is required');
    }

    return path.resolve(globalFlowRoot).replace(/[\\/]+$/, '');
}

function rewriteFireArtifactPaths(content) {
    return content
        .split('.specs-fire/standards/').join('.docs/')
        .split('.specs-fire/standards').join('.docs')
        .split('.specs-fire/state.yaml').join(`${GLOBAL_ARTIFACT_ROOT}/state.yaml`)
        .split('.specs-fire/intents/').join(`${GLOBAL_ARTIFACT_ROOT}/intents/`)
        .split('.specs-fire/intents').join(`${GLOBAL_ARTIFACT_ROOT}/intents`)
        .split('.specs-fire/runs/').join(`${GLOBAL_ARTIFACT_ROOT}/runs/`)
        .split('.specs-fire/runs').join(`${GLOBAL_ARTIFACT_ROOT}/runs`)
        .replace(RUN_EXECUTE_SCRIPT_PATTERN, `$1${SCRIPT_ARTIFACT_ENV} $2`);
}

function rewriteGlobalFirePaths(content, globalFlowRoot, options = {}) {
    if (typeof content !== 'string') {
        return content;
    }

    const normalizedRoot = normalizeGlobalFlowRoot(globalFlowRoot);
    const rewritten = content.split(FLOW_PREFIX).join(`${normalizedRoot}/`);
    return options.rewriteArtifacts ? rewriteFireArtifactPaths(rewritten) : rewritten;
}

module.exports = {
    FLOW_PREFIX,
    GLOBAL_ARTIFACT_ROOT,
    SCRIPT_ARTIFACT_ENV,
    rewriteFireArtifactPaths,
    rewriteGlobalFirePaths
};
