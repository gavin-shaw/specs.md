/**
 * Unit tests for atomic-write.cjs (writeFileAtomic)
 *
 * Verifies the temp-file + rename atomic-write contract:
 * - successful writes land the exact contents at the target
 * - the temp file lives in the target's own directory (single-filesystem rename)
 * - a failing rename leaves no partial file at the target
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// Spy on the CommonJS fs object the module under test actually requires (the ESM
// namespace import cannot be spied on — its bindings are non-configurable).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileAtomic } = require('../../../flows/fire/agents/builder/skills/run-execute/scripts/atomic-write.cjs');

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-write-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the exact contents to the target path on success', () => {
    const target = join(dir, 'state.yaml');
    writeFileAtomic(target, 'hello: world\n');

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('hello: world\n');
  });

  it('creates the temp file in the same directory as the target', () => {
    const target = join(dir, 'nested', 'shard.yaml');
    mkdirSync(dirname(target), { recursive: true });

    const renameSpy = vi.spyOn(nodeFs, 'renameSync');
    writeFileAtomic(target, 'a: 1\n');

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [tempSource, renameTarget] = renameSpy.mock.calls[0];
    expect(renameTarget).toBe(target);
    expect(dirname(tempSource as string)).toBe(dirname(target));
  });

  it('leaves no partial file at the target when rename throws (target absent)', () => {
    const target = join(dir, 'never-created.yaml');

    vi.spyOn(nodeFs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure');
    });

    expect(() => writeFileAtomic(target, 'x: 1\n')).toThrow('simulated rename failure');
    expect(existsSync(target)).toBe(false);
  });

  it('leaves prior target contents intact when rename throws', () => {
    const target = join(dir, 'existing.yaml');
    writeFileSync(target, 'original: true\n');

    vi.spyOn(nodeFs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure');
    });

    expect(() => writeFileAtomic(target, 'replacement: true\n')).toThrow('simulated rename failure');
    expect(readFileSync(target, 'utf8')).toBe('original: true\n');
  });

  it('depends only on Node built-ins (no flow-specific imports)', () => {
    const source = readFileSync(
      join(__dirname, '../../../flows/fire/agents/builder/skills/run-execute/scripts/atomic-write.cjs'),
      'utf8'
    );
    const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(requires.sort()).toEqual(['crypto', 'fs', 'path']);
  });
});
