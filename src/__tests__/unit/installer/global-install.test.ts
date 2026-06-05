import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  GLOBAL_MANIFEST_NAME,
  installFlowGlobal,
  uninstallFlowGlobal
} = require('../../../lib/installers/global-install');
/* eslint-enable @typescript-eslint/no-require-imports */

function collectTextFiles(root: string): string {
  const parts: string[] = [];

  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      const content = readFileSync(fullPath);
      if (!content.includes(0)) {
        parts.push(content.toString('utf8'));
      }
    }
  }

  visit(root);
  return parts.join('\n');
}

describe('installFlowGlobal', () => {
  let tempHome: string;
  let tempCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'specsmd-global-home-'));
    tempCwd = mkdtempSync(join(tmpdir(), 'specsmd-global-cwd-'));
    originalCwd = process.cwd();
    process.chdir(tempCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempCwd, { recursive: true, force: true });
  });

  it('installs global FIRE entry points for claude, codex, and cursor in native formats', async () => {
    await installFlowGlobal('fire', ['claude', 'codex', 'cursor'], { baseHome: tempHome });

    expect(existsSync(join(tempHome, '.claude', 'skills', 'specsmd-fire', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.claude', 'skills', 'specsmd-fire-planner', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.claude', 'skills', 'specsmd-fire-builder', 'SKILL.md'))).toBe(true);

    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire-planner', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire-builder', 'SKILL.md'))).toBe(true);

    expect(existsSync(join(tempHome, '.cursor', 'commands', 'specsmd-fire.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.cursor', 'commands', 'specsmd-fire-planner.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.cursor', 'commands', 'specsmd-fire-builder.md'))).toBe(true);

    const codexSkill = readFileSync(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md'), 'utf8');
    expect(codexSkill).toContain('name: specsmd-fire');
    expect(codexSkill).toContain(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'agents', 'orchestrator', 'agent.md'));
  });

  it('rewrites installed flow definitions and split storage paths', async () => {
    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    const installedFlow = collectTextFiles(join(tempHome, '.codex', 'skills', 'specsmd-fire'));

    expect(installedFlow).not.toContain('.specsmd/fire/');
    expect(installedFlow).toContain('~/.specs-fire/<project-name>/state.yaml');
    expect(installedFlow).toContain('.docs/');
    const codexFlowRoot = join(tempHome, '.codex', 'skills', 'specsmd-fire');
    expect(installedFlow).toContain(
      `SPECSMD_ARTIFACT_ROOT="$(node "${codexFlowRoot}/resolve-artifact-root.cjs" "{rootPath}")"`
    );
    expect(installedFlow).toContain(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'memory-bank.yaml'));
  });

  it('bundles script dependencies into the global flow root and writes a YAML manifest', async () => {
    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'node_modules', 'yaml', 'package.json'))).toBe(true);
    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire', 'node_modules', 'js-yaml', 'package.json'))).toBe(true);

    // Worktree-invariant resolver and its flat-bundled siblings must travel with the launcher.
    const flowRoot = join(tempHome, '.codex', 'skills', 'specsmd-fire');
    expect(existsSync(join(flowRoot, 'resolve-artifact-root.cjs'))).toBe(true);
    expect(existsSync(join(flowRoot, 'main-worktree.js'))).toBe(true);
    expect(existsSync(join(flowRoot, 'worktrees.js'))).toBe(true);

    const manifestPath = join(tempHome, '.codex', GLOBAL_MANIFEST_NAME);
    const manifest = yaml.load(readFileSync(manifestPath, 'utf8')) as {
      flow: string;
      tools: string[];
      locations: Record<string, { flow_root: string }>;
    };

    expect(manifest.flow).toBe('fire');
    expect(manifest.tools).toEqual(['codex']);
    expect(manifest.locations.codex.flow_root).toBe(join(tempHome, '.codex', 'skills', 'specsmd-fire'));
  });

  it('rejects unsupported global tools before writing partial artifacts', async () => {
    await expect(
      installFlowGlobal('fire', ['claude', 'gemini'], { baseHome: tempHome })
    ).rejects.toThrow(/Unsupported: gemini/);

    expect(existsSync(join(tempHome, '.claude'))).toBe(false);
    expect(existsSync(join(tempHome, '.gemini'))).toBe(false);
  });

  it('does not remove an existing global install when a later unsupported install fails', async () => {
    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    const existingSkill = join(tempHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md');
    expect(existsSync(existingSkill)).toBe(true);

    await expect(
      installFlowGlobal('fire', ['gemini'], { baseHome: tempHome })
    ).rejects.toThrow(/Unsupported: gemini/);

    expect(existsSync(existingSkill)).toBe(true);
  });

  it('does not write .specsmd or patch .gitignore in the target CWD', async () => {
    process.chdir(tempCwd);
    writeFileSync(join(tempCwd, '.gitignore'), 'dist/\n', 'utf8');

    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    expect(existsSync(join(tempCwd, '.specsmd'))).toBe(false);
    expect(readFileSync(join(tempCwd, '.gitignore'), 'utf8')).toBe('dist/\n');
  });

  it('uninstalls only tools recorded in the global manifest', async () => {
    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    const codexSkill = join(tempHome, '.codex', 'skills', 'specsmd-fire', 'SKILL.md');
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(join(tempHome, '.claude'))).toBe(false);

    await uninstallFlowGlobal({ baseHome: tempHome });

    expect(existsSync(codexSkill)).toBe(false);
    expect(existsSync(join(tempHome, '.codex', 'skills', 'specsmd-fire'))).toBe(false);
    expect(existsSync(join(tempHome, '.claude'))).toBe(false);
  });
});
