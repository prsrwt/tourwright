// npm run bench: how fast the example's intro renders on this machine, with repeated frames
// skipped (as make does) and with every frame captured, for the roadmap's render budget. Uses the
// fake voice, so no model is needed; needs ffmpeg, as make does.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/config/config.ts';
import { prepare } from '../src/pipeline/prepare.ts';
import { openSession } from '../src/pipeline/session.ts';
import { findFfmpeg, ffmpegMissing } from '../src/render/ffmpeg.ts';
import { renderVideo } from '../src/render/render.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));
const ffmpeg = findFfmpeg(app);
if (!ffmpeg) {
  console.error(ffmpegMissing(app));
  process.exit(1);
}
const config = resolveConfig({ out: join(app, 'out', '.bench') }, join(app, 'tourwright.config.mts'), { TOURWRIGHT_VOICE: 'fake' });
const prepared = await prepare(config, 'intro');
const t = prepared.timeline;
console.log(`intro: ${t.frames} frames, ${(t.frames / t.fps).toFixed(1)} s of video at ${t.width}x${t.height}, ${t.fps} fps`);
for (const skipIdentical of [true, false]) {
  const session = await openSession(config, prepared, () => undefined);
  try {
    const started = performance.now();
    await renderVideo(t, session.player, { ffmpeg, file: join(config.out, `bench-${skipIdentical}.mp4`), workDir: join(config.out, 'bench'), skipIdentical });
    const seconds = (performance.now() - started) / 1000;
    console.log(`  ${skipIdentical ? 'repeats skipped (as make does)' : 'every frame captured          '}  ${seconds.toFixed(1)} s, ${(t.frames / seconds).toFixed(0)} frames a second, ${(seconds / (t.frames / t.fps)).toFixed(2)} s per second of video`);
  } finally {
    await session.close();
  }
}
