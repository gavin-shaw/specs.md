import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const migrate = require('../../../lib/installers/migrate.cjs');
const { installFlowGlobal } = require('../../../lib/installers/global-install');
const { detectRepoLocalInstall } = require('../../../lib/installers/storage-migration');
/* eslint-enable @typescript-eslint/no-require-imports */

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');
const MIGRATE_SOURCE = resolve(__dirname, '..', '..', '..', 'lib', 'installers', 'migrate.cjs');

describe('orchestrator-triggered migration', () => {
  let repoRoot: string;
  let baseHome: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'specsmd-otm-repo-'));
    baseHome = mkdtempSync(join(tmpdir(), 'specsmd-otm-home-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(baseHome, { recursive: true, force: true });
  });

  function createRepoLocalInstall() {
    mkdirSync(join(repoRoot, '.specs-fire', 'standards'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'intents'), { recursive: true });
    mkdirSync(join(repoRoot, '.specs-fire', 'runs'), { recursive: true });
    writeFileSync(join(repoRoot, '.specs-fire', 'state.yaml'), 'project:\n  name: demo\n', 'utf8');
    mkdirSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire'), { recursive: true });
    writeFileSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'), 'name: specsmd-fire\n', 'utf8');
  }

  // AC: runtime trigger detect → execute (migrate --yes) for a given cwd.
  it('migrate --yes moves repo-local artifacts to the global root for the cwd', async () => {
    createRepoLocalInstall();
    const projectKey = repoRoot.split('/').pop() as string;

    const result = await migrate.run(['node', 'migrate', '--yes', repoRoot], { baseHome });

    expect(result.status).toBe('completed');
    expect(existsSync(join(baseHome, '.specs-fire', projectKey, 'state.yaml'))).toBe(true);
    expect(existsSync(join(baseHome, '.specs-fire', projectKey, 'intents'))).toBe(true);
    expect(existsSync(join(repoRoot, '.docs'))).toBe(true); // standards moved
    expect(existsSync(join(repoRoot, '.codex', 'skills', 'specsmd-fire'))).toBe(false);
    expect(existsSync(join(repoRoot, '.specs-fire'))).toBe(false); // retired (now empty)
  });

  // AC: migrate --check builds + reports a plan WITHOUT mutating the filesystem.
  it('migrate --check reports a pending plan and changes nothing', async () => {
    createRepoLocalInstall();
    const projectKey = repoRoot.split('/').pop() as string;

    const result = await migrate.run(['node', 'migrate', '--check', repoRoot], { baseHome });

    expect(result.status).toBe('pending');
    expect(result.moves.length).toBeGreaterThan(0);
    expect(existsSync(join(repoRoot, '.specs-fire', 'state.yaml'))).toBe(true);
    expect(existsSync(join(baseHome, '.specs-fire', projectKey))).toBe(false);
  });

  // AC: runtime trigger reuses detect/execute by import (no re-implemented logic).
  it('migrate.cjs reuses detect/execute by import', () => {
    const source = readFileSync(MIGRATE_SOURCE, 'utf8');
    expect(source).toContain("require('./storage-migration')");
    expect(source).toContain("require('./migration-executor')");
    // No re-implemented detection / move primitives.
    expect(source).not.toContain('function detectRepoLocalInstall');
    expect(source).not.toContain('function executeMove');
  });

  // AC: emitted global orchestrator carries Step 0; planner/builder do NOT;
  // and the flow source stays unchanged.
  it('injects Step 0 into the emitted orchestrator only, leaving source untouched', async () => {
    await installFlowGlobal('fire', ['claude'], { baseHome });

    const orchestrator = readFileSync(
      join(baseHome, '.claude', 'skills', 'specsmd-fire', 'SKILL.md'),
      'utf8'
    );
    const planner = readFileSync(
      join(baseHome, '.claude', 'skills', 'specsmd-fire-planner', 'SKILL.md'),
      'utf8'
    );
    const builder = readFileSync(
      join(baseHome, '.claude', 'skills', 'specsmd-fire-builder', 'SKILL.md'),
      'utf8'
    );

    expect(orchestrator).toContain('Step 0 — Repo-Local Migration Check');
    expect(orchestrator).toContain('migrate.cjs');
    expect(orchestrator).toContain('Step 0b — Init Clarity Check');
    expect(orchestrator).toContain('init-check.cjs');
    expect(orchestrator).toContain('~/.specs-fire/<project>/');
    expect(orchestrator).toContain('<repo>/.docs/');
    expect(orchestrator).toContain('specsmd install');
    expect(orchestrator).toContain('Default is yes/proceed');
    expect(orchestrator).toContain('without scaffolding anything');
    expect(orchestrator).toContain('project-init skill unchanged');
    expect(orchestrator).toContain('dual detection supersedes the simple state check below');
    expect(planner).not.toContain('Step 0 — Repo-Local Migration Check');
    expect(builder).not.toContain('Step 0 — Repo-Local Migration Check');
    expect(planner).not.toContain('Step 0b — Init Clarity Check');
    expect(builder).not.toContain('Step 0b — Init Clarity Check');

    // Bundled launcher + lib present in the flow root.
    expect(existsSync(join(baseHome, '.claude', 'skills', 'specsmd-fire', 'migrate.cjs'))).toBe(true);
    expect(existsSync(join(baseHome, '.claude', 'skills', 'specsmd-fire', 'init-check.cjs'))).toBe(true);
    expect(existsSync(join(baseHome, '.claude', 'skills', 'specsmd-fire', 'node_modules', 'fs-extra'))).toBe(true);

    // Flow source must remain byte-identical (merge-safe injection at emit time).
    const dirty = execSync('git status --porcelain src/flows/fire', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    expect(dirty.trim()).toBe('');
  });

  // AC: claude coverage extended to BOTH .claude/commands and .claude/agents;
  // .claude/skills left untouched; codex/cursor unchanged.
  it('migration cleans both .claude/commands and .claude/agents, leaving .claude/skills', async () => {
    mkdirSync(join(repoRoot, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'commands', 'specsmd-fire.md'), '# fire\n', 'utf8');
    mkdirSync(join(repoRoot, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'agents', 'specsmd-fire-builder.md'), '# builder\n', 'utf8');
    mkdirSync(join(repoRoot, '.claude', 'skills', 'specsmd-fire'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'skills', 'specsmd-fire', 'SKILL.md'), 'keep me\n', 'utf8');

    const detection = await detectRepoLocalInstall(repoRoot);
    const detectedDirs = detection.entryPoints.map((e: { relativePath: string }) => e.relativePath);
    expect(detectedDirs).toContain(join('.claude', 'commands', 'specsmd-fire.md'));
    expect(detectedDirs).toContain(join('.claude', 'agents', 'specsmd-fire-builder.md'));
    // skills are NOT in scope for detection/removal.
    expect(detectedDirs.some((p: string) => p.includes(join('.claude', 'skills')))).toBe(false);

    await migrate.run(['node', 'migrate', '--yes', repoRoot], { baseHome });

    expect(existsSync(join(repoRoot, '.claude', 'commands', 'specsmd-fire.md'))).toBe(false);
    expect(existsSync(join(repoRoot, '.claude', 'agents', 'specsmd-fire-builder.md'))).toBe(false);
    expect(existsSync(join(repoRoot, '.claude', 'skills', 'specsmd-fire', 'SKILL.md'))).toBe(true);
  });
});
