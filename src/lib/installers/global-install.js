const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { FLOWS } = require('../constants');
const { rewriteGlobalFirePaths } = require('./global-rewrite');
const { SUPPORTED_GLOBAL_TOOLS } = require('./global-tools');

const GLOBAL_MANIFEST_NAME = 'specsmd-global-manifest.yaml';

const GLOBAL_TOOLS = {
    claude: {
        key: 'claude',
        entryType: 'skill',
        flowRoot: ['.claude', 'skills', 'specsmd-fire'],
        entryDir: ['.claude', 'skills'],
        manifestDir: ['.claude']
    },
    codex: {
        key: 'codex',
        entryType: 'skill',
        flowRoot: ['.codex', 'skills', 'specsmd-fire'],
        entryDir: ['.codex', 'skills'],
        manifestDir: ['.codex']
    },
    cursor: {
        key: 'cursor',
        entryType: 'command',
        flowRoot: ['.cursor', 'specsmd-fire'],
        entryDir: ['.cursor', 'commands'],
        manifestDir: ['.cursor']
    }
};

function resolveBaseHome(options = {}) {
    return path.resolve(options.baseHome || os.homedir());
}

function resolveFlowPath(flowKey) {
    if (flowKey !== 'fire') {
        throw new Error('Global install currently supports only the fire flow');
    }

    const flow = FLOWS[flowKey];
    if (!flow) {
        throw new Error(`Unknown flow: ${flowKey}`);
    }

    return path.join(__dirname, '..', '..', 'flows', flow.path);
}

function assertSupportedGlobalTools(toolKeys) {
    const unsupported = toolKeys.filter(toolKey => !SUPPORTED_GLOBAL_TOOLS.includes(toolKey));
    if (unsupported.length > 0) {
        throw new Error(
            `Global install supports only ${SUPPORTED_GLOBAL_TOOLS.join(', ')}. Unsupported: ${unsupported.join(', ')}`
        );
    }
}

function getToolPaths(toolKey, baseHome) {
    const descriptor = GLOBAL_TOOLS[toolKey];
    return {
        descriptor,
        flowRoot: path.join(baseHome, ...descriptor.flowRoot),
        entryDir: path.join(baseHome, ...descriptor.entryDir),
        manifestPath: path.join(baseHome, ...descriptor.manifestDir, GLOBAL_MANIFEST_NAME)
    };
}

async function isTextFile(filePath) {
    const buffer = await fs.readFile(filePath);
    return !buffer.includes(0);
}

async function copyFlowDefinitions(sourceDir, flowRoot) {
    await fs.remove(flowRoot);
    await fs.ensureDir(flowRoot);

    const entries = await fs.readdir(sourceDir);
    for (const entry of entries) {
        if (entry === 'commands') {
            continue;
        }

        await copyFlowEntry(path.join(sourceDir, entry), path.join(flowRoot, entry), flowRoot);
    }
}

async function copyFlowEntry(sourcePath, targetPath, flowRoot) {
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
        await fs.ensureDir(targetPath);
        const entries = await fs.readdir(sourcePath);
        for (const entry of entries) {
            await copyFlowEntry(path.join(sourcePath, entry), path.join(targetPath, entry), flowRoot);
        }
        return;
    }

    if (await isTextFile(sourcePath)) {
        const content = await fs.readFile(sourcePath, 'utf8');
        await fs.outputFile(
            targetPath,
            rewriteGlobalFirePaths(content, flowRoot, { rewriteArtifacts: sourcePath.endsWith('.md') }),
            'utf8'
        );
        return;
    }

    await fs.copy(sourcePath, targetPath);
}

