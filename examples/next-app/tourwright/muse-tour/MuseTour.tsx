// Muse, for the Muse video: the whole of Muse's real page, held at one moment of a review after
// another. The reviewer is looking at "welcome", a short walkthrough of this app; the preview shows
// that video's own frames, captured by capture.mts. Each moment below is only data: the state Muse's
// server would send, and what the reviewer is part way through.
import { useMemo } from 'react';
import { Muse, type MuseMoment } from '../../../../src/runtime/studio.tsx';
import type { Note, StudioState } from '../../../../src/studio/protocol.ts';
import type { FrameReport, ReadyReport, TourApi } from '../../../../src/runtime/player.tsx';
import type { Rect } from '../../../../src/runtime/motion.ts';
import type { ScreenDescription } from '../../../../src/runtime/screen.ts';
import type { Timeline } from '../../../../src/timing/timeline.ts';
import captured from './frames.json';
import timelineJson from './timeline.json';
import script from '../walkthroughs/welcome/script.json';

const timeline = timelineJson as unknown as Timeline;
const shots = captured.frames;
const shot = (label: string) => shots.find((s) => s.label === label)!;
const images = Object.fromEntries(shots.map((s) => [s.label, new URL(`./frames/${s.file}`, import.meta.url).href]));
const snippet = new URL('./snippet.png', import.meta.url).href;
const ready = { stages: captured.stages, registered: Object.keys(captured.stages), errors: [] } as unknown as ReadyReport;

/** Every moment of the review the video shows, in order: each beat that animates "moment" moves on one. */
export const MOMENTS = [
  'first',
  'playing',
  'paused',
  'slower',
  'looping',
  'keys',
  'asking',
  'composing',
  'written',
  'picking',
  'attached',
  'drawing',
  'drawn',
  'held',
  'editing',
  'ready-to-send',
  'sent',
  'new-version',
  'answering',
  'filtered',
  'closed',
  'boxes',
  'adding',
  'box-added',
  'box-dragged',
  'scenes',
  'words',
  'voicing',
  'beat-editor',
  'beat-pick',
  'problems',
  'approve',
  'confirming',
  'dialog',
  'rendering',
  'done',
  'failed',
  'approved',
  'edited',
] as const;
export type MomentName = (typeof MOMENTS)[number];

const after = (now: MomentName, from: MomentName) => MOMENTS.indexOf(now) >= MOMENTS.indexOf(from);
const ms = (frame: number) => Math.round((frame / timeline.fps) * 1000);
const created = '2026-01-15T09:40:00.000Z';

const overdue = timeline.scenes[1]!;
const people = timeline.scenes[2]!;
const late = shot('overdue-late');
const load = shot('people-load');
const overdueCard = late.targets.find((t) => t.name === 'stat-overdue')!.rect;

const zoomNote: Note = {
  id: 'a1',
  ms: ms(late.frame),
  frame: late.frame,
  scene: overdue.id,
  sceneIndex: overdue.index,
  sentence: overdue.sentences[0]!.text,
  text: 'Zoom in closer on the Overdue card.',
  scope: 'moment',
  target: 'stat-overdue',
  rect: overdueCard,
  areaText: ['Overdue', '2', 'needs attention'],
  status: 'open',
  replies: [],
  created,
};
const tomNote: Note = {
  id: 'b2',
  ms: ms(load.frame),
  frame: load.frame,
  scene: people.id,
  sceneIndex: people.index,
  sentence: people.sentences[1]!.text,
  text: 'Tom has room for more work. Put a narration box on his row too.',
  scope: 'moment',
  rect: captured.tom!.rect,
  areaText: captured.tom!.text,
  snippet,
  status: 'open',
  replies: [],
  created,
};
const voiceNote: Note = {
  id: 'c3',
  ms: ms(shot('home-open').frame),
  frame: shot('home-open').frame,
  scene: timeline.scenes[0]!.id,
  sceneIndex: 0,
  text: 'The voice is a little fast. Slow it down a touch.',
  scope: 'all',
  status: 'open',
  replies: [],
  created,
};

const agent = (text: string) => ({ from: 'agent' as const, text, at: created });
const you = (text: string) => ({ from: 'you' as const, text, at: created });

