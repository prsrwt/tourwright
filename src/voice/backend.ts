// A voice backend is one function: sentence in, samples out. Everything else (caching, timing,
// placing audio by frame) is shared, so adding a backend never touches the timeline.

import type { Settings } from '../schema/settings.ts';
import type { VoiceBackend as BackendName } from '../config/config.ts';

/** Every backend speaks at this rate. Each allowed frame rate divides it exactly. */
export const SAMPLE_RATE = 24_000;

export type VoiceSettings = Settings['voice'];

export interface VoiceBackend {
  /** Part of the cache key, so audio from different backends never mixes. */
  readonly id: string;
  synthesize(text: string, voice: VoiceSettings): Promise<Float32Array>;
}

export async function createBackend(name: BackendName): Promise<VoiceBackend> {
  switch (name) {
    case 'fake':
      return (await import('./fake.ts')).fakeBackend;
    case 'kokoro':
      return (await import('./kokoro.ts')).createKokoroBackend();
  }
}
