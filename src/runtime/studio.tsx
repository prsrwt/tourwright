// Muse, the studio: watch a walkthrough with its narration, change it, leave notes for the agent,
// all pinned to the exact moment, and approve the video. The player runs in an iframe (the same
// page renders use), so the preview is the video, and the app's styles never reach Muse's own
// controls. Every change is written to script.json, which stays the single source of truth for the
// agent too.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Diagnostic } from '../check/diagnostic.ts';
import type { NewNoteRequest, Note, NoteScope, NoteStatus, ReplyRequest, ReviewRequest, StudioState } from '../studio/protocol.ts';
import type { TimedBeat, TimedScene, Timeline } from '../timing/timeline.ts';
import type { Rect } from './motion.ts';
import type { ReadyReport, TourApi } from './player.tsx';
import type { ScreenDescription } from './screen.ts';

const API = '/__tourwright/api';

// ---------------------------------------------------------------------------------------------
// Style: every colour and size Muse uses. Muse keeps to white and a warm off-white, so the video is
// what stands out. Peach (#FCDED3) is Muse's colour; it is too light for text, so it is only ever a
// surface, always with dark text on it. Each text colour below meets WCAG AA (4.5:1) on the
// surfaces it is used on: ink on any of them at 12:1 or more, muted at 5:1 or more (5.05:1 on
// peach), accent 5.3:1 or more, and each tone's text on its own background at 5.6:1 or more.

const C = {
  /** The page behind everything: a warm off-white. */
  page: '#FBF8F6',
  surface: '#FFFFFF',
  peach: '#FCDED3',
  /** A paler peach, for the note being written. */
  peachSoft: '#FEF4F0',
  /** Borders on peach. */
  peachDeep: '#EDB8A4',
  ink: '#1F2328',
  muted: '#5B5F66',
  line: '#ECE4DF',
  track: '#F3ECE8',
  /** The one accent: selection, links, the playhead's beats, the scene playing now. */
  accent: '#1F5FCC',
  /** The accent, faint: the inside of a target while picking one, a selected filter. */
  accentWash: 'rgba(31, 95, 204, 0.10)',
  /** Dims the preview behind the target outlines while picking. */
  shade: 'rgba(31, 35, 40, 0.35)',
  shadow: 'rgba(31, 35, 40, 0.08)',
  /** Waiting on the person reviewing. */
  yoursBg: '#FFF3D6',
  yoursText: '#7A4700',
  yoursEdge: '#D99A1E',
  /** Waiting on the agent. */
  agentBg: '#EEF1F4',
  agentText: '#4A5058',
  okBg: '#E3F3E8',
  okText: '#1C6B3A',
  warnBg: '#FFF0CC',
  warnText: '#7A4700',
  errBg: '#FDECEA',
  errText: '#B42318',
};

const S = {
  /** The spacing unit: gaps and padding are multiples of it. */
  gap: 8,
  radius: 8,
  text: 14,
  small: 12,
  /** Width of the side panel. */
  panel: 400,
  /** Below this window width, the side panel goes under the video. */
  narrow: 1000,
};

// Shared styles never mix a shorthand (border, margin) with its longhands, which React warns
// about when a rerender changes one of them: each sets only what the places using it override.
const reset: CSSProperties = { background: 'transparent', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', border: 0 };
const control: CSSProperties = { ...reset, borderRadius: S.radius, padding: '5px 12px', fontWeight: 600, lineHeight: '20px', whiteSpace: 'nowrap' };
/** The one main action in a place. */
const primary: CSSProperties = { ...control, background: C.ink, color: C.surface };
const quiet: CSSProperties = { ...control, background: C.surface, boxShadow: `inset 0 0 0 1px ${C.line}`, color: C.ink, fontWeight: 500 };
/** A small text action inside a card: edit, delete, reopen. */
const subtle: CSSProperties = { ...reset, color: C.muted, fontSize: S.small, textDecoration: 'underline', textUnderlineOffset: 2 };
const input: CSSProperties = { background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: S.radius, padding: '6px 8px', font: 'inherit' };
const label: CSSProperties = { width: 72, color: C.muted };
const link: CSSProperties = { ...reset, color: C.accent, fontVariantNumeric: 'tabular-nums', textDecoration: 'underline', textUnderlineOffset: 2 };
const card: CSSProperties = { padding: S.gap * 1.5, borderRadius: S.radius, background: C.surface, borderStyle: 'solid', borderWidth: 1, borderColor: C.line };
const panel: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: S.gap * 2 };
/** A round button in the transport. */
const round: CSSProperties = { ...reset, width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: C.ink };

function pill(background: string, color: string): CSSProperties {
  return { display: 'inline-block', padding: '2px 10px', borderRadius: 999, background, color, fontSize: S.small, fontWeight: 600, lineHeight: '18px', whiteSpace: 'nowrap' };
}

export function mountStudio(): void {
  createRoot(document.getElementById('tourwright-studio')!).render(<Studio />);
}

// ---------------------------------------------------------------------------------------------
// Server state

function useStudioState(): [StudioState | undefined, () => Promise<void>] {
  const [state, setState] = useState<StudioState>();
  const refresh = useCallback(async () => setState((await (await fetch(`${API}/state`)).json()) as StudioState), []);
  useEffect(() => {
    void refresh();
    const events = new EventSource(`${API}/events`);
    events.onmessage = () => void refresh();
    return () => events.close();
  }, [refresh]);
  return [state, refresh];
}

// ---------------------------------------------------------------------------------------------
// Script editing: plain JSON, written back whole, refused if someone else changed it meanwhile.

interface RawBeat {
  at: string;
  camera?: { to: string; zoom?: 'fit' | 'width' | number; align?: 'center' | 'top' };
  highlight?: string | false;
  animate?: string | string[];
}
interface RawScene {
  id?: string;
  stage: string;
  say: string;
  beats?: RawBeat[];
}
interface RawScript {
  scenes: RawScene[];
}

async function saveScript(state: StudioState, change: (script: RawScript) => void): Promise<string | undefined> {
  const script = structuredClone(state.script) as RawScript;
  change(script);
  const res = await fetch(`${API}/script`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: state.scriptHash, script }) });
  return res.ok ? undefined : ((await res.json()) as { error: string }).error;
}

// ---------------------------------------------------------------------------------------------
// The player in its iframe

/**
 * The player in its iframe, (re)started once per prepared timeline. `key` is the state's
 * timelineVersion: the timeline object itself is new on every state fetch, and restarting on each
 * one (a note arriving, say) would stop playback and measure every stage again.
 */
