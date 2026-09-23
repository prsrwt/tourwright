import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration } from '../src/narration/parse.ts';
import { buildMotion, EASES, toScreen, viewAll, viewFor, type Measurements } from '../src/runtime/motion.ts';
import type { Script } from '../src/schema/script.ts';
import { DEFAULT_SETTINGS, resolveSettings } from '../src/schema/settings.ts';
import { buildTimeline, type SentenceAudio } from '../src/timing/timeline.ts';
import { SAMPLE_RATE } from '../src/voice/backend.ts';

const video = { w: 1920, h: 1080 };
const world = { w: 1920, h: 1600 };
const camera = DEFAULT_SETTINGS.camera;

const close = (a: number, b: number, message?: string) => assert.ok(Math.abs(a - b) < 1e-6, message ?? `${a} is not ${b}`);

test('every ease runs from 0 to 1', () => {
  for (const [name, ease] of Object.entries(EASES)) {
    close(ease(0), 0, `${name}(0)`);
    close(ease(1), 1, `${name}(1)`);
  }
});

test('"all" fits the whole stage in frame', () => {
  const v = viewAll(world, video);
  close(v.s, 1080 / 1600);
  assert.deepEqual([v.cx, v.cy], [960, 800]);
});

test('fit, width and a number give the expected scale, clamped to maxZoom', () => {
  const small = { x: 400, y: 300, w: 400, h: 100 };
  const p = camera.padding;
  close(viewFor(small, { zoom: 'fit', align: 'center' }, world, video, { ...camera, maxZoom: 10 }).s, Math.min((1920 - 2 * p) / 400, (1080 - 2 * p) / 100));
  close(viewFor(small, { zoom: 'width', align: 'center' }, world, video, { ...camera, maxZoom: 10 }).s, (1920 - 2 * p) / 400);
  close(viewFor(small, { zoom: 2, align: 'center' }, world, video, camera).s, 2);
  close(viewFor(small, { zoom: 'fit', align: 'center' }, world, video, camera).s, camera.maxZoom);
});

test('the view stays inside the stage where it can, and "top" puts the target at the top', () => {
  const corner = { x: 0, y: 0, w: 200, h: 100 };
  const v = viewFor(corner, { zoom: 2, align: 'center' }, world, video, camera);
  // At 2x the frame shows 960 x 540 of the world, so the centre cannot go above (480, 270).
  assert.deepEqual([v.cx, v.cy], [480, 270]);

  const tall = { x: 100, y: 500, w: 1720, h: 900 };
  const top = viewFor(tall, { zoom: 'width', align: 'top' }, world, video, camera);
  const screen = toScreen(tall, top, video);
  close(screen.y, camera.padding);
  close(screen.x, camera.padding);
});

function timelineWith(scenes: Script['scenes']) {
  const script: Script = { title: 'T', scenes };
  // Three seconds per sentence.
  const audio: SentenceAudio[][] = scenes.map((scene) =>
    parseNarration(scene.say).sentences.map((x) => ({ text: x.text, spoken: x.text, cues: x.cues, file: '', samples: 3 * SAMPLE_RATE })),
  );
  return buildTimeline(script, resolveSettings(undefined), audio);
}

const measured: Measurements = {
  a: { world, targets: { left: { x: 0, y: 0, w: 400, h: 200 }, right: { x: 1500, y: 1400, w: 400, h: 200 } } },
  b: { world: video, targets: {} },
};

test('a camera move eases from where the camera is, and a later move starts mid-flight without a jump', () => {
  const t = timelineWith([
    { stage: 'a', say: 'A. B.', beats: [{ at: 'start', camera: { to: 'left', zoom: 2 } }, { at: 'end', camera: { to: 'right', zoom: 2 } }] },
  ]);
  const m = buildMotion(t, measured);
  const [first, second] = t.scenes[0]!.beats;
  const start = m.view(first!.camera!.from);
  assert.deepEqual(start, viewAll(world, video));
  const arrived = m.view(first!.camera!.from + first!.camera!.frames);
  close(arrived.s, 2);

  const handover = second!.camera!.from;
  const before = m.view(handover - 1);
  const at = m.view(handover);
  const after = m.view(handover + 1);
  assert.ok(Math.abs(at.cx - before.cx) < 50 && Math.abs(after.cx - at.cx) < 50, 'no snap at the handover');
});

test('a cut to another stage resets the camera and clears the highlight; the same stage carries both over', () => {
  const t = timelineWith([
    { stage: 'a', say: 'A.', beats: [{ at: 'start', camera: { to: 'left', zoom: 2 }, highlight: 'left' }] },
    { stage: 'a', say: 'A.' },
    { stage: 'b', say: 'A.' },
  ]);
  const m = buildMotion(t, measured);
  const [one, two, three] = t.scenes;
  const settled = m.view(two!.from - 1);
  close(settled.s, 2);
  assert.deepEqual(m.view(two!.from), settled);
  assert.equal(m.highlight(two!.from).opacity, 1);
  assert.deepEqual(m.view(three!.from), viewAll(video, video));
  assert.equal(m.highlight(three!.from).opacity, 0);
  assert.ok(one);
});

test('a highlight fades in on its target, slides to the next, and fades out in place', () => {
  const t = timelineWith([
    { stage: 'a', say: 'A. [next]B.', beats: [{ at: 'start', highlight: 'left' }, { at: 'next', highlight: 'right' }, { at: 'end', highlight: false }] },
  ]);
  const m = buildMotion(t, measured);
  const { slide, fade } = t.highlightFrames;
  const [appear, move, clear] = t.scenes[0]!.beats;
  const a = appear!.highlight!.from;
  assert.deepEqual(m.highlight(a).rect, measured.a!.targets.left);
  assert.equal(m.highlight(a).opacity, 0);
  assert.equal(m.highlight(a + fade).opacity, 1);

  const b = move!.highlight!.from;
  assert.deepEqual(m.highlight(b).rect, measured.a!.targets.left);
  assert.equal(m.highlight(b + 1).opacity, 1, 'slides without fading');
  assert.deepEqual(m.highlight(b + slide).rect, measured.a!.targets.right);

  const c = clear!.highlight!.from;
  assert.deepEqual(m.highlight(c + fade), { rect: measured.a!.targets.right, opacity: 0 });
});
