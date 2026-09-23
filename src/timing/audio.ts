import { readFileSync } from 'node:fs';
import { SAMPLE_RATE } from '../voice/backend.ts';
import { decodeWav, encodeWav } from '../voice/wav.ts';
import { samplesPerFrame, type Timeline } from './timeline.ts';

/** One WAV for the whole video: each sentence's samples placed at its first frame. */
export function buildSoundtrack(timeline: Timeline): Buffer {
  const spf = samplesPerFrame(timeline.fps);
  const track = new Float32Array(timeline.frames * spf);
  for (const scene of timeline.scenes) {
    for (const sentence of scene.sentences) {
      const { samples } = decodeWav(readFileSync(sentence.file));
      track.set(samples.subarray(0, sentence.frames * spf), sentence.from * spf);
    }
  }
  return encodeWav(track, SAMPLE_RATE);
}