function usePlayer(timeline: Timeline | undefined, key: number | undefined) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState<ReadyReport>();
  const [api, setApi] = useState<TourApi>();

  // Wait for the player page to mount, then (re)start it on each new timeline.
  useEffect(() => {
    if (!timeline) return;
    let cancelled = false;
    const start = async () => {
      let tour: TourApi | undefined;
      while (!cancelled && !(tour = (frameRef.current?.contentWindow as (Window & { __tour?: TourApi }) | null)?.__tour)) {
        await new Promise((done) => setTimeout(done, 50));
      }
      if (cancelled || !tour) return;
      const report = await tour.start(timeline);
      if (!cancelled) {
        setReady(report);
        setApi(tour);
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeline === undefined]);

  return { frameRef, ready, api };
}

// ---------------------------------------------------------------------------------------------
// Muse

type Tab = 'notes' | 'scenes';

/** Which notes to show: all of them, or only those waiting on one side. */
type Filter = 'all' | 'you' | 'agent' | 'done';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function useNarrow(): boolean {
  const query = `(max-width: ${S.narrow - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [query]);
  return narrow;
}

function Studio() {
  const [state] = useStudioState();
  const timeline = state?.timeline;
  const { frameRef, ready, api } = usePlayer(timeline, state?.timelineVersion);
  const audio = useRef<HTMLAudioElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Looping keeps playback inside the scene the playhead was in when it was turned on or last moved.
  const [loop, setLoop] = useState(false);
  const loopRange = useRef<{ from: number; to: number }>(undefined);
  const [message, setMessage] = useState<string>();
  const [picking, setPicking] = useState<((target: string) => void) | undefined>();
  const [tab, setTab] = useState<Tab>('notes');
  const [filter, setFilter] = useState<Filter>('all');
  const [help, setHelp] = useState(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const narrow = useNarrow();

  const fps = timeline?.fps ?? 30;
  const frames = timeline?.frames ?? 1;

  useEffect(() => {
    if (state) document.title = `${state.name}: Muse`;
  }, [state?.name]);

  // Show a frame: "play" while playing, so CSS transitions run by the frame as in a render;
  // "settle" when paused or scrubbing, so what you see is where things end up.
  const show = useCallback(
    (f: number, mode: 'play' | 'settle') => {
      const clamped = Math.max(0, Math.min(frames - 1, f));
      api?.setFrame(clamped, mode);
      setFrame(clamped);
      return clamped;
    },
    [api, frames],
  );

  const rangeAt = useCallback(
    (f: number) => {
      const scene = timeline && sceneAt(timeline, f);
      return scene ? { from: scene.from, to: scene.from + scene.frames - 1 } : { from: 0, to: (timeline?.titleFrames ?? 1) - 1 };
    },
    [timeline],
  );

  // Each (re)start leaves the player on its measuring render, so draw the current frame again.
  // The player object is the same across restarts; the ready report is new each time.
  useEffect(() => {
    if (api) show(frame, 'settle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ready]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, state?.timelineVersion]);

  // Playback follows the audio clock, so picture and narration never drift apart.
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let last = -1;
    const tick = () => {
      const a = audio.current;
      if (!a) return;
      const f = Math.floor(a.currentTime * fps);
      const range = loopRange.current;
      if (range && (f >= range.to || a.ended)) {
        a.currentTime = range.from / fps;
        if (a.paused) void a.play();
        last = -1;
        handle = requestAnimationFrame(tick);
        return;
      }
      if (f !== last) {
        last = f;
        show(f, 'play');
      }
      if (a.ended || f >= frames - 1) {
        setPlaying(false);
        return;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, fps, frames, show]);

  const seek = useCallback(
    (f: number) => {
      const shown = show(f, 'settle');
      if (audio.current) audio.current.currentTime = shown / fps;
      if (loopRange.current) loopRange.current = rangeAt(shown);
    },
    [show, fps, rangeAt],
  );

  const pause = useCallback(() => {
    if (!playing) return;
    audio.current?.pause();
    setPlaying(false);
    show(frame, 'settle');
  }, [playing, frame, show]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (playing) return pause();
    if (frame >= frames - 1) a.currentTime = 0;
    else a.currentTime = frame / fps;
    a.playbackRate = speed;
    void a.play();
    setPlaying(true);
  }, [playing, pause, frame, frames, fps, speed]);

  const toggleLoop = useCallback(() => {
    loopRange.current = loop ? undefined : rangeAt(frame);
    setLoop(!loop);
  }, [loop, frame, rangeAt]);

  // The start of the scene before or after the one playing: the title card counts as a scene.
  const jump = useCallback(
    (direction: -1 | 1) => {
      if (!timeline) return;
      const starts = [0, ...timeline.scenes.map((s) => s.from)];
      const here = starts.filter((f) => f <= frame).length - 1;
      // Going back from partway into a scene goes to its own start first, as a music player does.
      const target = direction === 1 ? starts[here + 1] : frame - starts[here]! > fps ? starts[here] : starts[here - 1];
      if (target === undefined) return;
      if (playing) {
        audio.current!.currentTime = target / fps;
        if (loopRange.current) loopRange.current = rangeAt(target);
      } else seek(target);
    },
    [timeline, frame, fps, playing, seek, rangeAt],
  );

  // Writing a note: pause, show the notes, and put the cursor in the box.
  const startNote = useCallback(() => {
    pause();
    setTab('notes');
    setTimeout(() => noteInput.current?.focus(), 0);
  }, [pause]);

  // Keyboard: space plays, arrows step a frame (with Shift, a second), [ and ] jump a scene,
  // L loops the scene, N writes a note, ? lists these.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const keys: Record<string, () => void> = {
        ' ': toggle,
        ArrowRight: () => (pause(), seek(frame + (e.shiftKey ? fps : 1))),
        ArrowLeft: () => (pause(), seek(frame - (e.shiftKey ? fps : 1))),
        '[': () => jump(-1),
        ']': () => jump(1),
        l: toggleLoop,
        n: startNote,
        '?': () => setHelp((h) => !h),
        Escape: () => (setHelp(false), setPicking(undefined)),
      };
      const run = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, pause, seek, jump, toggleLoop, startNote, frame, fps]);

  const edit = useCallback(
    async (change: (script: RawScript) => void) => {
      if (!state) return;
      setMessage('Saving...');
      const error = await saveScript(state, change);
      setMessage(error);
    },
    [state],
  );

  if (!state) return <Centered>Loading Muse...</Centered>;

  const waiting = state.notes.filter((n) => n.status === 'question' || n.status === 'fixed').length;
  const pick = (done: (target: string) => void) => setPicking(() => done);
  const seekPaused = (f: number) => (pause(), seek(f));

  const video = (
    <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: S.gap * 2, ...(narrow && { height: '62vh', flex: 'none' }) }}>
      {timeline ? (
        <Preview timeline={timeline} frameRef={frameRef} api={api} picking={picking} onPick={(t) => (picking?.(t), setPicking(undefined))} onCancelPick={() => setPicking(undefined)} frame={frame}>
          <Transport
            timeline={timeline}
            frame={frame}
            playing={playing}
            speed={speed}
            loop={loop}
            help={help}
            onToggle={toggle}
            onSeek={seekPaused}
            onJump={jump}
            onSpeed={setSpeed}
            onLoop={toggleLoop}
            onNote={startNote}
            onHelp={() => setHelp(!help)}
          />
        </Preview>
      ) : (
        <Centered>{state.preparing ? 'Voicing the narration...' : 'This walkthrough could not be prepared. See the problems under Scenes.'}</Centered>
      )}
      <audio ref={audio} src={`${API}/soundtrack.wav?v=${state.timelineVersion}`} preload="auto" onEnded={() => !loopRange.current && setPlaying(false)} />
    </main>
  );

  const side = (
    <aside style={{ background: C.surface, display: 'flex', flexDirection: 'column', minHeight: 0, ...(narrow ? { borderTop: `1px solid ${C.line}` } : { borderLeft: `1px solid ${C.line}` }) }}>
      <div role="tablist" aria-label="Side panel" style={{ display: 'flex', gap: S.gap / 2, padding: `${S.gap}px ${S.gap * 2}px 0`, borderBottom: `1px solid ${C.line}` }}>
        <TabButton id="notes" current={tab} onSelect={setTab}>
          Notes
          {waiting > 0 && (
            <span aria-label={`${waiting} waiting on you`} style={{ ...pill(C.yoursBg, C.yoursText), marginLeft: S.gap }}>
              {waiting}
            </span>
          )}
        </TabButton>
        <TabButton id="scenes" current={tab} onSelect={setTab}>
          Scenes
          {(state.error || state.diagnostics.some((d) => d.level === 'error')) && <span aria-label="has problems" style={{ ...pill(C.errBg, C.errText), marginLeft: S.gap }}>!</span>}
        </TabButton>
      </div>
      {/* Both panels stay mounted, so a half-written note or beat survives switching tabs. */}
      <div role="tabpanel" hidden={tab !== 'notes'} style={panel}>
        <Notes state={state} timeline={timeline} api={api} frame={frame} audio={audio} inputRef={noteInput} filter={filter} onFilter={setFilter} onSeek={seekPaused} onPick={pick} onWrite={pause} />
      </div>
      <div role="tabpanel" hidden={tab !== 'scenes'} style={panel}>
        <Problems diagnostics={state.diagnostics.filter((d) => !/^scenes\[/.test(d.path))} error={state.error} />
        {timeline && <Scenes state={state} timeline={timeline} ready={ready} frame={frame} onSeek={seekPaused} onEdit={edit} onPick={pick} />}
      </div>
    </aside>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header state={state} message={message} />
      {narrow ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {video}
          {side}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${S.panel}px` }}>
          {video}
          {side}
        </div>
      )}
    </div>
  );
}

