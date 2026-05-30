const os = require('os');
const path = require('path');

function trimTrailingSeparator(value) {
    return value.replace(/[\\/]+$/, '');
}

function resolveArtifactPaths(repoRoot, options = {}) {
    if (!repoRoot || typeof repoRoot !== 'string') {
        throw new Error('repoRoot is required');
    }

    const normalizedRepoRoot = trimTrailingSeparator(path.resolve(repoRoot));
    const baseHome = trimTrailingSeparator(path.resolve(options.baseHome || os.homedir()));
    const projectKey = path.basename(normalizedRepoRoot);

    return {
        projectKey,
        globalArtifactRoot: path.join(baseHome, '.specs-fire', projectKey),
        standardsRoot: path.join(normalizedRepoRoot, '.docs')
    };
}

module.exports = {
    resolveArtifactPaths
};
