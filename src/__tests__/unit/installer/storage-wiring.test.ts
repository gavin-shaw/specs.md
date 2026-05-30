import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'yaml';

/* eslint-disable @typescript-eslint/no-require-imports */
const { installFlowGlobal } = require('../../../lib/installers/global-install');
const { initRun, fireDir: initFireDir } = require('../../../flows/fire/agents/builder/skills/run-execute/scripts/init-run.cjs');
const { completeCurrentItem, fireDir: completeFireDir } = require('../../../flows/fire/agents/builder/skills/run-execute/scripts/complete-run.cjs');
const { updateCheckpoint, fireDir: checkpointFireDir } = require('../../../flows/fire/agents/builder/skills/run-execute/scripts/update-checkpoint.cjs');
const { updatePhase, fireDir: phaseFireDir } = require('../../../flows/fire/agents/builder/skills/run-execute/scripts/update-phase.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

function collectMarkdown(root: string): string {
  const parts: string[] = [];

  function visit(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (entry === 'node_modules') continue;
      if (statSync(fullPath).isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.endsWith('.md')) {
        parts.push(readFileSync(fullPath, 'utf8'));
      }
    }
  }

  visit(root);
  return parts.join('\n');
}

describe('global storage wiring', () => {
  const originalArtifactRoot = process.env.SPECSMD_ARTIFACT_ROOT;
  let roots: string[] = [];

  afterEach(() => {
    if (originalArtifactRoot === undefined) {
      delete process.env.SPECSMD_ARTIFACT_ROOT;
    } else {
      process.env.SPECSMD_ARTIFACT_ROOT = originalArtifactRoot;
    }

    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots = [];
  });

  function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  function writeState(root: string, state: unknown): void {
    mkdirSync(join(root, 'runs'), { recursive: true });
    writeFileSync(join(root, 'state.yaml'), yaml.stringify(state), 'utf8');
  }

  function readState(root: string): any {
    return yaml.parse(readFileSync(join(root, 'state.yaml'), 'utf8'));
  }

  it('rewrites installed markdown to split global artifacts from repo-local standards', async () => {
    const tempHome = tempRoot('specsmd-storage-home-');

    await installFlowGlobal('fire', ['codex'], { baseHome: tempHome });

    const markdown = collectMarkdown(join(tempHome, '.codex', 'skills', 'specsmd-fire'));

    expect(markdown).not.toContain('.specs-fire/standards/');
    expect(markdown).not.toMatch(/\.specs-fire\/(?:state\.yaml|intents|runs)\b/);
    expect(markdown).toContain('.docs/');
    expect(markdown).toContain('~/.specs-fire/<project-name>/state.yaml');
    expect(markdown).toContain('~/.specs-fire/<project-name>/intents/');
    expect(markdown).toContain('~/.specs-fire/<project-name>/runs/');
    expect(markdown).toContain('SPECSMD_ARTIFACT_ROOT="$HOME/.specs-fire/$(basename "{rootPath}")"');
  });

  it('run-execute scripts use SPECSMD_ARTIFACT_ROOT for state, intents, and runs', () => {
    const repoRoot = tempRoot('specsmd-storage-repo-');
    const artifactRoot = tempRoot('specsmd-storage-artifacts-');
    process.env.SPECSMD_ARTIFACT_ROOT = artifactRoot;

    writeState(artifactRoot, {
      intents: [
        {
          id: 'INT-001',
          work_items: [
            { id: 'WI-001', status: 'pending', mode: 'confirm' }
          ]
        }
      ],
      runs: { active: [], completed: [] }
    });

    const initResult = initRun(repoRoot, [{ id: 'WI-001', intent: 'INT-001', mode: 'confirm' }], 'single');
    updateCheckpoint(repoRoot, initResult.runId, 'approved', { checkpoint: 'plan' });
    updatePhase(repoRoot, initResult.runId, 'review');
    const completeResult = completeCurrentItem(repoRoot, initResult.runId, {}, { force: false });

    expect(initResult.runPath.startsWith(join(artifactRoot, 'runs'))).toBe(true);
    expect(existsSync(join(repoRoot, '.specs-fire'))).toBe(false);
    expect(completeResult.completedItem).toBe('WI-001');
    expect(readState(artifactRoot).runs.active[0].work_items[0].status).toBe('completed');
  });

  it('run-execute scripts default to repo-local .specs-fire when no override is set', () => {
    delete process.env.SPECSMD_ARTIFACT_ROOT;
    const repoRoot = '/tmp/example-repo';

    expect(initFireDir(repoRoot)).toBe(join(repoRoot, '.specs-fire'));
    expect(completeFireDir(repoRoot)).toBe(join(repoRoot, '.specs-fire'));
    expect(checkpointFireDir(repoRoot)).toBe(join(repoRoot, '.specs-fire'));
    expect(phaseFireDir(repoRoot)).toBe(join(repoRoot, '.specs-fire'));
  });
});