function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { description: '', body: content };

    const frontmatter = match[1];
    const body = match[2];
    const descMatch = frontmatter.match(/description:\s*["']?(.+?)["']?\s*$/m);
    return {
        description: descMatch ? descMatch[1] : '',
        body: body.trim()
    };
}

function buildSkillContent(skillName, commandContent) {
    const { description, body } = parseFrontmatter(commandContent);
    return [
        '---',
        `name: ${skillName}`,
        `description: "${description || 'specsmd agent'}"`,
        '---',
        '',
        body
    ].join('\n');
}

// Migration-check step injected ONLY into the emitted global orchestrator entry
// (the `fire` command). The flow source (src/flows/fire/**) is never edited, so
// the injection stays merge-safe — only the emitted global skill carries it.
function migrationCheckStep(flowRoot) {
    const launcher = path.join(flowRoot, 'migrate.cjs');
    return [
        '## Step 0 — Repo-Local Migration Check (global install)',
        '',
        'BEFORE any initialization or routing, check whether THIS repository still has a',
        'repo-local specsmd install that should migrate to the global storage model:',
        '',
        `1. Run: \`node "${launcher}" --check "$PWD"\``,
        '2. If it reports `"status": "not_needed"` (empty plan) → continue to Critical First Steps.',
        '3. If it reports `"status": "pending"` with a plan → show the planned moves/removals to the',
        '   user and ask for explicit confirmation. Do NOT proceed without a yes.',
        `4. On explicit confirmation ONLY: \`node "${launcher}" --yes "$PWD"\`, then continue.`,
        '',
        'NEVER run `migrate.cjs --yes` without explicit user confirmation in this conversation.',
        '',
        '---',
        ''
    ].join('\n');
}

function injectMigrationStep(content, flowRoot) {
    const step = migrationCheckStep(flowRoot);
    const marker = '## Critical First Steps';
    if (content.includes(marker)) {
        return content.replace(marker, `${step}${marker}`);
    }
    return `${content}\n\n${step}`;
}

// Init-clarity step injected ONLY into the emitted global orchestrator entry.
// It keeps the source flow merge-safe while teaching the global skill that
// initialized means either global state OR repo-local state exists.
function initClarityStep(flowRoot) {
    const launcher = path.join(flowRoot, 'init-check.cjs');
    return [
        '## Step 0b — Init Clarity Check (global install)',
        '',
        'BEFORE the Critical First Steps initialization check, determine whether THIS',
        'repository is already initialized in either supported location:',
        '',
        `1. Run: \`node "${launcher}" "$PWD"\``,
        '2. If the JSON reports `"status": "initialized"` → treat the repo as initialized',
        '   and continue to route. This dual detection supersedes the simple state check below.',
        '3. If the JSON reports `"status": "uninitialized"` → before project-init, tell the',
        '   user exactly where global FIRE will write artifacts:',
        '   - State, intents, and runs: `~/.specs-fire/<project>/`',
        '   - Standards: `<repo>/.docs/`',
        '4. Also tell the user that repo-local artifacts are available via the separate',
        '   per-repo install: `specsmd install`.',
        '5. Ask whether to proceed with global init. Default is yes/proceed.',
        '6. If the user declines, stop immediately without scaffolding anything and point',
        '   them to `specsmd install` for repo-local artifacts.',
        '7. If the user confirms or accepts the default, continue to the existing',
        '   project-init skill unchanged.',
        '',
        'Do NOT scaffold repo-local artifacts from the global skill.',
        '',
        '---',
        ''
    ].join('\n');
}

function injectInitClarityStep(content, flowRoot) {
    const step = initClarityStep(flowRoot);
    const marker = '## Critical First Steps';
    if (content.includes(marker)) {
        return content.replace(marker, `${step}${marker}`);
    }
    return `${content}\n\n${step}`;
}

async function emitEntryPoints(flowPath, toolKey, paths) {
    const commandsDir = path.join(flowPath, 'commands');
    const commandFiles = (await fs.readdir(commandsDir)).filter(file => file.endsWith('.md')).sort();
    const entries = [];

    await fs.ensureDir(paths.entryDir);

    for (const commandFile of commandFiles) {
        const sourcePath = path.join(commandsDir, commandFile);
        const commandName = path.basename(commandFile, '.md');
        const entryName = `specsmd-${commandName}`;
        let rewritten = rewriteGlobalFirePaths(
            await fs.readFile(sourcePath, 'utf8'),
            paths.flowRoot,
            { rewriteArtifacts: true }
        );

        if (commandName === 'fire') {
            rewritten = injectMigrationStep(rewritten, paths.flowRoot);
            rewritten = injectInitClarityStep(rewritten, paths.flowRoot);
        }

        if (paths.descriptor.entryType === 'skill') {
            const skillDir = path.join(paths.entryDir, entryName);
            const skillPath = path.join(skillDir, 'SKILL.md');
            await fs.ensureDir(skillDir);
            await fs.writeFile(skillPath, buildSkillContent(entryName, rewritten), 'utf8');
            entries.push(skillPath);
            continue;
        }

        const commandPath = path.join(paths.entryDir, `${entryName}.md`);
        await fs.outputFile(commandPath, rewritten, 'utf8');
        entries.push(commandPath);
    }

    return entries;
}

async function expectedEntryPaths(flowPath, paths) {
    const commandsDir = path.join(flowPath, 'commands');
    const commandFiles = (await fs.readdir(commandsDir)).filter(file => file.endsWith('.md')).sort();

    return commandFiles.map((commandFile) => {
        const commandName = path.basename(commandFile, '.md');
        const entryName = `specsmd-${commandName}`;
        if (paths.descriptor.entryType === 'skill') {
            return path.join(paths.entryDir, entryName);
        }

        return path.join(paths.entryDir, `${entryName}.md`);
    });
}

async function cleanupPartialInstall(flowPath, paths) {
    const entries = await expectedEntryPaths(flowPath, paths);
    for (const entry of entries) {
        await fs.remove(entry);
    }

    await fs.remove(paths.flowRoot);
    await fs.remove(paths.manifestPath);
}

async function bundleGlobalScriptDeps(flowRoot) {
    const { bundleScriptDeps } = require('../installer');
    await bundleScriptDeps(flowRoot);
}

// Resolve a package's root directory tolerantly. fs-extra blocks './package.json'
// in its "exports" map, so require.resolve('<pkg>/package.json') throws for it;
// fall back to resolving the entry point and walking up to the package.json.
async function resolvePackageDir(name) {
    try {
        return path.dirname(require.resolve(`${name}/package.json`));
    } catch (error) {
        let dir = path.dirname(require.resolve(name));
        while (!await fs.pathExists(path.join(dir, 'package.json'))) {
            const parent = path.dirname(dir);
            if (parent === dir) {
                throw error;
            }
            dir = parent;
        }
        return dir;
    }
}

// Bundle the self-contained migrate launcher + its lib deps into the global flow
// root so the orchestrator can run it from any repo with no `specsmd` on PATH.
async function bundleMigrateLauncher(flowRoot) {
    const libFiles = [
        'migrate.cjs',
        'init-check.cjs',
        'storage-migration.js',
        'migration-executor.js',
        'artifact-paths.js',
        'global-tools.js',
        'main-worktree.js',
        'resolve-artifact-root.cjs'
    ];
    for (const file of libFiles) {
        await fs.copy(path.join(__dirname, file), path.join(flowRoot, file));
    }

    // The porcelain parser lives under dashboard/git; flatten it beside main-worktree.js
    // so its bundled `require('./worktrees')` resolves.
    await fs.copy(
        path.join(__dirname, '..', 'dashboard', 'git', 'worktrees.js'),
        path.join(flowRoot, 'worktrees.js')
    );

    const nodeModules = path.join(flowRoot, 'node_modules');
    await fs.ensureDir(nodeModules);
    for (const dep of ['fs-extra', 'graceful-fs', 'jsonfile', 'universalify']) {
        const sourceDir = await resolvePackageDir(dep);
        await fs.copy(sourceDir, path.join(nodeModules, dep));
    }
}

function buildManifest(flowKey, tools, locations) {
    return {
        flow: flowKey,
        version: require('../../package.json').version,
        installed_at: new Date().toISOString(),
        tools,
        locations
    };
}

async function writeManifest(manifestPath, manifest) {
    await fs.ensureDir(path.dirname(manifestPath));
    await fs.writeFile(manifestPath, yaml.dump(manifest), 'utf8');
}

async function installFlowGlobal(flowKey, toolKeys, options = {}) {
    const selectedToolKeys = Array.isArray(toolKeys) ? toolKeys : [];
    assertSupportedGlobalTools(selectedToolKeys);

    const baseHome = resolveBaseHome(options);
    // NOTE: install --global installs the global skill ONLY. Repo-local migration
    // is now orchestrator-triggered (run /specsmd-fire in a repo → Step 0 migration
    // check via the bundled migrate.cjs), NOT performed here.
    const flowPath = resolveFlowPath(flowKey);
    const locations = {};
    const attemptedPaths = [];

    try {
        for (const toolKey of selectedToolKeys) {
            const paths = getToolPaths(toolKey, baseHome);
            attemptedPaths.push(paths);
            await copyFlowDefinitions(flowPath, paths.flowRoot);
            await bundleGlobalScriptDeps(paths.flowRoot);
            await bundleMigrateLauncher(paths.flowRoot);
            const entries = await emitEntryPoints(flowPath, toolKey, paths);

            locations[toolKey] = {
                flow_root: paths.flowRoot,
                entry_dir: paths.entryDir,
                entries,
                manifest: paths.manifestPath
            };
        }

        const manifest = buildManifest(flowKey, selectedToolKeys, locations);
        for (const toolKey of selectedToolKeys) {
            await writeManifest(locations[toolKey].manifest, manifest);
        }

        return selectedToolKeys.reduce((count, toolKey) => {
            return count + locations[toolKey].entries.length;
        }, 0);
    } catch (error) {
        for (const paths of attemptedPaths) {
            await cleanupPartialInstall(flowPath, paths);
        }
        throw error;
    }
}

async function readManifest(manifestPath) {
    const content = await fs.readFile(manifestPath, 'utf8');
    return yaml.load(content);
}

async function uninstallFlowGlobal(options = {}) {
    const baseHome = resolveBaseHome(options);
    const manifests = [];

    for (const toolKey of SUPPORTED_GLOBAL_TOOLS) {
        const { manifestPath } = getToolPaths(toolKey, baseHome);
        if (await fs.pathExists(manifestPath)) {
            manifests.push({ toolKey, manifestPath, manifest: await readManifest(manifestPath) });
        }
    }

    if (manifests.length === 0) {
        return { removed: [], manifests: [] };
    }

    const installedTools = new Set();
    for (const { manifest } of manifests) {
        for (const toolKey of manifest.tools || []) {
            installedTools.add(toolKey);
        }
    }

    const removed = [];
    for (const toolKey of installedTools) {
        if (!SUPPORTED_GLOBAL_TOOLS.includes(toolKey)) {
            continue;
        }

        const location = manifests.find(item => item.manifest.locations?.[toolKey])?.manifest.locations[toolKey];
        if (!location) {
            continue;
        }

        for (const entry of location.entries || []) {
            await fs.remove(entry);
            removed.push(entry);
        }

        if (location.flow_root) {
            await fs.remove(location.flow_root);
            removed.push(location.flow_root);
        }

        if (location.manifest) {
            await fs.remove(location.manifest);
            removed.push(location.manifest);
        }
    }

    return { removed, manifests: manifests.map(item => item.manifestPath) };
}

module.exports = {
    GLOBAL_MANIFEST_NAME,
    GLOBAL_TOOLS,
    SUPPORTED_GLOBAL_TOOLS,
    assertSupportedGlobalTools,
    installFlowGlobal,
    uninstallFlowGlobal
};
