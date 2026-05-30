import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports */
const { rewriteGlobalFirePaths } = require('../../../lib/installers/global-rewrite');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('rewriteGlobalFirePaths', () => {
  it('rewrites repo-local FIRE flow references to the global flow root', () => {
    const result = rewriteGlobalFirePaths(
      'Read .specsmd/fire/agents/planner/agent.md',
      '/tmp/specsmd-fire'
    );

    expect(result).toBe('Read /tmp/specsmd-fire/agents/planner/agent.md');
  });

  it('leaves repo-local .specs-fire artifact references unchanged', () => {
    const input = 'Read .specs-fire/state.yaml and .specs-fire/intents/';

    expect(rewriteGlobalFirePaths(input, '/tmp/specsmd-fire')).toBe(input);
  });

  it('is idempotent for already-rewritten content', () => {
    const input = 'Use .specsmd/fire/agents/builder/agent.md';
    const once = rewriteGlobalFirePaths(input, '/tmp/specsmd-fire');
    const twice = rewriteGlobalFirePaths(once, '/tmp/specsmd-fire');

    expect(twice).toBe(once);
  });
});
