// Muse, for the intro video: Muse's own components (its top bar, transport, narration box track,
// notes and render dialog) given sample state, the way a stage gives any app's components fixtures.
// The video area shows this app's dashboard where Muse would show the player, so the page on screen
// is Muse as it is, not a drawing of it.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { segments, type Segment } from '../../../../src/studio/boxes.ts';
import type { Note, StudioState } from '../../../../src/studio/protocol.ts';
import type { Timeline } from '../../../../src/timing/timeline.ts';
import { Header, Notes, Transport } from '../../../../src/runtime/studio.tsx';
import { dashboard } from '../fixtures';
import timelineJson from './muse-timeline.json';

const timeline = timelineJson as unknown as Timeline;
const snippet = new URL('./snippet.png', import.meta.url).href;

/** Where the reviewer is, in order: each beat of the video that animates "muse" moves on one step. */
export const MUSE_STEPS = ['watch', 'writing', 'noted', 'boxed', 'box-added', 'box-dragged', 'sent', 'fixed', 'approve', 'dialog', 'rendering', 'ready'] as const;
export type MuseStep = (typeof MUSE_STEPS)[number];

/** The video Muse plays, and the stage's page: 1920 by 1080. */
const VIDEO = 1920;
/**
 * Muse's window, as a browser window it is often used in, scaled up to fill the frame: at the
 * page's full width its 12 to 14 px text would come out too small to read in a video.
 */
const WINDOW = { width: 1440, height: 810 };
const ZOOM = VIDEO / WINDOW.width;
const PANEL = 400;
const PLAYER = WINDOW.width - PANEL - 32;
const SCALE = PLAYER / VIDEO;

const created = '2026-09-25T10:00:00.000Z';
const overdueNote: Note = {
  id: 'a1',
  ms: 13500,
  frame: 405,
  scene: 'stats',
  sceneIndex: 1,
  sentence: 'Overdue tasks are the ones to look at first.',
  text: 'Zoom in closer on the overdue card.',
  scope: 'moment',
  target: 'stat-overdue',
  status: 'open',
  replies: [],
  created,
};
const statusNote: Note = {
  id: 'b2',
  ms: 21500,
  frame: 645,
  scene: 'tasks',
  sceneIndex: 2,
  sentence: 'The status shows where each one stands.',
  text: 'Give the status column its own narration box.',
  scope: 'moment',
  rect: { x: 1180, y: 225, w: 230, h: 250 },
  areaText: ['Status', 'In progress', 'To do', 'Done', 'To do'],
  snippet,
  status: 'open',
  replies: [],
  created,
};

const at = (step: MuseStep, from: MuseStep) => MUSE_STEPS.indexOf(step) >= MUSE_STEPS.indexOf(from);

/** Muse's state at each step: what its server would send the page. */
function museState(step: MuseStep, rendered: number): StudioState {
  const base: StudioState = {
    name: 'intro',
    version: 1,
    timelineVersion: 1,
    stageVersion: 1,
    scriptHash: 'v2',
    script: undefined,
    timeline,
    diagnostics: [],
    preparing: false,
    notes: [],
    reviewChanged: [],
    final: { ready: false, why: 'There is no video yet', file: 'tourwright/out/intro.mp4' },
  };
  const fixed = (note: Note, reply: string): Note => ({ ...note, status: 'fixed', replies: [{ from: 'agent', text: reply, at: created }] });
  if (!at(step, 'noted')) return base;
  if (!at(step, 'boxed')) return { ...base, notes: [overdueNote] };
  if (!at(step, 'sent')) return { ...base, notes: [overdueNote, statusNote] };
  const sent = { status: 'changes-requested' as const, scriptHash: 'v2', at: created, notes: ['a1', 'b2'] };
  if (!at(step, 'fixed')) return { ...base, notes: [overdueNote, statusNote], review: sent };
  // The agent has made its changes: a new version, each note marked fixed with what it did.
  const agentFixes = [fixed(overdueNote, 'The camera now zooms in to twice the size on the overdue card.'), fixed(statusNote, 'Added a narration box on the status column, from "The status shows" to the end.')];
  if (!at(step, 'approve')) return { ...base, scriptHash: 'v3', notes: agentFixes, review: { ...sent, scriptHash: 'v2' } };
  // The first fix approved, the second still to check: that is what the render dialog lists.
  const checked = [{ ...agentFixes[0]!, status: 'closed' as const }, agentFixes[1]!];
  if (!at(step, 'dialog')) return { ...base, scriptHash: 'v3', notes: checked, review: { ...sent, scriptHash: 'v2' } };
  const approved = { status: 'approved' as const, scriptHash: 'v3', at: created };
  if (!at(step, 'rendering')) return { ...base, scriptHash: 'v3', notes: checked, review: approved, renderOffer: 'pending' };
  const job = { status: 'running' as const, step: 'Rendering', percent: Math.round(rendered), started: created };
  if (!at(step, 'ready')) return { ...base, scriptHash: 'v3', notes: checked, review: approved, render: job };
  return { ...base, scriptHash: 'v3', notes: checked, review: approved, render: { ...job, status: 'done', percent: 100 }, final: { ready: true, file: 'tourwright/out/intro.mp4' } };
}

