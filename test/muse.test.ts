// Muse opening by itself after make: the launcher starts one background Muse per walkthrough,
// reuses it, lets it close itself when nobody has it open, and starts nothing when review is
// turned off or nobody could see it. The browser is never really opened: `open` is replaced.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type ResolvedConfig } from '../src/config/config.ts';
import { launchMuse, liveMuse, musePath, type MuseRecord } from '../src/cli/launch.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));
// Inside the example app, so the background Muse finds its node_modules, aliases and CSS, but in
// its git-ignored out folder. Each test has its own app, so they cannot share a Muse.
const scratch = join(app, 'out', '.test', `muse-${process.pid}`);
const started: number[] = [];
after(() => {
  for (const pid of started) {
    try {
      process.kill(pid);
    } catch {
      // Already closed itself.
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});

/** A scratch app with the example's stages and a copy of its intro, and its own config. */
async function scratchApp(label: string, extra = ''): Promise<ResolvedConfig> {
  const dir = join(scratch, label);
  mkdirSync(join(dir, 'walkthroughs'), { recursive: true });
  cpSync(join(app, 'tourwright', 'walkthroughs', 'intro', 'script.json'), join(dir, 'walkthroughs', 'intro', 'script.json'));
  const stages = join(app, 'tourwright', 'stages.tsx').replace(/\\/g, '/');
  writeFileSync(join(dir, 'tourwright.config.mts'), `export default { preset: 'next', stages: ${JSON.stringify(stages)}, walkthroughs: 'walkthroughs', out: 'out', voice: { backend: 'fake' }${extra} };\n`);
  return loadConfig(dir, {});
}

// A desktop with a screen, whatever machine the tests run on.
const desktop = { env: { DISPLAY: ':0' }, platform: 'linux' as const };

function record(config: ResolvedConfig): MuseRecord {
  return JSON.parse(readFileSync(musePath(config, 'intro'), 'utf8')) as MuseRecord;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('make starts one background Muse and returns, and a second make reuses it', async () => {
  const config = await scratchApp('reuse');
  const opened: string[] = [];
  const open = (url: string) => void opened.push(url);

  const t0 = Date.now();
  const first = await launchMuse(config, 'intro', { ...desktop, open });
  const took = Date.now() - t0;
  assert.equal(first.outcome, 'opened', first.message);
  started.push(record(config).pid);
  // It waits only for Muse to start serving, never for anyone to look at it.
  assert.ok(took < 60_000, `launching took ${took} ms`);
  assert.match(first.message, /^Opened Muse to review it: http:\/\/127\.0\.0\.1:\d+\/__tourwright\/studio\nWatch it, leave notes, and approve it there\. It closes by itself 10 minutes after its tab is closed\.$/);
  assert.deepEqual(opened, [first.url]);

  // The background Muse is a separate process, serving this walkthrough.
  const { pid, url } = record(config);
  assert.notEqual(pid, process.pid);
  assert.ok(alive(pid));
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Muse<\/title>/);
  assert.equal((await liveMuse(config, 'intro'))?.pid, pid);

  // A second make opens the same Muse rather than starting another.
  const second = await launchMuse(config, 'intro', { ...desktop, open });
  assert.equal(second.outcome, 'reused', second.message);
  assert.equal(second.url, url);
  assert.equal(record(config).pid, pid);
  assert.deepEqual(opened, [url, url]);
  assert.match(second.message, /^Muse was already open for it; showed it again: /);

  // Killed outright (on Windows, process.kill gives it no chance to tidy up), it may leave its
  // record behind: a record whose process has gone counts as no Muse. Muse removing its own record
  // when it stops normally is covered by the idle test.
  process.kill(pid);
  await until(() => !alive(pid), 'the stopped Muse to exit');
  assert.equal(await liveMuse(config, 'intro'), undefined);
});

test('a background Muse closes itself once no tab has been open for its idle time', async () => {
  const config = await scratchApp('idle');
  const result = await launchMuse(config, 'intro', { ...desktop, open: () => undefined, idleSeconds: 2 });
  assert.equal(result.outcome, 'opened', result.message);
  assert.match(result.message, /It closes by itself 2 seconds after its tab is closed\./);
  const { pid, url } = record(config);
  started.push(pid);

  // While a tab is connected (an open event stream), it stays.
  const tab = new AbortController();
  const events = await fetch(new URL('/__tourwright/api/events', url), { signal: tab.signal });
  assert.equal(events.status, 200);
  await new Promise((done) => setTimeout(done, 4000));
  assert.ok(alive(pid), 'Muse closed while a tab was open');

  // Once the tab closes, it goes, and takes its record with it.
  tab.abort();
  await until(() => !alive(pid), 'the idle Muse to exit', 30_000);
  assert.equal(existsSync(musePath(config, 'intro')), false);
});

test('no Muse starts with --no-review, "review": false or in CI; a screenless machine gets a link', async () => {
  const opened: string[] = [];
  const open = (url: string) => void opened.push(url);
  const config = await scratchApp('off');

  const flag = await launchMuse(config, 'intro', { ...desktop, open, review: false });
  assert.equal(flag.outcome, 'off');
  assert.match(flag.message, /npx tourwright muse intro/);

  const ci = await launchMuse(config, 'intro', { env: { CI: 'true', DISPLAY: ':0' }, platform: 'linux', open });
  assert.equal(ci.outcome, 'ci');
  assert.match(ci.message, /^Not opening Muse: this looks like CI/);

  const quiet = await scratchApp('config-off', ', review: false');
  assert.equal(quiet.review, false);
  assert.equal((await launchMuse(quiet, 'intro', { ...desktop, open })).outcome, 'off');

  assert.deepEqual(opened, []);
  assert.equal(existsSync(musePath(config, 'intro')), false, 'nothing was started');
  assert.equal(existsSync(musePath(quiet, 'intro')), false, 'nothing was started');

  // Linux with no display: Muse starts, but only its link is printed.
  const screenless = await scratchApp('screenless');
  const link = await launchMuse(screenless, 'intro', { env: {}, platform: 'linux', open });
  assert.equal(link.outcome, 'link', link.message);
  started.push(record(screenless).pid);
  assert.match(link.message, /^Muse is ready to review it: http:\/\/127\.0\.0\.1:\d+\/__tourwright\/studio\nThere is no screen here to open it on/);
  assert.deepEqual(opened, []);
  process.kill(record(screenless).pid);
});

test('the browser is opened with each platform\'s own command', async () => {
  const { browserCommand } = await import('../src/cli/studio.ts');
  const url = 'http://127.0.0.1:24817/__tourwright/studio';
  // cmd's start needs an empty title first, passed without Node's escaping of the quotes.
  assert.deepEqual(browserCommand(url, 'win32'), { command: 'cmd', args: ['/c', 'start', '""', url], verbatim: true });
  assert.deepEqual(browserCommand(url, 'darwin'), { command: 'open', args: [url], verbatim: false });
  assert.deepEqual(browserCommand(url, 'linux'), { command: 'xdg-open', args: [url], verbatim: false });
});
