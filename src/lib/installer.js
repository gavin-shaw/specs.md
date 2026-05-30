const fs = require('fs-extra');
const path = require('path');
const prompts = require('prompts');
const yaml = require('js-yaml');
const CLIUtils = require('./cli-utils');
const InstallerFactory = require('./InstallerFactory');
const { FLOWS, LINKS } = require('./constants');
const analytics = require('./analytics');
const { installFlowGlobal, uninstallFlowGlobal } = require('./installers/global-install');

// Use theme from CLIUtils for consistent styling
const { theme } = CLIUtils;

/**
 * Categorize an error for analytics tracking
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
function categorizeError(error) {
    const message = (error.message || '').toLowerCase();

    if (message.includes('permission') || message.includes('eacces')) {
        return 'file_permission';
    }
    if (message.includes('enoent') || message.includes('not found')) {
        return 'file_not_found';
    }
    if (message.includes('network') || message.includes('enotfound') || message.includes('timeout')) {
        return 'network';
    }
    if (message.includes('enospc') || message.includes('disk')) {
        return 'disk_space';
    }
    return 'unknown';
}

/**
 * Bundle YAML deps into .specsmd/node_modules/ so flow scripts can resolve
 * them without requiring the user's project to have yaml/js-yaml installed.
 *
 * Uses require.resolve so it works whether specsmd was loaded via npx cache,
 * a global install, or a local checkout. Also writes .specsmd/.gitignore so
 * the bundled deps stay untracked.
 *
 * @param {string} specsmdDir - The .specsmd directory in the user's project
 */
async function bundleScriptDeps(specsmdDir) {
    const depsToBundle = ['yaml', 'js-yaml'];
    const targetNodeModules = path.join(specsmdDir, 'node_modules');
    await fs.ensureDir(targetNodeModules);

    for (const dep of depsToBundle) {
        const sourceDir = path.dirname(require.resolve(`${dep}/package.json`));
        const targetDir = path.join(targetNodeModules, dep);
        await fs.copy(sourceDir, targetDir);
    }

    await fs.writeFile(
        path.join(specsmdDir, '.gitignore'),
        'node_modules/\n',
        'utf8'
    );
}

/**
 * Count files in a directory recursively
 * @param {string} dir - Directory path
 * @returns {Promise<number>} File count
 */
async function countFiles(dir) {
    let count = 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                count += await countFiles(path.join(dir, entry.name));
            } else {
                count++;
            }
        }
    } catch {
        // Ignore errors (directory might not exist)
    }
    return count;
}

function parseFlowFlag(value) {
  const validKeys = Object.entries(FLOWS)
    .filter(([, f]) => !f.disabled)
    .map(([k]) => k);
  if (!validKeys.includes(value)) {
    CLIUtils.displayError(
      `Invalid --flow value "${value}". Valid: ${validKeys.join(', ')}`
    );
    process.exit(1);
  }
  return value;
}

function parseToolsFlag(value, installers) {
  const validKeys = installers.map(i => i.key);
  const requested = value.split(',').map(s => s.trim()).filter(Boolean);
  if (requested.length === 0) {
    CLIUtils.displayError(
      `--tools must list at least one tool. Valid: ${validKeys.join(', ')}`
    );
    process.exit(1);
  }
  const bad = requested.filter(k => !validKeys.includes(k));
  if (bad.length > 0) {
    CLIUtils.displayError(
      `Invalid --tools value(s): ${bad.join(', ')}. Valid: ${validKeys.join(', ')}`
    );
    process.exit(1);
  }
  return requested;
}

async function detectTools() {
  const detected = [];
  const installers = InstallerFactory.getInstallers();

  for (const installer of installers) {
    if (await installer.detect()) {
      detected.push(installer.key);
    }
  }
  return detected;
}

