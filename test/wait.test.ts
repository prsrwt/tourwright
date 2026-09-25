// wait: the agent hears what the user decided in Muse, and only something new ends the wait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/cli/init.ts';
import { videoPath } from '../src/cli/render.ts';
import { readRenderRecord, renderRecordPath, writeRenderRecord } from '../src/render/record.ts';
import { runWait, WAIT } from '../src/cli/wait.ts';
import { resolveConfig, type ResolvedConfig } from '../src/config/config.ts';
import { hashScript, writeReview } from '../src/studio/review.ts';

function app(): ResolvedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-wait-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const { log } = console;
  console.log = () => undefined;
  try {
    runInit(dir);
  } finally {
    console.log = log;
  }
  return resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
}

/** Runs wait, doing `meanwhile` once it has started, and returns its exit code and output. */
async function wait(config: ResolvedConfig, meanwhile: () => void = () => undefined, timeout = 5): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const { log } = console;
  console.log = (line: string) => lines.push(line);
  try {
    const running = runWait(config, 'intro', { timeout, interval: 10 });
    await new Promise((done) => setTimeout(done, 50));
    meanwhile();
    return { code: await running, out: lines.join('\n') };
  } finally {
    console.log = log;
  }
}

const hash = (config: ResolvedConfig) => hashScript(readFileSync(join(config.walkthroughs, 'intro', 'script.json'), 'utf8'));
const note = (id: string, status: string) => ({ id, ms: 1000, frame: 30, scene: 'welcome', sceneIndex: 0, text: `note ${id}`, status, scope: 'moment', replies: [], created: '' });

test('wait ends when the user approves, and says the video is finished', async () => {
  const config = app();
  const approved = await wait(config, () => writeReview(config, 'intro', { status: 'approved', scriptHash: hash(config), at: '2026-09-25T09:00:00Z' }));
  assert.equal(approved.code, WAIT.approved);
  assert.match(approved.out, /^Waiting for the user to review "intro" in Muse/);
  assert.match(approved.out, /Review: approved on 2026-09-25 09:00 UTC/);
  assert.match(approved.out, /Done: the user approved "intro"\. There is no video yet, so render the final cut with "npx tourwright make intro --require-approval --no-review"/);

  // A video with nothing recording what it was made from may be an earlier cut.
  mkdirSync(config.out, { recursive: true });
  writeFileSync(videoPath(config, 'intro'), '');
  assert.match((await wait(config)).out, /Nothing records what .*intro\.mp4 was made from \(an older Tourwright rendered it\), so render the final cut/);

  // Already approved: it returns at once. With a video rendered from this version, nothing is left.
  writeRenderRecord(config, 'intro', []);
  const again = await wait(config);
  assert.equal(again.code, WAIT.approved);
  assert.doesNotMatch(again.out, /Waiting/);
  assert.match(again.out, /Done: "intro" is finished, and .*intro\.mp4 is the approved version\. .*carry on with what comes next/);

  // A draft with the silent voice is not the final video, nor is one rendered before a file changed.
  writeRenderRecord({ ...config, voice: { backend: 'fake' } }, 'intro', []);
  assert.match((await wait(config)).out, /intro\.mp4 has the silent stand-in voice \(--fake-voice\), so render the final cut .*without --fake-voice/);
  const record = readRenderRecord(config, 'intro')!;
  writeFileSync(renderRecordPath(config, 'intro'), JSON.stringify({ ...record, voice: 'kokoro', inputs: { ...record.inputs, 'tourwright/walkthroughs/intro/script.json': 'an earlier one' } }));
  assert.match((await wait(config)).out, /intro\.mp4 was rendered before tourwright\/walkthroughs\/intro\/script\.json changed, so render the final cut/);
});

test('wait ends on a new request for changes, not on one made before it started', async () => {
  const config = app();
  writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hash(config), at: '2026-09-25T09:00:00Z', comment: 'Slower.' });
  writeFileSync(join(config.walkthroughs, 'intro', 'notes.json'), JSON.stringify({ notes: [note('a', 'open')] }));
  assert.equal((await wait(config, () => undefined, 0.3)).code, WAIT.timeout, 'the old request is not news');

  // The notes sent with the request come with it, in full: the agent need not go and fetch them.
  const changes = await wait(config, () => writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hash(config), at: '2026-09-25T09:05:00Z', comment: 'Zoom in more.', notes: ['a'] }));
  assert.equal(changes.code, WAIT.feedback);
  assert.match(changes.out, /Review: changes requested on 2026-09-25 09:05 UTC: "Zoom in more\."/);
  assert.match(changes.out, /The user sent 1 note for you to handle:\n\n\[a\] at 1\.000 s \(frame 30\), in scene "welcome" \(scenes\[0\]\)\n {2}note a/);
  assert.match(changes.out, /Next: make each change[^]*npx tourwright reply intro <id> --fixed[^]*wait again with npx tourwright wait intro\./);
});

