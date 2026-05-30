// Source-of-truth list of tools supported by the global install model.
// Extracted into its own module so lightweight consumers (e.g. the bundled
// migrate launcher and storage-migration) can depend on it WITHOUT pulling in
// global-install's heavy require graph (constants, global-rewrite, installer).
const SUPPORTED_GLOBAL_TOOLS = ['claude', 'codex', 'cursor'];

module.exports = { SUPPORTED_GLOBAL_TOOLS };
