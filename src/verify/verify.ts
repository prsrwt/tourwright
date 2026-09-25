// An agent cannot watch a video, so every quality worth having becomes a number or an image:
// verify renders the settle frame of every beat, asserts against the live DOM, and writes a
// report, a timing table and one contact sheet of every still.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closest, type Diagnostic } from '../check/diagnostic.ts';
import type { PlayerPage } from '../render/page.ts';
import { isStageThrow } from '../runtime/messages.ts';
import { highlightAt, type Rect } from '../runtime/motion.ts';
import type { ScreenDescription } from '../runtime/screen.ts';
import { sceneSeconds, settleFrame, type TimedBeat, type TimedScene, type Timeline } from '../timing/timeline.ts';
import { contactSheet, imageStats } from './images.ts';
import { pacingDiagnostics } from './pacing.ts';
import { screenMarkdown } from './screen.ts';
import { timingMarkdown } from './timing.ts';
import { namedLabels, normalise } from './words.ts';

/** Screen text smaller than this is hard to read in a compressed 1080p video. */
export const MIN_TEXT_PX = 12;
/** A frame where this share of pixels is one colour shows nothing. */
export const BLANK_SHARE = 0.995;
/** A highlight that is mostly off screen points at nothing the viewer can see. */
export const MIN_HIGHLIGHT_IN_VIEW = 0.5;
/** A caption may clip the edge of a big target, but should not hide much of it. */
export const MAX_CAPTION_COVER = 0.1;
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
  /** SHA-256 of the still, to tell next time whether it changed. */
  hash: string;
  /** Compared with the same still in the last verify: "new" when there was none to compare. */
  change: 'changed' | 'unchanged' | 'new';
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
  files: { report: string; timing: string; screen: string; contactSheet: string; stills: string };
}

interface Shot {
  scene: TimedScene;
  beat?: TimedBeat;
  cue: string;
  frame: number;
  /** The moment an animation starts, shown beside its settled still so the range is visible. */
  before?: boolean;
}