function TabButton({ id, current, onSelect, children }: { id: Tab; current: Tab; onSelect: (tab: Tab) => void; children: ReactNode }) {
  const selected = id === current;
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      style={{
        ...reset,
        padding: `${S.gap}px ${S.gap * 1.5}px`,
        marginBottom: -1,
        borderStyle: 'solid',
        borderWidth: '0 0 2px',
        borderColor: `transparent transparent ${selected ? C.ink : 'transparent'}`,
        color: selected ? C.ink : C.muted,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Header: the wordmark, the walkthrough, and the whole video's review.

function Header({ state, message }: { state: StudioState; message: string | undefined }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: S.gap * 1.5, padding: `${S.gap}px ${S.gap * 2}px`, minHeight: 56, background: C.surface, borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: C.peach, boxShadow: `inset 0 0 0 1px ${C.peachDeep}`, flex: 'none' }} />
      <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3, color: C.ink }}>Muse</span>
      <span aria-hidden="true" style={{ color: C.line, fontSize: 20 }}>/</span>
      <span style={{ fontSize: S.text + 1, fontWeight: 600, color: C.ink }}>{state.name}</span>
      {state.preparing && <span style={{ color: C.muted }}>Voicing changes...</span>}
      {message && <span style={{ color: message === 'Saving...' ? C.muted : C.errText }}>{message}</span>}
      <ReviewBar state={state} />
    </header>
  );
}

/**
 * The whole video's review, as two plain actions: send the open notes to the agent, or approve the
 * video as finished. Sending is the agent's signal to make the changes; approving tells it the
 * video is done. Approving while notes are still open asks first, so nothing is signed off by accident.
 */
