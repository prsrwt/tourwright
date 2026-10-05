// Captures what the "muse-tour" stages show inside Muse: the "welcome" walkthrough's timeline, a
// frame of that video as each beat settles (drawn by Tourwright's own player, narration box and
// caption included), the targets on screen in each, and a note's snippet cut from one of them.
// Run it again after changing "welcome": node tourwright/muse-tour/capture.mts (from examples/next-app).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../../../../src/config/config.ts';
import { prepare } from '../../../../src/pipeline/prepare.ts';
import { openSession } from '../../../../src/pipeline/session.ts';
import type { Rect } from '../../../../src/runtime/motion.ts';

const here = import.meta.dirname;
const config = await loadConfig(process.cwd(), { ...process.env, TOURWRIGHT_VOICE: 'fake' });
const prepared = await prepare(config, 'welcome', { log: () => undefined });
const { timeline } = prepared;
// Muse only reads the sentences' text and timing: the cached audio's paths are this machine's.
for (const scene of timeline.scenes) for (const sentence of scene.sentences) sentence.file = '';
writeFileSync(join(here, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');

// The frames: the title card, then each beat once it has settled, as Muse's Scenes tab seeks to.
const settle = (sceneIndex: number, beatIndex: number) => {
  const scene = timeline.scenes[sceneIndex]!;
  const beat = scene.beats[beatIndex]!;
  let f = beat.cue;
  if (beat.camera) f = Math.max(f, beat.camera.from + beat.camera.frames);
  if (beat.highlight) f = Math.max(f, beat.highlight.from + Math.max(timeline.highlightFrames.slide, timeline.highlightFrames.fade));
  if (beat.animate) f = Math.max(f, beat.animate.from + beat.animate.frames);
  return Math.min(f, scene.from + scene.frames - 1);
};
const shots = [{ label: 'title', frame: Math.round(timeline.titleFrames / 2) }, ...timeline.scenes.flatMap((s) => s.beats.map((b) => ({ label: `${s.id}-${b.at}`, frame: settle(s.index, b.index) })))];

const session = await openSession(config, prepared, () => undefined);
const { page } = session.player;
const frames: { label: string; frame: number; file: string; targets: { name: string; rect: Rect }[] }[] = [];
let tom: { rect: Rect; text: string[] } | undefined;
for (const shot of shots) {
  await page.evaluate((f) => window.__tour.setFrame(f, 'settle'), shot.frame);
  const file = `${shot.label}.jpg`;
  await page.screenshot({ path: join(here, 'frames', file), type: 'jpeg', quality: 88 });
  const targets = await page.evaluate(() => window.__tour.targetsOnScreen());
  frames.push({ ...shot, file, targets });
  // Tom's row on the Team page, which has no target of its own: the box a reviewer draws around it.
  if (shot.label === 'people-load') {
    tom = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="member-tom"]')!.getBoundingClientRect();
      const rect = { x: Math.round(r.x - 8), y: Math.round(r.y - 6), w: Math.round(r.width + 16), h: Math.round(r.height + 12) };
      return { rect, text: window.__tour.textIn(rect) };
    });
    const scale = timeline.layout.scale;
    await sharp(join(here, 'frames', file))
      .extract({ left: Math.round(tom.rect.x * scale), top: Math.round(tom.rect.y * scale), width: Math.round(tom.rect.w * scale), height: Math.round(tom.rect.h * scale) })
      .png()
      .toFile(join(here, 'snippet.png'));
  }
}
// What Muse's Scenes tab needs from the player: each stage's targets and values.
const stages = Object.fromEntries(Object.entries(session.player.ready.stages).filter(([name]) => timeline.scenes.some((s) => s.stage === name)).map(([name, report]) => [name, { available: report.available, values: report.values }]));
await session.close();
writeFileSync(join(here, 'frames.json'), JSON.stringify({ frames, tom, stages }, null, 2) + '\n');
console.log(`Wrote timeline.json, frames.json, snippet.png and ${frames.length} frames.`);