/** The narration boxes on the track, with the one the reviewer adds and then drags longer. */
function boxes(step: MuseStep): Segment[] {
  const all = segments(timeline);
  if (!at(step, 'box-added')) return all;
  const overview = timeline.scenes[0]!;
  const added: Segment = { target: 'team-name', scene: 0, beat: 99, from: overview.from, to: overview.sentences[1]!.from, start: 0, end: 1, carries: false };
  const box = at(step, 'box-dragged') ? { ...added, to: overview.from + overview.frames, end: 2 } : added;
  return [box, ...all];
}

const noop = () => undefined;

export function MuseStage({ step, playhead, rendered }: { step: MuseStep; playhead: number; rendered: number }) {
  const state = museState(step, rendered);
  const frame = Math.round(playhead);
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = step === 'writing' ? { text: 'Zoom in closer on the overdue card.', attached: { target: 'stat-overdue', rect: { x: 1296, y: 150, w: 590, h: 130 }, text: ['Overdue', '2', 'needs attention'] } } : undefined;
  return (
    // Page below Muse's window, so the camera can lift the transport clear of the captions.
    <div style={{ width: VIDEO, height: 1080 + 360, background: '#FBF8F6' }}>
    {/* Muse's page: its colours and type, as the page it is served in sets them. */}
    <div data-focus="muse-window" style={{ width: WINDOW.width, height: WINDOW.height, transform: `scale(${ZOOM})`, transformOrigin: '0 0', display: 'flex', flexDirection: 'column', background: '#FBF8F6', color: '#1F2328', font: '14px/1.4 ui-sans-serif, system-ui, sans-serif' }}>
      <div data-focus="muse-header">
        <Header state={state} message={undefined} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${PANEL}px` }}>
        <main style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          <div data-focus="player" style={{ position: 'relative', width: PLAYER, height: 1080 * SCALE, overflow: 'hidden', borderRadius: 8, background: '#0F172A' }}>
            <div style={{ width: VIDEO, height: 1080, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
              <VideoFrame drawn={at(step, 'boxed') && !at(step, 'box-added')} />
            </div>
          </div>
          <div data-focus="transport">
            <Transport
              timeline={timeline}
              frame={frame}
              playing={step === 'watch'}
              speed={1}
              loop={false}
              help={false}
              onToggle={noop}
              onSeek={noop}
              onJump={noop}
              onSpeed={noop}
              onLoop={noop}
              onNote={noop}
              onHelp={noop}
              boxes={boxes(step)}
              onAddBox={noop}
              onMoveBox={noop}
              onDeleteBox={noop}
            />
          </div>
        </main>
        <aside data-focus="notes" style={{ background: '#FFFFFF', borderLeft: '1px solid #ECE4DF', padding: 16, overflow: 'hidden' }}>
          {/* Keyed by step, so the note being written starts afresh at each one. */}
          <Notes key={step} state={state} timeline={timeline} api={undefined} frame={frame} audio={audio} inputRef={input} filter="all" onFilter={noop} onSeek={noop} onPick={noop} onWrite={noop} draft={draft} />
        </aside>
      </div>
    </div>
    </div>
  );
}

/**
 * What the player shows: the intro video's frame as the reviewer paused it, on the overdue card,
 * with its narration box and caption. With `drawn`, the box a reviewer drew around the status column.
 */
function VideoFrame({ drawn }: { drawn: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState<{ left: number; top: number; width: number; height: number }>();
  // The drawn box goes around the status column wherever the table lays it out.
  useLayoutEffect(() => {
    const root = frame.current;
    if (!root || !drawn) return setColumn(undefined);
    const cells = [...root.querySelectorAll('[data-testid^="status-"]')].map((el) => el.getBoundingClientRect());
    if (!cells.length) return;
    const origin = root.getBoundingClientRect();
    const scale = origin.width / VIDEO;
    const left = Math.min(...cells.map((r) => r.left));
    const right = Math.max(...cells.map((r) => r.right));
    const top = Math.min(...cells.map((r) => r.top));
    const bottom = Math.max(...cells.map((r) => r.bottom));
    setColumn({ left: (left - origin.left) / scale - 24, top: (top - origin.top) / scale - 70, width: (right - left) / scale + 120, height: (bottom - top) / scale + 94 });
  }, [drawn]);
  const box: CSSProperties = { position: 'absolute', borderRadius: 12, pointerEvents: 'none' };
  return (
    <div ref={frame} style={{ position: 'relative', width: VIDEO, height: 1080, overflow: 'hidden', background: '#F1F5F9' }}>
      {/* The dashboard at the intro's layout width, filling the frame as the video does. */}
      <div style={{ width: 1280, transform: 'scale(1.5)', transformOrigin: '0 0' }}>
        <AppShell team={dashboard.team} active="/">
          <div style={{ outline: '3px solid #2563EB', outlineOffset: 6, borderRadius: 12 }}>
            <StatCards stats={dashboard.stats} />
          </div>
          <TaskTable tasks={dashboard.tasks} />
        </AppShell>
      </div>
      {column && <div data-focus="drawn-box" style={{ ...box, ...column, border: '4px solid #1F5FCC', background: 'rgba(31, 95, 204, 0.10)' }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, display: 'flex', justifyContent: 'center' }}>
        <span style={{ background: '#0F172A', color: '#FFFFFF', font: '500 40px/1.3 ui-sans-serif, system-ui, sans-serif', padding: '14px 24px', borderRadius: 10 }}>Overdue tasks are the ones to look at first.</span>
      </div>
    </div>
  );
}