function ReviewBar({ state }: { state: StudioState }) {
  const [mode, setMode] = useState<'idle' | 'asking' | 'confirming'>('idle');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const review = state.review;
  const current = review?.scriptHash === state.scriptHash;
  const open = state.notes.filter((n) => n.status === 'open');
  // Notes already sent with the current request for changes are with the agent; only new ones are left to send.
  const sent = current && review?.status === 'changes-requested' ? (review.notes ?? []) : [];
  const unsent = open.filter((n) => !sent.includes(n.id));
  const unresolved = state.notes.filter((n) => n.status !== 'closed').length;
  const send = async (status: 'approved' | 'changes-requested') => {
    const body: ReviewRequest = { base: state.scriptHash, status, ...(status === 'changes-requested' && comment.trim() && { comment: comment.trim() }) };
    const res = await fetch(`${API}/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setError(res.ok ? undefined : ((await res.json()) as { error: string }).error);
    if (res.ok) {
      setMode('idle');
      setComment('');
    }
  };
  const plural = (n: number) => `${n} note${n === 1 ? '' : 's'}`;
  const [text, tone] = !review
    ? ['Not reviewed yet', pill(C.track, C.muted)]
    : review.status === 'approved'
      ? current
        ? ['Approved: finished', pill(C.okBg, C.okText)]
        : ['Edited since you approved it', pill(C.warnBg, C.warnText)]
      : current
        ? [sent.length ? `Sent ${plural(sent.length)} to the agent` : 'Sent to the agent', pill(C.warnBg, C.warnText)]
        : ['Changed since you sent it: watch again', pill(C.warnBg, C.warnText)];
  // Reviewing a version that is still being voiced, or failed to prepare, would approve something unseen.
  const busy = state.preparing || !!state.error;
  const when = review && `${new Date(review.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${review.comment ? `: "${review.comment}"` : ''}`;
  const approvedNow = current && review?.status === 'approved';
  return (
    <div data-review="" data-script-hash={state.scriptHash} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: S.gap, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span data-review-status="" title={when} style={tone}>
        {text}
      </span>
      {state.reviewError && <span style={{ color: C.errText, whiteSpace: 'pre-wrap' }}>{state.reviewError}</span>}
      {mode === 'asking' && (
        <>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && comment.trim() && void send('changes-requested')}
            placeholder="What should change?"
            style={{ ...input, width: 260 }}
            autoFocus
          />
          <button style={primary} disabled={!comment.trim()} onClick={() => void send('changes-requested')}>
            Send to the agent
          </button>
          <button style={quiet} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </>
      )}
      {mode === 'confirming' && (
        <>
          <span style={{ color: C.ink }}>{unresolved === 1 ? '1 note is' : `${unresolved} notes are`} not closed yet.</span>
          <button style={primary} onClick={() => void send('approved')}>
            Approve anyway
          </button>
          <button style={quiet} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </>
      )}
      {mode === 'idle' && (
        <>
          {/* With notes to send, one click sends them. Without, say what should change in a line. */}
          {unsent.length ? (
            <button data-action="send" style={quiet} disabled={busy} title="The agent gets these notes and makes the changes" onClick={() => void send('changes-requested')}>
              {sent.length ? `Send ${plural(unsent.length)} more to the agent` : `Send ${plural(unsent.length)} to the agent`}
            </button>
          ) : (
            !sent.length && (
              <button data-action="ask" style={quiet} disabled={busy} title="Tell the agent what should change, without pinning a note" onClick={() => setMode('asking')}>
                Ask for changes
              </button>
            )
          )}
          {!approvedNow && (
            <button data-action="approve" style={primary} disabled={busy} title="Tells the agent the video is finished" onClick={() => (unresolved ? setMode('confirming') : void send('approved'))}>
              Approve: it's finished
            </button>
          )}
        </>
      )}
      {error && <div style={{ width: '100%', textAlign: 'right', color: C.errText, whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Preview: the player, scaled to fit, with target outlines to click when picking.

function Preview(props: {
  timeline: Timeline;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  api: TourApi | undefined;
  picking: ((t: string) => void) | undefined;
  onPick: (target: string) => void;
  onCancelPick: () => void;
  frame: number;
  /** The transport, drawn under the video at its width, so the two read as one player. */
  children?: ReactNode;
}) {
  const { timeline, frameRef, api, picking, frame } = props;
  const box = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const room = el.clientHeight - (below.current?.offsetHeight ?? 0) - S.gap * 1.5;
      setScale(Math.max(0.1, Math.min(el.clientWidth / timeline.layout.width, room / timeline.layout.height)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    if (below.current) observer.observe(below.current);
    return () => observer.disconnect();
  }, [timeline.layout.width, timeline.layout.height]);

  // Largest first, so a target inside another (a card in a row of cards) is drawn on top and can be clicked.
  const targets = useMemo<{ name: string; rect: Rect }[]>(
    () => (picking && api ? api.targetsOnScreen().sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h) : []),
    [picking, api, frame],
  );

  return (
    <div ref={box} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: S.gap * 1.5 }}>
      <div style={{ position: 'relative', flex: 'none', width: timeline.layout.width * scale, height: timeline.layout.height * scale, borderRadius: S.radius, overflow: 'hidden', boxShadow: `0 0 0 1px ${C.line}, 0 8px 24px ${C.shadow}` }}>
        <iframe
          ref={frameRef}
          src="/__tourwright/"
          title="Preview"
          style={{ border: 0, width: timeline.layout.width, height: timeline.layout.height, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', background: C.surface }}
        />
        {picking && (
          <div style={{ position: 'absolute', inset: 0, background: C.shade, cursor: 'crosshair' }} onClick={props.onCancelPick}>
            {targets.map((t) => (
              <button
                key={t.name}
                title={t.name}
                data-target={t.name}
                onClick={(e) => (e.stopPropagation(), props.onPick(t.name))}
                style={{
                  position: 'absolute',
                  left: t.rect.x * scale,
                  top: t.rect.y * scale,
                  width: t.rect.w * scale,
                  height: t.rect.h * scale,
                  border: `2px solid ${C.accent}`,
                  borderRadius: 4,
                  background: C.accentWash,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span style={{ position: 'absolute', left: 0, top: 0, background: C.accent, color: C.surface, padding: '1px 6px', fontSize: 12, borderBottomRightRadius: 4 }}>{t.name}</span>
              </button>
            ))}
            <div style={{ position: 'absolute', left: S.gap, bottom: S.gap, background: C.ink, color: C.surface, padding: `${S.gap / 2}px ${S.gap}px`, borderRadius: S.radius }}>
              Click a target, or anywhere else (or Esc) to cancel. Scrub first if it is not in view.
            </div>
          </div>
        )}
      </div>
      <div ref={below} style={{ width: Math.max(timeline.layout.width * scale, 360), maxWidth: '100%' }}>
        {props.children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Transport: play, the scrubber marked with scenes and beats, the time to the millisecond, and
// what the reviewer controls about playback: speed, looping a scene, jumping between scenes.

function Transport(props: {
  timeline: Timeline;
  frame: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  help: boolean;
  onToggle: () => void;
  onSeek: (f: number) => void;
  onJump: (direction: -1 | 1) => void;
  onSpeed: (speed: number) => void;
  onLoop: () => void;
  onNote: () => void;
  onHelp: () => void;
}) {
  const { timeline, frame, playing } = props;
  const bar = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    props.onSeek(Math.round(((e.clientX - r.left) / r.width) * (timeline.frames - 1)));
  };
  const percent = (f: number) => `${(f / timeline.frames) * 100}%`;
  const current = sceneAt(timeline, frame);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.gap, position: 'relative' }}>
      <div
        ref={bar}
        data-scrubber=""
        onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), at(e))}
        onPointerMove={(e) => e.buttons === 1 && at(e)}
        style={{ position: 'relative', height: 36, background: C.track, borderRadius: S.radius, cursor: 'pointer', overflow: 'hidden', touchAction: 'none' }}
      >
        <Segment left="0%" width={percent(timeline.titleFrames)} label="title" active={!current} />
        {timeline.scenes.map((s, i) => (
          <Segment key={i} left={percent(s.from)} width={percent(s.frames)} label={s.id} active={current?.index === s.index} />
        ))}
        {timeline.scenes.flatMap((s) =>
          s.beats.map((b) => (
            <div key={`${s.index}-${b.index}`} title={`${s.id}: ${b.at}`} style={{ position: 'absolute', left: percent(b.cue), bottom: 4, width: 3, height: 10, marginLeft: -1, borderRadius: 2, background: C.accent }} />
          )),
        )}
        <div style={{ position: 'absolute', left: percent(frame), top: 0, bottom: 0, width: 2, marginLeft: -1, background: C.ink }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.gap, flexWrap: 'wrap' }}>
        <button onClick={() => props.onJump(-1)} aria-label="Previous scene" title="Previous scene  [" style={round}>
          <Icon d="M5 4v12M16 4.5v11L7.5 10z" />
        </button>
        <button onClick={props.onToggle} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause  Space" style={{ ...round, width: 44, height: 44, background: C.peach, boxShadow: `inset 0 0 0 1px ${C.peachDeep}` }}>
          {playing ? <Icon d="M6 4h3v12H6zM11 4h3v12h-3z" /> : <Icon d="M6.5 3.5v13l10-6.5z" />}
        </button>
        <button onClick={() => props.onJump(1)} aria-label="Next scene" title="Next scene  ]" style={round}>
          <Icon d="M15 4v12M4 4.5v11l8.5-5.5z" />
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: S.gap, marginLeft: S.gap, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{clock((frame / timeline.fps) * 1000)}</span>
          <span style={{ color: C.muted, fontSize: S.small }}>/ {clock((timeline.frames / timeline.fps) * 1000)}</span>
          <span style={{ color: C.muted, fontSize: S.small }}>frame {frame}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: S.gap }}>
          <button onClick={props.onLoop} aria-pressed={props.loop} aria-label="Loop this scene" title="Loop this scene  L" style={{ ...round, ...(props.loop && { background: C.accentWash, color: C.accent }) }}>
            <Icon d="M4 9V8a3 3 0 0 1 3-3h8l-2.5-2.5M16 11v1a3 3 0 0 1-3 3H5l2.5 2.5" stroke />
          </button>
          <select aria-label="Playback speed" value={props.speed} onChange={(e) => props.onSpeed(Number(e.target.value))} style={{ ...input, padding: '4px 6px' }}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button onClick={props.onHelp} aria-label="Keyboard shortcuts" aria-expanded={props.help} title="Keyboard shortcuts  ?" style={{ ...round, fontWeight: 700, color: C.muted }}>
            ?
          </button>
          <button onClick={props.onNote} style={primary} title="Note at this moment  N">
            Write a note
          </button>
        </div>
      </div>
      {props.help && <Shortcuts />}
    </div>
  );
}

function Shortcuts() {
  const rows: [ReactNode, string][] = [
    [<Key>Space</Key>, 'play or pause'],
    [<><Key>←</Key> <Key>→</Key></>, 'one frame, with Shift one second'],
    [<><Key>[</Key> <Key>]</Key></>, 'previous or next scene'],
    [<Key>L</Key>, 'loop the scene'],
    [<Key>N</Key>, 'note at this moment'],
    [<><Key>Ctrl</Key> <Key>Enter</Key></>, 'add the note'],
  ];
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" style={{ ...card, position: 'absolute', right: 0, bottom: '100%', marginBottom: S.gap, boxShadow: `0 8px 24px ${C.shadow}`, display: 'grid', gridTemplateColumns: 'auto auto', gap: `${S.gap}px ${S.gap * 2}px`, alignItems: 'center', zIndex: 1 }}>
      {rows.map(([keys, what], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{keys}</span>
          <span style={{ color: C.muted }}>{what}</span>
        </div>
      ))}
    </div>
  );
}

function Segment({ left, width, label, active }: { left: string; width: string; label: string; active: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        width,
        top: 0,
        bottom: 0,
        borderLeft: `1px solid ${C.surface}`,
        padding: '3px 8px',
        fontSize: S.small,
        fontWeight: active ? 600 : 400,
        color: active ? C.ink : C.muted,
        background: active ? C.peach : 'transparent',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </div>
  );
}

/** A 20px icon from one path: filled, or drawn as a line. */
function Icon({ d, stroke }: { d: string; stroke?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d={d} {...(stroke ? { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : { fill: 'currentColor' })} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Notes for the agent, pinned to the millisecond, each a short thread with whoever's turn it is.

const TURN: Record<NoteStatus, { label: string; detail?: string; tone: CSSProperties; edge: string }> = {
  question: { label: 'Your turn', detail: 'The agent has a question', tone: pill(C.yoursBg, C.yoursText), edge: C.yoursEdge },
  fixed: { label: 'Your turn', detail: 'The agent says it is fixed: approve it, or say it is not fixed yet', tone: pill(C.yoursBg, C.yoursText), edge: C.yoursEdge },
  open: { label: "Agent's turn", tone: pill(C.agentBg, C.agentText), edge: C.line },
  closed: { label: 'Closed', tone: pill(C.okBg, C.okText), edge: C.line },
};

const FILTERS: { id: Filter; label: string; statuses: NoteStatus[] }[] = [
  { id: 'all', label: 'All', statuses: ['question', 'fixed', 'open', 'closed'] },
  { id: 'you', label: 'Your turn', statuses: ['question', 'fixed'] },
  { id: 'agent', label: "Agent's turn", statuses: ['open'] },
  { id: 'done', label: 'Closed', statuses: ['closed'] },
];

const SCOPE: Record<NoteScope, string> = { moment: 'this moment', scene: 'the whole scene', all: 'the whole video' };

function Notes({
  state,
  timeline,
  api,
  frame,
  audio,
  inputRef,
  filter,
  onFilter,
  onSeek,
  onPick,
  onWrite,
}: {
  state: StudioState;
  timeline: Timeline | undefined;
  api: TourApi | undefined;
  frame: number;
  audio: React.RefObject<HTMLAudioElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  onSeek: (f: number) => void;
  onPick: (done: (target: string) => void) => void;
  /** Called when the note box gets the cursor: playback pauses, so the note's moment holds still. */
  onWrite: () => void;
}) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<NoteScope>('moment');
  const [attached, setAttached] = useState<{ target: string; rect: Rect }>();
  const [focused, setFocused] = useState(false);
  // The playhead to the millisecond: the audio clock while it has one, else the frame.
  const ms = () => Math.round(audio.current && !audio.current.paused ? audio.current.currentTime * 1000 : (frame / (timeline?.fps ?? 30)) * 1000);
  const now = clock((frame / (timeline?.fps ?? 30)) * 1000);
  const open = focused || !!text || !!attached;

  const add = async () => {
    if (!text.trim() || !timeline) return;
    const at = ms();
    const f = Math.min(timeline.frames - 1, Math.floor((at / 1000) * timeline.fps));
    const scene = sceneAt(timeline, f);
    const sentence = scene ? sentenceAt(scene, f) : undefined;
    // What is on screen at the note's frame, so the agent can read it rather than guess.
    let screen: ScreenDescription | undefined;
    let screens: { label: string; screen: ScreenDescription }[] | undefined;
    if (api) {
      // A note about a whole scene, or the whole video, also gets each beat in it as it settles.
      if (scope !== 'moment') {
        const covered = scope === 'all' ? timeline.scenes : scene ? [scene] : [];
        screens = covered.flatMap((s) =>
          s.beats.map((beat) => {
            api.setFrame(settle(timeline, s, beat), 'settle');
            return { label: `${s.id}-${beat.at}`, screen: api.describe() };
          }),
        );
      }
      api.setFrame(f, 'settle');
      screen = api.describe();
    }
    const note: NewNoteRequest = {
      ms: at,
      frame: f,
      scene: scene?.id ?? 'title',
      sceneIndex: scene?.index ?? -1,
      ...(sentence && { sentence }),
      text: text.trim(),
      scope,
      ...(attached && { target: attached.target, rect: attached.rect }),
      ...(screen && { screen }),
      ...(screens?.length && { screens }),
    };
    await fetch(`${API}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) });
    setText('');
    setScope('moment');
    setAttached(undefined);
    // Show the new note, wherever the list was filtered to.
    if (filter !== 'all' && filter !== 'agent') onFilter('all');
  };
  // Where the target is on screen now, in layout pixels: the picker shows the current frame.
  const attach = () =>
    onPick((target) => {
      const rect = api?.targetsOnScreen().find((t) => t.name === target)?.rect;
      if (rect) setAttached({ target, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } });
    });
  // Whatever needs the user comes first; closed notes sink to the bottom.
  const order: Record<NoteStatus, number> = { question: 0, fixed: 1, open: 2, closed: 3 };
  const count = (f: (typeof FILTERS)[number]) => state.notes.filter((n) => f.statuses.includes(n.status)).length;
  const shown = FILTERS.find((f) => f.id === filter)!;
  const notes = state.notes.filter((n) => shown.statuses.includes(n.status)).sort((a, b) => order[a.status] - order[b.status] || a.ms - b.ms);
  const withAgent = state.notes.filter((n) => n.status === 'open').length;

  return (
    <>
      {state.notesError && <Alert>{state.notesError}</Alert>}
      <div style={{ ...card, background: open ? C.peachSoft : C.surface, borderColor: open ? C.peachDeep : C.line }}>
        <label htmlFor="new-note" style={{ display: 'flex', alignItems: 'baseline', gap: S.gap, marginBottom: S.gap, color: C.ink, fontWeight: 600 }}>
          New note <span style={{ fontWeight: 400, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>at {now}</span>
        </label>
        <textarea
          id="new-note"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => (setFocused(true), onWrite())}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add();
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          placeholder={open ? 'What should change here? Such as "zoom in more on the total".' : 'What should change here?'}
          rows={open ? 3 : 1}
          style={{ ...input, width: '100%', resize: open ? 'vertical' : 'none', display: 'block' }}
        />
        {open && (
          <div style={{ display: 'flex', gap: S.gap, alignItems: 'center', flexWrap: 'wrap', marginTop: S.gap }}>
            <select aria-label="Note scope" value={scope} onChange={(e) => setScope(e.target.value as NoteScope)} style={input}>
              {(Object.keys(SCOPE) as NoteScope[]).map((s) => (
                <option key={s} value={s}>
                  About {SCOPE[s]}
                </option>
              ))}
            </select>
            {attached ? (
              <span style={{ color: C.ink }}>
                on <strong>{attached.target}</strong>{' '}
                <button onClick={() => setAttached(undefined)} style={subtle}>
                  remove
                </button>
              </span>
            ) : (
              <button style={quiet} onMouseDown={(e) => e.preventDefault()} onClick={attach} disabled={!api}>
                Attach to a target
              </button>
            )}
            <button onClick={() => void add()} style={{ ...primary, marginLeft: 'auto' }} disabled={!text.trim()} title="Ctrl+Enter">
              Add note
            </button>
          </div>
        )}
      </div>

      {state.notes.length > 0 && (
        <div role="radiogroup" aria-label="Show notes" style={{ display: 'flex', gap: S.gap / 2, margin: `${S.gap * 2}px 0 ${S.gap}px`, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const selected = f.id === filter;
            return (
              <button
                key={f.id}
                role="radio"
                aria-checked={selected}
                onClick={() => onFilter(f.id)}
                style={{ ...control, padding: '3px 10px', fontSize: S.small, fontWeight: 600, background: selected ? C.ink : 'transparent', color: selected ? C.surface : C.muted }}
              >
                {f.label} <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{count(f)}</span>
              </button>
            );
          })}
        </div>
      )}
      {withAgent > 0 && (filter === 'all' || filter === 'agent') && (
        <p style={{ color: C.muted, fontSize: S.small, margin: `0 0 ${S.gap}px` }}>
          The agent picks up notes when you ask it to, such as "fix my notes in Muse".
        </p>
      )}

      {!state.notes.length && (
        <div style={{ color: C.muted, margin: `${S.gap * 3}px ${S.gap}px 0`, lineHeight: 1.6 }}>
          <div style={{ color: C.ink, fontWeight: 600, marginBottom: S.gap / 2 }}>No notes yet</div>
          Play the video and press <Key>N</Key> wherever something should change. The agent replies here, and you approve the video at the top once it is right.
        </div>
      )}
      {state.notes.length > 0 && !notes.length && <p style={{ color: C.muted, margin: `${S.gap}px 0 0` }}>Nothing here.</p>}
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onSeek={onSeek} />
      ))}
    </>
  );
}

