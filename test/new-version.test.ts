// A new version from the agent reaches the Muse tab already open: make tells the running Muse,
// which reloads the preview (stage code included) and keeps the reviewer on the same sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStageServer, STUDIO_PATH } from '../src/bundle/server.ts';
import { resolveConfig } from '../src/config/config.ts';
import { API, type StudioState } from '../src/studio/protocol.ts';
import { createStudio } from '../src/studio/server.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));

test('a new version shows in the open tab, on the same sentence, with the stage loaded afresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-new-version-'));
  cpSync(join(app, 'tourwright', 'walkthroughs', 'intro'), join(dir, 'intro'), { recursive: true });
  const config = resolveConfig({ walkthroughs: dir, out: join(dir, 'out') }, join(app, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
  const scriptFile = join(dir, 'intro', 'script.json');
  let reloaded = 0;
  let server: Awaited<ReturnType<typeof startStageServer>> | undefined;
  const studio = createStudio(config, 'intro', () => undefined, { reloadStage: () => (reloaded++, server?.vite.moduleGraph.invalidateAll()) });
  server = await startStageServer(config, { middleware: (req, res, next) => studio.handle(req, res, next) });
  const origin = new URL(server.url).origin;
  const state = async () => (await (await fetch(`${origin}${API}/state`)).json()) as StudioState;
  const browser = await chromium.launch();
  try {
    await studio.ready;
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(120_000);
    await page.goto(new URL(STUDIO_PATH, origin).href);
    await page.locator('[data-scrubber]').waitFor();
    const counter = page.locator('span', { hasText: /^frame / }).first();
    const shownFrame = async () => Number((await counter.textContent())!.replace('frame ', ''));

    // The reviewer is partway through the second sentence of the second scene.
    const before = (await state()).timeline!;
    const sentence = before.scenes[1]!.sentences[1]!;
    const place = sentence.from + 7;
    const bar = (await page.locator('[data-scrubber]').boundingBox())!;
    await page.mouse.click(bar.x + (bar.width * (place + 0.5)) / before.frames, bar.y + 10);
    await page.waitForFunction((el) => el?.textContent !== 'frame 0', await counter.elementHandle());
    const at = await shownFrame();
    const into = at - sentence.from;
    assert.ok(at >= sentence.from && at < (before.scenes[1]!.sentences[2]?.from ?? before.scenes[1]!.from + before.scenes[1]!.frames), `frame ${at} is not in the sentence`);
    await page.frameLocator('iframe').locator('body').evaluate(() => ((window as unknown as { marker: number }).marker = 1));

    // The agent lengthens the first scene, which moves every later word, and runs make again.
    const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
    script.scenes[0].say = `${script.scenes[0].say} This sentence is new and takes a few seconds to say out loud.`;
    writeFileSync(scriptFile, JSON.stringify(script, null, 2));
    const res = await fetch(`${origin}${API}/new-version`, { method: 'POST' });
    assert.deepEqual(await res.json(), { tabs: 1 }, 'the open tab counts, so make opens no other');
    assert.equal(reloaded, 1, 'the stage code is compiled afresh');

    await page.locator('[data-new-version]').waitFor();
    const after = (await state()).timeline!;
    const moved = after.scenes[1]!.sentences[1]!;
    assert.ok(moved.from > sentence.from, 'the sentence starts later in the new version');
    await page.waitForFunction(([el, want]) => el?.textContent === `frame ${want}`, [await counter.elementHandle(), moved.from + into] as const);
    assert.equal(await shownFrame(), moved.from + into, 'same sentence, as far into it as before');
    // The preview itself was loaded again, not only restarted.
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => (window as unknown as { marker?: number }).marker), undefined);
    assert.match((await page.locator('[data-new-version]').textContent())!, /^Showing the agent's new version from /);
  } finally {
    await browser.close();
    studio.close();
    await server.close();
  }
});