export async function verifyWalkthrough(name: string, timeline: Timeline, player: PlayerPage, outDir: string, preflight: Diagnostic[]): Promise<VerifyReport> {
  const stillsDir = join(outDir, 'stills');
  // The last verify's stills, by label, so this one can say what changed: an agent then looks
  // only at those rather than at every still again.
  const previous = previousStills(join(outDir, 'report.json'));
  rmSync(stillsDir, { recursive: true, force: true });
  mkdirSync(stillsDir, { recursive: true });

  const shots: Shot[] = [];
  for (const scene of timeline.scenes) {
    for (const beat of scene.beats) {
      if (beat.animate) shots.push({ scene, beat, cue: `${beat.at}-before`, frame: beat.animate.from, before: true });
      shots.push({ scene, beat, cue: beat.at, frame: settleFrame(timeline, scene, beat) });
    }
    // A scene with no beats still gets a still, halfway through, so every scene is seen.
    if (scene.beats.length === 0) shots.push({ scene, cue: 'hold', frame: scene.from + Math.floor(scene.frames / 2) });
  }

  // Screen rects are in the page's CSS pixels; screenshots are in video pixels.
  const video = { w: timeline.layout.width, h: timeline.layout.height };
  const stills: Still[] = [];
  const images: Buffer[] = [];
  // Where the caption sits in each still, so the blank check judges the stage, not the caption.
  const masks: (Rect | null)[] = [];
  const pixelMasks: (Rect | null)[] = [];
  const beforeMarkup = new Map<TimedBeat, string>();
  const screens: { label: string; screen: ScreenDescription }[] = [];
  for (const shot of shots) {
    const at = `scenes[${shot.scene.index}]`;
    const diagnostics: Diagnostic[] = [];
    const frameReport = await player.page.evaluate((f) => window.__tour.setFrame(f), shot.frame);
    const png = await player.page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    const label = `${shot.scene.id}-${shot.cue}`;
    screens.push({ label, screen: await player.page.evaluate(() => window.__tour.describe()) });
    const file = join(stillsDir, `${label}.png`);
    writeFileSync(file, png);
    const hash = createHash('sha256').update(png).digest('hex');
    const change = !previous ? 'new' : previous.get(label) === hash ? 'unchanged' : 'changed';
    images.push(png);
    masks.push(await player.page.evaluate(() => window.__tour.captionRect()));
    const k = timeline.layout.scale;
    const caption = masks[masks.length - 1];
    const pixelMask = caption ? { x: caption.x * k, y: caption.y * k, w: caption.w * k, h: caption.h * k } : null;
    pixelMasks.push(pixelMask);

    if (shot.beat?.animate) {
      const markup = await player.page.evaluate(() => window.__tour.stageMarkup());
      if (shot.before) {
        beforeMarkup.set(shot.beat, markup);
      } else if (beforeMarkup.get(shot.beat) === markup) {
        diagnostics.push({
          level: 'warning',
          path: `${at}.beats[${shot.beat.index}].animate`,
          message: `Animating ${shot.beat.animate.values.map((v) => `"${v}"`).join(', ')} changed nothing on the page: the stage looks the same before and after.`,
          fix: 'pass the value to the prop the component actually draws from. If the component works the figure out from other props, animate those instead.',
        });
      }
    }
    if (shot.before) {
      stills.push({ file, label, scene: shot.scene.id, cue: shot.cue, frame: shot.frame, time: sceneSeconds(timeline, shot.scene, shot.frame), hash, change, diagnostics });
      continue;
    }

    // A highlight left on while the camera moved elsewhere: it outlines something mostly out of view.
    const lit = frameReport.highlight;
    if (lit && !shot.before) {
      const shown = visibleShare(lit, video);
      if (shown < MIN_HIGHLIGHT_IN_VIEW) {
        const on = highlightAt(timeline, shot.frame);
        diagnostics.push({
          level: 'warning',
          path: on ? `scenes[${on.scene}].beats[${on.beat}].highlight` : at,
          message: `In still ${label}, the highlight${on ? ` on "${on.target}"` : ''} is still on but only ${Math.round(shown * 100)}% of it is in view: the camera has moved on without it.`,
          fix: 'clear the highlight ({ "highlight": false }) or move it, in the beat that moves the camera away.',
        });
      }
    }

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
      const covered = caption && overlap(rect, caption);
      if (covered && covered > MAX_CAPTION_COVER) {
        diagnostics.push({
          level: 'warning',
          path,
          message: `In still ${label}, the caption covers ${Math.round(covered * 100)}% of target "${target}".`,
          fix: captionFixes(rect, caption!, video, timeline.settings.captions, target),
        });
      }
      const text = await player.page.evaluate(([s, t]) => window.__tour.minTextSize(s, t), [shot.scene.stage, target] as const);
      if (text !== null && text < MIN_TEXT_PX) {
        diagnostics.push({
          level: 'warning',
          path,
          message: `In still ${label}, the smallest text in "${target}" renders at ${text.toFixed(1)} px, below ${MIN_TEXT_PX} px, which is hard to read in a video.`,
          fix:
            timeline.layout.scale === 1 && timeline.layout.width >= 1600
              ? `the page is laid out ${timeline.layout.width} pixels wide, wider than most apps are used at, so their small text renders smaller than in use. Set "settings": { "video": { "layoutWidth": 1280 } }, or zoom in on "${target}".`
              : `zoom in on "${target}", or on a smaller part of it.`,
        });
      }
    }

    stills.push({ file, label, scene: shot.scene.id, cue: shot.cue, frame: shot.frame, time: sceneSeconds(timeline, shot.scene, shot.frame), hash, change, diagnostics });
  }

  // Labels the narration names must be on screen, spelt the same, while the sentence is spoken.
  const wordDiagnostics: Diagnostic[] = [];
  for (const scene of timeline.scenes) {
    for (const sentence of scene.sentences) {
      const labels = namedLabels(sentence.text);
      if (!labels.length) continue;
      await player.page.evaluate((f) => window.__tour.setFrame(f), sentence.from + Math.floor(sentence.frames / 2));
      const screen = await player.page.evaluate(() => window.__tour.stageText());
      const visible = normalise(screen.text);
      for (const label of labels) {
        if (visible.includes(normalise(label))) continue;
        const guess = closest(label, screen.labels);
        wordDiagnostics.push({
          level: 'warning',
          path: `scenes[${scene.index}].say`,
          message: `The narration names "${label}", but no such text is on screen while it is said: "${sentence.text}". Viewers match what they hear to what they see.`,
          fix: guess ? `say "${guess}", as the screen does, or check that the fixtures render "${label}".` : `use the words on the screen, or check that the fixtures render "${label}".`,
        });
      }
    }
  }

  // Errors the player caught itself (clean, one per stage) plus anything the console saw.
  const inPage = await player.page.evaluate(() => [...window.__tour.errors]);
  const pageMessages = [...new Set([...inPage, ...player.errors])];
  // A stage that is missing or threw is already an error; a blank still of it adds nothing.
  const failed = (stage: string) => player.ready.stages[stage]?.registered === false || pageMessages.some((m) => isStageThrow(m, stage));

  // Pixel checks run on a separate page, so they cannot disturb the player.
  const browser = player.page.context().browser()!;
  const stats = await imageStats(browser, images, pixelMasks);
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

  const diagnostics = [...preflight, ...pageErrors, ...pacingDiagnostics(timeline), ...wordDiagnostics, ...stills.flatMap((s) => s.diagnostics)];
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const files = {
    report: join(outDir, 'report.json'),
    timing: join(outDir, 'timing.md'),
    screen: join(outDir, 'screen.md'),
    contactSheet: join(outDir, 'contact-sheet.png'),
    stills: stillsDir,
  };
  writeFileSync(files.contactSheet, await contactSheet(browser, images, stills.map((s) => `${s.label}  ${s.time.toFixed(1)} s`)));
  writeFileSync(files.timing, timingMarkdown(name, timeline));
  writeFileSync(files.screen, screenMarkdown(name, screens.map((s, i) => ({ ...s, change: stills[i]!.change }))));
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

