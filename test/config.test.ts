import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, resolveConfig } from '../src/config/config.ts';

function tempApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test('defaults resolve against the config folder, and next is detected', () => {
  const dir = tempApp({ 'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }) });
  const config = resolveConfig({}, join(dir, 'tourwright.config.ts'), {});
  assert.equal(config.preset, 'next');
  assert.equal(config.stages, join(dir, 'tourwright', 'stages.tsx'));
  assert.equal(config.walkthroughs, join(dir, 'tourwright', 'walkthroughs'));
  assert.equal(config.voice.backend, 'kokoro');
});

test('TOURWRIGHT_VOICE overrides the configured backend, and is validated', () => {
  const file = join(tempApp({}), 'tourwright.config.ts');
  assert.equal(resolveConfig({ voice: { backend: 'kokoro' } }, file, { TOURWRIGHT_VOICE: 'fake' }).voice.backend, 'fake');
  assert.throws(() => resolveConfig({}, file, { TOURWRIGHT_VOICE: 'loud' }), ConfigError);
});

test('loads a TypeScript config from a parent folder', async () => {
  const dir = tempApp({
    'package.json': '{}',
    'tourwright.config.ts': 'const config: { out: string } = { out: "videos" };\nexport default config;\n',
  });
  const config = await loadConfig(join(dir), {});
  assert.equal(config.out, join(dir, 'videos'));
  assert.equal(config.preset, 'vite-react');
});

test('an invalid config names the bad field', async () => {
  const dir = tempApp({ 'tourwright.config.mjs': 'export default { stage: "x" };\n' });
  await assert.rejects(loadConfig(dir, {}), /rename "stage" to "stages"/);
});

test('a missing config says to run init', async () => {
  await assert.rejects(loadConfig(tempApp({}), {}), /tourwright init/);
});
