import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '../src/schema/script.ts';
import { resolveSettings } from '../src/schema/settings.ts';
import { buildSoundtrack } from '../src/timing/audio.ts';
import { buildTimeline, samplesPerFrame, settleFrame, TITLE_SECONDS, type SentenceAudio } from '../src/timing/timeline.ts';
import { SAMPLE_RATE } from '../src/voice/backend.ts';
import { fakeBackend } from '../src/voice/fake.ts';
import { voiceScript } from '../src/voice/synthesize.ts';
import { decodeWav, encodeWav } from '../src/voice/wav.ts';

const script: Script = {
  title: 'Intro',
  scenes: [
    {
      id: 'overview',
      stage: 'dashboard',
      say: '[open]This is the dashboard. [cards]These cards count your tasks.',
      beats: [
        { at: 'open', camera: { to: 'all' } },
        { at: 'cards', camera: { to: 'stats', zoom: 'width' }, highlight: 'stats' },
      ],
    },
    {
      id: 'tasks',
      stage: 'dashboard',
      say: '[table]Below them is every task. [status]The status shows where each one stands.',
      beats: [
        { at: 'table', camera: { to: 'tasks' } },
        { at: 'status', highlight: 'status-column' },
        { at: 'end', highlight: false },
      ],
    },
  ],
};

async function timelineFor(s: Script) {
  const settings = resolveSettings(s.settings);
  const voiced = await voiceScript(s, settings, fakeBackend, mkdtempSync(join(tmpdir(), 'tourwright-tl-')));
  return buildTimeline(s, settings, voiced.scenes);
}

function audio(seconds: number[][]): SentenceAudio[][] {
  return seconds.map((scene) => scene.map((s, i) => ({ text: `S${i}.`, spoken: `S${i}.`, cues: [], file: '', samples: Math.round(s * SAMPLE_RATE) })));
}

test('sentences start on frame boundaries, separated by the gap, and scenes end after the tail', () => {
  const s: Script = { title: 'T', scenes: [{ stage: 'a', say: 'One. Two.' }, { stage: 'a', say: 'Three.' }] };
  const settings = resolveSettings({ video: { fps: 30 }, voice: { sentenceGap: 0.3, tail: 0.7 } });
  // 1.01 s is 30.3 frames, so it occupies 31.
  const t = buildTimeline(s, settings, audio([[1.01, 2], [1]]));
  const title = TITLE_SECONDS * 30;
  const [first, second] = t.scenes;
  assert.equal(t.titleFrames, title);
  assert.deepEqual(first!.sentences.map((x) => [x.from, x.frames]), [[title, 31], [title + 31 + 9, 60]]);
  assert.equal(first!.cues.end, title + 31 + 9 + 60);
  assert.equal(first!.frames, 31 + 9 + 60 + 21);
  assert.equal(second!.from, title + first!.frames);
  assert.equal(t.frames, second!.from + 30 + 21);
});

test('camera and highlight moves start one lead before their cue, never before the scene', async () => {
  const t = await timelineFor(script);
  const lead = Math.round(t.settings.camera.lead * t.fps);
  const [overview, tasks] = t.scenes;

  const open = overview!.beats[0]!;
  assert.equal(open.cue, overview!.from);
  assert.equal(open.camera!.from, overview!.from, 'clamped to the scene start');

  const cards = overview!.beats[1]!;
  assert.equal(cards.cue, overview!.sentences[1]!.from);
  assert.equal(cards.camera!.from, cards.cue - lead);
  assert.equal(cards.highlight!.from, cards.cue - lead);
  assert.deepEqual({ zoom: cards.camera!.zoom, align: cards.camera!.align, ease: cards.camera!.ease }, { zoom: 'width', align: 'center', ease: 'inOutCubic' });

  const end = tasks!.beats[2]!;
  assert.equal(end.cue, tasks!.cues.end);
  assert.equal(end.highlight!.to, false);
});

