import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bundleScriptDeps } = require('../../../lib/installer');

describe('bundleScriptDeps', () => {
  let specsmdDir: string;

  beforeEach(() => {
    specsmdDir = mkdtempSync(join(tmpdir(), 'specsmd-bundle-test-'));
  });

  afterEach(() => {
    rmSync(specsmdDir, { recursive: true, force: true });
  });

  it('copies yaml package into .specsmd/node_modules/yaml', async () => {
    await bundleScriptDeps(specsmdDir);

    const yamlPkgPath = join(specsmdDir, 'node_modules', 'yaml', 'package.json');
    expect(existsSync(yamlPkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(yamlPkgPath, 'utf8'));
    expect(pkg.name).toBe('yaml');
  });

  it('copies js-yaml package into .specsmd/node_modules/js-yaml', async () => {
    await bundleScriptDeps(specsmdDir);

    const jsYamlPkgPath = join(specsmdDir, 'node_modules', 'js-yaml', 'package.json');
    expect(existsSync(jsYamlPkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(jsYamlPkgPath, 'utf8'));
    expect(pkg.name).toBe('js-yaml');
  });

  it('writes .specsmd/.gitignore excluding node_modules', async () => {
    await bundleScriptDeps(specsmdDir);

    const gitignorePath = join(specsmdDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const contents = readFileSync(gitignorePath, 'utf8');
    expect(contents).toContain('node_modules/');
  });

  it('produces yaml that scripts can require from .specsmd/foo/bar/baz/script.cjs', async () => {
    await bundleScriptDeps(specsmdDir);

    // Simulate a deeply-nested script path inside .specsmd and verify Node's
    // module resolution can find the bundled yaml from there.
    const scriptDir = join(specsmdDir, 'fire', 'agents', 'builder', 'skills', 'run-execute', 'scripts');
    const { createRequire } = await import('module');
    const scriptRequire = createRequire(join(scriptDir, 'fake-script.cjs'));

    const yaml = scriptRequire('yaml');
    expect(typeof yaml.parse).toBe('function');
    expect(typeof yaml.stringify).toBe('function');

    const jsYaml = scriptRequire('js-yaml');
    expect(typeof jsYaml.load).toBe('function');
    expect(typeof jsYaml.dump).toBe('function');
  });
});
