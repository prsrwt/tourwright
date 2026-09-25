// The final render from Muse: after an approval Muse asks whether to render the final video now,
// renders it on request (reporting each step), and an agent waiting on the review leaves the render
// to Muse rather than make it a second time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/cli/init.ts';
import { writeMuseRecord } from '../src/cli/launch.ts';
import { runWait, WAIT } from '../src/cli/wait.ts';
import { resolveConfig, type ResolvedConfig } from '../src/config/config.ts';
import { API, type StudioState } from '../src/studio/protocol.ts';
import { revealCommand, revealFile } from '../src/studio/final.ts';
import { createStudio } from '../src/studio/server.ts';

function app(): ResolvedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-final-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const { log } = console;
  console.log = () => undefined;
  try {
    runInit(dir);
  } finally {
    console.log = log;
  }
  return resolveConfig({}, join(dir, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
}

/** A stand-in for make: prints make's progress lines, then exits with `code`. */
function fakeMake(code: number, last = ''): { file: string; args: string[] } {
  const lines = ['Voicing intro with the fake voice...', 'Verifying intro...', 'Rendering 10 frames (0.3 s at 30 fps)...', '   50%  frame 5 of 10', last].filter(Boolean);
  return { file: process.execPath, args: ['-e', `for (const l of ${JSON.stringify(lines)}) console.log(l); process.exit(${code});`] };
}

/** Serves one Muse for a walkthrough in the test app, recorded as the running one so wait finds it. */
async function muse(config: ResolvedConfig, renderCommand: { file: string; args: string[] }) {
  const studio = createStudio(config, 'intro', () => undefined, { renderCommand });
  const server = createServer((req, res) => studio.handle(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  mkdirSync(join(config.out, 'intro'), { recursive: true });
  writeMuseRecord(config, 'intro', { pid: process.pid, port, url: `${origin}/__tourwright/studio`, started: new Date().toISOString() });
  await studio.ready;
  const state = async () => (await (await fetch(`${origin}${API}/state`)).json()) as StudioState;
  const post = (path: string) => fetch(`${origin}${API}${path}`, { method: 'POST' });
  const approve = async () => fetch(`${origin}${API}/review`, { method: 'PUT', body: JSON.stringify({ base: (await state()).scriptHash, status: 'approved' }) });
  const until = async (check: (s: StudioState) => boolean) => {
    const deadline = Date.now() + 20_000;
    while (!check(await state())) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify((await state()).render)}`);
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  return { state, post, approve, until, close: () => (studio.close(), new Promise((done) => server.close(done))) };
}

async function wait(config: ResolvedConfig, meanwhile: () => Promise<unknown> = async () => undefined, timeout = 3): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const { log } = console;
  console.log = (line: string) => lines.push(line);
  try {
    const running = runWait(config, 'intro', { timeout, interval: 20 });
    await meanwhile();
    return { code: await running, out: lines.join('\n') };
  } finally {
    console.log = log;
  }
}

test('Muse asks to render the final video once it is approved, and renders it on request', async () => {
  const config = app();
  const m = await muse(config, fakeMake(0));
  try {
    assert.equal((await m.post('/render')).status, 409, 'nothing is rendered as final before it is approved');
    assert.equal((await m.approve()).status, 200);
    const asked = await m.state();
    assert.equal(asked.renderOffer, 'pending');
    assert.deepEqual(asked.final, { ready: false, why: 'There is no video yet', file: 'tourwright/out/intro.mp4' });

    // An agent waiting meanwhile leaves the render to Muse, and says so when its wait runs out.
    const waiting = await wait(config, undefined, 0.5);
    assert.equal(waiting.code, WAIT.timeout);
    assert.match(waiting.out, /Muse is asking the user whether to render the final video now\. Waiting for their answer\.\.\.[^]*Still waiting: the user approved "intro", and Muse is still asking[^]*Don't render it yourself meanwhile\./);

    assert.equal((await m.post('/render')).status, 200);
    await m.until((s) => s.render?.status === 'done');
    const done = await m.state();
    assert.equal(done.renderOffer, undefined, 'answered');
    assert.equal(done.render?.percent, 100);
  } finally {
    await m.close();
  }
});

test('a failed render says why, and the waiting agent is told to fix it', async () => {
  const config = app();
  const m = await muse(config, fakeMake(1, 'Error: the voice model is not downloaded.'));
  try {
    await m.approve();
    const waited = await wait(config, async () => {
      await new Promise((done) => setTimeout(done, 100));
      await m.post('/render');
    });
    assert.equal(waited.code, WAIT.feedback);
    assert.match(waited.out, /The user tried to render the final video in Muse, and it failed:\n\n[^]*Error: the voice model is not downloaded\./);
    assert.match(waited.out, /Next: fix what it says, then render the final cut with "npx tourwright make intro --require-approval --no-review"/);
    assert.equal((await m.state()).render?.status, 'failed');
  } finally {
    await m.close();
  }
});

test('"Not now" leaves the render to the user: the agent does not make it either', async () => {
  const config = app();
  const m = await muse(config, fakeMake(0));
  try {
    await m.approve();
    const waited = await wait(config, async () => {
      await new Promise((done) => setTimeout(done, 100));
      await m.post('/render/decline');
    });
    assert.equal(waited.code, WAIT.approved);
    assert.match(waited.out, /Done: the user approved "intro", and chose not to render the final video yet \(there is no video yet\)\. Don't render it unless they ask/);
    assert.equal((await m.state()).renderOffer, 'declined');
    assert.equal(readFileSync(join(config.walkthroughs, 'intro', 'review.json'), 'utf8').includes('"approved"'), true);
  } finally {
    await m.close();
  }
});

test('Show in folder opens the folder on each platform, and says where the video is when it cannot', async () => {
  // explorer takes the path quoted after "/select," and nothing else, so a space in it (C:\Users\First Last) works.
  assert.deepEqual(revealCommand('C:\\Users\\Paras Rawat\\app\\out\\intro.mp4', 'win32'), { command: 'explorer.exe', args: ['/select,"C:\\Users\\Paras Rawat\\app\\out\\intro.mp4"'], verbatim: true });
  assert.deepEqual(revealCommand('/Users/p/app/out/intro.mp4', 'darwin'), { command: 'open', args: ['-R', '/Users/p/app/out/intro.mp4'], verbatim: false });
  assert.deepEqual(revealCommand('/home/p/app/out/intro.mp4', 'linux'), { command: 'xdg-open', args: ['/home/p/app/out'], verbatim: false });
  assert.equal(await revealFile('/srv/app/out/intro.mp4', 'linux', {}), 'There is no desktop on the machine Muse runs on to open a folder in. The video is at /srv/app/out/intro.mp4');
});
