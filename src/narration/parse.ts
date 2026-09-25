// Splits narration into sentences and finds its [cue] markers.
//
// A sentence ends at ".", "?" or "!" (plus any closing quotes or brackets) followed by whitespace
// or the end of the text. In v0.1 a cue may only start a sentence, because sentence starts are the
// only times the voice step knows exactly.

import { NAME_PATTERN } from '../schema/names.ts';

export const RESERVED_CUES = ['start', 'end'] as const;

export interface Sentence {
  /** Display text: markers removed, whitespace collapsed. */
  text: string;
  /** Cues written at the start of this sentence. */
  cues: string[];
  /** Character offset in the original text where the sentence begins: its first marker or word. */
  start: number;
}

export interface Marker {
  /** The text between the brackets, exactly as written. */
  name: string;
  /** Character offset of "[" in the original text. */
  offset: number;
  /** Index of the sentence the marker falls in (or starts). */
  sentence: number;
  /** True when the marker comes before any words of its sentence. */
  atSentenceStart: boolean;
}

export interface Narration {
  sentences: Sentence[];
  markers: Marker[];
  /** Offsets of "[" characters with no matching "]". */
  unclosed: number[];
}

const TERMINATORS = new Set(['.', '?', '!']);
const CLOSERS = new Set(['"', "'", ')', '”', '’']);
const MARKER = /\[([^[\]]*)\]/y;

export function parseNarration(say: string): Narration {
  const sentences: Sentence[] = [];
  const markers: Marker[] = [];
  const unclosed: number[] = [];
  let buffer = '';
  let pending: Marker[] = [];
  let start = -1;

  const close = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    buffer = '';
    if (text === '') return;
    sentences.push({ text, cues: pending.filter((m) => m.atSentenceStart).map((m) => m.name), start });
    pending = [];
    start = -1;
  };

  let i = 0;
  while (i < say.length) {
    const ch = say[i]!;
    if (start < 0 && !/\s/.test(ch)) start = i;
    if (ch === '[') {
      MARKER.lastIndex = i;
      const match = MARKER.exec(say);
      if (!match) {
        unclosed.push(i);
        buffer += ch;
        i += 1;
        continue;
      }
      const marker: Marker = {
        name: match[1]!,
        offset: i,
        sentence: sentences.length,
        atSentenceStart: buffer.trim() === '',
      };
      markers.push(marker);
      pending.push(marker);
      i += match[0].length;
      continue;
    }
    buffer += ch;
    i += 1;
    if (TERMINATORS.has(ch)) {
      while (i < say.length && (TERMINATORS.has(say[i]!) || CLOSERS.has(say[i]!))) buffer += say[i++];
      if (i >= say.length || /\s/.test(say[i]!)) close();
    }
  }
  close();

  return { sentences, markers, unclosed };
}

/** Removes cue markers and collapses whitespace: the text a viewer hears, before the lexicon. */
export function displayText(say: string): string {
  return parseNarration(say)
    .sentences.map((s) => s.text)
    .join(' ');
}

export function isValidCueName(name: string): boolean {
  return NAME_PATTERN.test(name);
}
