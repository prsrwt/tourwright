// The studio in a real browser, on a copy of the example's intro: it loads, seeks, edits a beat
// by clicking a target, pins a note to the playhead, refuses to overwrite an outside change, and
// runs the review: note threads with the agent, notes on a clicked target, and approving the
// whole video for one version of script.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStageServer, STUDIO_PATH } from '../src/bundle/server.ts';
import { resolveConfig } from '../src/config/config.ts';
import { API, type Note, type NotesFile, type Review } from '../src/studio/protocol.ts';
import { formatReview, hashScript, reviewState } from '../src/studio/review.ts';
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
    // The first load optimises dependencies into a fresh cache, which is slow while the other test
    // files run in parallel; Playwright's 30 s default is too tight for that.
    page.setDefaultTimeout(120_000);
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
    // And what was on screen there, read from the player, so the agent need not guess.
    assert.equal(note?.screen?.frame, frame);
    assert.equal(note?.screen?.scene, 'stats');
    assert.equal(note?.screen?.highlight?.target, 'stats');
    assert.ok(note?.screen?.targets.some((t) => t.name === 'stats' && t.cut.length === 0));

    // The agent resolves it in the file, the old way ("done" and a resolution): the studio reads
    // that as fixed, shows what it did, and the user approves it.
    writeFileSync(notesFile, JSON.stringify({ notes: [{ ...note!, status: 'done', resolution: 'Zoomed to 2x on the stats.' }] }, null, 2));
    await page.getByText('Agent: Zoomed to 2x on the stats.').waitFor();
    const readNotesFile = () => (JSON.parse(readFileSync(notesFile, 'utf8')) as NotesFile).notes;
    const card = (id: string) => page.locator(`[data-note="${id}"]`);
    await card(note!.id).getByText('Your turn: approve or request changes').waitFor();
    await card(note!.id).getByRole('button', { name: 'Approve', exact: true }).click();
    await card(note!.id).getByText('Closed', { exact: true }).waitFor();
    assert.equal(readNotesFile()[0]?.status, 'closed');

    // The agent asks a question on one note and says two others are fixed.
    const at = new Date().toISOString();
    const pinned = { ms: note!.ms, frame: note!.frame, scene: note!.scene, sceneIndex: note!.sceneIndex, scope: 'moment', created: at };
    const agentNotes: Note[] = [
      { ...pinned, id: 'ask', text: 'Make the cards stand out', status: 'question', replies: [{ from: 'agent', text: 'All three cards, or only Overdue?', at }] } as Note,
      { ...pinned, id: 'good', text: 'Highlight the overdue card', status: 'fixed', replies: [{ from: 'agent', text: 'Highlighted stat-overdue at the overdue cue.', at }] } as Note,
      { ...pinned, id: 'redo', text: 'Slow the zoom down', status: 'fixed', replies: [{ from: 'agent', text: 'Set the camera duration to 1.2 s.', at }] } as Note,
    ];
    writeFileSync(notesFile, JSON.stringify({ notes: [...readNotesFile(), ...agentNotes] }, null, 2));

    // A question stands out with a reply box; answering hands the note back to the agent.
    await card('ask').getByText('Your turn: the agent has a question').waitFor();
    assert.equal(await card('ask').getAttribute('data-status'), 'question');
    await card('ask').getByText('Agent: All three cards, or only Overdue?').waitFor();
    await card('ask').locator('textarea').fill('All three, please.');
    await card('ask').getByRole('button', { name: 'Send answer' }).click();
    await card('ask').getByText("Agent's turn").waitFor();
    await card('ask').getByText('You: All three, please.').waitFor();
    const answered = readNotesFile().find((n) => n.id === 'ask')!;
    assert.equal(answered.status, 'open');
    assert.deepEqual(answered.replies.map((r) => [r.from, r.text]), [['agent', 'All three cards, or only Overdue?'], ['you', 'All three, please.']]);

    // A fix is approved, which closes it, or sent back with what still needs changing.
    await card('good').getByRole('button', { name: 'Approve', exact: true }).click();
    await card('good').getByText('Closed', { exact: true }).waitFor();
    await card('redo').getByRole('button', { name: 'Request changes' }).click();
    await card('redo').locator('textarea').fill('Still too fast.');
    await card('redo').getByRole('button', { name: 'Send', exact: true }).click();
    await card('redo').getByText("Agent's turn").waitFor();
    const byId = Object.fromEntries(readNotesFile().map((n) => [n.id, n]));
    assert.equal(byId.good?.status, 'closed');
    assert.equal(byId.redo?.status, 'open');
    assert.deepEqual(byId.redo?.replies.map((r) => r.from), ['agent', 'you']);
    assert.equal(byId.redo?.replies[1]?.text, 'Still too fast.');

    // A note on a target picked in the preview, about the whole scene.
    await page.locator('textarea').first().fill('This card needs its label');
    await page.getByLabel('Note scope').selectOption('scene');
    await page.getByRole('button', { name: 'Attach to a target' }).click();
    await page.locator('button[title="stat-overdue"]').click();
    await page.getByText('on stat-overdue').first().waitFor();
    await page.getByRole('button', { name: /Add note at/ }).click();
    await page.getByText('This card needs its label').waitFor();
    const onTarget = readNotesFile().find((n) => n.text === 'This card needs its label')!;
    assert.equal(onTarget.target, 'stat-overdue');
    assert.equal(onTarget.scope, 'scene');
    const player = page.frames().find((f) => f.url().includes('/__tourwright/') && f !== page.mainFrame())!;
    const onScreen = (await player.evaluate(() => window.__tour.targetsOnScreen())).find((t) => t.name === 'stat-overdue')!;
    assert.deepEqual(onTarget.rect, { x: Math.round(onScreen.rect.x), y: Math.round(onScreen.rect.y), w: Math.round(onScreen.rect.w), h: Math.round(onScreen.rect.h) });
    await card(onTarget.id).getByText(/the whole scene · on stat-overdue/).waitFor();

    // A save that started before someone else changed script.json is refused, not merged blindly.
    const stale = (await (await fetch(`${origin}${API}/state`)).json()) as { scriptHash: string; script: unknown };
    writeFileSync(scriptFile, readFileSync(scriptFile, 'utf8').replace('Your team dashboard', 'Your team at a glance'));
    const refused = await fetch(`${origin}${API}/script`, { method: 'PUT', body: JSON.stringify({ base: stale.scriptHash, script: stale.script }) });
    assert.equal(refused.status, 409);
    assert.match(readFileSync(scriptFile, 'utf8'), /Your team at a glance/);

    // The whole video is approved for this version of script.json, and only this version.
    const reviewBar = page.locator('[data-review]');
    const reviewFile = join(dir, 'intro', 'review.json');
    // Wait for the studio to show the outside edit: reviewing before then is refused, as it should be.
    await page.locator(`[data-review][data-script-hash="${hashScript(readFileSync(scriptFile, 'utf8'))}"]`).waitFor();
    await reviewBar.getByText('Not reviewed yet').waitFor();
    await reviewBar.getByRole('button', { name: 'Approve this version' }).click();
    await reviewBar.getByText('Approved', { exact: true }).waitFor();
    const approved = JSON.parse(readFileSync(reviewFile, 'utf8')) as Review;
    const { scriptHash } = (await (await fetch(`${origin}${API}/state`)).json()) as { scriptHash: string };
    assert.equal(approved.status, 'approved');
    assert.equal(approved.scriptHash, scriptHash);
    assert.equal(reviewState(config, 'intro').approved, true);
    assert.match(formatReview('intro', reviewState(config, 'intro')), /^Review: approved .*, for script.json as it is now\.$/);

    // Editing script.json afterwards (here, as an agent would) means the approval no longer counts.
    writeFileSync(scriptFile, readFileSync(scriptFile, 'utf8').replace('Your team at a glance', 'Your team this week'));
    await reviewBar.getByText('Edited since approval').waitFor();
    assert.equal(reviewState(config, 'intro').approved, false);
    assert.match(formatReview('intro', reviewState(config, 'intro')), /^Review: edited since approval\./);

    // Asking for changes records the comment against the version now shown.
    await reviewBar.getByRole('button', { name: 'Request changes' }).click();
    await reviewBar.getByPlaceholder('What should change?').fill('Slower at the start.');
    await reviewBar.getByRole('button', { name: 'Send', exact: true }).click();
    await reviewBar.getByText('Changes requested', { exact: true }).waitFor();
    const requested = JSON.parse(readFileSync(reviewFile, 'utf8')) as Review;
    assert.equal(requested.status, 'changes-requested');
    assert.equal(requested.comment, 'Slower at the start.');
    assert.notEqual(requested.scriptHash, approved.scriptHash);
    assert.equal(reviewState(config, 'intro').current, true);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    studio.close();
    await server.close();
  }
});
