const path = require('path');

const FLOW_PREFIX = '.specsmd/fire/';

function normalizeGlobalFlowRoot(globalFlowRoot) {
    if (!globalFlowRoot || typeof globalFlowRoot !== 'string') {
        throw new Error('globalFlowRoot is required');
    }

    return path.resolve(globalFlowRoot).replace(/[\\/]+$/, '');
}

function rewriteGlobalFirePaths(content, globalFlowRoot) {
    if (typeof content !== 'string') {
        return content;
    }

    const normalizedRoot = normalizeGlobalFlowRoot(globalFlowRoot);
    return content.split(FLOW_PREFIX).join(`${normalizedRoot}/`);
}

module.exports = {
    FLOW_PREFIX,
    rewriteGlobalFirePaths
};
