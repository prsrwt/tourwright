// Kokoro, run locally through kokoro-js. Tourwright downloads the model into the shared cache
// itself (see download.ts), then kokoro-js loads it from disk, once per process for each dtype.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closest } from '../check/diagnostic.ts';
import { modelCacheDir } from '../cache.ts';
import { SAMPLE_RATE, type VoiceBackend, type VoiceSettings } from './backend.ts';
import { codeOf, downloadFiles, isComplete } from './download.ts';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Approximate download sizes, for doctor and the first-run message. */
export const KOKORO_DOWNLOAD_MB: Record<VoiceSettings['dtype'], number> = { fp32: 326, fp16: 163, q8: 92, q4: 305 };

type Kokoro = import('kokoro-js').KokoroTTS;

const loaded = new Map<string, Promise<Kokoro>>();

/** The files transformers.js loads for one dtype, relative to the model folder. */
export function kokoroFiles(dtype: VoiceSettings['dtype']): string[] {
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', `onnx/model${DTYPE_SUFFIX[dtype]}.onnx`];
}

// transformers.js's own file suffixes for each dtype.
const DTYPE_SUFFIX: Record<VoiceSettings['dtype'], string> = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4' };

export function kokoroModelDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(modelCacheDir(env), ...KOKORO_MODEL.split('/'));
}

/** True when every file for the dtype has downloaded completely. Checks the disk only. */
export function kokoroModelCached(dtype: VoiceSettings['dtype'] = 'fp32', env: NodeJS.ProcessEnv = process.env): boolean {
  return isComplete(kokoroModelDir(env), kokoroFiles(dtype));
}

async function load(dtype: VoiceSettings['dtype']): Promise<Kokoro> {
  const dir = kokoroModelDir();
  if (!kokoroModelCached(dtype)) {
    process.stderr.write(`Downloading the Kokoro voice model (${dtype}, about ${KOKORO_DOWNLOAD_MB[dtype]} MB) to ${dir}. This happens once, and resumes if interrupted.
`);
    try {
      await downloadFiles({
        baseUrl: `https://huggingface.co/${KOKORO_MODEL}/resolve/main/`,
        dir,
        files: kokoroFiles(dtype),
        log: (line) => process.stderr.write(`${line}
`),
      });
    } catch (error) {
      throw new Error(
        `Could not download the Kokoro voice model from huggingface.co (${codeOf(error)}).
` +
          `Fix: check that this machine can reach huggingface.co and run again; the download resumes where it stopped. ` +
          `To keep working without the model, add --fake-voice (silent narration with realistic timing).`,
      );
    }
  }

  // Load strictly from disk. Configure the very copy of transformers.js that kokoro-js imports,
  // whatever version that is: resolve it from kokoro-js, then take its ES module build, since the
  // CommonJS build is a separate instance with its own settings.
  const require = createRequire(import.meta.url);
  const cjsEntry = createRequire(require.resolve('kokoro-js')).resolve('@huggingface/transformers');
  const root = dirname(dirname(cjsEntry)); // <root>/dist/transformers.node.cjs
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: { node: { import: { default: string } } } };
  const esmEntry = join(root, pkg.exports.node.import.default);
  const { env } = (await import(pathToFileURL(esmEntry).href)) as typeof import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelCacheDir();

  const { KokoroTTS } = await import('kokoro-js');
  return KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype, device: 'cpu' });
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
