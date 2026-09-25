// Narration boxes placed and timed by hand in Muse. A reviewer picks a target (or draws an area),
// and sets when the box shows and when it goes on a track under the scrubber. Each edit is written
// into script.json the way an agent would write it: a beat that moves the narration box at the
// sentence where it starts, and one that clears it (or brings back the box it covered) where it
// ends. Times stay in words, not seconds: both edges sit on sentence starts, where a cue can go.
//
// Pure functions on the script as written, so Muse runs them in the browser and tests run them here.

import { parseNarration } from '../narration/parse.ts';
import { NAME_PATTERN } from '../schema/names.ts';
import type { Timeline } from '../timing/timeline.ts';

export interface BoxBeat {
  at: string;
  camera?: unknown;
  highlight?: string | false;
  animate?: unknown;
}
export interface BoxScene {
  id?: string;
  stage: string;
  say: string;
  beats?: BoxBeat[];
}
export interface BoxArea {
  stage: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface BoxScript {
  scenes: BoxScene[];
  areas?: Record<string, BoxArea>;
}

/**
 * Where a narration box starts or ends inside a scene, counted in sentence starts: 0 is the scene's
 * start (its first sentence), n its end once the last sentence has been spoken.
 */
export type Place = number;

/** One stretch of the video with a narration box on screen, as the track shows it. */
export interface Segment {
  /** The target (or drawn area) the box is on. */
  target: string;
  /** The scene whose beat puts it there, and that beat's index in the scene's beats. */
  scene: number;
  beat: number;
  /** Global frames, from the sentence start where it appears up to where it goes. */
  from: number;
  to: number;
  /** Places within its scene. `end` is the scene's sentence count when it lasts to the scene's end or beyond. */
  start: Place;
  end: Place;
  /** True when it carries on into the next scene (same stage, no beat changes it). */
  carries: boolean;
}

/** The narration boxes on a timeline, in order, cut where a scene on another stage begins. */
export function segments(timeline: Timeline): Segment[] {
  const out: Segment[] = [];
  let open: Segment | undefined;
  let stage: string | undefined;
  const close = (at: number, scene: number, place?: Place) => {
    if (!open) return;
    open.to = at;
    if (open.scene === scene && place !== undefined) open.end = place;
    else open.carries = true;
    if (open.to > open.from) out.push(open);
    open = undefined;
  };
  for (const scene of timeline.scenes) {
    if (scene.stage !== stage) {
      // A cut to another stage clears the box, as the player does.
      close(scene.from, scene.index);
      stage = scene.stage;
    }
    const placeOf = (cue: number) => {
      const i = scene.sentences.findIndex((s) => s.from === cue);
      return i >= 0 ? i : cue <= scene.from ? 0 : scene.sentences.length;
    };
    for (const beat of scene.beats.filter((b) => b.highlight).sort((a, b) => a.cue - b.cue)) {
      const place = placeOf(beat.cue);
      close(beat.cue, scene.index, place);
      const to = beat.highlight!.to;
      if (to) open = { target: to, scene: scene.index, beat: beat.index, from: beat.cue, to: beat.cue, start: place, end: scene.sentences.length, carries: false };
    }
  }
  if (open) {
    const last = open as Segment;
    last.to = timeline.frames;
    if (last.to > last.from) out.push(last);
  }
  return out;
}

export interface SetBox {
  scene: number;
  target: string;
  /** Sentence starts; start < end. */
  start: Place;
  end: Place;
}

/**
 * Puts a narration box on `target` from one sentence start to another in a scene, over whatever
 * was there. Where it ends, the box that was showing before comes back (or none).
 */
export function setBox(script: BoxScript, box: SetBox): void {
  const used = usedCues(script);
  place(script, box);
  tidy(script, box.scene, used);
}

/** Moves a box's edges, keeping its target. `beat` is the index of the beat that starts it. */
export function moveBox(script: BoxScript, scene: number, beat: number, start: Place, end: Place): void {
  const target = script.scenes[scene]?.beats?.[beat]?.highlight;
  if (typeof target !== 'string') throw new Error('There is no narration box there any more: it may have been changed meanwhile.');
  const used = usedCues(script);
  remove(script, scene, beat);
  place(script, { scene, target, start, end });
  tidy(script, scene, used);
}

/** Removes a box: what was on screen before it stays on for its stretch. */
export function deleteBox(script: BoxScript, scene: number, beat: number): void {
  if (typeof script.scenes[scene]?.beats?.[beat]?.highlight !== 'string') throw new Error('There is no narration box there any more: it may have been changed meanwhile.');
  const used = usedCues(script);
  remove(script, scene, beat);
  tidy(script, scene, used);
}

/**
 * Adds an area drawn in Muse to the script's areas under a name made from the text inside it, or
 * reuses the name of the same box already there. Returns the name, for the narration box to use.
 */
export function addArea(script: BoxScript, area: BoxArea, text: string[]): string {
  const rounded: BoxArea = { stage: area.stage, x: Math.round(area.x), y: Math.round(area.y), w: Math.max(1, Math.round(area.w)), h: Math.max(1, Math.round(area.h)) };
  const areas = (script.areas ??= {});
  for (const [name, a] of Object.entries(areas)) {
    if (a.stage === rounded.stage && a.x === rounded.x && a.y === rounded.y && a.w === rounded.w && a.h === rounded.h) return name;
  }
  const words = text.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 3);
  const base = words.length ? `area-${words.join('-')}` : 'area';
  const name = unique(base, (n) => n in areas);
  areas[name] = rounded;
  return name;
}