async function install(options = {}) {
  // Validate flag values BEFORE any side effects (analytics, fs, prompts)
  const installersForValidation = InstallerFactory.getInstallers();
  const flowFromFlag = options.flow != null ? parseFlowFlag(options.flow) : null;
  const toolsFromFlag = options.tools != null
    ? parseToolsFlag(options.tools, installersForValidation)
    : null;

  // Initialize analytics (respects opt-out env vars)
  analytics.init();
  await analytics.trackInstallerStarted();

  const installStartTime = Date.now();

  await CLIUtils.displayLogo();
  CLIUtils.displayHeader('Installation', '');

  // Step 1: Detect agentic coding tools
  const detectedToolKeys = await detectTools();
  const installers = InstallerFactory.getInstallers();
  const detectedNames = installers
    .filter(i => detectedToolKeys.includes(i.key))
    .map(i => i.name);

  CLIUtils.displayStep(1, 4, 'Detecting agentic coding tools...');
  if (detectedNames.length > 0) {
    CLIUtils.displayStatus('', `Detected: ${detectedNames.join(', ')}`, 'success');
  } else {
    CLIUtils.displayStatus('', 'No agentic coding tools detected', 'warning');
  }
  console.log('');

  // Step 2: Select tools
  CLIUtils.displayStep(2, 4, 'Select target tools');

  let selectedToolKeys;
  if (toolsFromFlag) {
    selectedToolKeys = toolsFromFlag;
    const chosenNames = installers
      .filter(i => selectedToolKeys.includes(i.key))
      .map(i => i.name);
    CLIUtils.displayStatus('', `Using --tools: ${chosenNames.join(', ')}`, 'success');
  } else {
    // Build choices with descriptive formatting
    const toolChoices = installers.map(installer => ({
      title: installer.name + (detectedToolKeys.includes(installer.key) ? theme.dim(' (detected)') : ''),
      value: installer.key,
      selected: detectedToolKeys.includes(installer.key)
    }));

    console.log(theme.dim('  [Space] toggle  [Enter] confirm  [a] toggle all'));
    console.log(theme.dim(`  ${theme.success('[x]')} = selected    ${theme.dim('[ ]')} = not selected\n`));

    const promptResult = await prompts({
      type: 'multiselect',
      name: 'selectedToolKeys',
      message: 'Choose tools:',
      choices: toolChoices,
      min: 1,
      instructions: false
    });
    selectedToolKeys = promptResult.selectedToolKeys;

    if (!selectedToolKeys || selectedToolKeys.length === 0) {
      CLIUtils.displayError('Installation cancelled - no tools selected');
      process.exit(1);
    }
  }

  // Track IDE selection (await to ensure delivery before potential cancel)
  await analytics.trackIdesConfirmed(selectedToolKeys);

  // Step 3: Select Flow
  console.log('');
  CLIUtils.displayStep(3, 4, 'Select SDLC flow');

  let selectedFlow;
  if (flowFromFlag) {
    selectedFlow = flowFromFlag;
    CLIUtils.displayStatus('', `Using --flow: ${FLOWS[selectedFlow].name}`, 'success');
  } else {
    console.log(theme.dim(`  Learn more about flows: ${LINKS.flows}\n`));
    const flowChoices = Object.entries(FLOWS).map(([key, flow]) => ({
      title: `${flow.name} - ${flow.description}${flow.message || ''}`,
      value: key,
      disabled: flow.disabled
    }));

    const promptResult = await prompts({
      type: 'select',
      name: 'selectedFlow',
      message: 'Which SDLC flow would you like to install?',
      choices: flowChoices
    });
    selectedFlow = promptResult.selectedFlow;

    if (!selectedFlow) {
      CLIUtils.displayError('Installation cancelled');
      process.exit(1);
    }
  }

  // Track flow selection (await to ensure delivery before potential cancel)
  await analytics.trackFlowSelected(selectedFlow);

  // Step 4: Install flow files
  console.log('');
  CLIUtils.displayStep(4, 4, `Installing ${FLOWS[selectedFlow].name} flow...`);

  try {
    const filesCreated = options.global
      ? await installFlowGlobal(selectedFlow, selectedToolKeys)
      : await installFlow(selectedFlow, selectedToolKeys);

    // Track successful installation for each tool
    const durationMs = Date.now() - installStartTime;
    for (const toolKey of selectedToolKeys) {
      analytics.trackInstallationCompleted(toolKey, selectedFlow, durationMs, filesCreated);
    }

    CLIUtils.displaySuccess(`${FLOWS[selectedFlow].name} flow installed successfully!`, 'Installation Complete');

    // Get selected tool names for next steps message
    const selectedToolNames = installers
      .filter(i => selectedToolKeys.includes(i.key))
      .map(i => i.name);

    const nextSteps = options.global
      ? [
        'Run specsmd in any repository with a local .specs-fire/ project state',
        `Open ${selectedToolNames.join(' or ')} and run /specsmd-fire`
      ]
      : [
        `Read .specsmd/${selectedFlow}/quick-start.md for getting started`,
        `Open ${selectedToolNames.join(' or ')} and run /specsmd-master-agent`
      ];
    CLIUtils.displayNextSteps(nextSteps);

    // Display IDE extension info with brand colors
    console.log('\n' + theme.primary('─'.repeat(72)));
    console.log(CLIUtils.logoGradient('  ★ IDE Extension'));
    console.log(theme.primary('─'.repeat(72)));
    console.log('');
    console.log('  ' + CLIUtils.logoGradient('Enhance your experience with the specsmd IDE extension!'));
    console.log('');
    console.log(`  ${theme.primary('Learn more:')}                ${LINKS.ideExtension}`);
    console.log(`  ${theme.primary('VS Code:')}                   ${LINKS.vscodeMarketplace}`);
    console.log(`  ${theme.primary('Cursor/Antigravity/Windsurf:')} ${LINKS.openVsx}`);
    console.log('');
    console.log(theme.primary('─'.repeat(72)) + '\n');
    console.log('');
  } catch (error) {
    // Track installation failure
    const errorCategory = categorizeError(error);
    for (const toolKey of selectedToolKeys) {
      analytics.trackInstallationFailed(toolKey, errorCategory, selectedFlow);
    }

    CLIUtils.displayError(`Installation failed: ${error.message}`);
    console.log(theme.dim('\nRolling back changes...'));
    if (!options.global) {
      await rollback(selectedFlow, selectedToolKeys);
    }
    CLIUtils.displayStatus('', 'Installation rolled back', 'warning');
    process.exit(1);
  }
}

