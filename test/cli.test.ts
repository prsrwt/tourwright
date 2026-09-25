import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkScript } from '../src/check/check.ts';
import { runInit } from '../src/cli/init.ts';
import { runNew } from '../src/cli/new.ts';
import { resolveConfig } from '../src/config/config.ts';

function tempApp(pkg: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-cli-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

function silently<T>(fn: () => T): T {
  const { log, error } = console;
  console.log = console.error = () => undefined;
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error });
  }
}

test('init sets up a Next app, and its intro script passes check', () => {
  const dir = tempApp({ dependencies: { next: '16.0.0', react: '19.0.0' } });
  assert.equal(silently(() => runInit(dir)), 0);
  assert.match(readFileSync(join(dir, 'tourwright.config.mts'), 'utf8'), /preset: 'next'/);
  assert.ok(existsSync(join(dir, 'tourwright', 'stages.tsx')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'walkthrough', 'SKILL.md')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^tourwright\/out\/$/m);
  const script = JSON.parse(readFileSync(join(dir, 'tourwright', 'walkthroughs', 'intro', 'script.json'), 'utf8'));
  assert.equal(script.$schema, '../../../node_modules/tourwright/schema/script.schema.json');
  assert.deepEqual(checkScript(script).diagnostics, []);
});

test('init writes a .ts config for an ES module app, keeps existing files, and needs React', () => {
  const dir = tempApp({ type: 'module', dependencies: { react: '19.0.0' } });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/');
  assert.equal(silently(() => runInit(dir)), 0);
  assert.match(readFileSync(join(dir, 'tourwright.config.ts'), 'utf8'), /preset: 'vite-react'/);
  writeFileSync(join(dir, 'tourwright', 'stages.tsx'), '// mine');
  assert.equal(silently(() => runInit(dir)), 0);
  assert.equal(readFileSync(join(dir, 'tourwright', 'stages.tsx'), 'utf8'), '// mine');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8').match(/tourwright\/out\//g)?.length, 1);
  assert.equal(silently(() => runInit(tempApp({}))), 1);
});

test('new creates a script that passes check, using a stage an existing walkthrough uses', () => {
  const dir = tempApp({ dependencies: { react: '19.0.0' } });
  silently(() => runInit(dir));
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
  assert.equal(silently(() => runNew(config, 'billing-overview')), 0);
  const script = JSON.parse(readFileSync(join(config.walkthroughs, 'billing-overview', 'script.json'), 'utf8'));
  assert.equal(script.title, 'Billing Overview');
  assert.equal(script.scenes[0].stage, 'example');
  assert.deepEqual(checkScript(script).diagnostics, []);
  assert.equal(silently(() => runNew(config, 'billing-overview')), 1, 'refuses to overwrite');
  assert.equal(silently(() => runNew(config, 'Bad Name')), 1);
});

test('no em or en dashes anywhere in the repo', () => {
  const root = new URL('..', import.meta.url);
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  const offenders = files.filter((file) => {
    const path = new URL(file, root);
    return existsSync(path) && !/\.(png|jpg|mp4|wav|ico)$/i.test(file) && dashes.test(readFileSync(path, 'utf8'));
  });
  assert.deepEqual(offenders, []);
});

test('notes: a byte order mark is fine, and a broken file is an error rather than "no notes"', async () => {
  const { readNotes } = await import('../src/studio/server.ts');
  const dir = tempApp({ dependencies: { react: '19.0.0' } });
  silently(() => runInit(dir));
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
  const notes = join(config.walkthroughs, 'intro', 'notes.json');
  writeFileSync(notes, String.fromCharCode(0xfeff) + JSON.stringify({ notes: [{ id: 'a', ms: 1000, frame: 30, scene: 'welcome', sceneIndex: 0, text: 'zoom', status: 'open', created: '' }] }));
  assert.equal(readNotes(config, 'intro')[0]?.text, 'zoom');
  writeFileSync(notes, '{ "notes": [ { "id": "a", ');
  assert.throws(() => readNotes(config, 'intro'), /is not valid JSON/);
});

test('notes: old files still read, questions come first, and the review is stated', async () => {
  const { readNotes } = await import('../src/studio/server.ts');
  const { runNotes } = await import('../src/cli/notes.ts');
  const { writeReview, hashScript } = await import('../src/studio/review.ts');
  const dir = tempApp({ dependencies: { react: '19.0.0' } });
  silently(() => runInit(dir));
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
  const notes = join(config.walkthroughs, 'intro', 'notes.json');
  const note = (id: string, status: string, extra: object = {}) => ({ id, ms: 1000, frame: 30, scene: 'welcome', sceneIndex: 0, text: `note ${id}`, status, created: '2026-01-01T00:00:00Z', ...extra });
  writeFileSync(
    notes,
    JSON.stringify({
      notes: [
        note('old', 'done', { resolution: 'Zoomed in.' }),
        note('todo', 'open', { scope: 'scene', target: 'stats', rect: { x: 10, y: 20, w: 300, h: 90 } }),
        note('ask', 'question', { replies: [{ from: 'agent', text: 'Which card?', at: '2026-01-01T00:00:00Z' }] }),
        note('shut', 'closed'),
      ],
    }),
  );
  // "done" was the old "fixed", and a resolution was the agent's reply.
  const old = readNotes(config, 'intro')[0]!;
  assert.equal(old.status, 'fixed');
  assert.equal(old.scope, 'moment');
  assert.deepEqual(old.replies, [{ from: 'agent', text: 'Zoomed in.', at: '2026-01-01T00:00:00Z' }]);
  assert.equal('resolution' in old, false);

  const lines: string[] = [];
  const { log } = console;
  console.log = (line: string) => lines.push(line);
  try {
    runNotes(config, 'intro', { json: false });
  } finally {
    console.log = log;
  }
  const out = lines.join('\n');
  assert.match(out, /^Review: not reviewed yet\./);
  const order = ['[ask]', '[todo]', '[old]', '[shut]'].map((id) => out.indexOf(id));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'questions, then open, fixed and closed');
  assert.match(out, /\[todo\] .*, about the whole scene\n {2}on target "stats", on screen at x 10, y 20, 300 by 90/);
  assert.match(out, /Agent: Which card\?/);
  assert.match(out, /npx tourwright reply intro <id> --fixed "what you changed"/);
  assert.match(out, /Only the user closes a note/);

  // An approval counts only for the script it was given for.
  const script = join(config.walkthroughs, 'intro', 'script.json');
  writeReview(config, 'intro', { status: 'approved', scriptHash: hashScript(readFileSync(script, 'utf8')), at: '2026-01-02T09:30:00Z' });
  const { reviewState, formatReview } = await import('../src/studio/review.ts');
  assert.equal(reviewState(config, 'intro').approved, true);
  writeFileSync(script, readFileSync(script, 'utf8').replace('"title"', '"subtitle": "Edited", "title"'));
  assert.equal(reviewState(config, 'intro').approved, false);
  assert.match(formatReview('intro', reviewState(config, 'intro')), /^Review: edited since approval\. It was approved on 2026-01-02 09:30 UTC/);

  writeFileSync(notes, JSON.stringify({ notes: [note('bad', 'finished')] }));
  assert.throws(() => readNotes(config, 'intro'), /has the status "finished"\.\nFix: use one of "open", "question", "fixed", "closed"\./);
});

