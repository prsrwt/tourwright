// check, verify, then render: the render only starts once every still passes, so a broken
// script fails in seconds rather than after a full render.

import { relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import { findFfmpeg, ffmpegMissing } from '../render/ffmpeg.ts';
import { renderVideo } from '../render/render.ts';
import { formatReview, reviewState } from '../studio/review.ts';
import { launchMuse } from './launch.ts';
import { verifyWalkthrough } from '../verify/verify.ts';
import { videoPath } from './render.ts';
import { printVerifyReport } from './verify.ts';

export interface MakeOptions {
  /** False with --no-review: leave Muse closed. */
  review?: boolean;
  /** With --require-approval: render only a version the user has approved in Muse. */
  requireApproval?: boolean;
}

export async function runMake(config: ResolvedConfig, name: string, options: MakeOptions = {}): Promise<number> {
  const log = (line: string) => console.log(line);
  // Checked first, so a final render of an unapproved version fails in a moment, not after verify.
  if (options.requireApproval) {
    const review = reviewState(config, name);
    if (!review.approved) {
      console.error(`Not rendered: --require-approval renders only a version approved in Muse. ${formatReview(name, review)}\nFix: ask the user to review it in Muse ("npx tourwright muse ${name}") and approve it, then run make again.`);
      return 1;
    }
  }
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
    // Rendered is not finished: the video is done only once the user approves this version.
    console.log(formatReview(name, reviewState(config, name)));
    // Most people who get a video never open a terminal, so bring the review page to them. This
    // starts Muse in the background and returns: make finishes as usual, even under an agent.
    console.log(`\n${(await launchMuse(config, name, { review: options.review ?? true })).message}`);
    if (!reviewState(config, name).approved) console.log(`To hear when the user approves it or asks for changes: npx tourwright wait ${name}`);
    return 0;
  } finally {
    await session.close();
  }
}
