import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patchRootGitignore } = require('../../../lib/installer');

const EXPECTED_PATTERNS = [
  '.claude/agents/specsmd-*',
  '.claude/commands/specsmd-*',
  '.codex/skills/specsmd-*',
  '.cursor/commands/specsmd-*',
  '.specsmd',
  '.specs-fire/intents',
  '.specs-fire/runs',
  '.specs-fire/state.yaml'
];

describe('patchRootGitignore', () => {
  let projectDir: string;
  let gitignorePath: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'specsmd-gitignore-test-'));
    gitignorePath = join(projectDir, '.gitignore');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates .gitignore with header and all patterns when none exists', async () => {
    const result = await patchRootGitignore(projectDir);

    expect(result.created).toBe(true);
    expect(result.added).toEqual(EXPECTED_PATTERNS);
    expect(existsSync(gitignorePath)).toBe(true);

    const contents = readFileSync(gitignorePath, 'utf8');
    expect(contents).toContain('# specsmd');
    for (const pattern of EXPECTED_PATTERNS) {
      expect(contents).toContain(pattern);
    }
    expect(contents.endsWith('\n')).toBe(true);
  });

  it('appends only missing patterns when some are already present', async () => {
    writeFileSync(gitignorePath, 'node_modules/\n.specsmd\n', 'utf8');

    const result = await patchRootGitignore(projectDir);

    expect(result.created).toBe(false);
    expect(result.added).toEqual([
      '.claude/agents/specsmd-*',
      '.claude/commands/specsmd-*',
      '.codex/skills/specsmd-*',
      '.cursor/commands/specsmd-*',
      '.specs-fire/intents',
      '.specs-fire/runs',
      '.specs-fire/state.yaml'
    ]);

    const contents = readFileSync(gitignorePath, 'utf8');
    // Pre-existing content preserved
    expect(contents).toContain('node_modules/');
    // Pre-existing .specsmd not duplicated
    const specsmdMatches = contents.match(/^\.specsmd$/gm) || [];
    expect(specsmdMatches.length).toBe(1);
    // New patterns appended
    expect(contents).toContain('.claude/agents/specsmd-*');
  });

  it('is a no-op when all patterns are already present', async () => {
    const original = `node_modules/\n${EXPECTED_PATTERNS.join('\n')}\n`;
    writeFileSync(gitignorePath, original, 'utf8');

    const result = await patchRootGitignore(projectDir);

    expect(result.created).toBe(false);
    expect(result.added).toEqual([]);

    const after = readFileSync(gitignorePath, 'utf8');
    expect(after).toBe(original);
  });

  it('preserves unrelated existing content', async () => {
    const original = 'node_modules/\ndist/\n.env\n';
    writeFileSync(gitignorePath, original, 'utf8');

    await patchRootGitignore(projectDir);

    const contents = readFileSync(gitignorePath, 'utf8');
    expect(contents.startsWith(original)).toBe(true);
    expect(contents).toContain('dist/');
    expect(contents).toContain('.env');
  });

  it('handles a file that does not end in a newline', async () => {
    writeFileSync(gitignorePath, 'node_modules/', 'utf8');

    await patchRootGitignore(projectDir);

    const contents = readFileSync(gitignorePath, 'utf8');
    // Should not have concatenated lines like "node_modules/# specsmd"
    expect(contents).not.toMatch(/node_modules\/#/);
    // node_modules/ still recognizable as its own line
    expect(contents).toMatch(/^node_modules\/$/m);
    // # specsmd header present on its own line
    expect(contents).toMatch(/^# specsmd$/m);
  });
});
