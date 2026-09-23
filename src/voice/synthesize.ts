// Synthesises whatever is missing, one cached WAV per sentence. The cache key is a hash of the
// spoken text, the voice settings and the backend, so a stale file can never be used: a changed
// sentence simply has a different key.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNarration } from '../narration/parse.ts';
import type { Script } from '../schema/script.ts';
import type { Settings } from '../schema/settings.ts';
import { SAMPLE_RATE, type VoiceBackend } from './backend.ts';
import { applyLexicon } from './lexicon.ts';
import { decodeWav, encodeWav } from './wav.ts';

export interface VoicedSentence {
  /** What a viewer reads: markers removed. */
  text: string;
  /** What the voice says: text after the lexicon. */
  spoken: string;
  cues: string[];
  /** The cached WAV. */
  file: string;
  samples: number;
}

export interface VoiceProgress {
  done: number;
  total: number;
  synthesised: number;
}

export interface VoiceResult {
  /** One array per scene, one entry per sentence. */
  scenes: VoicedSentence[][];
  /** How many sentences were synthesised rather than read from the cache. */
  synthesised: number;
}

export function cacheKey(backend: VoiceBackend, voice: Settings['voice'], spoken: string): string {
  return createHash('sha256')
    .update(JSON.stringify([backend.id, voice.voice, voice.speed, voice.dtype, spoken]))
    .digest('hex')
    .slice(0, 32);
}

export async function voiceScript(
  script: Script,
  settings: Settings,
  backend: VoiceBackend,
  cacheDir: string,
  onProgress?: (progress: VoiceProgress) => void,
): Promise<VoiceResult> {
  mkdirSync(cacheDir, { recursive: true });
  const planned = script.scenes.map((scene) =>
    parseNarration(scene.say).sentences.map((sentence) => {
      const spoken = applyLexicon(sentence.text, script.lexicon);
      return { text: sentence.text, spoken, cues: sentence.cues, file: join(cacheDir, `${cacheKey(backend, settings.voice, spoken)}.wav`) };
    }),
  );

  const total = planned.reduce((n, s) => n + s.length, 0);
  let done = 0;
  let synthesised = 0;
  const scenes: VoicedSentence[][] = [];
  for (const sentences of planned) {
    const voiced: VoicedSentence[] = [];
    for (const sentence of sentences) {
      if (!existsSync(sentence.file)) {
        const samples = await backend.synthesize(sentence.spoken, settings.voice);
        // Write then rename, so an interrupted run never leaves a truncated file under a valid key.
        const partial = `${sentence.file}.${process.pid}.partial`;
        writeFileSync(partial, encodeWav(samples, SAMPLE_RATE));
        renameSync(partial, sentence.file);
        synthesised += 1;
      }
      voiced.push({ ...sentence, samples: readSampleCount(sentence.file) });
      done += 1;
      onProgress?.({ done, total, synthesised });
    }
    scenes.push(voiced);
  }
  return { scenes, synthesised };
}

function readSampleCount(file: string): number {
  const wav = decodeWav(readFileSync(file));
  if (wav.sampleRate !== SAMPLE_RATE) throw new Error(`${file} is ${wav.sampleRate} Hz, expected ${SAMPLE_RATE} Hz. Delete it and run again.`);
  return wav.samples.length;
}
