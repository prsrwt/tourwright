// A review covers everything the video was made from, not only script.json: a fixture or component
// changed afterwards means the review no longer counts, and Muse refuses a review of stage code the
// reviewer has not seen yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAYER_PATH } from '../src/bundle/server.ts';
import { runInit } from '../src/cli/init.ts';
import { resolveConfig, type ResolvedConfig } from '../src/config/config.ts';
import { changedInputs, findLockfile, fingerprint, listFiles } from '../src/studio/fingerprint.ts';
import { API, type Review, type StudioState } from '../src/studio/protocol.ts';
import { formatReview, hashScript, readReview, reviewState, writeReview } from '../src/studio/review.ts';
import { createStudio } from '../src/studio/server.ts';

function app(): { config: ResolvedConfig; data: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-fingerprint-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const { log } = console;
  console.log = () => undefined;
  try {
    runInit(dir);
  } finally {
    console.log = log;
  }
  mkdirSync(join(dir, 'lib'));
  const data = join(dir, 'lib', 'data.ts');
  writeFileSync(data, 'export const total = 120;\n');
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
  return { config, data, script: join(config.walkthroughs, 'intro', 'script.json') };
}

test('a fingerprint names each file the video is made from, and says which changed', () => {
  const { config, data } = app();
  const inputs = fingerprint(config, 'intro', [data]);
  assert.deepEqual(Object.keys(inputs).sort(), ['lib/data.ts', 'package-lock.json', 'tourwright.config.mts', 'tourwright/walkthroughs/intro/script.json']);
  assert.equal(findLockfile(join(config.root, 'lib')), join(config.root, 'package-lock.json'), 'found from below, as in a monorepo');
  assert.deepEqual(changedInputs(config, inputs), []);
  writeFileSync(data, 'export const total = 95;\n');
  assert.deepEqual(changedInputs(config, inputs), ['lib/data.ts']);
  assert.equal(listFiles(['a', 'b', 'c']), 'a, b and c');
  assert.equal(listFiles(['a', 'b', 'c', 'd', 'e']), 'a, b, c and 2 more');
});

test('an approval stops counting when a stage file changes, and counts again when it is put back', () => {
  const { config, data, script } = app();
  writeReview(config, 'intro', { status: 'approved', scriptHash: hashScript(readFileSync(script, 'utf8')), at: '2026-09-25T09:00:00Z', inputs: fingerprint(config, 'intro', [data]) });
  assert.equal(reviewState(config, 'intro').approved, true);

  writeFileSync(data, 'export const total = 95;\n');
  const edited = reviewState(config, 'intro');
  assert.equal(edited.approved, false);
  assert.deepEqual(edited.changed, ['lib/data.ts']);
  assert.equal(formatReview('intro', edited), 'Review: edited since approval. It was approved on 2026-09-25 09:00 UTC, but lib/data.ts has changed since, so the approval no longer counts. The user needs to look again in Muse (npx tourwright muse intro).');

  writeFileSync(data, 'export const total = 120;\n');
  assert.equal(reviewState(config, 'intro').approved, true);

  // A review written before inputs were recorded covers script.json alone, as it always did.
  writeReview(config, 'intro', { status: 'approved', scriptHash: hashScript(readFileSync(script, 'utf8')), at: '2026-09-25T09:00:00Z' });
  writeFileSync(data, 'export const total = 95;\n');
  assert.equal(reviewState(config, 'intro').approved, true);
  writeFileSync(script, readFileSync(script, 'utf8').replace('"scenes"', '"scenes" '));
  assert.deepEqual(reviewState(config, 'intro').changed, ['tourwright/walkthroughs/intro/script.json']);
});

test('Muse records what the preview loaded with a review, and refuses one of stage code not yet seen', async () => {
  const { config, data } = app();
  let reloaded = 0;
  const studio = createStudio(config, 'intro', () => undefined, { reloadStage: () => reloaded++, sources: () => [data] });
  const server = createServer((req, res) =>
    studio.handle(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const state = async () => (await (await fetch(`${origin}${API}/state`)).json()) as StudioState;
  const review = (base: string) => fetch(`${origin}${API}/review`, { method: 'PUT', body: JSON.stringify({ base, status: 'approved' }) });
  try {
    await studio.ready;
    // The tab loads the stage; then the agent edits a fixture without making a new version.
    await fetch(`${origin}${PLAYER_PATH}`);
    await new Promise((done) => setTimeout(done, 30));
    writeFileSync(data, 'export const total = 95;\n');
    const refused = await review((await state()).scriptHash);
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: string }).error, /^lib\/data\.ts changed since this tab loaded the stage/);
    assert.equal(reloaded, 1, 'Muse loads the new stage code for the reviewer to watch');
    assert.equal(readReview(config, 'intro'), undefined);

    // Once the tab has loaded it, the review goes through, and covers the fixture as it is now.
    await fetch(`${origin}${PLAYER_PATH}`);
    const accepted = await review((await state()).scriptHash);
    assert.equal(accepted.status, 200);
    const saved = (await accepted.json()) as Review;
    assert.ok(saved.inputs?.['lib/data.ts'], 'the fixture is covered');
    assert.ok(saved.inputs?.['tourwright/walkthroughs/intro/script.json'], 'so is the script');
    assert.deepEqual((await state()).reviewChanged, []);

    writeFileSync(data, 'export const total = 80;\n');
    assert.deepEqual((await state()).reviewChanged, ['lib/data.ts'], 'the page learns the approval no longer counts');
  } finally {
    studio.close();
    await new Promise((done) => server.close(done));
  }
});
