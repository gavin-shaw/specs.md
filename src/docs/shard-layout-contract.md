# FIRE Worktree Shard Layout Contract

**Layout version: `shard_version: 1`**

This document is the published, versioned contract for the per-worktree FIRE run-state
shard. It is the on-disk API the **g3code dashboard** implements its shard-merge against.
A change to the shard layout **MUST** bump `shard_version` (and add a changelog entry
below) so consumers can detect drift.

Source of truth in this repo:
`src/flows/fire/agents/builder/skills/run-execute/scripts/shard-paths.cjs`
(`SHARD_VERSION`, `worktreeId`, `shardDir`, `shardStatePath`, `readShardState`,
`writeShardState`). Keep this doc and that module in sync.

## Why this exists (Option A)

Mutable run state is sharded **per worktree** so two Builders running in two worktrees of
one project write **disjoint** files — no shared hot-write, no lock, no stall. The shared
`state.yaml` holds **planning** only; runtime status lives in the shard plus the per-WI
markdown. Producing a single merged view across worktrees is the reader's job (g3code);
this contract is what the reader implements against.

## Global root resolution (worktree-invariant)

- **Project key** = `basename(realpath(mainWorktreeRoot))`, where `mainWorktreeRoot` is the
  first entry of `git worktree list --porcelain`. A linked worktree and its main tree
  resolve to the **same** project key, hence the same global root
  `~/.specs-fire/<project-key>/`.
- At builder runtime the global root arrives via `SPECSMD_ARTIFACT_ROOT` (injected,
  already main-worktree-keyed); the builder scripts do not shell git.

## Shard path template

```
~/.specs-fire/<project-key>/                      # shared project root (worktree-invariant)
├── state.yaml                                    # SHARED — planning only
├── intents/<intent-id>/...                       # SHARED — Planner-owned (per-WI markdown)
├── runs/<run-id>/                                # SHARED parent; write-once run folders
│   └── run.md  plan.md  test-report.md  review-report.md  walkthrough.md
└── worktrees/<worktree-id>/                       # per-worktree SHARD directory
    └── run-state.yaml                             # the only mutable per-worktree file
```

- **Run output folders** stay under the shared `runs/<run-id>/`. They are write-once under
  a collision-safe unique `run-id`, so two worktrees never co-write them; only the mutable
  run-state file is sharded.

## Shard-id scheme (`<worktree-id>`)

```
<worktree-id> = sanitize(basename(realpath(worktreeRoot))) + "-" + sha256(realpath(worktreeRoot)).slice(0, 8)
```

- `realpath` normalises symlinks (falls back to `path.resolve` if it cannot be taken).
- `sanitize` = lowercase, every run of non-`[a-z0-9]` → `-`, trim leading/trailing `-`
  (empty → `workspace`).
- The 8-hex path hash guarantees two worktrees that **share a basename but sit at different
  paths** get **different** shard ids (and therefore different shard directories).
- The same `<worktree-id>` is the run-id worktree token, so `run-<worktree-id>-NNN` never
  collides across worktrees. `NNN` is a per-shard monotonic sequence.

## Shard file schema — `run-state.yaml`

```yaml
shard_version: 1
worktree_id: <worktree-id>               # see scheme above
worktree_path: <realpath of this worktree root>
runs:
  active:
    - id: run-<worktree-id>-NNN
      scope: single | batch | wide
      work_items:
        - id: <wi-id>
          intent: <intent-id>
          mode: autopilot | confirm | validate
          status: pending | in_progress | completed
          current_phase: plan | execute | test | review | null
          checkpoint_state: none | awaiting_approval | approved | not_required
          current_checkpoint: <name> | null
          completed_at: <iso-8601> | null      # present once the item completes
      current_item: <wi-id> | null
      started: <iso-8601>
  completed:
    - id: run-<worktree-id>-NNN
      scope: single | batch | wide
      work_items:
        - { id: <wi-id>, intent: <intent-id>, mode: autopilot | confirm | validate }
      started: <iso-8601>
      completed: <iso-8601>
```

- `runs.active[]` entries carry full per-WI runtime fields; `runs.completed[]` entries carry
  the trimmed `{id, intent, mode}` work-item shape plus `started`/`completed`.
- All shard writes are atomic (same-directory temp file + `rename`), so a reader never
  observes a truncated `run-state.yaml`.

## Field split — shared (planning) vs shard (runtime)

| Field | Location | Class |
|-------|----------|-------|
| `project.*`, `workspace.*` | `state.yaml` | shared |
| `intents[].id / title / status / completed_at` | `state.yaml` | **shared (planning)** |
| `intents[].work_items[].id / title / complexity / mode / depends_on / branch` | `state.yaml` | **shared (planning)** |
| `intents[].work_items[].status / run_id / completed_at` (runtime) | per-WI markdown frontmatter + shard | **shard (runtime)** |
| `runs.active[]`, `runs.completed[]` (whole arrays) | shard `run-state.yaml` | **shard (runtime)** |
| `runs.active[].current_item` | shard | **shard (runtime)** |
| `runs.active[].work_items[].current_phase` | shard | **shard (runtime)** |
| `runs.active[].work_items[].checkpoint_state / current_checkpoint` | shard | **shard (runtime)** |
| `shard_version / worktree_id / worktree_path` | shard | **shard (runtime)** |

The builder scripts **never** write run records or runtime status into the shared
`state.yaml`. The shared `state.yaml` `intents[]` is planning only.

## Reader reconstruction rule (effective WI status)

```
effective_status(wi) =
  1. shard runtime status, if wi appears in any worktrees/*/run-state.yaml run; else
  2. the per-WI markdown frontmatter `status` (durable runtime record); else
  3. the shared state.yaml planning status (default 'pending').
```

- **Planning** (what the Planner intends) always comes from `state.yaml`.
- **Runtime** (what a Builder did) comes from the shard, falling back to the per-WI markdown.
- The merged view enumerates `~/.specs-fire/<project-key>/worktrees/*/run-state.yaml`,
  overlays each WI's runtime status, and presents planning ⊕ runtime.

## Consumer & scope

The **g3code dashboard** is the consumer of this contract: it enumerates the per-worktree
shards and merges them (overlaying runtime WI status onto planning) into one overall view.
That shard-merge work lives in g3code and is **out of scope for this repository** — this
repo only **publishes** the layout. A future specsmd change to the layout must bump
`shard_version` so g3code can detect and adapt to the revision.

## Changelog

- **v1** — Initial sharded run-state layout: `worktrees/<worktree-id>/run-state.yaml`,
  collision-safe `<worktree-id>`, Option A field split, atomic writes.
