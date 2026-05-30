#!/usr/bin/env node

const { program } = require('commander');
const installer = require('../lib/installer');
const dashboard = require('../lib/dashboard');
const packageJson = require('../package.json');

program
    .version(packageJson.version)
    .description(packageJson.description);

program
    .command('install')
    .description('Install a specsmd flow (interactive by default)')
    .option('--flow <flow>', 'Skip the flow prompt: simple|fire|aidlc|ideation')
    .option('--tools <list>', 'Skip the tool prompt: comma-separated tool keys')
    .option('--global', 'Install supported flows globally for claude, codex, or cursor')
    .action((options) => installer.install(options));

program
    .command('uninstall')
    .description('Uninstall specsmd from the current project')
    .option('--global', 'Uninstall global specsmd flow artifacts')
    .action((options) => installer.uninstall(options));

program
    .command('dashboard')
    .description('Live terminal dashboard for flow state (FIRE first)')
    .option('--flow <flow>', 'Flow to inspect (fire|aidlc|simple), default auto-detect')
    .option('--path <dir>', 'Workspace path', process.cwd())
    .option('--worktree <nameOrPath>', 'Initial git worktree (branch name, worktree name, id, or absolute path)')
    .option('--refresh-ms <n>', 'Fallback refresh interval in milliseconds (default: 1000)', '1000')
    .option('--no-watch', 'Render once and exit')
    .action((options) => dashboard.run(options));

program.parseAsync(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});
