// The studio: watch a walkthrough with its narration, change it, and leave notes for the agent,
// all pinned to the exact moment. The player runs in an iframe (the same page renders use), so the
// preview is the video, and the app's styles never reach the studio's own controls. Every change
// is written to script.json, which stays the single source of truth for the agent too.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Diagnostic } from '../check/diagnostic.ts';
import type { StudioState, Note } from '../studio/protocol.ts';
import type { TimedBeat, TimedScene, Timeline } from '../timing/timeline.ts';
import type { Rect } from './motion.ts';
import type { ReadyReport, TourApi } from './player.tsx';
import type { ScreenDescription } from './screen.ts';

const API = '/__tourwright/api';

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

function usePlayer(timeline: Timeline | undefined, version: number | undefined) {
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
  }, [timeline, version]);

  return { frameRef, ready, api };
}

// ---------------------------------------------------------------------------------------------
// The studio

function Studio() {
  const [state] = useStudioState();
  const timeline = state?.timeline;
  const { frameRef, ready, api } = usePlayer(timeline, state?.version);
  const audio = useRef<HTMLAudioElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string>();
  const [picking, setPicking] = useState<((target: string) => void) | undefined>();
  const noteInput = useRef<HTMLTextAreaElement>(null);

  const fps = timeline?.fps ?? 30;
  const frames = timeline?.frames ?? 1;

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

  // Each (re)start leaves the player on its measuring render, so draw the current frame again.
  // The player object is the same across restarts; the ready report is new each time.
  useEffect(() => {
    if (api) show(frame, 'settle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ready]);

  // Playback follows the audio clock, so picture and narration never drift apart.
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let last = -1;
    const tick = () => {
      const a = audio.current;
      if (!a) return;
      const f = Math.floor(a.currentTime * fps);
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
    },
    [show, fps],
  );

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      show(frame, 'settle');
    } else {
      if (frame >= frames - 1) a.currentTime = 0;
      else a.currentTime = frame / fps;
      void a.play();
      setPlaying(true);
    }
  }, [playing, frame, frames, fps, show]);

  // Keyboard: space plays, arrows step a frame (with Shift, a second), N writes a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (typing) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (playing) toggle();
        seek(frame + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? fps : 1));
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (playing) toggle();
        noteInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, frame, fps, playing]);

  const edit = useCallback(
    async (change: (script: RawScript) => void) => {
      if (!state) return;
      setMessage('Saving...');
      const error = await saveScript(state, change);
      setMessage(error);
    },
    [state],
  );

  if (!state) return <Centered>Loading the studio...</Centered>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: 16, gap: 12 }}>
        <Header state={state} message={message} />
        {timeline ? (
          <Preview timeline={timeline} frameRef={frameRef} api={api} picking={picking} onPick={(t) => (picking?.(t), setPicking(undefined))} onCancelPick={() => setPicking(undefined)} frame={frame} />
        ) : (
          <Centered>{state.preparing ? 'Voicing the narration...' : 'This walkthrough could not be prepared. See the problems on the right.'}</Centered>
        )}
        {timeline && (
          <Transport timeline={timeline} frame={frame} playing={playing} onToggle={toggle} onSeek={(f) => (playing && toggle(), seek(f))} />
        )}
        <audio ref={audio} src={`${API}/soundtrack.wav?v=${state.version}`} preload="auto" onEnded={() => setPlaying(false)} />
      </div>
      <aside style={{ borderLeft: '1px solid #1e293b', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Notes state={state} timeline={timeline} api={api} frame={frame} audio={audio} inputRef={noteInput} onSeek={seek} />
        <Problems diagnostics={state.diagnostics.filter((d) => !/^scenes\[/.test(d.path))} error={state.error} />
        {timeline && (
          <Scenes
            state={state}
            timeline={timeline}
            ready={ready}
            frame={frame}
            onSeek={(f) => (playing && toggle(), seek(f))}
            onEdit={edit}
            onPick={(done) => setPicking(() => done)}
          />
        )}
      </aside>
    </div>
  );
}

function Header({ state, message }: { state: StudioState; message: string | undefined }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <strong style={{ fontSize: 16 }}>{state.name}</strong>
      <span style={{ color: '#94a3b8' }}>{state.preparing ? 'Voicing changes...' : 'Tourwright studio'}</span>
      {message && <span style={{ marginLeft: 'auto', color: message === 'Saving...' ? '#94a3b8' : '#fca5a5' }}>{message}</span>}
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
}) {
  const { timeline, frameRef, api, picking, frame } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / timeline.layout.width, el.clientHeight / timeline.layout.height));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [timeline.layout.width, timeline.layout.height]);

  const targets = useMemo<{ name: string; rect: Rect }[]>(() => (picking && api ? api.targetsOnScreen() : []), [picking, api, frame]);

  return (
    <div ref={box} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: timeline.layout.width * scale, height: timeline.layout.height * scale, boxShadow: '0 0 0 1px #334155' }}>
        <iframe
          ref={frameRef}
          src="/__tourwright/"
          title="Preview"
          style={{ border: 0, width: timeline.layout.width, height: timeline.layout.height, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', background: '#fff' }}
        />
        {picking && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.35)', cursor: 'crosshair' }} onClick={props.onCancelPick}>
            {targets.map((t) => (
              <button
                key={t.name}
                title={t.name}
                onClick={(e) => (e.stopPropagation(), props.onPick(t.name))}
                style={{
                  position: 'absolute',
                  left: t.rect.x * scale,
                  top: t.rect.y * scale,
                  width: t.rect.w * scale,
                  height: t.rect.h * scale,
                  border: '2px solid #38bdf8',
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#0f172a',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span style={{ position: 'absolute', left: 0, top: 0, background: '#38bdf8', padding: '1px 5px', fontSize: 12 }}>{t.name}</span>
              </button>
            ))}
            <div style={{ position: 'absolute', left: 8, bottom: 8, background: '#0f172a', padding: '4px 8px', borderRadius: 4 }}>
              Click a target, or anywhere else to cancel. Scrub first if it is not in view.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Transport: play, time to the millisecond, and a scrubber marked with scenes and cues.

function Transport({ timeline, frame, playing, onToggle, onSeek }: { timeline: Timeline; frame: number; playing: boolean; onToggle: () => void; onSeek: (f: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left) / r.width) * (timeline.frames - 1)));
  };
  const percent = (f: number) => `${(f / timeline.frames) * 100}%`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button onClick={onToggle} style={button}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 150 }}>
        {clock((frame / timeline.fps) * 1000)} <span style={{ color: '#64748b' }}>frame {frame}</span>
      </span>
      <div
        ref={bar}
        onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), at(e))}
        onPointerMove={(e) => e.buttons === 1 && at(e)}
        style={{ position: 'relative', flex: 1, height: 36, background: '#1e293b', borderRadius: 4, cursor: 'pointer', overflow: 'hidden' }}
      >
        <Segment left="0%" width={percent(timeline.titleFrames)} label="title" />
        {timeline.scenes.map((s, i) => (
          <Segment key={i} left={percent(s.from)} width={percent(s.frames)} label={s.id} />
        ))}
        {timeline.scenes.flatMap((s) =>
          s.beats.map((b) => <div key={`${s.index}-${b.index}`} style={{ position: 'absolute', left: percent(b.cue), bottom: 0, width: 2, height: 10, background: '#38bdf8' }} />),
        )}
        <div style={{ position: 'absolute', left: percent(frame), top: 0, bottom: 0, width: 2, background: '#f8fafc' }} />
      </div>
    </div>
  );
}

