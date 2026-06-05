import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  scriptArtifactEnv,
  rewriteFireArtifactPaths,
  rewriteGlobalFirePaths
} = require('../../../lib/installers/global-rewrite');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('rewriteGlobalFirePaths', () => {
  it('rewrites repo-local FIRE flow references to the global flow root', () => {
    const result = rewriteGlobalFirePaths(
      'Read .specsmd/fire/agents/planner/agent.md',
      '/tmp/specsmd-fire'
    );

    expect(result).toBe('Read /tmp/specsmd-fire/agents/planner/agent.md');
  });

  it('leaves repo-local .specs-fire artifact references unchanged by default', () => {
    const input = 'Read .specs-fire/state.yaml and .specs-fire/intents/';

    expect(rewriteGlobalFirePaths(input, '/tmp/specsmd-fire')).toBe(input);
  });

  it('rewrites FIRE artifact references when artifact rewrite is enabled', () => {
    const input = [
      'Read .specs-fire/state.yaml',
      'Glob .specs-fire/intents/*/brief.md',
      'Open .specs-fire/runs/{run-id}/run.md',
      'Load .specs-fire/standards/testing-standards.md'
    ].join('\n');

    const result = rewriteGlobalFirePaths(input, '/tmp/specsmd-fire', { rewriteArtifacts: true });

    expect(result).toContain('~/.specs-fire/<project-name>/state.yaml');
    expect(result).toContain('~/.specs-fire/<project-name>/intents/*/brief.md');
    expect(result).toContain('~/.specs-fire/<project-name>/runs/{run-id}/run.md');
    expect(result).toContain('.docs/testing-standards.md');
  });

  it('injects the worktree-invariant artifact-root override into run-execute script calls', () => {
    const result = rewriteFireArtifactPaths(
      'node scripts/update-phase.cjs {rootPath} {runId} test',
      '/tmp/specsmd-fire'
    );

    expect(result).toBe(
      `${scriptArtifactEnv('/tmp/specsmd-fire')} node scripts/update-phase.cjs {rootPath} {runId} test`
    );
    expect(result).toContain('/tmp/specsmd-fire/resolve-artifact-root.cjs');
  });

  it('is idempotent for already-rewritten content', () => {
    const input = 'Use .specsmd/fire/agents/builder/agent.md';
    const once = rewriteGlobalFirePaths(input, '/tmp/specsmd-fire');
    const twice = rewriteGlobalFirePaths(once, '/tmp/specsmd-fire');

    expect(twice).toBe(once);
  });
});