function NoteCard({ note, onSeek }: { note: Note; onSeek: (f: number) => void }) {
  const [reply, setReply] = useState('');
  const [mode, setMode] = useState<'idle' | 'replying' | 'editing' | 'deleting'>('idle');
  const [draft, setDraft] = useState(note.text);
  const patch = (change: Partial<Note>) => fetch(`${API}/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
  const send = async () => {
    const body: ReplyRequest = { text: reply.trim(), status: 'open' };
    await fetch(`${API}/notes/${note.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setReply('');
    setMode('idle');
  };
  const save = async () => {
    await patch({ text: draft.trim() });
    setMode('idle');
  };
  const remove = () => fetch(`${API}/notes/${note.id}`, { method: 'DELETE' });
  const turn = TURN[note.status];
  const yours = note.status === 'question' || note.status === 'fixed';
  const replyBox = (placeholder: string, action: string, cancel: boolean) => (
    <div style={{ marginTop: S.gap }}>
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && reply.trim() && void send()}
        placeholder={placeholder}
        rows={2}
        style={{ ...input, width: '100%', resize: 'vertical', display: 'block' }}
      />
      <div style={{ display: 'flex', gap: S.gap, marginTop: S.gap }}>
        <button style={primary} disabled={!reply.trim()} onClick={() => void send()}>
          {action}
        </button>
        {cancel && (
          <button style={quiet} onClick={() => setMode('idle')}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-note={note.id}
      data-status={note.status}
      style={{
        ...card,
        marginTop: S.gap,
        borderWidth: '1px 1px 1px 3px',
        background: yours ? '#FFFBF2' : C.surface,
        borderColor: `${C.line} ${C.line} ${C.line} ${turn.edge}`,
        opacity: note.status === 'closed' ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: S.gap, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={turn.tone}>{turn.label}</span>
        <button onClick={() => onSeek(note.frame)} style={link} title="Jump to this moment">
          {clock(note.ms)}
        </button>
        <span style={{ flex: 1, minWidth: 0, color: C.muted, fontSize: S.small }}>
          {note.scene}
          {note.scope !== 'moment' && ` · ${SCOPE[note.scope]}`}
          {note.target && ` · on ${note.target}`}
        </span>
      </div>
      {turn.detail && <div style={{ marginTop: S.gap, color: C.yoursText, fontWeight: 600 }}>{turn.detail}</div>}
      {mode === 'editing' ? (
        <div style={{ marginTop: S.gap }}>
          <textarea aria-label="Note" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ ...input, width: '100%', resize: 'vertical', display: 'block' }} autoFocus />
          <div style={{ display: 'flex', gap: S.gap, marginTop: S.gap }}>
            <button style={primary} disabled={!draft.trim()} onClick={() => void save()}>
              Save
            </button>
            <button style={quiet} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: S.gap, whiteSpace: 'pre-wrap', color: C.ink }}>{note.text}</div>
      )}
      {note.replies.map((r, i) => (
        <div key={i} style={{ marginTop: S.gap, padding: `${S.gap / 2}px ${S.gap}px`, borderRadius: S.radius, background: r.from === 'agent' ? C.agentBg : C.peachSoft, whiteSpace: 'pre-wrap', color: C.ink }}>
          <span style={{ fontWeight: 600 }}>{r.from === 'agent' ? 'Agent:' : 'You:'}</span> {r.text}
        </div>
      ))}
      {note.status === 'question' && replyBox('Answer the agent', 'Send answer', false)}
      {note.status === 'fixed' &&
        (mode === 'replying' ? (
          replyBox('What still needs changing?', 'Send', true)
        ) : (
          <div style={{ display: 'flex', gap: S.gap, marginTop: S.gap }}>
            <button style={primary} onClick={() => void patch({ status: 'closed' })}>
              Approve fix
            </button>
            <button style={quiet} onClick={() => setMode('replying')}>
              Not fixed yet
            </button>
          </div>
        ))}
      {note.status === 'closed' && mode === 'replying' && replyBox('What still needs changing?', 'Reopen', true)}
      {mode !== 'editing' && (
        <div style={{ display: 'flex', gap: S.gap * 1.5, marginTop: S.gap, justifyContent: 'flex-end', alignItems: 'center' }}>
          {mode === 'deleting' ? (
            <>
              <span style={{ color: C.muted, fontSize: S.small }}>Delete this note?</span>
              <button style={{ ...subtle, color: C.errText }} onClick={() => void remove()}>
                Yes, delete
              </button>
              <button style={subtle} onClick={() => setMode('idle')}>
                Keep it
              </button>
            </>
          ) : (
            <>
              {/* Once the agent has replied, the note is a conversation: add to it rather than rewrite it. */}
              {note.status === 'open' && !note.replies.length && (
                <button style={subtle} onClick={() => (setDraft(note.text), setMode('editing'))}>
                  edit
                </button>
              )}
              {note.status === 'closed' && mode !== 'replying' && (
                <button style={subtle} onClick={() => setMode('replying')}>
                  reopen
                </button>
              )}
              <button style={subtle} onClick={() => setMode('deleting')}>
                delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Scenes and beats: jump to any of them, and edit them.

function Scenes(props: { state: StudioState; timeline: Timeline; ready: ReadyReport | undefined; frame: number; onSeek: (f: number) => void; onEdit: (change: (s: RawScript) => void) => Promise<void>; onPick: (done: (target: string) => void) => void }) {
  const { state, timeline } = props;
  const script = state.script as RawScript | undefined;
  const current = sceneAt(timeline, props.frame);
  return (
    <>
      <p style={{ color: C.muted, margin: `0 0 ${S.gap * 1.5}px` }}>Click a time to jump there, the narration to edit it, or edit on a beat to change the camera and highlight.</p>
      {timeline.scenes.map((scene) => (
        <SceneCard key={scene.index} {...props} scene={scene} raw={script?.scenes?.[scene.index]} active={current?.index === scene.index} />
      ))}
    </>
  );
}

function SceneCard(props: { state: StudioState; timeline: Timeline; ready: ReadyReport | undefined; scene: TimedScene; raw: RawScene | undefined; active: boolean; onSeek: (f: number) => void; onEdit: (change: (s: RawScript) => void) => Promise<void>; onPick: (done: (target: string) => void) => void }) {
  const { timeline, scene, raw, state } = props;
  const [editingSay, setEditingSay] = useState(false);
  const [say, setSay] = useState(raw?.say ?? '');
  const [editing, setEditing] = useState<number | 'new'>();
  const problems = state.diagnostics.filter((d) => d.path === `scenes[${scene.index}]` || d.path.startsWith(`scenes[${scene.index}].`) && !d.path.startsWith(`scenes[${scene.index}].beats[`));
  const stage = props.ready?.stages[scene.stage];
  const targets = ['all', ...(stage?.available ?? [])];
  const values = Object.keys(stage?.values ?? {});
  const cues = Object.keys(scene.cues);

  return (
    <div data-scene={scene.id} style={{ ...card, marginBottom: S.gap * 1.5, borderColor: props.active ? C.accent : C.line, boxShadow: props.active ? `0 0 0 1px ${C.accent}` : 'none' }}>
      <div style={{ display: 'flex', gap: S.gap, alignItems: 'baseline' }}>
        <button onClick={() => props.onSeek(scene.from)} style={{ ...link, fontWeight: 600, fontSize: S.text + 1 }}>
          {scene.id}
        </button>
        <span style={{ color: C.muted }}>
          {scene.stage} · {clock((scene.from / timeline.fps) * 1000)} · {(scene.frames / timeline.fps).toFixed(1)} s
        </span>
        {props.active && <span style={{ ...pill(C.peach, C.ink), marginLeft: 'auto' }}>Now playing</span>}
      </div>
      {editingSay ? (
        <div style={{ marginTop: S.gap }}>
          <textarea value={say} onChange={(e) => setSay(e.target.value)} style={{ ...input, width: '100%', minHeight: 90 }} />
          <div style={{ color: C.muted, fontSize: S.small, margin: `${S.gap / 2}px 0` }}>Put a [cue] at the start of a sentence to hang a beat on it. Changed sentences are voiced again.</div>
          <div style={{ display: 'flex', gap: S.gap }}>
            <button
              style={primary}
              onClick={() =>
                void props.onEdit((s) => {
                  s.scenes[scene.index]!.say = say;
                }).then(() => setEditingSay(false))
              }
            >
              Save narration
            </button>
            <button style={quiet} onClick={() => setEditingSay(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: S.gap, color: C.ink, cursor: 'text', lineHeight: 1.5 }} title="Click to edit the narration" onClick={() => (setSay(raw?.say ?? ''), setEditingSay(true))}>
          {scene.sentences.map((s, i) => (
            <span key={i}>
              {s.cues.map((c) => (
                <span key={c} style={{ color: C.accent, fontWeight: 600 }}>[{c}]</span>
              ))}
              {s.text}{' '}
            </span>
          ))}
        </div>
      )}
      <DiagnosticList diagnostics={problems} />
      {scene.beats.length > 0 && <div style={{ marginTop: S.gap * 1.5, borderTop: `1px solid ${C.line}` }} />}
      {scene.beats.map((beat) => {
        const beatProblems = state.diagnostics.filter((d) => d.path.startsWith(`scenes[${scene.index}].beats[${beat.index}]`));
        return editing === beat.index ? (
          <BeatEditor
            key={beat.index}
            initial={raw?.beats?.[beat.index] ?? { at: beat.at }}
            cues={cues}
            targets={targets}
            values={values}
            onPick={props.onPick}
            onCancel={() => setEditing(undefined)}
            onDelete={() =>
              void props.onEdit((s) => {
                s.scenes[scene.index]!.beats!.splice(beat.index, 1);
              }).then(() => setEditing(undefined))
            }
            onSave={(next) =>
              void props.onEdit((s) => {
                s.scenes[scene.index]!.beats![beat.index] = next;
              }).then(() => setEditing(undefined))
            }
          />
        ) : (
          <div key={beat.index} style={{ marginTop: S.gap }}>
            <div style={{ display: 'flex', gap: S.gap, alignItems: 'baseline' }}>
              <button onClick={() => props.onSeek(settle(timeline, scene, beat))} style={link}>
                {clock((beat.cue / timeline.fps) * 1000)}
              </button>
              <span style={{ ...pill(C.agentBg, C.agentText), fontSize: S.small }}>{beat.at}</span>
              <span style={{ flex: 1, color: C.ink }}>{describe(beat)}</span>
              <button onClick={() => setEditing(beat.index)} style={link}>
                edit
              </button>
            </div>
            <DiagnosticList diagnostics={beatProblems} />
          </div>
        );
      })}
      {editing === 'new' ? (
        <BeatEditor
          initial={{ at: cues.find((c) => !scene.beats.some((b) => b.at === c)) ?? 'end', camera: { to: 'all' } }}
          cues={cues}
          targets={targets}
          values={values}
          onPick={props.onPick}
          onCancel={() => setEditing(undefined)}
          onSave={(next) =>
            void props.onEdit((s) => {
              const target = s.scenes[scene.index]!;
              target.beats = [...(target.beats ?? []), next];
            }).then(() => setEditing(undefined))
          }
        />
      ) : (
        <button onClick={() => setEditing('new')} style={{ ...link, display: 'inline-block', marginTop: S.gap }}>
          + add beat
        </button>
      )}
    </div>
  );
}

function BeatEditor(props: {
  initial: RawBeat;
  cues: string[];
  targets: string[];
  values: string[];
  onPick: (done: (target: string) => void) => void;
  onSave: (beat: RawBeat) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const i = props.initial;
  const [at, setAt] = useState(i.at);
  const [camera, setCamera] = useState(i.camera?.to ?? '');
  const [zoom, setZoom] = useState(i.camera?.zoom === undefined ? 'fit' : String(i.camera.zoom));
  const [align, setAlign] = useState(i.camera?.align ?? 'center');
  const [highlight, setHighlight] = useState(i.highlight === false ? '(clear)' : (i.highlight ?? ''));
  const [animate, setAnimate] = useState<string[]>(i.animate === undefined ? [] : typeof i.animate === 'string' ? [i.animate] : i.animate);

  const build = (): RawBeat => {
    const beat: RawBeat = { at };
    if (camera) {
      const z = zoom === 'fit' || zoom === 'width' ? zoom : Number(zoom);
      beat.camera = { to: camera, ...(z !== 'fit' && { zoom: z }), ...(align !== 'center' && { align }) };
    }
    if (highlight) beat.highlight = highlight === '(clear)' ? false : highlight;
    if (animate.length) beat.animate = animate.length === 1 ? animate[0]! : animate;
    return beat;
  };
  const row: CSSProperties = { display: 'flex', gap: S.gap, alignItems: 'center', marginTop: S.gap };

  return (
    <div style={{ marginTop: S.gap, padding: S.gap * 1.5, borderRadius: S.radius, background: C.page, border: `1px solid ${C.line}` }}>
      <div style={row}>
        <span style={label}>at cue</span>
        <select value={at} onChange={(e) => setAt(e.target.value)} style={input}>
          {props.cues.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div style={row}>
        <span style={label}>camera</span>
        <select value={camera} onChange={(e) => setCamera(e.target.value)} style={input}>
          <option value="">(no move)</option>
          {props.targets.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button style={quiet} onClick={() => props.onPick(setCamera)}>
          pick
        </button>
        {camera && camera !== 'all' && (
          <>
            <select value={zoom} onChange={(e) => setZoom(e.target.value)} style={input}>
              <option>fit</option>
              <option>width</option>
              {['1.5', '2', '2.5'].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
            <select value={align} onChange={(e) => setAlign(e.target.value as 'center' | 'top')} style={input}>
              <option>center</option>
              <option>top</option>
            </select>
          </>
        )}
      </div>
      <div style={row}>
        <span style={label}>highlight</span>
        <select value={highlight} onChange={(e) => setHighlight(e.target.value)} style={input}>
          <option value="">(unchanged)</option>
          <option value="(clear)">(clear)</option>
          {props.targets.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button style={quiet} onClick={() => props.onPick(setHighlight)}>
          pick
        </button>
      </div>
      {props.values.length > 0 && (
        <div style={row}>
          <span style={label}>animate</span>
          {props.values.map((v) => (
            <label key={v} style={{ color: C.ink }}>
              <input type="checkbox" checked={animate.includes(v)} onChange={(e) => setAnimate(e.target.checked ? [...animate, v] : animate.filter((x) => x !== v))} /> {v}
            </label>
          ))}
        </div>
      )}
      <div style={{ ...row, marginTop: S.gap * 1.5 }}>
        <button style={primary} onClick={() => props.onSave(build())} disabled={!camera && !highlight && !animate.length}>
          Save beat
        </button>
        <button style={quiet} onClick={props.onCancel}>
          Cancel
        </button>
        {props.onDelete && (
          <button style={{ ...quiet, marginLeft: 'auto', color: C.errText }} onClick={props.onDelete}>
            Delete beat
          </button>
        )}
      </div>
    </div>
  );
}

function Problems({ diagnostics, error }: { diagnostics: Diagnostic[]; error: string | undefined }) {
  if (!error && !diagnostics.length) return null;
  return (
    <div style={{ ...card, marginBottom: S.gap * 1.5, background: C.errBg, borderColor: C.errText }}>
      <div style={{ fontWeight: 600, color: C.errText }}>Problems</div>
      {error && <div style={{ color: C.errText, whiteSpace: 'pre-wrap', marginTop: S.gap / 2 }}>{error}</div>}
      <DiagnosticList diagnostics={diagnostics} />
    </div>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <>
      {diagnostics.map((d, i) => (
        <div key={i} style={{ marginTop: S.gap / 2, fontSize: S.small, color: d.level === 'error' ? C.errText : C.warnText }}>
          {d.message}
          {d.fix && <div style={{ color: C.muted }}>Fix: {d.fix}</div>}
        </div>
      ))}
    </>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return <div style={{ ...card, marginBottom: S.gap * 1.5, background: C.errBg, borderColor: C.errText, color: C.errText, whiteSpace: 'pre-wrap' }}>{children}</div>;
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd style={{ display: 'inline-block', minWidth: 18, padding: '0 5px', borderStyle: 'solid', borderWidth: '1px 1px 2px', borderColor: C.line, borderRadius: 4, background: C.surface, color: C.ink, font: 'inherit', fontSize: S.small, textAlign: 'center' }}>
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------------------------
// Helpers

function sceneAt(timeline: Timeline, frame: number): TimedScene | undefined {
  let found: TimedScene | undefined;
  for (const scene of timeline.scenes) if (frame >= scene.from) found = scene;
  return found;
}

/** The sentence being spoken at a frame: the last one to have started. */
function sentenceAt(scene: TimedScene, frame: number): string | undefined {
  let found: string | undefined;
  for (const s of scene.sentences) if (frame >= s.from) found = s.text;
  return found;
}

/** Where a beat's movement has finished, inside its scene: the same frame verify's still shows. */
function settle(timeline: Timeline, scene: TimedScene, beat: TimedBeat): number {
  let f = beat.cue;
  if (beat.camera) f = Math.max(f, beat.camera.from + beat.camera.frames);
  if (beat.highlight) f = Math.max(f, beat.highlight.from + Math.max(timeline.highlightFrames.slide, timeline.highlightFrames.fade));
  if (beat.animate) f = Math.max(f, beat.animate.from + beat.animate.frames);
  return Math.min(f, scene.from + scene.frames - 1);
}

function describe(beat: TimedBeat): string {
  const parts: string[] = [];
  if (beat.camera) parts.push(`camera to ${beat.camera.to}${beat.camera.to === 'all' ? '' : ` (${beat.camera.zoom})`}`);
  if (beat.highlight) parts.push(beat.highlight.to === false ? 'clear highlight' : `highlight ${beat.highlight.to}`);
  if (beat.animate) parts.push(`animate ${beat.animate.values.join(', ')}`);
  return parts.join(', ');
}

/** Minutes, seconds and milliseconds: 01:02.345. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor(total / 1000) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, height: '100%' }}>{children}</div>;
}
