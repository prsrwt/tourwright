// The studio in a real browser, on a copy of the example's intro: it loads, seeks, edits a beat
// by clicking a target, pins a note to the playhead, refuses to overwrite an outside change, and
// shows what the agent did about a note.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStageServer, STUDIO_PATH } from '../src/bundle/server.ts';
import { resolveConfig } from '../src/config/config.ts';
import { API, type NotesFile } from '../src/studio/protocol.ts';
import { createStudio } from '../src/studio/server.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));

test('the studio plays back, edits script.json, and pins notes to the millisecond', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-studio-'));
  cpSync(join(app, 'tourwright', 'walkthroughs', 'intro'), join(dir, 'intro'), { recursive: true });
  const config = resolveConfig({ walkthroughs: dir, out: join(dir, 'out') }, join(app, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
  const scriptFile = join(dir, 'intro', 'script.json');
  const studio = createStudio(config, 'intro', () => undefined);
  const server = await startStageServer(config, { middleware: (req, res, next) => studio.handle(req, res, next) });
  const browser = await chromium.launch();
  try {
    await studio.ready;
    const origin = new URL(server.url).origin;
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(new URL(STUDIO_PATH, origin).href);
    await page.getByText('Scenes and beats').waitFor();

    // Seek halfway along the scrubber.
    const bar = page.locator('div[style*="height: 36px"]');
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 10);
    // Wait for the redraw: under load, reading at once can still see frame 0.
    const counter = page.locator('span', { hasText: /^frame / }).first();
    await page.waitForFunction((el) => el?.textContent !== 'frame 0', await counter.elementHandle());
    const frame = Number((await counter.textContent())!.replace('frame ', ''));
    assert.ok(frame > 300 && frame < 450, `seeking halfway should land mid-video, not frame ${frame}`);

    // Edit the first beat: pick its camera target by clicking it on the preview.
    await page.getByText('edit').first().click();
    await page.getByRole('button', { name: 'pick' }).first().click();
    assert.deepEqual((await page.locator('button[title]').allTextContents()).sort(), ['stat-overdue', 'stats', 'status-column', 'tasks']);
    await page.locator('button[title="stats"]').click();
    await page.getByRole('button', { name: 'Save beat' }).click();
    await page.getByText('camera to stats (fit)').first().waitFor();
    assert.deepEqual(JSON.parse(readFileSync(scriptFile, 'utf8')).scenes[0].beats[0], { at: 'open', camera: { to: 'stats' } });

    // A note records where the playhead is.
    await page.locator('textarea').first().fill('Zoom in more on the total here');
    await page.getByRole('button', { name: /Add note at/ }).click();
    await page.getByText('Zoom in more on the total here').waitFor();
    const notesFile = join(dir, 'intro', 'notes.json');
    const [note] = (JSON.parse(readFileSync(notesFile, 'utf8')) as NotesFile).notes;
    assert.equal(note?.frame, frame);
    assert.equal(note?.ms, Math.round((frame / 30) * 1000));
    assert.equal(note?.scene, 'stats');
    assert.equal(note?.sentence, 'These cards count your open, completed and overdue tasks.');

    // The agent resolves it in the file; the studio shows what it did.
    writeFileSync(notesFile, JSON.stringify({ notes: [{ ...note!, status: 'done', resolution: 'Zoomed to 2x on the stats.' }] }, null, 2));
    await page.getByText('Agent: Zoomed to 2x on the stats.').waitFor();

    // A save that started before someone else changed script.json is refused, not merged blindly.
    const stale = (await (await fetch(`${origin}${API}/state`)).json()) as { scriptHash: string; script: unknown };
    writeFileSync(scriptFile, readFileSync(scriptFile, 'utf8').replace('Your team dashboard', 'Your team at a glance'));
    const refused = await fetch(`${origin}${API}/script`, { method: 'PUT', body: JSON.stringify({ base: stale.scriptHash, script: stale.script }) });
    assert.equal(refused.status, 409);
    assert.match(readFileSync(scriptFile, 'utf8'), /Your team at a glance/);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    studio.close();
    await server.close();
  }
});
