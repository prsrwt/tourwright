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

test('ffmpeg-static installed without its binary gets the fix that works', async () => {
  const { ffmpegMissing } = await import('../src/render/ffmpeg.ts');
  const dir = tempApp({});
  assert.match(ffmpegMissing(dir), /npm install -D ffmpeg-static/);
  mkdirSync(join(dir, 'node_modules', 'ffmpeg-static'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'ffmpeg-static', 'package.json'), JSON.stringify({ name: 'ffmpeg-static', main: 'index.js' }));
  writeFileSync(join(dir, 'node_modules', 'ffmpeg-static', 'index.js'), `module.exports = ${JSON.stringify(join(dir, 'missing', 'ffmpeg.exe'))};`);
  assert.match(ffmpegMissing(dir), /npm approve-scripts ffmpeg-static.*npm rebuild ffmpeg-static/);
});