test('lengthening a sentence moves every later cue and beat, with no time edited by hand', async () => {
  const before = await timelineFor(script);
  const longer = structuredClone(script);
  longer.scenes[0]!.say = '[open]This is the dashboard your whole team shares every week. [cards]These cards count your tasks.';
  const after = await timelineFor(longer);

  const shift = after.scenes[0]!.sentences[0]!.frames - before.scenes[0]!.sentences[0]!.frames;
  assert.ok(shift > 0);
  // The first cue is at the scene start, so it does not move; everything after the longer sentence does.
  assert.equal(after.scenes[0]!.cues.open, before.scenes[0]!.cues.open);
  const cues = (t: typeof before) => [t.scenes[0]!.cues.cards!, ...Object.values(t.scenes[1]!.cues)];
  assert.deepEqual(cues(after), cues(before).map((f) => f + shift));
  const moves = (t: typeof before) => t.scenes.flatMap((s) => s.beats.slice(s.index === 0 ? 1 : 0)).map((b) => [b.camera?.from, b.highlight?.from]);
  assert.deepEqual(moves(after), moves(before).map(([c, h]) => [c === undefined ? c : c + shift, h === undefined ? h : h + shift]));
  assert.equal(after.frames, before.frames + shift);
});

test('a still settles after its slowest move, inside its scene', async () => {
  const t = await timelineFor(script);
  const scene = t.scenes[0]!;
  const cards = scene.beats[1]!;
  assert.equal(settleFrame(t, scene, cards), Math.max(cards.camera!.from + cards.camera!.frames, cards.highlight!.from + t.highlightFrames.slide));
  const last = t.scenes[1]!;
  assert.ok(settleFrame(t, last, last.beats[2]!) < last.from + last.frames);
});

test('the soundtrack places each sentence at its first frame', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-audio-'));
  const tone = (n: number) => Float32Array.from({ length: n }, () => 0.5);
  const files = [join(dir, 'a.wav'), join(dir, 'b.wav')];
  writeFileSync(files[0]!, encodeWav(tone(1000), SAMPLE_RATE));
  writeFileSync(files[1]!, encodeWav(tone(500), SAMPLE_RATE));
  const s: Script = { title: 'T', scenes: [{ stage: 'a', say: 'One. Two.' }] };
  const t = buildTimeline(s, resolveSettings(undefined), [
    [
      { text: 'One.', spoken: 'One.', cues: [], file: files[0]!, samples: 1000 },
      { text: 'Two.', spoken: 'Two.', cues: [], file: files[1]!, samples: 500 },
    ],
  ]);
  const track = decodeWav(buildSoundtrack(t)).samples;
  const spf = samplesPerFrame(t.fps);
  assert.equal(track.length, t.frames * spf);
  const [one, two] = t.scenes[0]!.sentences;
  const at = (i: number) => Math.round(track[i]! * 2);
  assert.equal(at(one!.from * spf - 1), 0);
  assert.equal(at(one!.from * spf), 1);
  assert.equal(at(one!.from * spf + 999), 1);
  assert.equal(at(one!.from * spf + 1000), 0);
  assert.equal(at(two!.from * spf), 1);
  assert.equal(at(two!.from * spf + 500), 0);
});

test('the title card lasts settings.title.seconds, and 0 leaves it out', () => {
  const s: Script = { title: 'T', scenes: [{ stage: 'a', say: 'One.' }] };
  const one = audio([[1]]);
  assert.equal(buildTimeline(s, resolveSettings({ title: { seconds: 4 } }), one).titleFrames, 120);
  const none = buildTimeline(s, resolveSettings({ title: { seconds: 0, background: '#064e3b' } }), one);
  assert.equal(none.titleFrames, 0);
  assert.equal(none.scenes[0]!.from, 0, 'the first scene starts the video');
  assert.equal(none.settings.title.background, '#064e3b');
});
