import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scriptJsonSchema } from '../src/schema/emit.ts';
import { DEFAULT_SETTINGS, resolveSettings } from '../src/schema/settings.ts';

test('the committed JSON Schema matches the zod schema', () => {
  const committed = readFileSync(new URL('../schema/script.schema.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, scriptJsonSchema(), 'Run "npm run schema" and commit the result.');
});

test('resolveSettings merges each group over the defaults', () => {
  const s = resolveSettings({ video: { fps: 60 }, highlight: { color: 'red' } });
  assert.equal(s.video.fps, 60);
  assert.equal(s.video.width, DEFAULT_SETTINGS.video.width);
  assert.equal(s.highlight.color, 'red');
  assert.deepEqual(s.camera, DEFAULT_SETTINGS.camera);
});

test('every frame rate is a whole number of 24 kHz samples', () => {
  for (const fps of [24, 25, 30, 50, 60]) assert.equal(24000 % fps, 0);
});
