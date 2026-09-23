import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScript } from '../src/check/check.ts';
import type { Diagnostic } from '../src/check/diagnostic.ts';

const valid = {
  title: 'Intro',
  scenes: [
    {
      id: 'overview',
      stage: 'dashboard',
      say: '[open]This is the dashboard. [stats]These cards show the week so far.',
      beats: [
        { at: 'open', camera: { to: 'all' } },
        { at: 'stats', camera: { to: 'stats', zoom: 'fit' }, highlight: 'stats' },
        { at: 'end', highlight: false },
      ],
    },
  ],
};

function withScene(scene: Record<string, unknown>): unknown {
  return { ...valid, scenes: [{ ...valid.scenes[0], ...scene }] };
}

function errors(raw: unknown): Diagnostic[] {
  return checkScript(raw).diagnostics.filter((d) => d.level === 'error');
}

test('a valid script has no diagnostics', () => {
  const result = checkScript(valid);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.script?.scenes[0]?.id, 'overview');
});

test('an unknown field names the valid fields and the likely fix', () => {
  const [error] = errors({ ...valid, scenes: [{ ...valid.scenes[0], beats: [{ at: 'open', camra: { to: 'all' } }] }] });
  assert.equal(error?.path, 'scenes[0].beats[0].camra');
  assert.match(error!.message, /"camera"/);
  assert.equal(error?.fix, 'rename "camra" to "camera".');
});

test('an invalid enum value lists the options', () => {
  const [error] = errors(withScene({ beats: [{ at: 'open', camera: { to: 'all', align: 'middle' } }], say: '[open]Hi.' }));
  assert.equal(error?.path, 'scenes[0].beats[0].camera.align');
  assert.match(error!.message, /"center", "top"/);
});

test('an invalid zoom explains the choices', () => {
  const [error] = errors(withScene({ beats: [{ at: 'open', camera: { to: 'all', zoom: 'fill' } }], say: '[open]Hi.' }));
  assert.match(error!.message, /"fit", "width" or a number/);
});

test('a missing required field says so', () => {
  const [error] = errors({ scenes: valid.scenes });
  assert.equal(error?.path, 'title');
  assert.match(error!.message, /missing/);
});

test('a mid-sentence cue is an error whose fix moves it to the sentence start', () => {
  const [error] = errors(withScene({ say: 'This is the dashboard. These [stats]cards show the week.', beats: [{ at: 'stats', highlight: 'stats' }] }));
  assert.match(error!.message, /middle of a sentence/);
  assert.match(error!.fix!, /"\[stats\]These cards show the week\."/);
});

test('a beat at an unknown cue suggests the closest one', () => {
  const found = errors(withScene({ beats: [{ at: 'open', camera: { to: 'all' } }, { at: 'stat', highlight: 'stats' }] }));
  const unknown = found.find((d) => d.path === 'scenes[0].beats[1].at');
  assert.equal(unknown?.fix, 'change it to "stats".');
});

test('an unused cue is an error', () => {
  const found = errors(withScene({ beats: [{ at: 'open', camera: { to: 'all' } }] }));
  assert.ok(found.some((d) => d.message === 'Cue [stats] is not used by any beat.'));
});

test('reserved, duplicate, invalid and trailing cues are errors', () => {
  const found = errors(withScene({ say: '[start]One. [a]Two. [a]Three. [Big Box]Four. Five. [late]', beats: [] }));
  const messages = found.map((d) => d.message).join('\n');
  assert.match(messages, /\[start\] is reserved/);
  assert.match(messages, /\[a\] appears more than once/);
  assert.match(messages, /\[Big Box\] has an invalid name/);
  assert.ok(found.some((d) => d.fix === 'write it as "[big-box]".'));
  assert.match(messages, /\[late\] comes after the last sentence/);
});

test('an unclosed bracket is an error', () => {
  const found = errors(withScene({ say: '[open]See [here.', beats: [{ at: 'open', camera: { to: 'all' } }] }));
  assert.ok(found.some((d) => /no closing/.test(d.message)));
});

test('a beat that does nothing and two beats on one cue are errors', () => {
  const found = errors(withScene({ say: '[open]Hi.', beats: [{ at: 'open' }, { at: 'open', highlight: false }] }));
  assert.ok(found.some((d) => /does nothing/.test(d.message)));
  assert.ok(found.some((d) => /already uses "open"/.test(d.message)));
});

test('duplicate scene ids are errors, including defaulted ones', () => {
  const scene = { stage: 'dashboard', say: 'Hi.' };
  const found = errors({ title: 'T', scenes: [scene, { ...scene, id: '1' }] });
  assert.equal(found[0]?.path, 'scenes[1].id');
});

test('an empty narration is an error', () => {
  const found = errors(withScene({ say: '   ', beats: [] }));
  assert.ok(found.some((d) => /empty/.test(d.message)));
});

test('em and en dashes anywhere are errors', () => {
  const [en, em] = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  const found = errors({ ...valid, subtitle: `Weekly ${em} summary` });
  assert.equal(found[0]?.path, 'subtitle');
  const inSay = errors(withScene({ say: `[open]This is the dashboard, 10${en}20 items. [stats]These cards show the week.` }));
  assert.equal(inSay[0]?.path, 'scenes[0].say');
});

test('a long sentence is a warning, not an error', () => {
  const long = Array.from({ length: 30 }, () => 'word').join(' ') + '.';
  const result = checkScript(withScene({ say: `[open]${long} [stats]Short.` }));
  assert.deepEqual(errors(withScene({ say: `[open]${long} [stats]Short.` })), []);
  assert.equal(result.diagnostics[0]?.level, 'warning');
});

test('settings are strict and range-checked', () => {
  const found = errors({ ...valid, settings: { video: { fps: 29, width: 1921 }, camera: { lead: -1 } } });
  const paths = found.map((d) => d.path).sort();
  assert.deepEqual(paths, ['settings.camera.lead', 'settings.video.fps', 'settings.video.width']);
});
