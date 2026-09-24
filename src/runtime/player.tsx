// The player page: renders any frame of a timeline on demand. The stepper (and verify) drive it
// through window.__tour; nothing here reads the wall clock.

import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Timeline } from '../timing/timeline.ts';
import { buildMotion, toScreen, type Motion, type Rect, type StageMeasure, type View } from './motion.ts';
import { stageThrew } from './messages.ts';
import type { Stages, ValueDefinitions } from './stage.ts';
import { buildValues, type StageValues } from './values.ts';

export interface StageReport {
  /** False when the stages file does not register this stage. */
  registered: boolean;
  /** The stage's animatable values, as declared (steps that cannot be sent as JSON become null). */
  values: ValueDefinitions;
  /**
   * The stage measured in each layout it takes, keyed by StageValues.state: one layout unless a
   * steps value (a toggle, say) changes what is on the page.
   */
  states: Record<string, StageMeasure>;
  /** Every target the stage offers: data-focus names and registered selectors. */
  available: string[];
  /** Why a registered selector could not be used. */
  invalid: Record<string, string>;
}

export interface ReadyReport {
  stages: Record<string, StageReport>;
  registered: string[];
  errors: string[];
}

export interface FrameReport {
  frame: number;
  scene: number;
  view: View;
  /** Screen rect of the current highlight, when visible. */
  highlight: Rect | null;
  errors: string[];
}

export interface TourApi {
  start(timeline: Timeline): Promise<ReadyReport>;
  /**
   * Renders a frame. "play" (rendering a video, frame after frame) runs CSS transitions and
   * animations by the frame number; "settle" (a still) shows each one at its end.
   */
  setFrame(frame: number, mode?: AnimationMode): FrameReport;
  /** Screen rect of a target at the current frame, for verify. */
  targetOnScreen(stage: string, target: string): Rect | null;
  /** Smallest rendered font size, in screen pixels, of visible text inside a target at the current frame. */
  minTextSize(stage: string, target: string): number | null;
  /** Screen rect of the burned-in caption at the current frame, when one is showing. */
  captionRect(): Rect | null;
  /** The stage's markup at the current frame, to tell whether animating a value changed anything. */
  stageMarkup(): string;
  /** The stage's visible text at the current frame, and the labels of its controls and headings. */
  stageText(): { text: string; labels: string[] };
  errors: string[];
}

declare global {
  interface Window {
    __tour: TourApi;
  }
}

const FOCUS = 'data-focus';

export type AnimationMode = 'play' | 'settle';

/**
 * CSS transitions and animations run on the browser's own clock, not the frame. Take control of
 * them: pause each one and set its time from the frame number, counted from the frame it started
 * on. A toggle then slides, and a spinner spins, identically on every render. Reading the
 * animations also flushes styles, so a transition triggered by this frame's props exists here.
 */
function syncAnimations(frame: number, mode: AnimationMode, fps: number, starts: WeakMap<Animation, number>): void {
  for (const animation of document.getAnimations()) {
    if (mode === 'settle') {
      try {
        animation.finish();
      } catch {
        // An infinite animation has no end to jump to; show its first frame.
        animation.pause();
        animation.currentTime = 0;
      }
      continue;
    }
    let start = starts.get(animation);
    if (start === undefined) {
      start = frame;
      starts.set(animation, start);
    }
    animation.pause();
    animation.currentTime = ((frame - start) * 1000) / fps;
  }
}

