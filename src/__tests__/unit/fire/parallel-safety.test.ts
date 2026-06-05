/**
 * Parallel non-stall safety tests.
 *
 * The core promise: two Builders in two worktrees of one project run the real
 * init-run / update-phase / complete-run flow at the same time, write DISJOINT shards,
 * both runs are durably recorded, and no shared mutable file is co-written — so one run
 * can never block the other. "No stall" is asserted structurally (disjoint shard writes +
 * an unmutated shared state.yaml), which is what makes stalling impossible.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as yaml from 'yaml';

/* eslint-disable @typescript-eslint/no-require-imports */
const scripts = '../../../flows/fire/agents/builder/skills/run-execute/scripts';
const { initRun } = require(`${scripts}/init-run.cjs`);
const { updatePhase } = require(`${scripts}/update-phase.cjs`);
const { completeRun } = require(`${scripts}/complete-run.cjs`);
const { shardStatePath } = require(`${scripts}/shard-paths.cjs`);
/* eslint-enable @typescript-eslint/no-require-imports */

const WI = [{ id: 'WI-001', intent: 'INT-001', mode: 'autopilot' }];

describe('parallel non-stall safety', () => {
  let artifactRoot: string;
  let wtA: string;
  let wtB: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'parallel-artifact-'));
    mkdirSync(join(artifactRoot, 'runs'), { recursive: true });
    writeFileSync(
      join(artifactRoot, 'state.yaml'),
      yaml.stringify({ intents: [{ id: 'INT-001', status: 'pending', work_items: [{ id: 'WI-001', status: 'pending' }] }] }),
      'utf8'
    );
    wtA = mkdtempSync(join(tmpdir(), 'wt-a-'));
    wtB = mkdtempSync(join(tmpdir(), 'wt-b-'));
    savedEnv = process.env.SPECSMD_ARTIFACT_ROOT;
    process.env.SPECSMD_ARTIFACT_ROOT = artifactRoot;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SPECSMD_ARTIFACT_ROOT;
    } else {
      process.env.SPECSMD_ARTIFACT_ROOT = savedEnv;
    }
    for (const dir of [artifactRoot, wtA, wtB]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function readShard(rootPath: string): { runs: { active: Array<{ id: string }>; completed: Array<{ id: string }> } } {
    return yaml.parse(readFileSync(shardStatePath(rootPath), 'utf8'));
  }

  function allRunIds(rootPath: string): string[] {
    const shard = readShard(rootPath);
    return [...shard.runs.active, ...shard.runs.completed].map((r) => r.id);
  }

  // Drive the real flow for one worktree: init → review → complete.
  function runFlow(rootPath: string): string {
    const { runId } = initRun(rootPath, WI, 'single');
    updatePhase(rootPath, runId, 'review');
    completeRun(rootPath, runId, { testsAdded: 1 });
    return runId;
  }

  it('runs the real flow in two worktrees writing disjoint, self-contained shards', () => {
    const runA = runFlow(wtA);
    const runB = runFlow(wtB);

    // Both runs produced run folders + run.md under the shared runs/ dir.
    for (const runId of [runA, runB]) {
      expect(existsSync(join(artifactRoot, 'runs', runId, 'run.md'))).toBe(true);
    }

    // Each run lives in its own shard; neither shard references the other's run id.
    expect(shardStatePath(wtA)).not.toBe(shardStatePath(wtB));
    expect(allRunIds(wtA)).toEqual([runA]);
    expect(allRunIds(wtB)).toEqual([runB]);
    expect(allRunIds(wtA)).not.toContain(runB);
    expect(allRunIds(wtB)).not.toContain(runA);
  });

  it('never co-writes a shared file: state.yaml is unchanged by either run', () => {
    const before = readFileSync(join(artifactRoot, 'state.yaml'), 'utf8');

    runFlow(wtA);
    runFlow(wtB);

    const after = readFileSync(join(artifactRoot, 'state.yaml'), 'utf8');
    expect(after).toBe(before);
    // The two shards are distinct files — no shared mutable write point.
    expect(shardStatePath(wtA)).not.toBe(shardStatePath(wtB));
  });

  it('produces correct, interleave-independent shard contents', () => {
    // Interleave: A.init, B.init, A.complete, B.complete.
    const a = initRun(wtA, WI, 'single');
    const b = initRun(wtB, WI, 'single');
    updatePhase(wtA, a.runId, 'review');
    updatePhase(wtB, b.runId, 'review');
    completeRun(wtA, a.runId, {});
    completeRun(wtB, b.runId, {});

    const shardA = readShard(wtA);
    const shardB = readShard(wtB);

    expect(shardA.runs.active).toHaveLength(0);
    expect(shardB.runs.active).toHaveLength(0);
    expect(shardA.runs.completed.map((r) => r.id)).toEqual([a.runId]);
    expect(shardB.runs.completed.map((r) => r.id)).toEqual([b.runId]);
  });

  it('keeps run-id sequences unique and non-colliding across shards under interleaving', () => {
    const a1 = initRun(wtA, WI, 'single');
    const b1 = initRun(wtB, WI, 'single');
    const a2 = initRun(wtA, WI, 'single');
    const b2 = initRun(wtB, WI, 'single');

    const ids = [a1.runId, b1.runId, a2.runId, b2.runId];
    expect(new Set(ids).size).toBe(4);
    // Each worktree's sequence is independent and monotonic within its own shard.
    expect(allRunIds(wtA).sort()).toEqual([a1.runId, a2.runId].sort());
    expect(allRunIds(wtB).sort()).toEqual([b1.runId, b2.runId].sort());
  });
});