const GITIGNORE_PATTERNS = [
  '.claude/agents/specsmd-*',
  '.claude/commands/specsmd-*',
  '.codex/skills/specsmd-*',
  '.cursor/commands/specsmd-*',
  '.specsmd',
  '.specs-fire/intents',
  '.specs-fire/runs',
  '.specs-fire/state.yaml'
];

const GITIGNORE_HEADER = '# specsmd';

async function patchRootGitignore(cwd = process.cwd()) {
  const gitignorePath = path.join(cwd, '.gitignore');

  if (!(await fs.pathExists(gitignorePath))) {
    const contents = [GITIGNORE_HEADER, ...GITIGNORE_PATTERNS].join('\n') + '\n';
    await fs.writeFile(gitignorePath, contents, 'utf8');
    return { created: true, added: [...GITIGNORE_PATTERNS] };
  }

  const existing = await fs.readFile(gitignorePath, 'utf8');
  const existingLines = new Set(
    existing.split('\n').map(line => line.trim()).filter(Boolean)
  );
  const missing = GITIGNORE_PATTERNS.filter(p => !existingLines.has(p));

  if (missing.length === 0) {
    return { created: false, added: [] };
  }

  const needsLeadingBlank = existing.length > 0 && !existing.endsWith('\n\n');
  const separator = existing.endsWith('\n') ? '' : '\n';
  const blankLine = needsLeadingBlank ? '\n' : '';
  const appended = separator + blankLine + [GITIGNORE_HEADER, ...missing].join('\n') + '\n';

  await fs.writeFile(gitignorePath, existing + appended, 'utf8');
  return { created: false, added: missing };
}