test('wait ends when the user answers a question, and otherwise times out with where things stand', async () => {
  const config = app();
  const notes = join(config.walkthroughs, 'intro', 'notes.json');
  writeFileSync(notes, JSON.stringify({ notes: [note('q', 'question'), note('b', 'open')] }));
  const idle = await wait(config, () => undefined, 0.2);
  assert.equal(idle.code, WAIT.timeout);
  assert.match(idle.out, /Review: not reviewed yet\.[^]*Still waiting: .*1 note is open for you\.\nNext: run "npx tourwright wait intro" again/);

  const answered = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [note('q', 'open'), note('b', 'open')] })));
  assert.equal(answered.code, WAIT.feedback);
  assert.match(answered.out, /The user answered your question:\n\n\[q\] at 1\.000 s/);
});

test('every answer on a note wakes the agent; approving a fix or deleting a note is reported with it', async () => {
  const config = app();
  const notes = join(config.walkthroughs, 'intro', 'notes.json');
  const reply = { from: 'you', text: 'Still too fast.', at: '2026-09-25T10:00:00Z' };
  writeFileSync(notes, JSON.stringify({ notes: [note('f', 'fixed'), note('g', 'fixed'), note('c', 'closed'), note('d', 'open')] }));

  // Approving a fix or deleting a note needs nothing from the agent, so on their own they do not wake it.
  const quiet = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [note('f', 'fixed'), note('g', 'closed'), note('c', 'closed')] })), 0.3);
  assert.equal(quiet.code, WAIT.timeout);
  assert.match(quiet.out, /approved your fix on \[g\]: those notes are closed\.\nThe user deleted \[d\]: nothing to do for those\./);

  // "Not fixed yet" on a fix hands it back.
  const notYet = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [{ ...note('f', 'open'), replies: [reply] }, note('g', 'closed'), note('c', 'closed')] })));
  assert.equal(notYet.code, WAIT.feedback);
  assert.match(notYet.out, /The user says this is not fixed yet:\n\n\[f\][^]*User: Still too fast\./);

  // So does reopening a closed note.
  const reopened = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [{ ...note('f', 'open'), replies: [reply] }, note('g', 'closed'), { ...note('c', 'open'), replies: [reply] }] })));
  assert.equal(reopened.code, WAIT.feedback);
  assert.match(reopened.out, /The user reopened this note:\n\n\[c\]/);
  assert.doesNotMatch(reopened.out, /\[f\] at/, 'f was already handed back before this wait');

  // Rewording a note already sent to the agent hands it over again; rewording one not sent does not.
  writeFileSync(notes, JSON.stringify({ notes: [note('s', 'open'), note('u', 'open')] }));
  writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hash(config), at: '2026-09-25T10:00:00Z', notes: ['s'] });
  const unsentEdit = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [note('s', 'open'), { ...note('u', 'open'), text: 'u, reworded' }] })), 0.3);
  assert.equal(unsentEdit.code, WAIT.timeout);
  const sentEdit = await wait(config, () => writeFileSync(notes, JSON.stringify({ notes: [{ ...note('s', 'open'), text: 'Zoom to 3x, not 2x.' }, note('u', 'open')] })));
  assert.equal(sentEdit.code, WAIT.feedback);
  assert.match(sentEdit.out, /The user reworded a note they sent you:\n\n\[s\][^]*Zoom to 3x, not 2x\./);
});

test('a note on an area the user drew reaches the agent with its text and its snippet', async () => {
  const config = app();
  const area = { ...note('a', 'open'), rect: { x: 100, y: 200, w: 80, h: 24 }, areaText: ['Export'], snippet: 'notes/a.png' };
  writeFileSync(join(config.walkthroughs, 'intro', 'notes.json'), JSON.stringify({ notes: [area] }));
  const sent = await wait(config, () => writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hash(config), at: '2026-09-25T10:30:00Z', notes: ['a'] }));
  assert.equal(sent.code, WAIT.feedback);
  assert.match(sent.out, /\[a\][^\n]*\n {2}on an area the user drew, on screen at x 100, y 200, 80 by 24 \(layout pixels\)\n {2}the text there: "Export"\n {2}a picture of exactly that part: .*intro[\\/]notes[\\/]a\.png/);
});

test('narration boxes the user placed in Muse reach the agent with whatever ends the wait', async () => {
  const config = app();
  const file = join(config.walkthroughs, 'intro', 'script.json');
  const script = JSON.parse(readFileSync(file, 'utf8'));
  const sent = await wait(config, () => {
    const placed = structuredClone(script);
    placed.areas = { 'area-export': { stage: placed.scenes[0].stage, x: 10, y: 20, w: 80, h: 24 } };
    placed.scenes[0].beats = [...(placed.scenes[0].beats ?? []), { at: 'end', highlight: 'area-export' }];
    writeFileSync(file, JSON.stringify(placed, null, 2));
    writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hash(config), at: '2026-09-25T11:00:00Z', comment: 'See the box I added.' });
  });
  assert.equal(sent.code, WAIT.feedback);
  assert.match(sent.out, /The user changed the narration boxes themselves in Muse\. They are in script\.json now; keep them unless a note asks otherwise:\n {2}now: scene "[^"]+" \(scenes\[0\]\), at the end of the scene: puts the narration box on area-export \(an area of stage \w+: x 10, y 20, 80 by 24\)/);
});