/** The notes at each moment: written, sent, answered by the agent, checked. */
function notesAt(now: MomentName): Note[] {
  if (!after(now, 'drawing')) return [];
  if (!after(now, 'drawn')) return [zoomNote];
  if (!after(now, 'held')) return [zoomNote, tomNote];
  if (!after(now, 'new-version')) return [zoomNote, tomNote, voiceNote];
  const zoomFixed: Note = { ...zoomNote, status: 'fixed', replies: [agent('The camera now zooms in to twice the size on the Overdue card.')] };
  const tomAsked: Note = { ...tomNote, status: 'question', replies: [agent("Should the box go round Tom's whole row, or only his task bar?")] };
  const voiceFixed: Note = { ...voiceNote, status: 'fixed', replies: [agent('The voice now speaks at 0.9 of its speed.')] };
  // The agent fixes two notes first; its question about the third comes after.
  if (!after(now, 'answering')) return [zoomFixed, tomNote, voiceFixed];
  if (!after(now, 'closed')) return [zoomFixed, tomAsked, voiceFixed];
  // The reviewer approved two fixes; the agent has since added Tom's box, which the reviewer has
  // not checked yet: what the render dialog lists as still in progress.
  const zoomClosed: Note = { ...zoomFixed, status: 'closed' };
  const tomFixed: Note = { ...tomAsked, status: 'fixed', replies: [...tomAsked.replies, you('His whole row, please.'), agent("Added a narration box round Tom's row, while the second sentence is spoken.")] };
  return [zoomClosed, tomFixed, { ...voiceFixed, status: 'closed' }];
}

/** What Muse's server would send at each moment. */
function stateAt(now: MomentName, rendered: number): StudioState {
  const notes = notesAt(now);
  const hash = after(now, 'new-version') ? 'v2' : 'v1';
  const sent = { status: 'changes-requested' as const, scriptHash: 'v1', at: created, notes: ['a1', 'b2', 'c3'] };
  const approved = { status: 'approved' as const, scriptHash: 'v2', at: created };
  const review = after(now, 'dialog') ? approved : after(now, 'sent') ? sent : undefined;
  const state: StudioState = {
    name: 'welcome',
    version: 1,
    timelineVersion: 1,
    stageVersion: 1,
    scriptHash: hash,
    script,
    timeline: timelineAt(now),
    diagnostics: [],
    preparing: now === 'voicing',
    notes,
    reviewChanged: [],
    final: { ready: false, why: 'There is no final video yet', file: 'tourwright/out/welcome.mp4' },
    ...(review && { review }),
  };
  if (after(now, 'new-version')) state.newVersionAt = '2026-01-15T10:00:00.000Z';
  if (now === 'problems') {
    // An edit to the narration with a dash in it, as check reports it.
    state.diagnostics = [{ level: 'error', path: 'scenes[1].say', message: `Contains an em or en dash: "...the ones to look at first ${String.fromCharCode(0x2014)} below, every task shows...".`, fix: 'use a full stop or a comma instead, or a plain hyphen in a range such as "10-20".' }];
  }
  if (now === 'dialog') state.renderOffer = 'pending';
  const job = { status: 'running' as const, step: 'Rendering', percent: Math.round(rendered), started: created };
  if (now === 'rendering') state.render = job;
  if (now === 'failed') state.render = { ...job, status: 'failed', error: 'ffmpeg exited with code 1: No space left on device.' };
  if (now === 'done' || after(now, 'approved')) {
    state.render = { ...job, status: 'done', percent: 100 };
    state.final = { ready: true, file: 'tourwright/out/welcome.mp4' };
  }
  if (now === 'edited') {
    state.reviewChanged = ['components/TeamList.tsx'];
    state.final = { ready: false, why: 'Edited since it was approved', file: 'tourwright/out/welcome.mp4' };
  }
  return state;
}

/**
 * The timeline after the reviewer's edits to the narration boxes, as Muse would get it back: a box
 * added on Amara's row for the first sentence of "people", and then the box on Jonas's badge
 * dragged to last until the end of "away".
 */
function timelineAt(now: MomentName): Timeline {
  if (!after(now, 'box-added')) return timeline;
  const edited = structuredClone(timeline);
  const [team] = edited.scenes[people.index]!.beats;
  team!.highlight = { to: 'member-amara', from: team!.cue };
  if (after(now, 'box-dragged')) delete edited.scenes[3]!.beats[1]!.highlight;
  return edited;
}
/** The box selected on the track: the one just added, then the one being dragged. */
const selectedBox = (now: MomentName) => (now === 'box-added' ? `${people.index}-0` : now === 'box-dragged' ? '3-0' : undefined);