async function installFlow(flowKey, toolKeys) {
  const flowPath = path.join(__dirname, '..', 'flows', FLOWS[flowKey].path);

  // Step 1: Install commands for each tool
  // Pass empty config since config.yaml is removed
  const dummyConfig = {};
  for (const toolKey of toolKeys) {
    const installer = InstallerFactory.getInstaller(toolKey);
    if (installer) {
      await installer.installCommands(flowPath, dummyConfig);
    }
  }

  // Step 2: Install shared flow config
  const specsmdDir = '.specsmd';
  const targetFlowDir = path.join(specsmdDir, flowKey);

  console.log(theme.dim(`  Installing flow resources to ${targetFlowDir}/...`));
  await fs.ensureDir(targetFlowDir);

  // Copy agents
  await fs.copy(path.join(flowPath, 'agents'), path.join(targetFlowDir, 'agents'));

  // Copy internal agent capabilities (legacy check)
  if (await fs.pathExists(path.join(flowPath, 'agent-capabilities'))) {
    await fs.copy(path.join(flowPath, 'agent-capabilities'), path.join(targetFlowDir, 'agent-capabilities'));
  }

  // Copy bolt-types if they exist (legacy check)
  if (await fs.pathExists(path.join(flowPath, 'bolt-types'))) {
    await fs.copy(path.join(flowPath, 'bolt-types'), path.join(targetFlowDir, 'bolt-types'));
  }

  // Copy skills, templates, shared (now at flow root level, not nested in .specsmd)
  if (await fs.pathExists(path.join(flowPath, 'skills'))) {
    await fs.copy(path.join(flowPath, 'skills'), path.join(targetFlowDir, 'skills'));
  }
  if (await fs.pathExists(path.join(flowPath, 'templates'))) {
    await fs.copy(path.join(flowPath, 'templates'), path.join(targetFlowDir, 'templates'));
  }
  if (await fs.pathExists(path.join(flowPath, 'shared'))) {
    await fs.copy(path.join(flowPath, 'shared'), path.join(targetFlowDir, 'shared'));
  }
  if (await fs.pathExists(path.join(flowPath, 'scripts'))) {
    await fs.copy(path.join(flowPath, 'scripts'), path.join(targetFlowDir, 'scripts'));
  }

  // Copy config files
  if (await fs.pathExists(path.join(flowPath, 'memory-bank.yaml'))) {
    await fs.copy(path.join(flowPath, 'memory-bank.yaml'), path.join(targetFlowDir, 'memory-bank.yaml'));
  }
  if (await fs.pathExists(path.join(flowPath, 'context-config.yaml'))) {
    await fs.copy(path.join(flowPath, 'context-config.yaml'), path.join(targetFlowDir, 'context-config.yaml'));
  }
  if (await fs.pathExists(path.join(flowPath, 'quick-start.md'))) {
    await fs.copy(path.join(flowPath, 'quick-start.md'), path.join(targetFlowDir, 'quick-start.md'));
  }

  // Copy docs
  await fs.copy(path.join(flowPath, 'README.md'), path.join(targetFlowDir, 'README.md'));

  if (await fs.pathExists(path.join(flowPath, 'constitution.md'))) {
    await fs.copy(path.join(flowPath, 'constitution.md'), path.join(targetFlowDir, 'constitution.md'));
  }

  CLIUtils.displayStatus('', 'Installed flow resources', 'success');

  // NOTE: memory-bank/ is NOT created during installation
  // It will be created when user runs project-init
  // This allows us to detect if project is initialized by checking for memory-bank/standards/

  // Step 3: Create manifest
  const manifest = {
    flow: flowKey,
    version: require('../package.json').version,
    installed_at: new Date().toISOString(),
    tools: toolKeys
  };

  await fs.writeFile(
    path.join(specsmdDir, 'manifest.yaml'),
    yaml.dump(manifest),
    'utf8'
  );

  CLIUtils.displayStatus('', 'Created installation manifest', 'success');

  // Bundle yaml/js-yaml into .specsmd/node_modules/ so flow scripts can find
  // them via Node's normal module resolution. Also writes .specsmd/.gitignore
  // to keep the bundled deps out of the user's git tree.
  await bundleScriptDeps(specsmdDir);
  CLIUtils.displayStatus('', 'Bundled script dependencies', 'success');

  await patchRootGitignore();
  CLIUtils.displayStatus('', 'Updated .gitignore', 'success');

  // Count files created for analytics
  const filesCreated = await countFiles(specsmdDir);
  return filesCreated;
}

