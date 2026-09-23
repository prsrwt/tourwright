import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionsVtt } from '../src/render/captions.ts';
import type { Script } from '../src/schema/script.ts';
import { resolveSettings } from '../src/schema/settings.ts';
import { buildTimeline, type SentenceAudio } from '../src/timing/timeline.ts';
import { SAMPLE_RATE } from '../src/voice/backend.ts';
import { overlap } from '../src/verify/verify.ts';

function timeline(scenes: string[][], lexicon?: Record<string, string>) {
  const script: Script = { title: 'T', ...(lexicon && { lexicon }), scenes: scenes.map((s) => ({ stage: 'a', say: s.join(' ') })) };
  const audio: SentenceAudio[][] = scenes.map((s) => s.map((text) => ({ text, spoken: text.toUpperCase(), cues: [], file: '', samples: 2 * SAMPLE_RATE })));
  return buildTimeline(script, resolveSettings({ video: { fps: 30 }, voice: { sentenceGap: 0.3, tail: 0.7 } }), audio);
}

test('each caption runs until the next sentence starts, and the last one clears before the next scene', () => {
  const t = timeline([['One.', 'Two.'], ['Three.']]);
  const [one, two, three] = t.captions;
  const [first, second] = t.scenes;
  assert.deepEqual(one, { text: 'One.', from: first!.sentences[0]!.from, to: first!.sentences[1]!.from });
  // Two seconds of audio (60 frames) plus one gap (9 frames), which ends before the scene does.
  assert.equal(two!.to, first!.sentences[1]!.from + 60 + 9);
  assert.ok(two!.to <= second!.from);
  assert.equal(three!.from, second!.sentences[0]!.from);
});

test('captions show the written words, not the spoken ones', () => {
  const t = timeline([['Tourwright is ready.']]);
  assert.equal(t.captions[0]!.text, 'Tourwright is ready.');
  assert.equal(t.scenes[0]!.sentences[0]!.spoken, 'TOURWRIGHT IS READY.');
});

test('the WebVTT file has one cue per caption, with exact times', () => {
  const t = timeline([['One.', 'Two & <three> --> four.']]);
  const vtt = captionsVtt(t);
  assert.ok(vtt.startsWith('WEBVTT\n\n1\n00:00:02.500 --> '));
  // Title 75 frames, then 60 frames of audio and a 9-frame gap: frame 144 is 4.8 s, and the
  // last caption holds one gap past its audio, to frame 213 (7.1 s).
  assert.match(vtt, /\n2\n00:00:04\.800 --> 00:00:07\.100\nTwo &amp; &lt;three> -- > four\.\n$/);
});

test('overlap is the share of the target that is covered', () => {
  const target = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(overlap(target, { x: 50, y: 50, w: 100, h: 100 }), 0.25);
  assert.equal(overlap(target, { x: 200, y: 0, w: 10, h: 10 }), 0);
  assert.equal(overlap(target, { x: -10, y: -10, w: 200, h: 200 }), 1);
});