function Segment({ left, width, label }: { left: string; width: string; label: string }) {
  return (
    <div style={{ position: 'absolute', left, width, top: 0, bottom: 0, borderLeft: '1px solid #334155', padding: '2px 6px', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Notes for the agent, pinned to the millisecond.

function Notes({ state, timeline, api, frame, audio, inputRef, onSeek }: { state: StudioState; timeline: Timeline | undefined; api: TourApi | undefined; frame: number; audio: React.RefObject<HTMLAudioElement | null>; inputRef: React.RefObject<HTMLTextAreaElement | null>; onSeek: (f: number) => void }) {
  const [text, setText] = useState('');
  // The playhead to the millisecond: the audio clock while it has one, else the frame.
  const ms = () => Math.round(audio.current && !audio.current.paused ? audio.current.currentTime * 1000 : (frame / (timeline?.fps ?? 30)) * 1000);

  const add = async () => {
    if (!text.trim() || !timeline) return;
    const at = ms();
    const f = Math.min(timeline.frames - 1, Math.floor((at / 1000) * timeline.fps));
    const scene = sceneAt(timeline, f);
    const sentence = scene ? sentenceAt(scene, f) : undefined;
    // What is on screen at the note's frame, so the agent can read it rather than guess.
    let screen: ScreenDescription | undefined;
    if (api) {
      api.setFrame(f, 'settle');
      screen = api.describe();
    }
    const note = {
      ms: at,
      frame: f,
      scene: scene?.id ?? 'title',
      sceneIndex: scene?.index ?? -1,
      ...(sentence && { sentence }),
      text: text.trim(),
      ...(screen && { screen }),
    };
    await fetch(`${API}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) });
    setText('');
  };
  const update = (note: Note, change: Partial<Note>) =>
    fetch(`${API}/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
  const remove = (note: Note) => fetch(`${API}/notes/${note.id}`, { method: 'DELETE' });

  return (
    <Section title={`Notes for the agent (${state.notes.filter((n) => n.status === 'open').length} open)`}>
      {state.notesError && <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{state.notesError}</div>}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add();
        }}
        placeholder={`Note at ${clock((frame / (timeline?.fps ?? 30)) * 1000)}, such as "zoom in more on the total". Ctrl+Enter to add. Press N anywhere to write one.`}
        style={{ ...input, width: '100%', minHeight: 56, resize: 'vertical' }}
      />
      <button onClick={() => void add()} style={{ ...button, marginTop: 6 }} disabled={!text.trim()}>
        Add note at {clock((frame / (timeline?.fps ?? 30)) * 1000)}
      </button>
      {state.notes.map((note) => (
        <div key={note.id} style={{ marginTop: 8, padding: 8, borderRadius: 4, background: '#1e293b', opacity: note.status === 'done' ? 0.6 : 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <a onClick={() => onSeek(note.frame)} style={link}>
              {clock(note.ms)}
            </a>
            <span style={{ color: '#94a3b8' }}>{note.scene}</span>
            <label style={{ marginLeft: 'auto', color: '#94a3b8' }}>
              <input type="checkbox" checked={note.status === 'done'} onChange={(e) => void update(note, { status: e.target.checked ? 'done' : 'open' })} /> done
            </label>
            <a onClick={() => void remove(note)} style={{ ...link, color: '#fca5a5' }}>
              delete
            </a>
          </div>
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{note.text}</div>
          {note.resolution && <div style={{ marginTop: 4, color: '#86efac' }}>Agent: {note.resolution}</div>}
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Scenes and beats: jump to any of them, and edit them.

function Scenes(props: { state: StudioState; timeline: Timeline; ready: ReadyReport | undefined; frame: number; onSeek: (f: number) => void; onEdit: (change: (s: RawScript) => void) => Promise<void>; onPick: (done: (target: string) => void) => void }) {
  const { state, timeline } = props;
  const script = state.script as RawScript | undefined;
  const current = sceneAt(timeline, props.frame);
  return (
    <Section title="Scenes and beats">
      {timeline.scenes.map((scene) => (
        <SceneCard key={scene.index} {...props} scene={scene} raw={script?.scenes?.[scene.index]} active={current?.index === scene.index} />
      ))}
    </Section>
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
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: props.active ? '#1e293b' : 'transparent', border: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <a onClick={() => props.onSeek(scene.from)} style={{ ...link, fontWeight: 600 }}>
          {scene.id}
        </a>
        <span style={{ color: '#94a3b8' }}>
          {scene.stage} · {clock((scene.from / timeline.fps) * 1000)} · {(scene.frames / timeline.fps).toFixed(1)} s
        </span>
      </div>
      {editingSay ? (
        <div style={{ marginTop: 6 }}>
          <textarea value={say} onChange={(e) => setSay(e.target.value)} style={{ ...input, width: '100%', minHeight: 90 }} />
          <div style={{ color: '#64748b', fontSize: 12 }}>Put a [cue] at the start of a sentence to hang a beat on it. Changed sentences are voiced again.</div>
          <button
            style={button}
            onClick={() =>
              void props.onEdit((s) => {
                s.scenes[scene.index]!.say = say;
              }).then(() => setEditingSay(false))
            }
          >
            Save narration
          </button>{' '}
          <button style={quiet} onClick={() => setEditingSay(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 6, color: '#cbd5e1', cursor: 'text' }} title="Click to edit the narration" onClick={() => (setSay(raw?.say ?? ''), setEditingSay(true))}>
          {scene.sentences.map((s, i) => (
            <span key={i}>
              {s.cues.map((c) => (
                <span key={c} style={{ color: '#38bdf8' }}>[{c}]</span>
              ))}
              {s.text}{' '}
            </span>
          ))}
        </div>
      )}
      <DiagnosticList diagnostics={problems} />
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
          <div key={beat.index} style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <a onClick={() => props.onSeek(settle(timeline, scene, beat))} style={link}>
                {clock((beat.cue / timeline.fps) * 1000)}
              </a>
              <span style={{ color: '#38bdf8' }}>{beat.at}</span>
              <span style={{ flex: 1 }}>{describe(beat)}</span>
              <a onClick={() => setEditing(beat.index)} style={link}>
                edit
              </a>
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
        <a onClick={() => setEditing('new')} style={{ ...link, display: 'inline-block', marginTop: 6 }}>
          + add beat
        </a>
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
  const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 };

  return (
    <div style={{ marginTop: 6, padding: 8, borderRadius: 4, background: '#0b1220', border: '1px solid #334155' }}>
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
            <label key={v} style={{ color: '#cbd5e1' }}>
              <input type="checkbox" checked={animate.includes(v)} onChange={(e) => setAnimate(e.target.checked ? [...animate, v] : animate.filter((x) => x !== v))} /> {v}
            </label>
          ))}
        </div>
      )}
      <div style={{ ...row, marginTop: 10 }}>
        <button style={button} onClick={() => props.onSave(build())} disabled={!camera && !highlight && !animate.length}>
          Save beat
        </button>
        <button style={quiet} onClick={props.onCancel}>
          Cancel
        </button>
        {props.onDelete && (
          <button style={{ ...quiet, marginLeft: 'auto', color: '#fca5a5' }} onClick={props.onDelete}>
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
    <Section title="Problems">
      {error && <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{error}</div>}
      <DiagnosticList diagnostics={diagnostics} />
    </Section>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <>
      {diagnostics.map((d, i) => (
        <div key={i} style={{ marginTop: 4, fontSize: 12, color: d.level === 'error' ? '#fca5a5' : '#fcd34d' }}>
          {d.message}
          {d.fix && <div style={{ color: '#94a3b8' }}>Fix: {d.fix}</div>}
        </div>
      ))}
    </>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ padding: 14, borderBottom: '1px solid #1e293b' }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', marginBottom: 8 }}>{title}</div>
      {children}
    </section>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', height: '100%' }}>{children}</div>;
}

const button: CSSProperties = { background: '#2563eb', color: '#fff', border: 0, borderRadius: 4, padding: '6px 12px', cursor: 'pointer', font: 'inherit' };
const quiet: CSSProperties = { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', font: 'inherit' };
const input: CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '4px 6px', font: 'inherit', boxSizing: 'border-box' };
const label: CSSProperties = { width: 70, color: '#94a3b8' };
const link: CSSProperties = { color: '#7dd3fc', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' };
