// The player page: renders any frame of a timeline on demand. The stepper (and verify) drive it
// through window.__tour; nothing here reads the wall clock.

import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Timeline } from '../timing/timeline.ts';
import { buildMotion, toScreen, type Measurements, type Motion, type Rect, type View } from './motion.ts';
import { stageThrew } from './messages.ts';
import type { Stages } from './stage.ts';

export interface StageReport {
  /** False when the stages file does not register this stage. */
  registered: boolean;
  world: { w: number; h: number };
  targets: Record<string, Rect | null>;
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
  setFrame(frame: number): FrameReport;
  /** Screen rect of a target at the current frame, for verify. */
  targetOnScreen(stage: string, target: string): Rect | null;
  /** Smallest rendered font size, in screen pixels, of visible text inside a target at the current frame. */
  minTextSize(stage: string, target: string): number | null;
  errors: string[];
}

declare global {
  interface Window {
    __tour: TourApi;
  }
}

const FOCUS = 'data-focus';

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
  let measured: Measurements = {};
  let current = { stage: '', view: { cx: 0, cy: 0, s: 1 } as View };

  const worldEl = () => host.querySelector<HTMLElement>('[data-tour-world]');

  const draw = (frame: number): FrameReport => {
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
        <Frame width={t.width} height={t.height} view={view} stage={scene && <StageView key={scene.stage} stages={stages} name={scene.stage} onError={record} />}>
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
          {frame < t.titleFrames && <TitleCard title={t.title} subtitle={t.subtitle} />}
        </Frame>,
      ),
    );
    return { frame, scene: sceneIndex, view, highlight: onScreen, errors: [...errors] };
  };

  window.__tour = {
    errors,
    async start(next) {
      timeline = next;
      measured = {};
      const report: ReadyReport = { stages: {}, registered: Object.keys(stages), errors };
      const needed = new Map<string, Set<string>>();
      for (const scene of next.scenes) {
        const names = needed.get(scene.stage) ?? new Set<string>();
        for (const beat of scene.beats) {
          if (beat.camera && beat.camera.to !== 'all') names.add(beat.camera.to);
          if (beat.highlight && beat.highlight.to !== false && beat.highlight.to !== 'all') names.add(beat.highlight.to);
        }
        needed.set(scene.stage, names);
      }

      // Measure each stage once, unscaled, after its fonts and images have loaded. The layout does
      // not change from frame to frame, so these boxes hold for the whole video.
      await document.fonts.ready;
      for (const [name, targets] of needed) {
        const registered = name in stages;
        flushSync(() =>
          root.render(
            <Frame
              width={next.width}
              height={next.height}
              view={{ cx: next.width / 2, cy: next.height / 2, s: 1 }}
              stage={registered && <StageView key={name} stages={stages} name={name} onError={record} />}
            />,
          ),
        );
        const world = worldEl();
        if (!world) throw new Error(`The player lost its frame while rendering stage "${name}". Errors so far: ${errors.join(' | ') || 'none'}`);
        await settle(world);
        const size = { w: world.scrollWidth, h: world.scrollHeight };
        const stage: StageReport = { registered, world: size, targets: {}, available: [], invalid: {} };
        const selectors = stages[name]?.targets ?? {};
        for (const [target, selector] of Object.entries(selectors)) {
          try {
            world.querySelector(selector);
          } catch {
            stage.invalid[target] = `"${selector}" is not a valid CSS selector.`;
          }
        }
        const focus = [...world.querySelectorAll(`[${FOCUS}]`)].map((el) => el.getAttribute(FOCUS)!);
        stage.available = [...new Set([...focus, ...Object.keys(selectors)])].sort();
        for (const target of targets) stage.targets[target] = registered ? measure(world, target, selectors) : null;
        report.stages[name] = stage;
        measured[name] = { world: size, targets: stage.targets };
      }

      motion = buildMotion(next, measured);
      return report;
    },
    setFrame: draw,
    targetOnScreen(stage, target) {
      const world = worldEl();
      if (!world || current.stage !== stage) return null;
      const rect = measure(world, target, stages[stage]?.targets ?? {});
      return rect && timeline ? toScreen(rect, current.view, { w: timeline.width, h: timeline.height }) : null;
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

function StageView({ stages, name, onError }: { stages: Stages; name: string; onError: (message: string) => void }) {
  const stage = stages[name];
  if (!stage) return null;
  // render() must be called inside the boundary, or a stage that throws takes the player down.
  return (
    <Boundary stage={name} onError={onError}>
      <StageContent render={stage.render} />
    </Boundary>
  );
}

function StageContent({ render }: { render: () => ReactNode }) {
  return render();
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
