import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration } from '../src/narration/parse.ts';
import type { Scene, Script } from '../src/schema/script.ts';
import { resolveSettings } from '../src/schema/settings.ts';
import { buildTimeline, type SentenceAudio } from '../src/timing/timeline.ts';
import { SAMPLE_RATE } from '../src/voice/backend.ts';
import { pacingDiagnostics } from '../src/verify/pacing.ts';

/** Every sentence lasts `seconds`; the gap between sentences is 0.3 s and moves take 0.9 s. */
function pacing(scenes: Scene[], seconds = 3) {
  const script: Script = { title: 'T', scenes };
  const audio: SentenceAudio[][] = scenes.map((s) =>
    parseNarration(s.say).sentences.map((x) => ({ text: x.text, spoken: x.text, cues: x.cues, file: '', samples: seconds * SAMPLE_RATE })),
  );
  return pacingDiagnostics(buildTimeline(script, resolveSettings(undefined), audio));
}

const messages = (d: { message: string }[]) => d.map((x) => x.message);

test('a well paced scene has no warnings', () => {
  const found = pacing([
    {
      stage: 'a',
      say: '[open]This is the page. [total]This is the total. It is what you can claim.',
      beats: [
        { at: 'open', camera: { to: 'all' } },
        { at: 'total', camera: { to: 'total' }, highlight: 'total' },
        { at: 'end', highlight: false },
      ],
    },
  ]);
  assert.deepEqual(found, []);
});

test('a camera move soon after the last one settles is flagged, across scenes on one stage', () => {
  // Sentences of 1 s. The first move starts with the scene and settles 0.9 s in; the next cue is
  // 1.3 s in and its move starts one 0.4 s lead earlier, at 0.9 s: no time to take in the view.
  // With no tail, the next scene's move then comes 0.5 s after that one settles.
  const found = pacing(
    [
      { stage: 'a', say: '[open]Short. [next]Short.', tail: 0, beats: [{ at: 'open', camera: { to: 'all' } }, { at: 'next', camera: { to: 'total' } }] },
      { stage: 'a', say: '[again]Short again. Still here.', beats: [{ at: 'again', camera: { to: 'list' } }] },
    ],
    1,
  );
  const rushed = found.filter((d) => /The camera moves to/.test(d.message));
  assert.deepEqual(
    rushed.map((d) => d.path),
    ['scenes[0].beats[1].camera', 'scenes[1].beats[0].camera'],
  );
  assert.match(rushed[0]!.message, /only 0\.0 s after settling on "all"/);
  assert.match(rushed[1]!.message, /only 0\.5 s after settling on "total"/);
});

test('scenes that run long or flash past are flagged', () => {
  const long = pacing([{ stage: 'a', say: 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine.' }], 3);
  // Nine 3 s sentences, eight 0.3 s gaps and a 0.7 s tail.
  assert.match(messages(long).join(), /lasts 30\.1 s/);
  const short = pacing([{ stage: 'a', say: 'Hi.' }], 1);
  assert.match(messages(short).join(), /lasts only 1\.7 s/);
});

test('a highlight left on while the narration moves on is flagged', () => {
  const found = pacing([
    {
      stage: 'a',
      say: '[total]This is the total. One. Two. Three.',
      beats: [
        { at: 'start', camera: { to: 'all' } },
        { at: 'total', highlight: 'total' },
      ],
    },
  ]);
  assert.match(messages(found).join(), /highlight on "total" stays on through 3 more sentences/);
});

test('zooming in before the viewer has seen the whole screen is flagged', () => {
  const found = pacing([{ stage: 'a', say: '[total]This is the total. It is big.', beats: [{ at: 'total', camera: { to: 'total' } }] }]);
  assert.deepEqual(
    found.map((d) => d.path),
    ['scenes[0].beats[0].camera.to'],
  );
});

test('a highlight carried into the next scene on the same stage is counted there too', () => {
  const found = pacing([
    { stage: 'a', say: '[warn]These need attention. Check them.', beats: [{ at: 'start', camera: { to: 'all' } }, { at: 'warn', highlight: 'attention' }] },
    { stage: 'a', say: '[more]There is more behind that figure. It comes from the method. Each has a pot.', beats: [{ at: 'more', animate: 'details' }] },
  ]);
  const lingering = found.find((d) => /stays on/.test(d.message));
  assert.equal(lingering?.path, 'scenes[0].beats[1].highlight');
  assert.match(lingering!.message, /through 4 more sentences, into the next scene, up to "Each has a pot\."/);
  // A cut to another stage clears it, so nothing lingers there.
  const cut = pacing([
    { stage: 'a', say: '[warn]These need attention.', beats: [{ at: 'start', camera: { to: 'all' } }, { at: 'warn', highlight: 'attention' }] },
    { stage: 'b', say: 'One. Two. Three. Four.' },
  ]);
  assert.equal(cut.filter((d) => /stays on/.test(d.message)).length, 0);
});