/** Where the reviewer is in the video, and what else they are part way through. */
function momentAt(now: MomentName): Omit<MuseMoment, 'screen'> {
  const zoomDraft = { text: zoomNote.text };
  const tomDraft = { text: tomNote.text };
  switch (now) {
    case 'first':
      return { frame: shot('home-stats').frame };
    case 'playing':
      return { frame: shot('overdue-list').frame, playing: true };
    case 'paused':
      return { frame: late.frame };
    case 'slower':
      return { frame: late.frame, speed: 0.75 };
    case 'looping':
      return { frame: late.frame, speed: 0.75, loop: true };
    case 'keys':
      return { frame: late.frame, help: true };
    case 'asking':
      return { frame: late.frame, review: { mode: 'asking', comment: 'Make the whole video a little slower.' } };
    case 'composing':
      return { frame: late.frame, draft: { text: 'Zoom in closer' } };
    case 'written':
      return { frame: late.frame, draft: zoomDraft };
    case 'picking':
      return { frame: late.frame, draft: zoomDraft, picking: 'area' };
    case 'attached':
      return { frame: late.frame, draft: { ...zoomDraft, attached: { target: 'stat-overdue', rect: overdueCard, text: zoomNote.areaText! } } };
    case 'drawing':
      return { frame: load.frame, draft: tomDraft, picking: 'area', drawn: captured.tom!.rect };
    case 'drawn':
    case 'held':
    case 'ready-to-send':
    case 'sent':
      return { frame: load.frame };
    case 'editing':
      return { frame: load.frame, notes: { c3: { mode: 'editing', text: 'The voice is a little fast. Slow it down a touch' } } };
    case 'new-version':
      return { frame: load.frame };
    case 'answering':
      return { frame: load.frame, notes: { b2: { mode: 'replying', text: 'His whole row, please.' } } };
    case 'filtered':
      return { frame: load.frame, filter: 'you' };
    case 'closed':
      // Filtered to the closed notes, where the one just approved has gone.
      return { frame: late.frame, filter: 'done' };
    case 'boxes':
      return { frame: load.frame };
    case 'adding':
      return { frame: load.frame, picking: 'target' };
    case 'box-added':
      return { frame: shot('people-team').frame, box: selectedBox(now) };
    case 'box-dragged':
      return { frame: shot('away-away').frame, box: selectedBox(now) };
    case 'scenes':
      return { frame: shot('home-stats').frame, tab: 'scenes' };
    case 'words':
    case 'voicing':
      return { frame: shot('home-stats').frame, tab: 'scenes', scene: { index: 0, say: "[open]This is your team's dashboard. [stats]These cards count every task your team has, " } };
    case 'beat-editor':
      return { frame: late.frame, tab: 'scenes', scene: { index: 1, beat: 0 } };
    case 'beat-pick':
      return { frame: late.frame, tab: 'scenes', scene: { index: 1, beat: 0 }, picking: 'target' };
    case 'problems':
      return { frame: late.frame, tab: 'scenes' };
    case 'confirming':
      return { frame: shot('away-next').frame, review: { mode: 'confirming' } };
    default:
      return { frame: shot('away-next').frame };
  }
}

/** A stand-in for the player's page, answering what Muse asks it from the captured frame. */
function playerAt(frame: number, targets: { name: string; rect: Rect }[]): TourApi {
  const none = () => null;
  return {
    start: async () => ready,
    setFrame: () => ({ frame, scene: 0, view: undefined, highlight: null, signature: null, errors: [] }) as unknown as FrameReport,
    targetOnScreen: none,
    minTextSize: none,
    captionRect: none,
    stageMarkup: () => '',
    stageText: () => ({ text: '', labels: [] }),
    targetsOnScreen: () => targets,
    textIn: () => [],
    toStage: (rect) => ({ stage: '', rect }),
    describe: () => ({}) as ScreenDescription,
    errors: [],
  };
}

/** Muse's window at a common browser size, scaled up to fill the video so its text reads. */
const WINDOW = { width: 1440, height: 810 };
const ZOOM = 1920 / WINDOW.width;

export function MuseTour({ moment: now, rendered }: { moment: MomentName; rendered: number }) {
  const held = momentAt(now);
  // The video's frame: the last one captured at or before the playhead.
  const frameShot = [...shots].reverse().find((s) => s.frame <= held.frame) ?? shots[0]!;
  const api = useMemo(() => playerAt(held.frame, frameShot.targets), [held.frame, frameShot]);
  const state = stateAt(now, rendered);
  const moment: MuseMoment = {
    ...held,
    screen: (
      <div data-focus="video">
        <img src={images[frameShot.label]} alt="" style={{ display: 'block', width: timeline.layout.width, height: timeline.layout.height }} />
      </div>
    ),
  };
  return (
    // Room below Muse's window, so the camera can lift the transport clear of the captions.
    <div className="muse-page" style={{ position: 'relative', width: 1920, height: 1080 + 360, background: '#FBF8F6' }}>
      {/* Muse's window with a strip of room below it: framed on this, the captions sit under Muse, not over it. */}
      <div data-focus="muse-room" style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080 + 150, pointerEvents: 'none' }} />
      {/* Muse's page styles, as the page Muse is served in sets them. */}
      <style>{`.muse-page button:disabled { opacity: 0.45; cursor: default; } .muse-page *, .muse-page *::before, .muse-page *::after { box-sizing: border-box; }`}</style>
      <div
        data-focus="muse"
        style={{ width: WINDOW.width, height: WINDOW.height, transform: `scale(${ZOOM})`, transformOrigin: '0 0', background: '#FBF8F6', color: '#1F2328', font: '14px/1.4 ui-sans-serif, system-ui, sans-serif' }}
      >
        {/* Keyed by moment, so what the reviewer is part way through starts afresh at each one. */}
        <Muse key={now} state={state} player={{ frameRef: { current: null }, ready, api }} moment={moment} />
      </div>
    </div>
  );
}
