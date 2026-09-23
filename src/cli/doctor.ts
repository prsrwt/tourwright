// Reports everything a render needs, and where each piece comes from. It never downloads anything
// unless asked to with --voice.

import { existsSync } from 'node:fs';
import { modelCacheDir } from '../cache.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { findFfmpeg, FFMPEG_MISSING } from '../render/ffmpeg.ts';
import { DEFAULT_SETTINGS } from '../schema/settings.ts';
import { KOKORO_DOWNLOAD_MB, kokoroModelCached } from '../voice/kokoro.ts';

interface Line {
  ok: boolean;
  label: string;
  detail: string;
}

export interface DoctorOptions {
  /** Load the voice model and speak a sentence, downloading the model if needed. */
  voice: boolean;
}

export async function runDoctor(config: ResolvedConfig | undefined, configError: string | undefined, options: DoctorOptions): Promise<number> {
  const lines: Line[] = [];
  const add = (ok: boolean, label: string, detail: string) => {
    lines.push({ ok, label, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(8)} ${detail}`);
  };

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  add(major > 22 || (major === 22 && minor >= 18), 'node', `${process.versions.node} (needs 22.18 or later)`);

  if (config) {
    add(true, 'config', `${config.configFile} (preset ${config.preset}, voice ${config.voice.backend})`);
    add(existsSync(config.stages), 'stages', existsSync(config.stages) ? config.stages : `${config.stages} does not exist. Fix: run "npx tourwright init".`);
  } else {
    add(false, 'config', configError ?? 'not found');
  }

  const ffmpeg = findFfmpeg(config?.root ?? process.cwd());
  add(Boolean(ffmpeg), 'ffmpeg', ffmpeg ? `${ffmpeg.version} from ${ffmpeg.source === 'PATH' ? 'the PATH' : `ffmpeg-static (${ffmpeg.path})`}` : FFMPEG_MISSING);

  const browser = await findBrowser();
  add(browser.ok, 'browser', browser.detail);

  const dtype = DEFAULT_SETTINGS.voice.dtype;
  if (config?.voice.backend === 'fake') {
    add(true, 'voice', 'fake backend: silent narration, no model needed');
  } else if (options.voice) {
    add(...(await trySpeaking()));
  } else {
    add(
      true,
      'voice',
      kokoroModelCached()
        ? `Kokoro model cached in ${modelCacheDir()}. Run "tourwright doctor --voice" to test speaking.`
        : `Kokoro model not downloaded yet: about ${KOKORO_DOWNLOAD_MB[dtype]} MB on first use, into ${modelCacheDir()}. Run "tourwright doctor --voice" to download and test it now.`,
    );
  }

  return lines.every((l) => l.ok) ? 0 : 1;
}

/** Launches the browser renders use (headless Chromium), which is the only reliable check. */
async function findBrowser(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const version = browser.version();
    await browser.close();
    return { ok: true, detail: `headless Chromium ${version}` };
  } catch (error) {
    const message = (error as Error).message;
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      return { ok: false, detail: 'Playwright\'s Chromium is not installed.\nFix: run "npx playwright install --only-shell chromium" (about 115 MB, once per machine).' };
    }
    return { ok: false, detail: `Chromium could not start: ${message.split('\n')[0]}` };
  }
}

async function trySpeaking(): Promise<[boolean, string, string]> {
  try {
    const { createKokoroBackend } = await import('../voice/kokoro.ts');
    const started = Date.now();
    const samples = await createKokoroBackend().synthesize('Tourwright is ready.', DEFAULT_SETTINGS.voice);
    return [true, 'voice', `Kokoro spoke ${(samples.length / 24000).toFixed(1)} s of audio in ${((Date.now() - started) / 1000).toFixed(1)} s. Model in ${modelCacheDir()}.`];
  } catch (error) {
    return [false, 'voice', (error as Error).message];
  }
}
