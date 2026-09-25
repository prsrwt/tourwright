// Placing and timing a narration box by hand in Muse: pick what it goes on, drag its edges on the
// track under the scrubber, delete it, and each step is written into script.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStageServer, STUDIO_PATH } from '../src/bundle/server.ts';
import { resolveConfig } from '../src/config/config.ts';
import { API, type StudioState } from '../src/studio/protocol.ts';
import { createStudio } from '../src/studio/server.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));

test('a narration box is placed, retimed and deleted from Muse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-boxes-'));
  cpSync(join(app, 'tourwright', 'walkthroughs', 'intro'), join(dir, 'intro'), { recursive: true });
  const config = resolveConfig({ walkthroughs: dir, out: join(dir, 'out') }, join(app, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
  const file = join(dir, 'intro', 'script.json');
  const original = readFileSync(file, 'utf8');
  const script = () => JSON.parse(readFileSync(file, 'utf8'));
  const studio = createStudio(config, 'intro', () => undefined);
  const server = await startStageServer(config, { middleware: (req, res, next) => studio.handle(req, res, next) });
  const origin = new URL(server.url).origin;
  const state = async () => (await (await fetch(`${origin}${API}/state`)).json()) as StudioState;
  const browser = await chromium.launch();
  try {
    await studio.ready;
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(120_000);
    await page.goto(new URL(STUDIO_PATH, origin).href);
    await page.locator('[data-scrubber]').waitFor();
    const version = async () => (await state()).timelineVersion;

    // Onto the first sentence of the "tasks" scene, then put a box on the status column there.
    const timeline = (await state()).timeline!;
    const tasks = timeline.scenes[2]!;
    const bar = (await page.locator('[data-scrubber]').boundingBox())!;
    await page.mouse.click(bar.x + (bar.width * (tasks.sentences[0]!.from + 20)) / timeline.frames, bar.y + 10);
    await page.waitForTimeout(500);
    const before = await version();
    await page.locator('[data-action="add-box"]').click();
    await page.locator('[data-picker] [data-target="status-column"]').click();
    await page.waitForFunction(async (v) => (await (await fetch('/__tourwright/api/state')).json()).timelineVersion > v, before);
    let scene = script().scenes[2];
    // The agent's box on the same target came next, so the two merge into one, and its cue goes.
    assert.equal(scene.say, '[table]Below them is every task due this week, with who owns it. The status shows where each one stands.');
    assert.deepEqual(scene.beats, [
      { at: 'table', camera: { to: 'tasks', zoom: 'width', align: 'top' }, highlight: 'status-column' },
      { at: 'end', highlight: false },
    ]);

    // On the track it runs from the scene's start to its end. Drag its start edge right, onto the
    // second sentence: a cue goes there, and before it the box from the scene before stays on.
    const segment = page.locator('[data-segment="status-column"]').first();
    await segment.click();
    await page.locator('[data-box-selected]').waitFor();
    const edge = (await segment.locator('[data-edge="start"]').boundingBox())!;
    const track = (await page.locator('[data-box-track]').boundingBox())!;
    const target = track.x + (track.width * tasks.sentences[1]!.from) / timeline.frames;
    const moved = await version();
    await page.mouse.move(edge.x + 2, edge.y + 5);
    await page.mouse.down();
    await page.mouse.move(target, edge.y + 5, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(async (v) => (await (await fetch('/__tourwright/api/state')).json()).timelineVersion > v, moved);
    scene = script().scenes[2];
    assert.equal(scene.say, '[table]Below them is every task due this week, with who owns it. [status-column]The status shows where each one stands.');
    assert.deepEqual(scene.beats, [
      { at: 'table', camera: { to: 'tasks', zoom: 'width', align: 'top' } },
      { at: 'status-column', highlight: 'status-column' },
      { at: 'end', highlight: false },
    ]);

    // Deleting it leaves the scene with no box there.
    await page.locator('[data-segment="status-column"]').first().click();
    const deleted = await version();
    await page.locator('[data-action="delete-box"]').click();
    await page.waitForFunction(async (v) => (await (await fetch('/__tourwright/api/state')).json()).timelineVersion > v, deleted);
    assert.deepEqual(script().scenes[2].beats, [
      { at: 'table', camera: { to: 'tasks', zoom: 'width', align: 'top' } },
      { at: 'end', highlight: false },
    ]);
    assert.equal(script().scenes[2].say, '[table]Below them is every task due this week, with who owns it. The status shows where each one stands.', 'the unused cue went with it');
    assert.notEqual(readFileSync(file, 'utf8'), original);
  } finally {
    await browser.close();
    studio.close();
    await server.close();
  }
});
