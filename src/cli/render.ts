import { mkdirSync } from 'node:fs';
import { relative } from 'node:path';
import { formatDiagnostics } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare, type Prepared } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import { findFfmpeg, ffmpegMissing } from '../render/ffmpeg.ts';
import { videoPath, writeRenderRecord } from '../render/record.ts';
import { renderVideo, type RenderResult } from '../render/render.ts';

export { videoPath };

/** Renders out/<name>.mp4. Returns undefined, having printed why, when it cannot. */
export async function renderWalkthrough(config: ResolvedConfig, prepared: Prepared, log: (line: string) => void): Promise<RenderResult | undefined> {
  const ffmpeg = findFfmpeg(config.root);
  if (!ffmpeg) {
    console.error(ffmpegMissing(config.root));
    return undefined;
  }
  const session = await openSession(config, prepared, log);
  try {
    if (session.diagnostics.some((d) => d.level === 'error')) {
      console.error(`${formatDiagnostics(session.diagnostics)}\n\nNothing was rendered. Fix the errors above, then run again.`);
      return undefined;
    }
    mkdirSync(config.out, { recursive: true });
    const seconds = (prepared.timeline.frames / prepared.timeline.fps).toFixed(1);
    log(`Rendering ${prepared.timeline.frames} frames (${seconds} s at ${prepared.timeline.fps} fps) with ffmpeg ${ffmpeg.version} from ${ffmpeg.source}...`);
    const result = await renderVideo(prepared.timeline, session.player, { ffmpeg, file: videoPath(config, prepared.name), workDir: prepared.outDir, log });
    writeRenderRecord(config, prepared.name, session.sources());
    return result;
  } finally {
    await session.close();
  }
}

export async function runRender(config: ResolvedConfig, name: string): Promise<number> {
  const log = (line: string) => console.log(line);
  const prepared = await prepare(config, name, { log });
  const result = await renderWalkthrough(config, prepared, log);
  if (!result) return 1;
  console.log(`Wrote ${relative(process.cwd(), result.file) || result.file} (${result.seconds.toFixed(1)} s).`);
  return 0;
}
