// The player page: renders any frame of a timeline on demand. The stepper (and verify) drive it
// through window.__tour; nothing here reads the wall clock.

import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Area } from '../schema/script.ts';
import type { Timeline } from '../timing/timeline.ts';
import { buildMotion, highlightAt, toScreen, type Motion, type Rect, type StageMeasure, type View } from './motion.ts';
import { stageThrew } from './messages.ts';
import { clipText, type ScreenDescription, type ScreenTarget } from './screen.ts';
import { isSteps, type Stages, type ValueDefinitions } from './stage.ts';
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
  /** Every target the stage offers, in any state: data-focus names and registered selectors. */
  available: string[];
  /** The targets on the page in each measured state, keyed like `states`. */
  availableIn: Record<string, string[]>;
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
  /**
   * Everything that decides this frame's pixels: the stage and its values, the camera, the
   * highlight, the caption and the title card. Two frames with the same signature render
   * identically, so a render can reuse the last screenshot. Null while a CSS animation is still
   * moving: such a frame is always captured.
   */
  signature: string | null;
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
  /** Every target of the current stage and where it is on screen, for picking one by clicking. */
  targetsOnScreen(): { name: string; rect: Rect }[];
  /** The stage's text inside an area of the screen at the current frame, in reading order: what a box drawn in Muse points at. */
  textIn(area: Rect): string[];
  /** A box on the screen at the current frame, in the stage's own pixels (where it sits whatever the camera does), with the stage it is on. */
  toStage(rect: Rect): { stage: string; rect: Rect };
  /**
   * What a viewer sees at the current frame, read from the page: how much of the frame each
   * target fills, the highlight and the text inside it, the caption and the stage's values.
   */
  describe(): ScreenDescription;
  errors: string[];
}

declare global {
  interface Window {
    __tour: TourApi;
  }
}

const FOCUS = 'data-focus';
/** Sub-pixel rounding allowance when telling whether a target runs past an edge of the frame. */
const EDGE = 1;

export type AnimationMode = 'play' | 'settle';

/**
 * CSS transitions and animations run on the browser's own clock, not the frame. Take control of
 * them: pause each one and set its time from the frame number, counted from the frame it started
 * on. A toggle then slides, and a spinner spins, identically on every render. Reading the
 * animations also flushes styles, so a transition triggered by this frame's props exists here.
 */
