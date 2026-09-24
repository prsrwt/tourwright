// Turns a script and the length of each spoken sentence into frame numbers: when each sentence
// starts, when each cue lands, and when each camera and highlight move begins. Pure, so the same
// inputs always give the same timeline, and the player, the audio track and the reports all
// read the same numbers.
//
// Every sentence starts on a frame boundary. Because each allowed frame rate divides the sample
// rate, a frame is a whole number of samples and audio placed by frame never drifts.

import { sceneId, type Script } from '../schema/script.ts';
import { DEFAULT_SETTINGS, type EaseName, type Settings } from '../schema/settings.ts';
import { SAMPLE_RATE } from '../voice/backend.ts';

/** Seconds the silent title card is shown before the first scene, unless settings.title changes it. */
export const TITLE_SECONDS = DEFAULT_SETTINGS.title.seconds;

export interface TimedSentence {
  text: string;
  spoken: string;
  cues: string[];
  /** Global frame the sentence starts on. */
  from: number;
  /** Frames the audio occupies, rounded up. */
  frames: number;
  /** The cached WAV, and its exact length. */
  file: string;
  samples: number;
}

export interface CameraMove {
  to: string;
  zoom: 'fit' | 'width' | number;
  align: 'center' | 'top';
  ease: EaseName;
  from: number;
  frames: number;
}

export interface Animation {
  /** Stage values: numbers ease to their end value, steps move to their next step. */
  values: string[];
  from: number;
  frames: number;
  ease: EaseName;
}

export interface HighlightMove {
  /** A target, or false to fade the highlight out. */
  to: string | false;
  from: number;
}

export interface TimedBeat {
  /** Index into the scene's beats, as written in script.json. */
  index: number;
  at: string;
  /** Global frame of the cue. */
  cue: number;
  camera?: CameraMove;
  highlight?: HighlightMove;
  animate?: Animation;
}

export interface TimedScene {
  index: number;
  id: string;
  stage: string;
  from: number;
  frames: number;
  sentences: TimedSentence[];
  /** Global frame of every cue, including "start" and "end". */
  cues: Record<string, number>;
  beats: TimedBeat[];
}

export interface Caption {
  /** The written sentence, as a viewer reads it: markers removed, lexicon not applied. */
  text: string;
  /** Global frames: shown from `from` up to, not including, `to`. */
  from: number;
  to: number;
}

export interface Timeline {
  title: string;
  subtitle?: string;
  fps: number;
  width: number;
  height: number;
  /** Frames of the title card, which comes first. */
  titleFrames: number;
  frames: number;
  settings: Settings;
  /** Highlight slide and fade durations, in frames. */
  highlightFrames: { slide: number; fade: number };
  scenes: TimedScene[];
  /** One per sentence, whatever the captions setting; the setting decides how they are shown. */
  captions: Caption[];
}

export interface SentenceAudio {
  text: string;
  spoken: string;
  cues: string[];
  file: string;
  samples: number;
}

export function samplesPerFrame(fps: number): number {
  return SAMPLE_RATE / fps;
}

export function buildTimeline(script: Script, settings: Settings, audio: readonly (readonly SentenceAudio[])[]): Timeline {
  const { fps } = settings.video;
  const spf = samplesPerFrame(fps);
  const toFrames = (seconds: number) => Math.round(seconds * fps);
  const gap = toFrames(settings.voice.sentenceGap);
  const lead = toFrames(settings.camera.lead);

  const titleFrames = toFrames(settings.title.seconds);
  let cursor = titleFrames;
  const scenes = script.scenes.map((scene, index): TimedScene => {
    const from = cursor;
    const sentences: TimedSentence[] = [];
    const cues: Record<string, number> = { start: from };
    let at = from;
    (audio[index] ?? []).forEach((sentence, i) => {
      if (i > 0) at += gap;
      const frames = Math.ceil(sentence.samples / spf);
      sentences.push({ ...sentence, from: at, frames });
      for (const cue of sentence.cues) cues[cue] = at;
      at += frames;
    });
    cues.end = at;
    const frames = at - from + toFrames(scene.tail ?? settings.voice.tail);

    const beats = (scene.beats ?? []).flatMap((beat, b): TimedBeat[] => {
      const cue = cues[beat.at];
      if (cue === undefined) return [];
      const start = Math.max(from, cue - lead);
      const timed: TimedBeat = { index: b, at: beat.at, cue };
      if (beat.camera) {
        timed.camera = {
          to: beat.camera.to,
          zoom: beat.camera.zoom ?? 'fit',
          align: beat.camera.align ?? 'center',
          ease: beat.camera.ease ?? settings.camera.ease,
          from: start,
          frames: Math.max(1, toFrames(beat.camera.duration ?? settings.camera.duration)),
        };
      }
      if (beat.highlight !== undefined) timed.highlight = { to: beat.highlight, from: start };
      if (beat.animate !== undefined) {
        // Start once the camera has arrived, so the viewer is already looking at what moves.
        timed.animate = {
          values: typeof beat.animate === 'string' ? [beat.animate] : beat.animate,
          from: timed.camera ? timed.camera.from + timed.camera.frames : Math.max(from, cue),
          frames: Math.max(1, toFrames(settings.animate.duration)),
          ease: settings.animate.ease,
        };
      }
      return [timed];
    });

    cursor = from + frames;
    return { index, id: sceneId(scene, index), stage: scene.stage, from, frames, sentences, cues, beats };
  });

  return {
    title: script.title,
    ...(script.subtitle !== undefined && { subtitle: script.subtitle }),
    fps,
    width: settings.video.width,
    height: settings.video.height,
    titleFrames,
    frames: cursor,
    settings,
    highlightFrames: { slide: Math.max(1, toFrames(settings.highlight.slide)), fade: Math.max(1, toFrames(settings.highlight.fade)) },
    scenes,
    captions: scenes.flatMap((scene) => captionsFor(scene, gap)),
  };
}

/**
 * A caption stays up until the next sentence starts, so it does not flicker off in the gap
 * between sentences. The last one in a scene holds for one gap after its audio, then clears
 * before the next scene.
 */
function captionsFor(scene: TimedScene, gap: number): Caption[] {
  const end = scene.from + scene.frames;
  return scene.sentences.map((sentence, i) => {
    const next = scene.sentences[i + 1];
    const to = next ? next.from : Math.min(sentence.from + sentence.frames + gap, end);
    return { text: sentence.text, from: sentence.from, to };
  });
}

/** The frame where a beat's movement has finished, clamped inside its scene: what verify stills show. */
export function settleFrame(timeline: Timeline, scene: TimedScene, beat: TimedBeat): number {
  let settle = beat.cue;
  if (beat.camera) settle = Math.max(settle, beat.camera.from + beat.camera.frames);
  if (beat.highlight) {
    const { slide, fade } = timeline.highlightFrames;
    settle = Math.max(settle, beat.highlight.from + Math.max(slide, fade));
  }
  if (beat.animate) settle = Math.max(settle, beat.animate.from + beat.animate.frames);
  return Math.min(settle, scene.from + scene.frames - 1);
}

/** Seconds from the start of a scene, for reports. */
export function sceneSeconds(timeline: Timeline, scene: TimedScene, frame: number): number {
  return (frame - scene.from) / timeline.fps;
}
