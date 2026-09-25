// Narration boxes placed by hand in Muse: each edit is written into script.json as an agent
// would write it, with both edges on sentence starts and nothing left behind that does nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addArea, deleteBox, moveBox, setBox, type BoxScript } from '../src/studio/boxes.ts';

const script = (): BoxScript => ({
  scenes: [
    { stage: 'app', say: 'One is here. [total] Two is the total. Three comes next. Four ends it.', beats: [{ at: 'total', camera: { to: 'total' }, highlight: 'total' }] },
    { stage: 'app', say: 'Five carries on. Six too.' },
  ],
});

test('a box goes on from one sentence start to another, adding cues only where there are none', () => {
  const s = script();
  setBox(s, { scene: 0, target: 'export', start: 2, end: 3 });
  assert.equal(s.scenes[0]!.say, 'One is here. [total] Two is the total. [export] Three comes next. [after-export] Four ends it.');
  // Where it ends, the box it covered comes back.
  assert.deepEqual(s.scenes[0]!.beats, [
    { at: 'total', camera: { to: 'total' }, highlight: 'total' },
    { at: 'export', highlight: 'export' },
    { at: 'after-export', highlight: 'total' },
  ]);

  // Over the cue already there, it reuses it; at the scene's start it uses "start".
  const t = script();
  setBox(t, { scene: 0, target: 'menu', start: 0, end: 1 });
  assert.equal(t.scenes[0]!.say, script().scenes[0]!.say, 'no cue added');
  assert.deepEqual(t.scenes[0]!.beats, [
    { at: 'start', highlight: 'menu' },
    { at: 'total', camera: { to: 'total' }, highlight: 'total' },
  ]);
});

test('a box over others replaces them for its stretch, and one running to the end only closes there if something carries on', () => {
  const s = script();
  setBox(s, { scene: 0, target: 'export', start: 0, end: 4 });
  assert.equal(s.scenes[0]!.say, script().scenes[0]!.say);
  // The camera beat stays; its narration box goes, as the new box covers it.
  assert.deepEqual(s.scenes[0]!.beats, [
    { at: 'start', highlight: 'export' },
    { at: 'total', camera: { to: 'total' } },
    // The agent's box was on until the end and on into the next scene: it comes back there.
    { at: 'end', highlight: 'total' },
  ]);
  const u = script();
  u.scenes[1]!.stage = 'other';
  delete u.scenes[0]!.beats![0]!.highlight;
  setBox(u, { scene: 0, target: 'export', start: 1, end: 4 });
  // The next scene is on another stage, so the cut clears it: no beat is needed at "end".
  assert.deepEqual(u.scenes[0]!.beats, [{ at: 'total', camera: { to: 'total' }, highlight: 'export' }]);
  const v = script();
  v.scenes[1]!.beats = [{ at: 'start', highlight: 'menu' }];
  setBox(v, { scene: 0, target: 'export', start: 2, end: 4 });
  assert.deepEqual(v.scenes[0]!.beats!.at(-1), { at: 'export', highlight: 'export' }, 'nor when the next scene moves the box as it begins');
});

test('moving an edge keeps the target, and drops the cues and beats it no longer needs', () => {
  const s = script();
  setBox(s, { scene: 0, target: 'export', start: 2, end: 3 });
  moveBox(s, 0, 1, 2, 4);
  assert.equal(s.scenes[0]!.say, 'One is here. [total] Two is the total. [export] Three comes next. Four ends it.');
  assert.deepEqual(s.scenes[0]!.beats, [
    { at: 'total', camera: { to: 'total' }, highlight: 'total' },
    { at: 'export', highlight: 'export' },
    { at: 'end', highlight: 'total' },
  ]);

  // Its start can move too, over the box it covered; a cue already at the new end is reused.
  moveBox(s, 0, 1, 1, 2);
  assert.equal(s.scenes[0]!.say, 'One is here. [total] Two is the total. [export] Three comes next. Four ends it.');
  assert.deepEqual(s.scenes[0]!.beats, [
    { at: 'total', camera: { to: 'total' }, highlight: 'export' },
    { at: 'export', highlight: 'total' },
  ]);
});

test('deleting a box leaves the script as if it had never been there', () => {
  const s = script();
  setBox(s, { scene: 0, target: 'export', start: 2, end: 3 });
  deleteBox(s, 0, 1);
  assert.deepEqual(s, script());

  // Deleting the agent's own box clears it for its stretch.
  const t = script();
  deleteBox(t, 0, 0);
  assert.deepEqual(t.scenes[0]!.beats, [{ at: 'total', camera: { to: 'total' } }]);
  assert.throws(() => deleteBox(t, 0, 0), /no narration box there any more/);
});

test('a drawn area becomes a named target, named from its text, and goes when nothing uses it', () => {
  const s = script();
  const name = addArea(s, { stage: 'app', x: 10.4, y: 20, w: 80, h: 24.6 }, ['Export CSV', 'now']);
  assert.equal(name, 'area-export-csv-now');
  assert.deepEqual(s.areas, { 'area-export-csv-now': { stage: 'app', x: 10, y: 20, w: 80, h: 25 } });
  assert.equal(addArea(s, { stage: 'app', x: 10, y: 20, w: 80, h: 25 }, []), name, 'the same box keeps its name');
  assert.equal(addArea(s, { stage: 'app', x: 0, y: 0, w: 5, h: 5 }, ['Export CSV now']), 'area-export-csv-now-2');
  setBox(s, { scene: 0, target: name, start: 2, end: 3 });
  assert.deepEqual(Object.keys(s.areas!), [name], 'unused areas are dropped');
  deleteBox(s, 0, 1);
  assert.equal(s.areas, undefined);
});
