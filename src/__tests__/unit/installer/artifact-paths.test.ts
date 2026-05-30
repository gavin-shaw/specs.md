import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { resolveArtifactPaths } = require('../../../lib/installers/artifact-paths');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('resolveArtifactPaths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves project-keyed global artifacts and repo-local standards with baseHome override', () => {
    const result = resolveArtifactPaths('/x/y/customer-authorization', { baseHome: '/home/u' });

    expect(result).toEqual({
      projectKey: 'customer-authorization',
      globalArtifactRoot: join('/home/u', '.specs-fire', 'customer-authorization'),
      standardsRoot: join('/x/y/customer-authorization', '.docs')
    });
  });

  it('uses os.homedir when baseHome is omitted', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/mock/home');

    const result = resolveArtifactPaths('/repos/specs.md');

    expect(os.homedir).toHaveBeenCalledTimes(1);
    expect(result.globalArtifactRoot).toBe(join('/mock/home', '.specs-fire', 'specs.md'));
  });

  it('normalizes trailing separators before deriving exact artifact paths', () => {
    const result = resolveArtifactPaths('/x/y/customer-authorization///', { baseHome: '/home/u///' });

    expect(result).toEqual({
      projectKey: 'customer-authorization',
      globalArtifactRoot: join('/home/u', '.specs-fire', 'customer-authorization'),
      standardsRoot: join('/x/y/customer-authorization', '.docs')
    });
  });

  it('does not import filesystem modules in the pure path resolver', () => {
    const source = readFileSync(join(__dirname, '../../../lib/installers/artifact-paths.js'), 'utf8');

    expect(source).not.toMatch(/require\(['"]fs['"]\)/);
    expect(source).not.toMatch(/require\(['"]fs-extra['"]\)/);
  });
});