async function rollback(flowKey, toolKeys) {
  // Remove tool command files
  for (const toolKey of toolKeys) {
    const installer = InstallerFactory.getInstaller(toolKey);
    if (installer) {
      const commandsDir = installer.commandsDir;
      if (await fs.pathExists(commandsDir)) {
        const files = await fs.readdir(commandsDir);
        for (const file of files) {
          if (file.startsWith('specsmd-')) {
            await fs.remove(path.join(commandsDir, file));
          }
        }
      }
    }
  }

  // Remove .specsmd directory
  if (await fs.pathExists('.specsmd')) {
    await fs.remove('.specsmd');
  }
}

async function uninstall(options = {}) {
  CLIUtils.displayHeader('Uninstall', '');

  if (options.global) {
    const result = await uninstallFlowGlobal();
    if (result.removed.length === 0) {
      CLIUtils.displayWarning('specsmd is not installed globally');
      return;
    }

    CLIUtils.displaySuccess('Global uninstall complete!', 'Complete');
    return;
  }

  // Check if specsmd is installed
  if (!await fs.pathExists('.specsmd/manifest.yaml')) {
    CLIUtils.displayWarning('specsmd is not installed in this project');
    return;
  }

  // Read manifest
  const manifestContent = await fs.readFile('.specsmd/manifest.yaml', 'utf8');
  const manifest = yaml.load(manifestContent);

  const installers = InstallerFactory.getInstallers();
  // Support both old 'ides' key and new 'tools' key for backward compatibility
  const installedToolKeys = manifest.tools || manifest.ides || [];
  const installedNames = installers
    .filter(i => installedToolKeys.includes(i.key))
    .map(i => i.name);

  console.log(theme.dim(`Found installation: ${FLOWS[manifest.flow].name} flow`));
  console.log(theme.dim(`Installed for: ${installedNames.join(', ')}\n`));

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Are you sure you want to uninstall specsmd?',
    initial: false
  });

  if (!confirm) {
    CLIUtils.displayStatus('', 'Uninstall cancelled', 'warning');
    return;
  }

  // Ask about memory bank
  const { keepMemoryBank } = await prompts({
    type: 'confirm',
    name: 'keepMemoryBank',
    message: 'Keep memory-bank folder? (Contains your project artifacts)',
    initial: true
  });

  console.log(theme.primary('\nUninstalling...\n'));

  try {
    // Remove command files
    for (const toolKey of installedToolKeys) {
      const installer = InstallerFactory.getInstaller(toolKey);
      if (installer) {
        const commandsDir = installer.commandsDir;
        if (await fs.pathExists(commandsDir)) {
          console.log(theme.dim(`  Removing commands from ${commandsDir}/...`));
          const files = await fs.readdir(commandsDir);
          for (const file of files) {
            if (file.startsWith('specsmd-')) {
              await fs.remove(path.join(commandsDir, file));
            }
          }
        }
      }
    }

    // Remove .specsmd directory
    console.log(theme.dim('  Removing .specsmd/...'));
    await fs.remove('.specsmd');

    // Optionally remove memory-bank
    if (!keepMemoryBank && await fs.pathExists('memory-bank')) {
      console.log(theme.dim('  Removing memory-bank/...'));
      await fs.remove('memory-bank');
    }

    CLIUtils.displaySuccess('Uninstall complete!', 'Complete');
    if (keepMemoryBank) {
      console.log(theme.dim('memory-bank/ was preserved\n'));
    }
  } catch (error) {
    CLIUtils.displayError(`Uninstall failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  install,
  uninstall,
  parseFlowFlag,
  parseToolsFlag,
  bundleScriptDeps,
  patchRootGitignore
};
