// The frame stepper: set a frame, screenshot it, pipe it to ffmpeg. Every frame is a pure function
// of its number, so the same script renders the same frames on every run.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSoundtrack } from '../timing/audio.ts';
import { captionsVtt } from './captions.ts';
import type { Timeline } from '../timing/timeline.ts';
import type { FfmpegLocation } from './ffmpeg.ts';
import type { PlayerPage } from './page.ts';

export interface RenderResult {
  file: string;
  frames: number;
  seconds: number;
  /** One SHA-256 per frame, so two renders can be compared. */
  hashFile: string;
  /** The WebVTT captions next to the video, unless captions are off. */
  captionsFile?: string;
}

export interface RenderOptions {
  ffmpeg: FfmpegLocation;
  /** Where the MP4 goes. */
  file: string;
  /** Folder for the soundtrack and frame hashes. */
  workDir: string;
  log?: (line: string) => void;
  /**
   * Reuse the last screenshot when a frame's signature matches the one before (default true).
   * Narration videos mostly hold still, so most frames repeat the last one exactly.
   */
  skipIdentical?: boolean;
}

export class RenderError extends Error {}

export async function renderVideo(timeline: Timeline, player: PlayerPage, options: RenderOptions): Promise<RenderResult> {
  const log = options.log ?? (() => undefined);
  mkdirSync(options.workDir, { recursive: true });
  const soundtrack = join(options.workDir, 'soundtrack.wav');
  writeFileSync(soundtrack, buildSoundtrack(timeline));

  // Captions go next to the video as WebVTT (what a web page's <track> needs). Only soft captions
  // also go inside it as a subtitle track: ffmpeg marks the first subtitle track as the default,
  // so players would show it on top of burned-in captions.
  const { mode } = timeline.settings.captions;
  const captionsFile = mode === 'off' ? undefined : options.file.replace(/\.mp4$/, '') + '.vtt';
  if (captionsFile) writeFileSync(captionsFile, captionsVtt(timeline));
  const embedCaptions = mode === 'soft';

  // Encode to a temporary name, so a failed render never leaves a broken file where the video goes.
  const partial = `${options.file}.partial.mp4`;
  const crf = timeline.settings.video.crf;
  const args = [
    ...['-y', '-hide_banner', '-loglevel', 'error'],
    ...['-f', 'image2pipe', '-framerate', String(timeline.fps), '-c:v', 'png', '-i', '-'],
    ...['-i', soundtrack],
    ...(embedCaptions ? ['-i', captionsFile!] : []),
    ...['-map', '0:v', '-map', '1:a'],
    ...(embedCaptions ? ['-map', '2:s', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng'] : []),
    ...['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(timeline.fps)],
    ...['-c:a', 'aac', '-b:a', '160k'],
    ...['-movflags', '+faststart', partial],
  ];
  const ffmpeg = spawn(options.ffmpeg.path, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number>((done, fail) => {
    ffmpeg.on('error', fail);
    ffmpeg.on('close', (code) => done(code ?? 1));
  });
  // A write error means ffmpeg has already quit; its exit code and stderr explain why.
  ffmpeg.stdin.on('error', () => undefined);

  const hashes: string[] = [];
  const started = Date.now();
  let reported = 0;
  const skip = options.skipIdentical ?? true;
  let last: { signature: string; png: Buffer; hash: string } | undefined;
  let reused = 0;
  try {
    for (let frame = 0; frame < timeline.frames; frame++) {
      const report = await player.page.evaluate((f) => window.__tour.setFrame(f, 'play'), frame);
      const errors = [...player.errors, ...report.errors];
      if (errors.length) throw new RenderError(`The stage reported an error at frame ${frame}:\n${errors.join('\n')}`);
      // The player has set every CSS animation to this frame's time, so capture them as they are,
      // unless nothing that decides the pixels has changed since the last frame.
      let png: Buffer;
      let hash: string;
      if (skip && last && report.signature !== null && report.signature === last.signature) {
        ({ png, hash } = last);
        reused++;
      } else {
        png = await player.page.screenshot({ type: 'png', caret: 'hide' });
        hash = createHash('sha256').update(png).digest('hex');
        last = report.signature === null ? undefined : { signature: report.signature, png, hash };
      }
      hashes.push(hash);
      if (!ffmpeg.stdin.write(png)) {
        await Promise.race([new Promise((done) => ffmpeg.stdin.once('drain', done)), exited]);
      }
      if (ffmpeg.exitCode !== null) break;
      const percent = Math.floor(((frame + 1) / timeline.frames) * 100);
      if (percent >= reported + 10) {
        reported = percent - (percent % 10);
        log(`  ${String(reported).padStart(3)}%  frame ${frame + 1} of ${timeline.frames}`);
      }
    }
  } catch (error) {
    ffmpeg.kill();
    await exited.catch(() => undefined);
    rmSync(partial, { force: true });
    throw error;
  }
  ffmpeg.stdin.end();
  const code = await exited;
  if (code !== 0) {
    rmSync(partial, { force: true });
    throw new RenderError(`ffmpeg failed (exit code ${code}):\n${stderr.trim() || '(no output)'}`);
  }
  renameSync(partial, options.file);

  const hashFile = join(options.workDir, 'frames.sha256');
  writeFileSync(hashFile, hashes.map((h, i) => `${h}  ${i}`).join('\n') + '\n');
  log(`Rendered ${timeline.frames} frames in ${((Date.now() - started) / 1000).toFixed(1)} s${reused ? ` (${reused} repeated the frame before, so were not captured again)` : ''}.`);
  return { file: options.file, frames: timeline.frames, seconds: timeline.frames / timeline.fps, hashFile, ...(captionsFile && { captionsFile }) };
}
