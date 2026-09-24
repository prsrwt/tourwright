// Camera and highlight as pure functions of the frame number. Shared by the player (in the
// browser) and the tests (in Node), so what is tested is exactly what renders.

import type { Timeline } from '../timing/timeline.ts';
import type { EaseName, Settings } from '../schema/settings.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** What the camera shows: the world point at the centre of the frame, and the scale. */
export interface View {
  cx: number;
  cy: number;
  s: number;
}

export interface HighlightState {
  /** In world coordinates, before padding. */
  rect: Rect;
  opacity: number;
}

export const EASES: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
};

/** A stage's size and its targets' boxes, as measured in one layout. */
export interface StageMeasure {
  world: Size;
  targets: Record<string, Rect | null>;
}

/** Measurements per stage, when a stage has only one layout. */
export interface Measurements {
  [stage: string]: StageMeasure;
}

/**
 * The measurement that holds for a stage at a frame. A stage whose values include steps (a
 * toggle, say) can change layout part-way through, so where things are depends on when.
 */
export type MeasureLookup = (stage: string, frame: number) => StageMeasure | undefined;

export interface FramingOptions {
  zoom: 'fit' | 'width' | number;
  align: 'center' | 'top';
}

/** The whole stage, as large as fits. */
export function viewAll(world: Size, video: Size): View {
  const s = Math.min(video.w / world.w, video.h / world.h);
  return { cx: world.w / 2, cy: world.h / 2, s };
}

/** Frames a target: scale from the zoom mode, clamped to maxZoom, then kept inside the world where possible. */
export function viewFor(target: Rect, options: FramingOptions, world: Size, video: Size, camera: Settings['camera']): View {
  const p = camera.padding;
  const base = video.w / world.w; // zoom 1 shows the full stage width
  let s: number;
  if (options.zoom === 'fit') s = Math.min((video.w - 2 * p) / target.w, (video.h - 2 * p) / target.h);
  else if (options.zoom === 'width') s = (video.w - 2 * p) / target.w;
  else s = options.zoom * base;
  s = Math.min(s, camera.maxZoom * base);
  // Never zoom out past the whole stage: there is nothing to show beyond it.
  s = Math.max(s, viewAll(world, video).s);

  const cx = target.x + target.w / 2;
  const cy = options.align === 'top' ? target.y - p / s + video.h / (2 * s) : target.y + target.h / 2;
  return { cx: clampAxis(cx, world.w, video.w / s), cy: clampAxis(cy, world.h, video.h / s), s };
}

function clampAxis(centre: number, worldLength: number, visibleLength: number): number {
  if (visibleLength >= worldLength) return worldLength / 2;
  return Math.min(Math.max(centre, visibleLength / 2), worldLength - visibleLength / 2);
}

/** World rect to screen rect under a view. */
export function toScreen(rect: Rect, view: View, video: Size): Rect {
  return {
    x: (rect.x - view.cx) * view.s + video.w / 2,
    y: (rect.y - view.cy) * view.s + video.h / 2,
    w: rect.w * view.s,
    h: rect.h * view.s,
  };
}

interface Segment<T> {
  start: number;
  frames: number;
  from: T;
  to: T;
  ease: (t: number) => number;
}

/** A value that moves in segments. Each new segment starts from wherever the value is at its start, so nothing snaps. */
class Track<T> {
  private readonly segments: Segment<T>[] = [];
  private readonly initial: T;
  private readonly lerp: (a: T, b: T, t: number) => T;

  constructor(initial: T, lerp: (a: T, b: T, t: number) => T) {
    this.initial = initial;
    this.lerp = lerp;
  }

  at(frame: number): T {
    let value = this.initial;
    for (const seg of this.segments) {
      if (seg.start > frame) break;
      value = seg.frames <= 0 || frame >= seg.start + seg.frames ? seg.to : this.lerp(seg.from, seg.to, seg.ease((frame - seg.start) / seg.frames));
    }
    return value;
  }