// ---------------------------------------------------------------------------------------------

function place(script: BoxScript, box: SetBox): void {
  const scene = script.scenes[box.scene];
  if (!scene) throw new Error(`There is no scene ${box.scene}.`);
  const count = parseNarration(scene.say).sentences.length;
  const start = Math.max(0, Math.min(count - 1, Math.round(box.start)));
  const end = Math.max(start + 1, Math.min(count, Math.round(box.end)));
  // What shows where the box ends, before this edit: it comes back there.
  const after = showingAt(script, box.scene, end);
  const beats = (scene.beats ??= []);
  for (const beat of beats) {
    const at = placeOf(scene, beat.at);
    if (at !== undefined && at > start && at < end) delete beat.highlight;
  }
  beatAt(script, box.scene, start, box.target).highlight = box.target;
  const closing = beats.find((b) => placeOf(scene, b.at) === end && b.highlight !== undefined);
  if (!closing && !(end === count && endsWithScene(script, box.scene))) beatAt(script, box.scene, end, `after-${box.target}`).highlight = after;
  sortBeats(scene);
}

/**
 * Whether a box that lasts to its scene's end goes there by itself: no scene follows, the next is on
 * another stage (a cut clears it), or the next moves the narration box as it begins. Then a beat
 * at "end" to put the old box back would only flash it in the pause between scenes.
 */
function endsWithScene(script: BoxScript, sceneIndex: number): boolean {
  const scene = script.scenes[sceneIndex]!;
  const next = script.scenes[sceneIndex + 1];
  return !next || next.stage !== scene.stage || (next.beats ?? []).some((b) => b.highlight !== undefined && placeOf(next, b.at) === 0);
}

function remove(script: BoxScript, sceneIndex: number, beatIndex: number): void {
  const scene = script.scenes[sceneIndex]!;
  const beat = scene.beats![beatIndex]!;
  // What showed just before it takes its place; tidy then drops what no longer changes anything.
  beat.highlight = showingAt(script, sceneIndex, placeOf(scene, beat.at) ?? 0, beat);
}

/** The narration box showing just before `place` in a scene (a target, or false for none). */
function showingAt(script: BoxScript, sceneIndex: number, at: Place, skip?: BoxBeat): string | false {
  let showing: string | false = false;
  let stage: string | undefined;
  for (let i = 0; i <= sceneIndex; i++) {
    const scene = script.scenes[i]!;
    if (scene.stage !== stage) {
      showing = false;
      stage = scene.stage;
    }
    for (const beat of ordered(scene)) {
      if (beat === skip || beat.highlight === undefined) continue;
      const p = placeOf(scene, beat.at);
      if (p === undefined || (i === sceneIndex && p >= at)) continue;
      showing = beat.highlight;
    }
  }
  return showing;
}

/**
 * After an edit: drops narration box changes in the scene that change nothing, beats left with
 * nothing to do, cue markers the edit left unused, and areas no beat points at any more.
 */
function tidy(script: BoxScript, sceneIndex: number, usedBefore: Set<string>): void {
  const scene = script.scenes[sceneIndex]!;
  let showing = showingAt(script, sceneIndex, 0);
  for (const beat of ordered(scene)) {
    if (beat.highlight === undefined || placeOf(scene, beat.at) === undefined) continue;
    if (beat.highlight === showing) delete beat.highlight;
    else showing = beat.highlight;
  }
  scene.beats = (scene.beats ?? []).filter((b) => b.camera !== undefined || b.highlight !== undefined || b.animate !== undefined);
  if (!scene.beats.length) delete scene.beats;

  const now = usedCues(script);
  for (const key of usedBefore) {
    const [i, cue] = key.split('\u0000') as [string, string];
    if (Number(i) === sceneIndex && !now.has(key)) removeCue(scene, cue);
  }

  if (script.areas) {
    const pointed = new Set(script.scenes.flatMap((s) => (s.beats ?? []).flatMap((b) => [typeof b.highlight === 'string' ? b.highlight : '', (b.camera as { to?: string } | undefined)?.to ?? ''])));
    for (const name of Object.keys(script.areas)) if (!pointed.has(name)) delete script.areas[name];
    if (!Object.keys(script.areas).length) delete script.areas;
  }
}

