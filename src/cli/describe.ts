// describe: what is on screen at a moment, or at every beat once it has settled, as text. An
// agent cannot watch the video, so this is how it knows what a viewer sees before it changes
// anything.

import { formatDiagnostics } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import type { PlayerPage } from '../render/page.ts';
import { formatScreen, type ScreenDescription } from '../runtime/screen.ts';
import { settleFrame, type Timeline } from '../timing/timeline.ts';

export class DescribeError extends Error {}

/** Renders each frame as a still ("settle") and describes it. */
export async function describeFrames(player: PlayerPage, frames: number[]): Promise<ScreenDescription[]> {
  const out: ScreenDescription[] = [];
  for (const frame of frames) {
    await player.page.evaluate((f) => window.__tour.setFrame(f), frame);
    out.push(await player.page.evaluate(() => window.__tour.describe()));
  }
  return out;
}

/** The frame at a number of seconds, as given to --at, or an error that says how to fix it. */
export function frameAt(timeline: Timeline, name: string, at: string): number {
  const seconds = Number(at);
  const length = (timeline.frames / timeline.fps).toFixed(3);
  if (at.trim() === '' || !Number.isFinite(seconds) || seconds < 0) {
    throw new DescribeError(`--at "${at}" is not a time in seconds.\nFix: give seconds from the start of the video, such as --at 12.5. "${name}" lasts ${length} s.`);
  }
  const frame = Math.floor(seconds * timeline.fps);
  if (frame >= timeline.frames) {
    throw new DescribeError(`--at ${at} is past the end of "${name}", which lasts ${length} s.\nFix: give a time below ${length}.`);
  }
  return frame;
}

/** Every beat's settle frame, in order: the frames verify's stills show. */
export function beatFrames(timeline: Timeline): number[] {
  return timeline.scenes.flatMap((scene) => scene.beats.map((beat) => settleFrame(timeline, scene, beat)));
}

export async function runDescribe(config: ResolvedConfig, name: string, options: { at?: string; json: boolean }): Promise<number> {
  const log = options.json ? () => undefined : (line: string) => console.error(line);
  const prepared = await prepare(config, name, { log });
  const frames = options.at === undefined ? beatFrames(prepared.timeline) : [frameAt(prepared.timeline, name, options.at)];
  const session = await openSession(config, prepared, log);
  try {
    // A missing target does not stop a description, but it explains a surprising one.
    const errors = session.diagnostics.filter((d) => d.level === 'error');
    if (errors.length) console.error(`${formatDiagnostics(errors)}\n`);
    const screens = await describeFrames(session.player, frames);
    if (options.json) console.log(JSON.stringify(screens, null, 2));
    else console.log(screens.map((s) => formatScreen(s)).join('\n\n'));
    return 0;
  } finally {
    await session.close();
  }
}
