// Silence whose length depends only on the text and the speed, so tests and an agent's iteration
// loop get realistic timing without the model download.

import { SAMPLE_RATE, type VoiceBackend } from './backend.ts';

/** Roughly 2.4 words a second at speed 1, close to Kokoro's pace. */
const SECONDS_PER_CHARACTER = 0.065;

export function fakeSeconds(text: string, speed: number): number {
  return (0.2 + text.length * SECONDS_PER_CHARACTER) / speed;
}

export const fakeBackend: VoiceBackend = {
  id: 'fake',
  async synthesize(text, voice) {
    return new Float32Array(Math.round(fakeSeconds(text, voice.speed) * SAMPLE_RATE));
  },
};
