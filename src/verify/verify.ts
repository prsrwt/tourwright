// An agent cannot watch a video, so every quality worth having becomes a number or an image:
// verify renders the settle frame of every beat, asserts against the live DOM, and writes a
// report, a timing table and one contact sheet of every still.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '../check/diagnostic.ts';
import type { PlayerPage } from '../render/page.ts';
import { isStageThrow } from '../runtime/messages.ts';
import type { Rect } from '../runtime/motion.ts';
import { sceneSeconds, settleFrame, type TimedBeat, type TimedScene, type Timeline } from '../timing/timeline.ts';
import { contactSheet, imageStats } from './images.ts';
import { timingMarkdown } from './timing.ts';

/** Screen text smaller than this is hard to read in a compressed 1080p video. */
export const MIN_TEXT_PX = 12;
/** A frame where this share of pixels is one colour shows nothing. */
export const BLANK_SHARE = 0.995;
/** Sub-pixel rounding allowance when checking that a target is inside the frame. */
const EDGE_TOLERANCE = 1;

export interface Still {
  file: string;
  label: string;
  scene: string;
  cue: string;
  frame: number;
  /** Seconds from the start of the scene. */
  time: number;
  diagnostics: Diagnostic[];
}

export interface VerifyReport {
  name: string;
  ok: boolean;
  frames: number;
  fps: number;
  seconds: number;
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
  stills: Still[];
  files: { report: string; timing: string; contactSheet: string; stills: string };
}

interface Shot {
  scene: TimedScene;
  beat?: TimedBeat;
  cue: string;
  frame: number;
}

export async function verifyWalkthrough(name: string, timeline: Timeline, player: PlayerPage, outDir: string, preflight: Diagnostic[]): Promise<VerifyReport> {
  const stillsDir = join(outDir, 'stills');
  rmSync(stillsDir, { recursive: true, force: true });
  mkdirSync(stillsDir, { recursive: true });

  const shots: Shot[] = [];
  for (const scene of timeline.scenes) {
    for (const beat of scene.beats) shots.push({ scene, beat, cue: beat.at, frame: settleFrame(timeline, scene, beat) });
    // A scene with no beats still gets a still, halfway through, so every scene is seen.
    if (scene.beats.length === 0) shots.push({ scene, cue: 'hold', frame: scene.from + Math.floor(scene.frames / 2) });
  }

  const video = { w: timeline.width, h: timeline.height };
  const stills: Still[] = [];
  const images: Buffer[] = [];
  for (const shot of shots) {
    const at = `scenes[${shot.scene.index}]`;
    const diagnostics: Diagnostic[] = [];
    await player.page.evaluate((f) => window.__tour.setFrame(f), shot.frame);
    const png = await player.page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    const label = `${shot.scene.id}-${shot.cue}`;
    const file = join(stillsDir, `${label}.png`);
    writeFileSync(file, png);
    images.push(png);

    const targets = new Map<string, string>();
    if (shot.beat?.camera && shot.beat.camera.to !== 'all') targets.set(shot.beat.camera.to, `${at}.beats[${shot.beat.index}].camera.to`);
    if (shot.beat?.highlight?.to && shot.beat.highlight.to !== 'all') targets.set(shot.beat.highlight.to, `${at}.beats[${shot.beat.index}].highlight`);
    for (const [target, path] of targets) {
      const rect = await player.page.evaluate(([s, t]) => window.__tour.targetOnScreen(s, t), [shot.scene.stage, target] as const);
      if (!rect) continue; // Missing targets were reported before any still was taken.
      const cut = outside(rect, video);
      if (cut) {
        diagnostics.push({
          level: 'error',
          path,
          message: `In still ${label}, target "${target}" is cut off by the frame: ${cut}.`,
          fix: shot.beat?.camera?.to === target
            ? 'use "zoom": "fit", or a smaller zoom number, so the whole target fits.'
            : `move the camera to "${target}" (or something that contains it) before highlighting it.`,
        });
      }
      const text = await player.page.evaluate(([s, t]) => window.__tour.minTextSize(s, t), [shot.scene.stage, target] as const);
      if (text !== null && text < MIN_TEXT_PX) {
        diagnostics.push({
          level: 'warning',
          path,
          message: `In still ${label}, the smallest text in "${target}" renders at ${text.toFixed(1)} px, below ${MIN_TEXT_PX} px, which is hard to read in a video.`,
          fix: `zoom in on "${target}", or on a smaller part of it.`,
        });
      }
    }

    stills.push({ file, label, scene: shot.scene.id, cue: shot.cue, frame: shot.frame, time: sceneSeconds(timeline, shot.scene, shot.frame), diagnostics });
  }

  // Errors the player caught itself (clean, one per stage) plus anything the console saw.
  const inPage = await player.page.evaluate(() => [...window.__tour.errors]);
  const pageMessages = [...new Set([...inPage, ...player.errors])];
  // A stage that is missing or threw is already an error; a blank still of it adds nothing.
  const failed = (stage: string) => player.ready.stages[stage]?.registered === false || pageMessages.some((m) => isStageThrow(m, stage));

  // Pixel checks run on a separate page, so they cannot disturb the player.
  const browser = player.page.context().browser()!;
  const stats = await imageStats(browser, images);
  stats.forEach((s, i) => {
    const still = stills[i]!;
    if (s.dominantShare >= BLANK_SHARE && !failed(shots[i]!.scene.stage)) {
      still.diagnostics.push({
        level: 'error',
        path: `scenes[${shots[i]!.scene.index}]`,
        message: `Still ${still.label} is blank: ${(s.dominantShare * 100).toFixed(1)}% of the frame is one colour.`,
        fix: 'check that the stage renders its components with fixtures, and that the camera is not framing empty space.',
      });
    }
  });

  const pageErrors: Diagnostic[] = pageMessages.map((message) => ({
    level: 'error',
    path: '(stage)',
    message,
    fix: 'fix the error in the stage or the component. Stages must render without console errors.',
  }));

  const diagnostics = [...preflight, ...pageErrors, ...stills.flatMap((s) => s.diagnostics)];
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const files = {
    report: join(outDir, 'report.json'),
    timing: join(outDir, 'timing.md'),
    contactSheet: join(outDir, 'contact-sheet.png'),
    stills: stillsDir,
  };
  writeFileSync(files.contactSheet, await contactSheet(browser, images, stills.map((s) => `${s.label}  ${s.time.toFixed(1)} s`)));
  writeFileSync(files.timing, timingMarkdown(name, timeline));
  const report: VerifyReport = {
    name,
    ok: errors === 0,
    frames: timeline.frames,
    fps: timeline.fps,
    seconds: timeline.frames / timeline.fps,
    errors,
    warnings: diagnostics.length - errors,
    diagnostics,
    stills,
    files,
  };
  writeFileSync(files.report, JSON.stringify(report, null, 2) + '\n');
  return report;
}

function outside(rect: Rect, video: { w: number; h: number }): string | undefined {
  const parts: string[] = [];
  if (rect.x < -EDGE_TOLERANCE) parts.push(`${Math.round(-rect.x)} px past the left edge`);
  if (rect.y < -EDGE_TOLERANCE) parts.push(`${Math.round(-rect.y)} px past the top edge`);
  if (rect.x + rect.w > video.w + EDGE_TOLERANCE) parts.push(`${Math.round(rect.x + rect.w - video.w)} px past the right edge`);
  if (rect.y + rect.h > video.h + EDGE_TOLERANCE) parts.push(`${Math.round(rect.y + rect.h - video.h)} px past the bottom edge`);
  return parts.length ? parts.join(', ') : undefined;
}