class Boundary extends Component<{ children: ReactNode; stage: string; onError: (message: string) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(stageThrew(this.props.stage, error.message));
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function mountPlayer(stages: Stages): void {
  const errors: string[] = [];
  // A stage renders more than once (measuring, then frames), so the same error can recur.
  const record = (message: string) => {
    if (!errors.includes(message)) errors.push(message);
  };
  window.addEventListener('error', (e) => record(`Uncaught error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => record(`Unhandled promise rejection: ${String((e.reason as Error)?.message ?? e.reason)}`));

  const host = document.getElementById('tourwright-root')!;
  const root: Root = createRoot(host, {
    // The boundary records a clean message naming the stage; React's own log of it would repeat
    // it as a long console error.
    onCaughtError: () => undefined,
    onUncaughtError: (error) => record(`Uncaught error while rendering: ${(error as Error)?.message ?? String(error)}`),
  });
  let timeline: Timeline | undefined;
  let motion: Motion | undefined;
  let values: StageValues | undefined;
  let current = { stage: '', view: { cx: 0, cy: 0, s: 1 } as View };

  const worldEl = () => host.querySelector<HTMLElement>('[data-tour-world]');

  // The frame each CSS transition or animation was first seen on: its time zero.
  const animationStarts = new WeakMap<Animation, number>();

  const draw = (frame: number, mode: AnimationMode = 'settle'): FrameReport => {
    const t = timeline!;
    const video = { w: t.width, h: t.height };
    const sceneIndex = findScene(t, frame);
    const scene = t.scenes[sceneIndex];
    const view = motion!.view(frame);
    const light = motion!.highlight(frame);
    const onScreen = light.opacity > 0 ? pad(toScreen(light.rect, view, video), t.settings.highlight.padding) : null;
    current = { stage: scene?.stage ?? '', view };
    const h = t.settings.highlight;
    flushSync(() =>
      root.render(
        <Frame width={t.width} height={t.height} view={view} stage={scene && <StageView key={scene.stage} stages={stages} name={scene.stage} values={values!.at(scene.stage, frame)} onError={record} />}>
          {onScreen && (
            <div
              style={{
                position: 'absolute',
                left: onScreen.x,
                top: onScreen.y,
                width: onScreen.w,
                height: onScreen.h,
                boxSizing: 'border-box',
                border: `${h.stroke}px solid ${h.color}`,
                borderRadius: h.radius,
                boxShadow: `0 0 0 ${2 * Math.max(t.width, t.height)}px rgba(0, 0, 0, ${h.dim})`,
                opacity: light.opacity,
                pointerEvents: 'none',
              }}
            />
          )}
          {t.settings.captions.mode === 'burned' && <CaptionView timeline={t} frame={frame} />}
          {frame < t.titleFrames && <TitleCard title={t.title} subtitle={t.subtitle} />}
        </Frame>,
      ),
    );
    syncAnimations(frame, mode, t.fps, animationStarts);
    return { frame, scene: sceneIndex, view, highlight: onScreen, errors: [...errors] };
  };

  window.__tour = {
    errors,
    async start(next) {
      timeline = next;
      const definitions: Record<string, ValueDefinitions> = {};
      for (const [name, stage] of Object.entries(stages)) definitions[name] = stage.values ?? {};
      const stageValues = buildValues(next, definitions);
      values = stageValues;
      const report: ReadyReport = { stages: {}, registered: Object.keys(stages), errors };

      // For each stage: the targets it needs, and one frame for each layout it passes through.
      const { slide } = next.highlightFrames;
      const needed = new Map<string, { targets: Set<string>; layouts: Map<string, number> }>();
      for (const scene of next.scenes) {
        const entry = needed.get(scene.stage) ?? { targets: new Set<string>(), layouts: new Map<string, number>() };
        const frames = [scene.from];
        for (const beat of scene.beats) {
          if (beat.camera) frames.push(beat.camera.from + beat.camera.frames);
          if (beat.highlight) frames.push(beat.highlight.from + slide);
          if (beat.animate) frames.push(beat.animate.from + beat.animate.frames);
          if (beat.camera && beat.camera.to !== 'all') entry.targets.add(beat.camera.to);
          if (beat.highlight && beat.highlight.to !== false && beat.highlight.to !== 'all') entry.targets.add(beat.highlight.to);
        }
        for (const frame of frames) {
          const state = stageValues.state(scene.stage, frame);
          if (!entry.layouts.has(state)) entry.layouts.set(state, frame);
        }
        needed.set(scene.stage, entry);
      }

      // Measure each layout once, unscaled, after its fonts and images have loaded. Within one
      // layout nothing moves from frame to frame, so these boxes hold wherever it is shown.
      await document.fonts.ready;
      for (const [name, { targets, layouts }] of needed) {
        const registered = name in stages;
        const selectors = stages[name]?.targets ?? {};
        const stage: StageReport = { registered, values: JSON.parse(JSON.stringify(definitions[name] ?? {})), states: {}, available: [], invalid: {} };
        const available = new Set<string>(Object.keys(selectors));
        for (const [state, frame] of layouts) {
          flushSync(() =>
            root.render(
              <Frame
                width={next.width}
                height={next.height}
                view={{ cx: next.width / 2, cy: next.height / 2, s: 1 }}
                stage={registered && <StageView key={name} stages={stages} name={name} values={stageValues.forLayout(name, frame)} onError={record} />}
              />,
            ),
          );
          const world = worldEl();
          if (!world) throw new Error(`The player lost its frame while rendering stage "${name}". Errors so far: ${errors.join(' | ') || 'none'}`);
          await settle(world);
          for (const [target, selector] of Object.entries(selectors)) {
            try {
              world.querySelector(selector);
            } catch {
              stage.invalid[target] = `"${selector}" is not a valid CSS selector.`;
            }
          }
          for (const el of world.querySelectorAll(`[${FOCUS}]`)) available.add(el.getAttribute(FOCUS)!);
          const boxes: Record<string, Rect | null> = {};
          for (const target of targets) boxes[target] = registered ? measure(world, target, selectors) : null;
          stage.states[state] = { world: { w: world.scrollWidth, h: world.scrollHeight }, targets: boxes };
        }
        stage.available = [...available].sort();
        report.stages[name] = stage;
      }

      motion = buildMotion(next, (stage, frame) => report.stages[stage]?.states[stageValues.state(stage, frame)]);
      return report;
    },
    setFrame: draw,
    targetOnScreen(stage, target) {
      const world = worldEl();
      if (!world || current.stage !== stage) return null;
      const rect = measure(world, target, stages[stage]?.targets ?? {});
      return rect && timeline ? toScreen(rect, current.view, { w: timeline.width, h: timeline.height }) : null;
    },
    stageMarkup() {
      return worldEl()?.innerHTML ?? '';
    },
    stageText() {
      const world = worldEl();
      if (!world) return { text: '', labels: [] };
      const controls = world.querySelectorAll('button, a, label, summary, [role=button], [role=tab], [role=switch], [role=menuitem], h1, h2, h3, h4, th');
      const labels = [...new Set([...controls].map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length <= 60))];
      return { text: world.innerText, labels };
    },
    captionRect() {
      const el = host.querySelector('[data-tour-caption]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    },
    minTextSize(stage, target) {
      const world = worldEl();
      if (!world || current.stage !== stage) return null;
      const elements = select(world, target, stages[stage]?.targets ?? {});
      let smallest: number | null = null;
      for (const el of elements) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || !node.parentElement) continue;
          const style = getComputedStyle(node.parentElement);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          const size = parseFloat(style.fontSize) * current.view.s;
          if (smallest === null || size < smallest) smallest = size;
        }
      }
      return smallest;
    },
  };
}

function Frame({ width, height, view, stage, children }: { width: number; height: number; view: View; stage: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: '#fff' }}>
      <div
        data-tour-world=""
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          transformOrigin: '0 0',
          transform: `translate(${width / 2 - view.cx * view.s}px, ${height / 2 - view.cy * view.s}px) scale(${view.s})`,
        }}
      >
        {stage}
      </div>
      {children}
    </div>
  );
}

function StageView({ stages, name, values, onError }: { stages: Stages; name: string; values: Record<string, unknown>; onError: (message: string) => void }) {
  const stage = stages[name];
  if (!stage) return null;
  // render() must be called inside the boundary, or a stage that throws takes the player down.
  return (
    <Boundary stage={name} onError={onError}>
      <StageContent render={() => stage.render(values)} />
    </Boundary>
  );
}

function StageContent({ render }: { render: () => ReactNode }) {
  return render();
}

/** The current sentence, drawn in screen space so the camera never moves or scales it. */
function CaptionView({ timeline, frame }: { timeline: Timeline; frame: number }) {
  const caption = timeline.captions.find((c) => frame >= c.from && frame < c.to);
  if (!caption) return null;
  const { size, position } = timeline.settings.captions;
  const scale = timeline.height / 1080;
  const margin = Math.round(timeline.height * 0.06);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [position]: margin,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        data-tour-caption=""
        style={{
          maxWidth: '80%',
          padding: `${Math.round(10 * scale)}px ${Math.round(22 * scale)}px`,
          borderRadius: Math.round(12 * scale),
          // Nearly opaque, so nothing behind shows through, with a faint edge that separates it
          // from dark screens as well as light ones.
          background: 'rgba(15, 23, 42, 0.94)',
          border: `${Math.max(1, Math.round(scale))}px solid rgba(255, 255, 255, 0.18)`,
          color: '#fff',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: size * scale,
          lineHeight: 1.35,
          textAlign: 'center',
        }}
      >
        {caption.text}
      </div>
    </div>
  );
}

function TitleCard({ title, subtitle }: { title: string; subtitle: string | undefined }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        background: '#0f172a',
        color: '#fff',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
        padding: '0 10%',
      }}
    >
      <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.1 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 36, opacity: 0.75 }}>{subtitle}</div>}
    </div>
  );
}

function findScene(t: Timeline, frame: number): number {
  for (let i = t.scenes.length - 1; i >= 0; i--) if (frame >= t.scenes[i]!.from) return i;
  return 0;
}

function select(world: HTMLElement, target: string, selectors: Record<string, string>): Element[] {
  const selector = selectors[target] ?? `[${FOCUS}="${CSS.escape(target)}"]`;
  try {
    return [...world.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

/** The box around every element a target matches, in unscaled world coordinates. */
function measure(world: HTMLElement, target: string, selectors: Record<string, string>): Rect | null {
  const origin = world.getBoundingClientRect();
  const scale = origin.width / world.offsetWidth || 1;
  let box: { l: number; t: number; r: number; b: number } | null = null;
  for (const el of select(world, target, selectors)) {
    // display: contents wrappers have no box of their own; measure their children instead.
    const rects = getComputedStyle(el).display === 'contents' ? [...el.children].map((c) => c.getBoundingClientRect()) : [el.getBoundingClientRect()];
    for (const r of rects) {
      if (r.width === 0 && r.height === 0) continue;
      const l = (r.left - origin.left) / scale;
      const t = (r.top - origin.top) / scale;
      const next = { l, t, r: l + r.width / scale, b: t + r.height / scale };
      box = box ? { l: Math.min(box.l, next.l), t: Math.min(box.t, next.t), r: Math.max(box.r, next.r), b: Math.max(box.b, next.b) } : next;
    }
  }
  return box && { x: box.l, y: box.t, w: box.r - box.l, h: box.b - box.t };
}

function pad(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, w: rect.w + 2 * padding, h: rect.h + 2 * padding };
}

/** Waits for fonts and images inside the world, so measurements are final. */
async function settle(world: HTMLElement): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...world.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  await document.fonts.ready;
}
