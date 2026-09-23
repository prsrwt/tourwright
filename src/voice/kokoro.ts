// Kokoro, run locally through kokoro-js. The model downloads once into the shared cache and is
// loaded once per process for each dtype.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closest } from '../check/diagnostic.ts';
import { modelCacheDir } from '../cache.ts';
import { SAMPLE_RATE, type VoiceBackend, type VoiceSettings } from './backend.ts';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Approximate download sizes, for doctor and the first-run message. */
export const KOKORO_DOWNLOAD_MB: Record<VoiceSettings['dtype'], number> = { fp32: 326, fp16: 163, q8: 92, q4: 305 };

type Kokoro = import('kokoro-js').KokoroTTS;

const loaded = new Map<string, Promise<Kokoro>>();

export function kokoroModelCached(env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(join(modelCacheDir(env), ...KOKORO_MODEL.split('/'), 'config.json'));
}

async function load(dtype: VoiceSettings['dtype']): Promise<Kokoro> {
  // Point transformers.js at the shared cache. Configure the very copy kokoro-js imports, whatever
  // version that is: resolve it from kokoro-js, then take its ES module build, since the CommonJS
  // build is a separate instance with its own settings.
  const require = createRequire(import.meta.url);
  const cjsEntry = createRequire(require.resolve('kokoro-js')).resolve('@huggingface/transformers');
  const root = dirname(dirname(cjsEntry)); // <root>/dist/transformers.node.cjs
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: { node: { import: { default: string } } } };
  const esmEntry = join(root, pkg.exports.node.import.default);
  const { env } = (await import(pathToFileURL(esmEntry).href)) as typeof import('@huggingface/transformers');
  env.cacheDir = modelCacheDir();

  if (!kokoroModelCached()) {
    process.stderr.write(`Downloading the Kokoro voice model (${dtype}, about ${KOKORO_DOWNLOAD_MB[dtype]} MB) to ${env.cacheDir}. This happens once.\n`);
  }
  const { KokoroTTS } = await import('kokoro-js');
  let lastReport = 0;
  const attempt = () =>
    KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype,
      device: 'cpu',
      progress_callback: (info) => {
        if (info.status !== 'progress' || !info.file.endsWith('.onnx')) return;
        const percent = Math.floor(info.progress);
        if (percent >= lastReport + 10 || percent === 100) {
          lastReport = percent;
          process.stderr.write(`  ${info.file}: ${percent}%\n`);
        }
      },
    });

  // transformers.js does not retry, and a dropped connection mid-download is common on some networks.
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (tries === DOWNLOAD_TRIES) {
        throw new Error(
          `Could not download the Kokoro voice model from huggingface.co (${networkCode(error)}, ${tries} tries).\n` +
            `Fix: check that this machine can reach huggingface.co and run again; files already downloaded are kept. ` +
            `To keep working without the model, set TOURWRIGHT_VOICE=fake (silent narration with realistic timing).`,
        );
      }
      process.stderr.write(`Download interrupted (${networkCode(error)}); retrying (${tries + 1} of ${DOWNLOAD_TRIES}).\n`);
      await new Promise((done) => setTimeout(done, 1000 * tries));
    }
  }
}

const DOWNLOAD_TRIES = 4;

function networkCode(error: unknown): string {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as Error).message;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch failed|network|terminated/i.test(error.message);
}

export function createKokoroBackend(): VoiceBackend {
  return {
    id: 'kokoro',
    async synthesize(text, voice) {
      let model = loaded.get(voice.dtype);
      if (!model) {
        model = load(voice.dtype);
        loaded.set(voice.dtype, model);
        model.catch(() => loaded.delete(voice.dtype));
      }
      const tts = await model;
      const voices = Object.keys(tts.voices);
      if (!voices.includes(voice.voice)) {
        const guess = closest(voice.voice, voices);
        throw new Error(
          `"${voice.voice}" is not a Kokoro voice. Valid: ${voices.join(', ')}.\nFix: set settings.voice.voice to ${guess ? `"${guess}"` : 'one of those'}.`,
        );
      }
      const audio = await tts.generate(text, { voice: voice.voice as keyof Kokoro['voices'], speed: voice.speed });
      if (audio.sampling_rate !== SAMPLE_RATE) throw new Error(`Kokoro returned ${audio.sampling_rate} Hz audio, expected ${SAMPLE_RATE} Hz.`);
      return audio.audio;
    },
  };
}