function syncAnimations(frame: number, mode: AnimationMode, fps: number, starts: WeakMap<Animation, number>): boolean {
  // Whether any animation is part way through at this frame, so the frame shows it moving.
  let moving = false;
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
    const time = ((frame - start) * 1000) / fps;
    animation.currentTime = time;
    const end = animation.effect?.getComputedTiming().endTime;
    if (end === undefined || typeof end !== 'number' || !Number.isFinite(end) || time < end) moving = true;
  }
  return moving;
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
  let definitions: Record<string, ValueDefinitions> = {};
  let current = { stage: '', frame: 0, view: { cx: 0, cy: 0, s: 1 } as View };

  const worldEl = () => host.querySelector<HTMLElement>('[data-tour-world]');

  // The frame each CSS transition or animation was first seen on: its time zero.
  const animationStarts = new WeakMap<Animation, number>();

  const draw = (frame: number, mode: AnimationMode = 'settle'): FrameReport => {
    const t = timeline!;
    const video = { w: t.layout.width, h: t.layout.height };
    const sceneIndex = findScene(t, frame);
    const scene = t.scenes[sceneIndex];
    const view = motion!.view(frame);
    const light = motion!.highlight(frame);
    const onScreen = light.opacity > 0 ? pad(toScreen(light.rect, view, video), t.settings.highlight.padding) : null;
    current = { stage: scene?.stage ?? '', frame, view };
    const h = t.settings.highlight;
    flushSync(() =>
      root.render(
        <Frame width={t.layout.width} height={t.layout.height} view={view} stage={scene && <StageView key={scene.stage} stages={stages} name={scene.stage} values={values!.at(scene.stage, frame)} onError={record} />}>
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
                boxShadow: `0 0 0 ${2 * Math.max(t.layout.width, t.layout.height)}px rgba(0, 0, 0, ${h.dim})`,
                opacity: light.opacity,
                pointerEvents: 'none',
              }}
            />
          )}
          {t.settings.captions.mode === 'burned' && <CaptionView timeline={t} frame={frame} />}
          {frame < t.titleFrames && <TitleCard title={t.title} subtitle={t.subtitle} background={t.settings.title.background} color={t.settings.title.color} scale={t.layout.height / 1080} />}
        </Frame>,
      ),
    );
    const moving = syncAnimations(frame, mode, t.fps, animationStarts);
    return { frame, scene: sceneIndex, view, highlight: onScreen, signature: moving ? null : signatureOf(t, frame, scene?.stage, view, light, values!), errors: [...errors] };
  };

  const targetsOnScreen = (): { name: string; rect: Rect }[] => {
    const world = worldEl();
    if (!world || !timeline) return [];
    const selectors = stages[current.stage]?.targets ?? {};
    const areas = areasOn(current.stage);
    const names = new Set([...Object.keys(selectors), ...[...world.querySelectorAll(`[${FOCUS}]`)].map((el) => el.getAttribute(FOCUS)!), ...Object.keys(areas)]);
    const video = { w: timeline.layout.width, h: timeline.layout.height };
    return [...names].flatMap((name) => {
      const rect = measure(world, name, selectors, areas);
      return rect ? [{ name, rect: toScreen(rect, current.view, video) }] : [];
    });
  };

  window.__tour = {
    errors,
    async start(next) {
      timeline = next;
      definitions = {};
      drawnAreas = next.areas ?? {};
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
        const stage: StageReport = { registered, values: JSON.parse(JSON.stringify(definitions[name] ?? {})), states: {}, available: [], availableIn: {}, invalid: {} };
        const available = new Set<string>(Object.keys(selectors));
        for (const [state, frame] of layouts) {
          flushSync(() =>
            root.render(
              <Frame
                width={next.layout.width}
                height={next.layout.height}
                view={{ cx: next.layout.width / 2, cy: next.layout.height / 2, s: 1 }}
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
          // Areas drawn in Muse are there in every state: they are boxes, not elements.
          const here = [...[...world.querySelectorAll(`[${FOCUS}]`)].map((el) => el.getAttribute(FOCUS)!), ...Object.keys(areasOn(name))];
          for (const target of here) available.add(target);
          // Selector targets count only where they match something in this state.
          const matched = Object.keys(selectors).filter((t) => measure(world, t, selectors));
          stage.availableIn[state] = [...new Set([...here, ...matched])].sort();
          const boxes: Record<string, Rect | null> = {};
          for (const target of targets) boxes[target] = registered ? measure(world, target, selectors, areasOn(name)) : null;
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
      const rect = measure(world, target, stages[stage]?.targets ?? {}, areasOn(stage));
      return rect && timeline ? toScreen(rect, current.view, { w: timeline.layout.width, h: timeline.layout.height }) : null;
    },
    stageMarkup() {
      return worldEl()?.innerHTML ?? '';
    },
    targetsOnScreen: () => targetsOnScreen(),
    toStage(rect) {
      const { cx, cy, s: zoom } = current.view;
      const w = timeline?.layout.width ?? 0;
      const h = timeline?.layout.height ?? 0;
      // The inverse of toScreen.
      return { stage: current.stage, rect: { x: (rect.x - w / 2) / zoom + cx, y: (rect.y - h / 2) / zoom + cy, w: rect.w / zoom, h: rect.h / zoom } };
    },
    textIn(area) {
      const world = worldEl();
      if (!world) return [];
      // Client rects include the camera's transform, so relative to the frame they are screen pixels.
      const origin = host.getBoundingClientRect();
      const walker = document.createTreeWalker(world, NodeFilter.SHOW_TEXT);
      const found: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        const cx = r.x - origin.x + r.width / 2;
        const cy = r.y - origin.y + r.height / 2;
        if (r.width && cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h && found.at(-1) !== text) found.push(text);
      }
      return found;
    },
    describe() {
      const t = timeline!;
      const video = { w: t.layout.width, h: t.layout.height };
      const frame = current.frame;
      const title = frame < t.titleFrames;
      const sceneIndex = findScene(t, frame);
      const scene = t.scenes[sceneIndex];
      const sentence = scene?.sentences.find((s) => frame >= s.from && frame < s.from + s.frames);

      const targets: ScreenTarget[] = targetsOnScreen()
        .flatMap(({ name, rect }) => {
          const area = rect.w * rect.h;
          const shown = intersect(rect, { x: 0, y: 0, ...video });
          if (!area || !shown) return [];
          const cut: ScreenTarget['cut'] = [];
          if (rect.y < -EDGE) cut.push('top');
          if (rect.y + rect.h > video.h + EDGE) cut.push('bottom');
          if (rect.x < -EDGE) cut.push('left');
          if (rect.x + rect.w > video.w + EDGE) cut.push('right');
          const inView = shown.w * shown.h;
          return [{ name, share: inView / (video.w * video.h), visible: inView / area, cut }];
        })
        .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

      // The highlight is on a target only while it shows; a faded-out one points at nothing.
      const lit = !title && motion!.highlight(frame).opacity > 0 ? highlightAt(t, frame) : undefined;
      const world = worldEl();
      let highlight: ScreenDescription['highlight'] = null;
      if (lit && world) {
        const elements = lit.target === 'all' ? [world] : select(world, lit.target, stages[current.stage]?.targets ?? {}, areasOn(current.stage));
        highlight = { target: lit.target, text: clipText(visibleText(elements, host)) };
      }

      const caption = t.settings.captions.mode === 'burned' ? t.captions.find((c) => frame >= c.from && frame < c.to)?.text ?? null : null;
      const counting = scene ? values!.counting(scene.stage, frame) : [];
      const now = scene ? values!.at(scene.stage, frame) : {};
      const screenValues = Object.entries(definitions[scene?.stage ?? ''] ?? {}).map(([name, def]) => ({
        name,
        text: isSteps(def) ? stepText(now[name]) : (now[name] as number).toLocaleString('en-GB', { minimumFractionDigits: def.decimals ?? 0, maximumFractionDigits: def.decimals ?? 0 }),
        counting: counting.includes(name),
      }));

      return {
        frame,
        seconds: Math.round((frame / t.fps) * 1000) / 1000,
        title,
        scene: title || !scene ? 'title' : scene.id,
        sceneIndex: title || !scene ? -1 : scene.index,
        stage: current.stage,
        sentence: title ? null : (sentence?.text ?? null),
        targets,
        highlight,
        caption: title ? null : caption,
        values: screenValues,
      };
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
      const elements = select(world, target, stages[stage]?.targets ?? {}, areasOn(stage));
      let smallest: number | null = null;
      for (const el of elements) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || !node.parentElement) continue;
          const style = getComputedStyle(node.parentElement);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          // In video pixels: the camera's scale, then the page's scale up to the video.
          const size = parseFloat(style.fontSize) * current.view.s * (timeline?.layout.scale ?? 1);
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
  // Sizes are given for a 1080-high video; the page is laid out at layout.height.
  const scale = timeline.layout.height / 1080;
  const margin = Math.round(timeline.layout.height * 0.06);
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

function TitleCard({ title, subtitle, background, color, scale }: { title: string; subtitle: string | undefined; background: string; color: string; scale: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24 * scale,
        background,
        color,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
        padding: '0 10%',
      }}
    >
      <div style={{ fontSize: 72 * scale, fontWeight: 600, lineHeight: 1.1 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 36 * scale, opacity: 0.75 }}>{subtitle}</div>}
    </div>
  );
}

