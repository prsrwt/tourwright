import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration } from '../src/narration/parse.ts';
import type { ValueDefinitions } from '../src/runtime/stage.ts';
import { buildValues } from '../src/runtime/values.ts';
import type { Scene, Script } from '../src/schema/script.ts';
import { resolveSettings } from '../src/schema/settings.ts';
import { buildTimeline, type SentenceAudio } from '../src/timing/timeline.ts';
import { SAMPLE_RATE } from '../src/voice/backend.ts';

function timeline(scenes: Scene[]) {
  const script: Script = { title: 'T', scenes };
  const audio: SentenceAudio[][] = scenes.map((s) =>
    parseNarration(s.say).sentences.map((x) => ({ text: x.text, spoken: x.text, cues: x.cues, file: '', samples: 3 * SAMPLE_RATE })),
  );
  return buildTimeline(script, resolveSettings(undefined), audio);
}

const gasds: ValueDefinitions = {
  claim: { from: 0, to: 1732.5, decimals: 2 },
  count: { from: 0, to: 300 },
  details: { steps: [false, true] },
  progress: { steps: [null, 'claimed', 'paid'] },
};

test('a number starts at "from", eases to "to" once the camera arrives, and stays there', () => {
  const t = timeline([
    { stage: 'g', say: 'Intro. [total]This is the total.', beats: [{ at: 'total', camera: { to: 'claim' }, animate: 'claim' }] },
    { stage: 'g', say: 'Later.' },
  ]);
  const values = buildValues(t, { g: gasds });
  const beat = t.scenes[0]!.beats[0]!;
  const a = beat.animate!;
  assert.equal(a.from, beat.camera!.from + beat.camera!.frames, 'starts when the camera settles');

  assert.equal(values.at('g', t.scenes[0]!.from).claim, 0);
  const middle = values.at('g', a.from + Math.floor(a.frames / 2)).claim as number;
  assert.ok(middle > 0 && middle < 1732.5);
  assert.equal(middle, Math.round(middle * 100) / 100, 'rounded to its decimals');
  assert.equal(values.at('g', a.from + a.frames).claim, 1732.5);
  assert.equal(values.at('g', t.scenes[1]!.from).claim, 1732.5, 'carries into the next scene on the stage');
  // Never animated: its real value throughout. And layout is always measured at the end values.
  assert.equal(values.at('g', t.scenes[0]!.from).count, 300);
  assert.equal(values.forLayout('g', t.scenes[0]!.from).claim, 1732.5);
});

test('a steps value moves on one step at each beat that animates it, and sets the layout state', () => {
  const t = timeline([
    {
      stage: 'g',
      say: '[claim]You claim. [paid]HMRC pays. [details]Show the details.',
      beats: [
        { at: 'claim', animate: 'progress' },
        { at: 'paid', animate: 'progress' },
        { at: 'details', animate: 'details' },
      ],
    },
  ]);
  const values = buildValues(t, { g: gasds });
  assert.deepEqual(values.problems, []);
  const [claim, paid, details] = t.scenes[0]!.beats.map((b) => b.animate!.from);
  // Each step shows from the frame after its animation starts.
  assert.equal(values.at('g', claim!).progress, null);
  assert.equal(values.at('g', claim! + 1).progress, 'claimed');
  assert.equal(values.at('g', paid! + 1).progress, 'paid');
  assert.equal(values.at('g', details!).details, false);
  assert.equal(values.at('g', details! + 1).details, true);
  assert.equal(values.state('g', details!), 'details=0&progress=2');
  assert.equal(values.state('g', details! + 1), 'details=1&progress=2');
});

test('unknown values, a number animated twice and one step too many are reported', () => {
  const t = timeline([
    {
      stage: 'g',
      say: '[a]One. [b]Two. [c]Three. [d]Four.',
      beats: [
        { at: 'a', animate: ['claim', 'clam'] },
        { at: 'b', animate: 'claim' },
        { at: 'c', animate: 'details' },
        { at: 'd', animate: 'details' },
      ],
    },
  ]);
  const problems = buildValues(t, { g: gasds }).problems;
  assert.deepEqual(
    problems.map((p) => [p.beat, p.message.split('.')[0]]),
    [
      [0, '"clam" is not a value of stage "g"'],
      [1, '"claim" is a number and was already animated'],
      [3, '"details" has 2 steps, so it can move on 1 times, and this is move 2'],
    ],
  );
});