test('reply answers a note in one command, and never closes one', async () => {
  const { readNotes } = await import('../src/studio/server.ts');
  const { runReply } = await import('../src/cli/reply.ts');
  const dir = tempApp({ dependencies: { react: '19.0.0' } });
  silently(() => runInit(dir));
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
  const note = (id: string, status: string) => ({ id, ms: 1000, frame: 30, scene: 'welcome', sceneIndex: 0, text: `note ${id}`, status, scope: 'moment', replies: [], created: '' });
  writeFileSync(join(config.walkthroughs, 'intro', 'notes.json'), JSON.stringify({ notes: [note('a', 'open'), note('b', 'open'), note('c', 'closed')] }));

  assert.equal(silently(() => runReply(config, 'intro', 'a', { fixed: 'Zoomed to 2x on the stats.' })), 0);
  assert.equal(silently(() => runReply(config, 'intro', 'b', { question: 'All three cards, or only Overdue?' })), 0);
  const [a, b, c] = readNotes(config, 'intro');
  assert.equal(a?.status, 'fixed');
  assert.deepEqual(a?.replies.map((r) => [r.from, r.text]), [['agent', 'Zoomed to 2x on the stats.']]);
  assert.equal(b?.status, 'question');
  assert.equal(c?.status, 'closed');

  // A closed note, an unknown id, and a reply that is neither or both, are refused.
  assert.throws(() => runReply(config, 'intro', 'c', { fixed: 'Again.' }), /Note "c" is closed[^]*Fix:/);
  assert.throws(() => runReply(config, 'intro', 'zz', { fixed: 'x' }), /There is no note "zz"[^]*Notes: a, b, c\.[^]*Fix:/);
  assert.equal(silently(() => runReply(config, 'intro', 'a', {})), 1);
  assert.equal(silently(() => runReply(config, 'intro', 'a', { fixed: 'x', question: 'y' })), 1);
  assert.equal(readNotes(config, 'intro')[2]?.replies.length, 0, 'the closed note is untouched');
});

test('make --require-approval refuses a version not approved in Muse, before doing any work', async () => {
  const { runMake } = await import('../src/cli/make.ts');
  const { writeReview, hashScript } = await import('../src/studio/review.ts');
  const dir = tempApp({ dependencies: { react: '19.0.0' } });
  silently(() => runInit(dir));
  const config = resolveConfig({}, join(dir, 'tourwright.config.mts'), {});
  const errors: string[] = [];
  const { error } = console;
  console.error = (line: string) => errors.push(line);
  try {
    assert.equal(await runMake(config, 'intro', { requireApproval: true }), 1);
    // Changes requested is not an approval either.
    const script = readFileSync(join(config.walkthroughs, 'intro', 'script.json'), 'utf8');
    writeReview(config, 'intro', { status: 'changes-requested', scriptHash: hashScript(script), at: '2026-01-02T09:30:00Z', comment: 'Slower.' });
    assert.equal(await runMake(config, 'intro', { requireApproval: true }), 1);
  } finally {
    console.error = error;
  }
  assert.match(errors[0]!, /^Not rendered: --require-approval renders only a version approved in Muse\. Review: not reviewed yet\.[^]*Fix: ask the user to review it in Muse/);
  assert.match(errors[1]!, /Review: changes requested on 2026-01-02 09:30 UTC: "Slower\."/);
});

test('ffmpeg-static installed without its binary gets the fix that works', async () => {
  const { ffmpegMissing } = await import('../src/render/ffmpeg.ts');
  const dir = tempApp({});
  assert.match(ffmpegMissing(dir), /npm install -D ffmpeg-static/);
  mkdirSync(join(dir, 'node_modules', 'ffmpeg-static'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'ffmpeg-static', 'package.json'), JSON.stringify({ name: 'ffmpeg-static', main: 'index.js' }));
  writeFileSync(join(dir, 'node_modules', 'ffmpeg-static', 'index.js'), `module.exports = ${JSON.stringify(join(dir, 'missing', 'ffmpeg.exe'))};`);
  assert.match(ffmpegMissing(dir), /npm approve-scripts ffmpeg-static.*npm rebuild ffmpeg-static/);
});