/**
 * See FrameReport.signature. Stage values count by what identifies them exactly: a steps value by
 * its step's index (a step can be anything, even a function, which JSON would silently drop) and
 * a number by the number.
 */
function signatureOf(t: Timeline, frame: number, stage: string | undefined, view: View, light: { rect: Rect; opacity: number }, values: StageValues): string {
  const caption = t.settings.captions.mode === 'burned' ? (t.captions.find((c) => frame >= c.from && frame < c.to)?.text ?? null) : null;
  const numbers = stage ? Object.entries(values.at(stage, frame)).filter(([, v]) => typeof v === 'number') : [];
  return JSON.stringify([stage ?? null, stage ? values.state(stage, frame) : '', numbers, view, light.opacity > 0 ? light : 0, caption, frame < t.titleFrames]);
}

function findScene(t: Timeline, frame: number): number {
  for (let i = t.scenes.length - 1; i >= 0; i--) if (frame >= t.scenes[i]!.from) return i;
  return 0;
}

/**
 * Areas drawn in Muse, by name, on the stage they belong to: targets given as a box in world
 * coordinates rather than an element. Set when a timeline starts.
 */
let drawnAreas: Record<string, Area> = {};

/** The drawn areas on one stage, by name. */
function areasOn(stage: string): Record<string, Rect> {
  return Object.fromEntries(Object.entries(drawnAreas).flatMap(([name, a]) => (a.stage === stage ? [[name, { x: a.x, y: a.y, w: a.w, h: a.h }]] : [])));
}