/**
 * Only the fixes that can work for this target: framing it higher needs room above the caption,
 * moving captions to the top needs the target clear of the top, and smaller captions always help.
 */
function captionFixes(target: Rect, caption: Rect, frame: { w: number; h: number }, captions: Timeline['settings']['captions'], name: string): string {
  const fixes: string[] = [];
  const room = captions.position === 'bottom' ? caption.y : frame.h - (caption.y + caption.h);
  if (target.h < room) fixes.push(`frame "${name}" so it sits clear of the caption, for example with "align": "top"`);
  else fixes.push(`zoom out a little, since "${name}" is taller than the space the caption leaves`);
  const otherEdge = captions.position === 'bottom' ? target.y > frame.h * 0.25 : target.y + target.h < frame.h * 0.75;
  if (otherEdge) fixes.push(`move captions to the ${captions.position === 'bottom' ? 'top' : 'bottom'} with "settings": { "captions": { "position": "${captions.position === 'bottom' ? 'top' : 'bottom'}" } }, but check other stills do not then clash`);
  fixes.push(`make captions smaller with "settings": { "captions": { "size": ${Math.max(24, captions.size - 8)} } }`);
  return `${fixes.join('; or ')}.`;
}

/** How much of a rect, from 0 to 1, is inside the frame. */
function visibleShare(rect: Rect, frame: { w: number; h: number }): number {
  return overlap(rect, { x: 0, y: 0, w: frame.w, h: frame.h });
}

/** Each still's hash from the last verify's report, by label; undefined when there is none. */
function previousStills(file: string): Map<string, string> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const report = JSON.parse(readFileSync(file, 'utf8')) as { stills?: { label?: string; hash?: string }[] };
    // A report from before stills had hashes has nothing to compare with.
    if (!report.stills?.every((s) => s.label && s.hash)) return undefined;
    return new Map(report.stills.map((s) => [s.label!, s.hash!]));
  } catch {
    return undefined;
  }
}

/** The share of `target`'s area, from 0 to 1, that `cover` hides. */
export function overlap(target: Rect, cover: Rect): number {
  const w = Math.min(target.x + target.w, cover.x + cover.w) - Math.max(target.x, cover.x);
  const h = Math.min(target.y + target.h, cover.y + cover.h) - Math.max(target.y, cover.y);
  return w > 0 && h > 0 && target.w * target.h > 0 ? (w * h) / (target.w * target.h) : 0;
}

function outside(rect: Rect, video: { w: number; h: number }): string | undefined {
  const parts: string[] = [];
  if (rect.x < -EDGE_TOLERANCE) parts.push(`${Math.round(-rect.x)} px past the left edge`);
  if (rect.y < -EDGE_TOLERANCE) parts.push(`${Math.round(-rect.y)} px past the top edge`);
  if (rect.x + rect.w > video.w + EDGE_TOLERANCE) parts.push(`${Math.round(rect.x + rect.w - video.w)} px past the right edge`);
  if (rect.y + rect.h > video.h + EDGE_TOLERANCE) parts.push(`${Math.round(rect.y + rect.h - video.h)} px past the bottom edge`);
  return parts.length ? parts.join(', ') : undefined;
}
