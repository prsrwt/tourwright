// check, verify, then render: the render only starts once every still passes, so a broken
// script fails in seconds rather than after a full render.

import { relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import { findFfmpeg, ffmpegMissing } from '../render/ffmpeg.ts';
import { renderVideo } from '../render/render.ts';
import { verifyWalkthrough } from '../verify/verify.ts';
import { videoPath } from './render.ts';
import { printVerifyReport } from './verify.ts';

export async function runMake(config: ResolvedConfig, name: string): Promise<number> {
  const log = (line: string) => console.log(line);
  const ffmpeg = findFfmpeg(config.root);
  if (!ffmpeg) {
    console.error(ffmpegMissing(config.root));
    return 1;
  }
  const prepared = await prepare(config, name, { log });
  const session = await openSession(config, prepared, log);
  try {
    log(`Verifying ${name}...`);
    const report = await verifyWalkthrough(name, prepared.timeline, session.player, prepared.outDir, [...prepared.warnings, ...session.diagnostics]);
    printVerifyReport(report);
    if (!report.ok) {
      console.error('\nNot rendered: fix the errors above, then run make again.');
      return 1;
    }
    const t = prepared.timeline;
    log(`\nRendering ${t.frames} frames (${(t.frames / t.fps).toFixed(1)} s at ${t.fps} fps)...`);
    const result = await renderVideo(t, session.player, { ffmpeg, file: videoPath(config, name), workDir: prepared.outDir, log });
    console.log(`Wrote ${relative(process.cwd(), result.file) || result.file} (${result.seconds.toFixed(1)} s).`);
    return 0;
  } finally {
    await session.close();
  }
}
