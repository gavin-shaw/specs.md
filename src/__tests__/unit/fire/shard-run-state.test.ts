/**
 * Tests for Option A sharded run state.
 *
 * Mutable run records live in a per-worktree shard
 * (<artifactRoot>/worktrees/<worktree-id>/run-state.yaml); the shared state.yaml carries
 * planning only. Two worktrees of one project write disjoint shards — the property that
 * makes parallel builders non-stalling. SPECSMD_ARTIFACT_ROOT is pointed at a shared
 * artifact root to simulate two worktrees of the same project.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import * as yaml from 'yaml';

/* eslint-disable @typescript-eslint/no-require-imports */
const scripts = '../../../flows/fire/agents/builder/skills/run-execute/scripts';
const { initRun } = require(`${scripts}/init-run.cjs`);
const { completeRun } = require(`${scripts}/complete-run.cjs`);
const { worktreeId, shardStatePath, shardDir } = require(`${scripts}/shard-paths.cjs`);
const nodeFs = require('fs');
/* eslint-enable @typescript-eslint/no-require-imports */

const PLANNING = {
  intents: [
    { id: 'INT-001', title: 'Demo', status: 'pending', work_items: [{ id: 'WI-001', status: 'pending' }] },
  ],
};

describe('sharded run state (Option A)', () => {
  let artifactRoot: string;
  let wtA: string;
  let wtB: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'shard-artifact-'));
    mkdirSync(join(artifactRoot, 'runs'), { recursive: true });
    writeFileSync(join(artifactRoot, 'state.yaml'), yaml.stringify(PLANNING), 'utf8');
    wtA = mkdtemp('wt-a-proj-');
    wtB = mkdtemp('wt-b-proj-');
    savedEnv = process.env.SPECSMD_ARTIFACT_ROOT;
    process.env.SPECSMD_ARTIFACT_ROOT = artifactRoot;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SPECSMD_ARTIFACT_ROOT;
    } else {
      process.env.SPECSMD_ARTIFACT_ROOT = savedEnv;
    }
    vi.restoreAllMocks();
    for (const dir of [artifactRoot, wtA, wtB]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function mkdtemp(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
  }

  function readShard(rootPath: string): { runs: { active: Array<{ id: string }>; completed: Array<{ id: string }> } } {
    return yaml.parse(readFileSync(shardStatePath(rootPath), 'utf8'));
  }

  function readPlanning(): { runs?: unknown; intents: Array<{ work_items: Array<{ status: string }> }> } {
    return yaml.parse(readFileSync(join(artifactRoot, 'state.yaml'), 'utf8'));
  }

  it('writes the run record to the shard, not state.yaml.runs.active', () => {
    const { runId } = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');

    const shard = readShard(wtA);
    expect(shard.runs.active.map((r) => r.id)).toContain(runId);

    const planning = readPlanning();
    expect(planning.runs).toBeUndefined();
  });

  it('two worktrees of one project write disjoint shards', () => {
    const a = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    const b = initRun(wtB, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    completeRun(wtA, a.runId, {}, { force: true });
    completeRun(wtB, b.runId, {}, { force: true });

    expect(shardStatePath(wtA)).not.toBe(shardStatePath(wtB));

    const shardA = readShard(wtA);
    const shardB = readShard(wtB);
    const idsA = [...shardA.runs.active, ...shardA.runs.completed].map((r) => r.id);
    const idsB = [...shardB.runs.active, ...shardB.runs.completed].map((r) => r.id);

    expect(idsA).toContain(a.runId);
    expect(idsB).toContain(b.runId);
    expect(idsA).not.toContain(b.runId);
    expect(idsB).not.toContain(a.runId);
  });

  it('two worktrees with the same basename but different paths get different shard ids', () => {
    expect(worktreeId('/repos/x/proj')).not.toBe(worktreeId('/repos/y/proj'));
    expect(shardDir('/repos/x/proj')).not.toBe(shardDir('/repos/y/proj'));
    // Same basename prefix, different hash suffix.
    expect(worktreeId('/repos/x/proj').startsWith('proj-')).toBe(true);
    expect(worktreeId('/repos/y/proj').startsWith('proj-')).toBe(true);
  });

  it('does not mutate planning state.yaml intents with runtime status', () => {
    const before = readPlanning();
    const { runId } = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    completeRun(wtA, runId, {}, { force: true });

    const after = readPlanning();
    expect(after.intents).toEqual(before.intents);
    expect(after.intents[0].work_items[0].status).toBe('pending');
  });

  it('routes shard writes through the atomic temp+rename helper', () => {
    const renameSpy = vi.spyOn(nodeFs, 'renameSync');
    initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');

    const renamedTargets = renameSpy.mock.calls.map((c) => c[1]);
    expect(renamedTargets).toContain(shardStatePath(wtA));
  });

  it('generates unique, non-colliding run ids across two worktrees', () => {
    const a1 = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    const a2 = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    const b1 = initRun(wtB, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');

    expect(a1.runId).toBe(`run-${worktreeId(wtA)}-001`);
    expect(a2.runId).toBe(`run-${worktreeId(wtA)}-002`);
    expect(b1.runId).toBe(`run-${worktreeId(wtB)}-001`);
    expect(new Set([a1.runId, a2.runId, b1.runId]).size).toBe(3);
  });

  it('makes a completed WI status recoverable from the shard and the per-WI markdown', () => {
    const intentDir = join(artifactRoot, 'intents', 'INT-001');
    mkdirSync(join(intentDir, 'work-items'), { recursive: true });
    writeFileSync(join(intentDir, 'brief.md'), '---\nid: INT-001\nstatus: pending\n---\n\n# INT-001\n', 'utf8');
    writeFileSync(
      join(intentDir, 'work-items', 'WI-001.md'),
      '---\nid: WI-001\nintent: INT-001\nstatus: in_progress\n---\n\n# WI-001\n',
      'utf8'
    );

    const { runId } = initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');
    completeRun(wtA, runId, {}, { force: true });

    const shard = readShard(wtA);
    const completed = shard.runs.completed.find((r) => r.id === runId);
    expect(completed).toBeDefined();

    const wiMd = readFileSync(join(intentDir, 'work-items', 'WI-001.md'), 'utf8');
    const fm = yaml.parse((wiMd.match(/^---\n([\s\S]*?)\n---/) as RegExpMatchArray)[1]);
    expect(fm.status).toBe('completed');
    expect(fm.run_id).toBe(runId);
  });

  it('keeps the temp file beside the shard (same directory) for a single-fs rename', () => {
    const renameSpy = vi.spyOn(nodeFs, 'renameSync');
    initRun(wtA, [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }], 'single');

    const shardWrite = renameSpy.mock.calls.find((c) => c[1] === shardStatePath(wtA));
    expect(shardWrite).toBeDefined();
    expect(dirname(shardWrite![0] as string)).toBe(dirname(shardStatePath(wtA)));
  });
});
