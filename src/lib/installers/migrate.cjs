#!/usr/bin/env node
// Self-contained repo-local → global migration launcher.
//
// Reused two ways:
//   migrate.cjs --check [cwd]  → build + print the migration plan, make NO changes
//   migrate.cjs --yes   [cwd]  → build the plan and execute it (DESTRUCTIVE moves/removals)
//
// Detection / plan / execution logic is reused by import from storage-migration.js
// and migration-executor.js — this launcher adds NO detection or move logic of its own.
// When bundled into a global flow root, this file and its lib deps sit alongside it so
// the orchestrator can invoke it from any repo without `specsmd` on PATH.
const path = require('path');
const { buildMigrationPlan } = require('./storage-migration');
const { executeMigration } = require('./migration-executor');
const { guardBaseWorktree } = require('./base-worktree-guard');

function parseArgs(argv) {
    const args = (argv || process.argv).slice(2);
    let mode = null;
    let cwd = null;
    for (const arg of args) {
        if (arg === '--check') {
            mode = 'check';
        } else if (arg === '--yes') {
            mode = 'yes';
        } else if (!arg.startsWith('--') && cwd === null) {
            cwd = arg;
        }
    }
    return { mode, cwd: cwd ? path.resolve(cwd) : process.cwd() };
}

function planIsEmpty(plan) {
    return !plan.detected || ((plan.moves || []).length === 0 && (plan.removals || []).length === 0);
}

function summarizePlan(plan) {
    return {
        status: 'pending',
        projectKey: plan.projectKey,
        repoRoot: plan.repoRoot,
        globalArtifactRoot: plan.globalArtifactRoot,
        standardsRoot: plan.standardsRoot,
        collision: plan.collision,
        moves: (plan.moves || []).map(move => ({ type: move.type, from: move.from, to: move.to })),
        removals: (plan.removals || []).map(removal => ({ type: removal.type, path: removal.path }))
    };
}

async function run(argv, options = {}) {
    const { mode, cwd } = parseArgs(argv);
    if (mode !== 'check' && mode !== 'yes') {
        const message = 'Usage: migrate.cjs --check|--yes [cwd]';
        return { status: 'usage_error', message };
    }

    // Refuse before any plan is built or file is moved when invoked from a linked worktree.
    const guard = guardBaseWorktree(cwd, options);
    if (guard.blocked) {
        return {
            status: 'blocked',
            reason: 'linked_worktree',
            message: guard.message,
            baseWorktreePath: guard.baseWorktreePath,
            repoRoot: cwd
        };
    }

    const plan = await buildMigrationPlan(cwd, options);

    if (planIsEmpty(plan)) {
        return { status: 'not_needed', detected: plan.detected, repoRoot: plan.repoRoot };
    }

    if (mode === 'check') {
        return summarizePlan(plan);
    }

    const result = await executeMigration(plan, options);
    return { status: result.status, completed: result.completed, globalArtifactRoot: plan.globalArtifactRoot };
}

async function main() {
    let result;
    try {
        result = await run(process.argv);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));

    if (result.status === 'usage_error') {
        process.exit(2);
    }
    if (result.status === 'blocked') {
        process.exit(3);
    }
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs, planIsEmpty, summarizePlan, run };