/** The elements with text inside an area: what an area target is made of, for its text and font sizes. */
function inArea(world: HTMLElement, area: Rect): Element[] {
  const origin = world.getBoundingClientRect();
  const scale = origin.width / world.offsetWidth || 1;
  const found = new Set<Element>();
  const walker = document.createTreeWalker(world, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.textContent?.trim() || !el) continue;
    // The text's own box, not its element's: a label's element can be far wider than its words.
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - origin.left) / scale;
    const cy = (r.top + r.height / 2 - origin.top) / scale;
    if (cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h) found.add(el);
  }
  return [...found];
}

function select(world: HTMLElement, target: string, selectors: Record<string, string>, areas: Record<string, Rect> = {}): Element[] {
  if (areas[target]) return inArea(world, areas[target]);
  const selector = selectors[target] ?? `[${FOCUS}="${CSS.escape(target)}"]`;
  try {
    return [...world.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

/** The box around every element a target matches, in unscaled world coordinates. */
function measure(world: HTMLElement, target: string, selectors: Record<string, string>, areas: Record<string, Rect> = {}): Rect | null {
  if (areas[target]) return { ...areas[target] };
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

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * The text inside some elements that is inside the frame. When they are wholly in view that is
 * their innerText; otherwise each text node counts only if part of it is inside the frame.
 */
function visibleText(elements: Element[], host: HTMLElement): string {
  const frame = host.getBoundingClientRect();
  const inside = (r: DOMRect) => r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom;
  const whole = (r: DOMRect) => r.left >= frame.left - EDGE && r.right <= frame.right + EDGE && r.top >= frame.top - EDGE && r.bottom <= frame.bottom + EDGE;
  const parts: string[] = [];
  for (const el of elements) {
    if (whole(el.getBoundingClientRect())) {
      parts.push((el as HTMLElement).innerText);
      continue;
    }
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement) continue;
      const style = getComputedStyle(node.parentElement);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(inside)) parts.push(node.textContent);
    }
  }
  return parts.join(' ');
}

/** A step as text: booleans and numbers as they are, anything else as JSON where it can be. */
function stepText(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object' || value === null) return String(value);
  try {
    return clipText(JSON.stringify(value) ?? String(value), 60);
  } catch {
    return '(not text)';
  }
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