/** The beat at a sentence start, made (with a cue there if need be) when there is none. */
function beatAt(script: BoxScript, sceneIndex: number, at: Place, name: string): BoxBeat {
  const scene = script.scenes[sceneIndex]!;
  const beats = (scene.beats ??= []);
  const existing = beats.find((b) => placeOf(scene, b.at) === at);
  if (existing) return existing;
  const beat: BoxBeat = { at: cueFor(scene, at, name) };
  beats.push(beat);
  return beat;
}

/** A cue at a sentence start: the one written there, "start" or "end", or a new one. */
function cueFor(scene: BoxScene, at: Place, name: string): string {
  const { sentences, markers } = parseNarration(scene.say);
  if (at <= 0 && !sentences[0]?.cues.length) return 'start';
  if (at >= sentences.length) return 'end';
  const sentence = sentences[at]!;
  if (sentence.cues.length) return sentence.cues[0]!;
  const base = NAME_PATTERN.test(name) ? name : 'box';
  const cue = unique(base, (n) => n === 'start' || n === 'end' || markers.some((m) => m.name === n));
  // Written the way this narration writes its cues: "[cue]Word" or "[cue] Word".
  const tight = markers.some((m) => /\S/.test(scene.say[m.offset + m.name.length + 2] ?? ' '));
  scene.say = `${scene.say.slice(0, sentence.start)}[${cue}]${tight ? '' : ' '}${scene.say.slice(sentence.start)}`;
  return cue;
}

/** Which sentence start a beat's cue is at; undefined for a cue not in the narration. */
function placeOf(scene: BoxScene, cue: string): Place | undefined {
  const { sentences } = parseNarration(scene.say);
  if (cue === 'start') return 0;
  if (cue === 'end') return sentences.length;
  const i = sentences.findIndex((s) => s.cues.includes(cue));
  return i >= 0 ? i : undefined;
}

function ordered(scene: BoxScene): BoxBeat[] {
  const beats = scene.beats ?? [];
  return beats.map((b, i) => ({ b, i, p: placeOf(scene, b.at) ?? -1 })).sort((x, y) => x.p - y.p || x.i - y.i).map((x) => x.b);
}

function sortBeats(scene: BoxScene): void {
  if (scene.beats) scene.beats = ordered(scene);
}

function usedCues(script: BoxScript): Set<string> {
  return new Set(script.scenes.flatMap((s, i) => (s.beats ?? []).map((b) => `${i}\u0000${b.at}`)));
}

function removeCue(scene: BoxScene, cue: string): void {
  if (cue === 'start' || cue === 'end') return;
  const marker = parseNarration(scene.say).markers.find((m) => m.name === cue);
  if (!marker) return;
  const endOf = marker.offset + cue.length + 2;
  const trailing = scene.say[endOf] === ' ' ? 1 : 0;
  scene.say = scene.say.slice(0, marker.offset) + scene.say.slice(endOf + trailing);
}

function unique(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * The narration boxes a script sets, one line each, in words: what `wait` compares to tell the
 * agent which boxes the user placed or moved in Muse while it waited.
 */
export function describeBoxes(script: BoxScript): string[] {
  return script.scenes.flatMap((scene, i) => {
    const { sentences } = parseNarration(scene.say);
    const name = scene.id ?? String(i + 1);
    const where = (p: Place) => (p >= sentences.length ? 'the end of the scene' : `"${clip(sentences[p]!.text)}"`);
    return ordered(scene).flatMap((beat) => {
      const p = placeOf(scene, beat.at);
      if (beat.highlight === undefined || p === undefined) return [];
      const area = typeof beat.highlight === 'string' ? script.areas?.[beat.highlight] : undefined;
      const what = beat.highlight === false ? 'clears the narration box' : `puts the narration box on ${beat.highlight}${area ? ` (an area of stage ${area.stage}: x ${area.x}, y ${area.y}, ${area.w} by ${area.h})` : ''}`;
      return [`scene "${name}" (scenes[${i}]), at ${where(p)}: ${what}`];
    });
  });
}

function clip(text: string): string {
  const words = text.split(' ');
  return words.length > 6 ? `${words.slice(0, 6).join(' ')}...` : text;
}
