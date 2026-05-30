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
    .command('migrate')
    .description('Migrate a repo-local specsmd install to the global storage model for a directory')
    .argument('[cwd]', 'Target repository directory', process.cwd())
    .option('--check', 'Detect and print the migration plan without making changes')
    .option('--yes', 'Execute the migration non-interactively (destructive)')
    .action(async (cwd, options) => {
        const migrate = require('../lib/installers/migrate.cjs');
        const mode = options.yes ? '--yes' : '--check';
        const result = await migrate.run(['node', 'migrate', mode, cwd]);
        console.log(JSON.stringify(result, null, 2));
        if (result.status === 'blocked') {
            process.exit(3);
        }
    });

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