  /** Segments must be added in start order. */
  add(start: number, frames: number, to: T | ((from: T) => T), ease: (t: number) => number): void {
    const from = this.at(start);
    this.segments.push({ start, frames, from, to: typeof to === 'function' ? (to as (from: T) => T)(from) : to, ease });
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Scale changes geometrically, so a zoom from 1x to 4x passes 2x halfway, as the eye expects.
const lerpView = (a: View, b: View, t: number): View => ({ cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), t)) });

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

const lerpHighlight = (a: HighlightState, b: HighlightState, t: number): HighlightState => ({ rect: lerpRect(a.rect, b.rect, t), opacity: lerp(a.opacity, b.opacity, t) });

export interface Motion {
  view(frame: number): View;
  highlight(frame: number): HighlightState;
}

const NONE: HighlightState = { rect: { x: 0, y: 0, w: 0, h: 0 }, opacity: 0 };

/**
 * Builds the camera and highlight tracks. A scene on a different stage from the one before cuts
 * to the whole stage and clears the highlight; a scene on the same stage carries both over.
 * Targets missing from the measurements are skipped here; verify reports them.
 */
export function buildMotion(timeline: Timeline, measured: Measurements | MeasureLookup): Motion {
  const lookup: MeasureLookup = typeof measured === 'function' ? measured : (stage) => measured[stage];
  const video = { w: timeline.layout.width, h: timeline.layout.height };
  const { camera } = timeline.settings;
  const first = timeline.scenes[0];
  const firstWorld = (first && lookup(first.stage, first.from)?.world) || video;
  const views = new Track<View>(viewAll(firstWorld, video), lerpView);
  const highlights = new Track<HighlightState>(NONE, lerpHighlight);
  const outCubic = EASES.outCubic;
  const { slide, fade } = timeline.highlightFrames;

  let stage: string | undefined;
  for (const scene of timeline.scenes) {
    const at = (frame: number) => lookup(scene.stage, frame);
    if (scene.stage !== stage) {
      views.add(scene.from, 0, viewAll(at(scene.from)?.world ?? video, video), EASES.linear);
      highlights.add(scene.from, 0, NONE, EASES.linear);
      stage = scene.stage;
    }
    const beats = [...scene.beats].sort((a, b) => (a.camera?.from ?? a.cue) - (b.camera?.from ?? b.cue));
    for (const beat of beats) {
      if (beat.camera) {
        const c = beat.camera;
        // Framed where the target will be when the camera arrives.
        const m = at(c.from + c.frames);
        const world = m?.world ?? video;
        const rect = c.to === 'all' ? null : m?.targets[c.to];
        if (c.to === 'all' || rect) {
          const to = rect ? viewFor(rect, c, world, video, camera) : viewAll(world, video);
          views.add(c.from, c.frames, to, EASES[c.ease]);
        }
      }
    }
    const lights = [...scene.beats].filter((b) => b.highlight).sort((a, b) => a.highlight!.from - b.highlight!.from);
    for (const beat of lights) {
      const h = beat.highlight!;
      if (h.to === false) {
        highlights.add(h.from, fade, (from) => ({ rect: from.rect, opacity: 0 }), outCubic);
        continue;
      }
      const m = at(h.from + slide);
      const rect = h.to === 'all' ? { x: 0, y: 0, ...(m?.world ?? video) } : m?.targets[h.to];
      if (!rect) continue;
      if (highlights.at(h.from).opacity === 0) {
        // Appearing from nothing: jump to the target invisibly, then fade in place.
        highlights.add(h.from, 0, { rect, opacity: 0 }, EASES.linear);
        highlights.add(h.from, fade, { rect, opacity: 1 }, outCubic);
      } else {
        highlights.add(h.from, slide, { rect, opacity: 1 }, outCubic);
      }
    }
  }

  return { view: (f) => views.at(f), highlight: (f) => highlights.at(f) };
}
