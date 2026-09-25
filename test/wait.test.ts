// wait: the agent hears what the user decided in Muse, and only something new ends the wait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/cli/init.ts';
import { videoPath } from '../src/cli/render.ts';
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

  // Already approved: it returns at once. With a video rendered from this script, nothing is left.
  mkdirSync(config.out, { recursive: true });
  writeFileSync(videoPath(config, 'intro'), '');
  const again = await wait(config);
  assert.equal(again.code, WAIT.approved);
  assert.doesNotMatch(again.out, /Waiting/);
  assert.match(again.out, /Done: "intro" is finished, and .*intro\.mp4 is the approved version\. .*carry on with what comes next/);

  // A video older than the script it was approved for is an earlier cut.
  utimesSync(videoPath(config, 'intro'), new Date(0), new Date(0));
  assert.match((await wait(config)).out, /intro\.mp4 is older than the approved script\.json, so render the final cut/);
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
  assert.match(answered.out, /The user answered your question on \[q\]:\n\n\[q\] at 1\.000 s/);
});
