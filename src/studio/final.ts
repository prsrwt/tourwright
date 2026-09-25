// The final render, started from Muse. Most people who review a video never open a terminal, so
// once they approve it Muse offers to make the final cut, and makes it: make, with the real voice,
// for the approved version only, in a process of its own so Muse stays responsive meanwhile.

import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, relative } from 'node:path';
import { cliEntry } from '../cli/entry.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { finalVideo } from '../render/record.ts';
import type { FinalState, RenderJob } from './protocol.ts';
import { reviewState } from './review.ts';

export function finalState(config: ResolvedConfig, name: string): FinalState {
  const video = finalVideo(config, name, reviewState(config, name));
  const file = relative(config.root, video.file).split('\\').join('/');
  return video.ready ? { ready: true, file } : { ready: false, why: video.why, file };
}

export interface FinalRender {
  job: RenderJob;
  cancel(): void;
}

/** Lines of make's output kept for an error message: the reason is near the end. */
const TAIL = 30;

/**
 * Starts make for the approved version with the real voice, calling `changed` as it moves on.
 * `command` is for tests: the process to run in place of make.
 */
export function startFinalRender(config: ResolvedConfig, name: string, changed: () => void, command?: { file: string; args: string[] }): FinalRender {
  const job: RenderJob = { status: 'running', step: 'Starting', percent: 0, started: new Date().toISOString() };
  // The stand-in voice may be why Muse itself is silent (make --fake-voice started it); the final
  // video has the voice the config asks for.
  const { TOURWRIGHT_VOICE: _, ...env } = process.env;
  const child: ChildProcess = spawn(command?.file ?? process.execPath, command?.args ?? [cliEntry, 'make', name, '--require-approval', '--no-review'], {
    cwd: config.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines: string[] = [];
  let partial = '';
  const read = (chunk: Buffer) => {
    const text = partial + chunk.toString();
    const parts = text.split(/\r?\n/);
    partial = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) lines.push(line);
      if (lines.length > TAIL) lines.shift();
      const step = stepOf(line);
      if (step && (step.step !== job.step || step.percent !== job.percent)) {
        job.step = step.step;
        job.percent = step.percent ?? job.percent;
        changed();
      }
    }
  };
  child.stdout?.on('data', read);
  child.stderr?.on('data', read);
  const finish = (code: number | null, error?: Error) => {
    if (job.status !== 'running') return;
    if (partial.trim()) lines.push(partial);
    job.finished = new Date().toISOString();
    if (code === 0) {
      job.status = 'done';
      job.step = 'Done';
      job.percent = 100;
    } else {
      job.status = 'failed';
      job.error = error?.message ?? (lines.join('\n').trim() || `make stopped with exit code ${code}.`);
    }
    changed();
  };
  child.on('error', (error) => finish(null, error));
  child.on('close', (code) => finish(code));
  return {
    job,
    cancel() {
      if (job.status === 'running') child.kill();
    },
  };
}

/**
 * How to open the folder holding a file, with the file selected where the platform can. On Windows,
 * explorer reads its own command line: the path goes in quotes after "/select," with nothing
 * escaped, so the arguments are passed verbatim, and its window is not hidden (Muse runs with no
 * console, and explorer takes windowsHide to mean a hidden folder window).
 */
export function revealCommand(file: string, platform: NodeJS.Platform): { command: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32') return { command: 'explorer.exe', args: [`/select,"${file}"`], verbatim: true };
  if (platform === 'darwin') return { command: 'open', args: ['-R', file], verbatim: false };
  return { command: 'xdg-open', args: [dirname(file)], verbatim: false };
}

/**
 * Opens the folder holding a file. Resolves to why it could not, if it could not, so Muse can say
 * so and show the path rather than do nothing.
 */
export function revealFile(file: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return Promise.resolve(`There is no desktop on the machine Muse runs on to open a folder in. The video is at ${file}`);
  }
  const { command, args, verbatim } = revealCommand(file, platform);
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: false, windowsVerbatimArguments: verbatim });
    const failed = (why: string) => done(`Could not open the folder (${why}). The video is at ${file}`);
    child.on('error', (error) => failed(error.message));
    // explorer exits with 1 even when it opened the folder, so only the others' exit codes count.
    child.on('exit', (code) => (platform !== 'win32' && code ? failed(`${command} exited with ${code}`) : done(undefined)));
    // Some openers stay running; one still going after a moment has opened it.
    setTimeout(() => done(undefined), 3000).unref();
    child.unref();
  });
}

/** What a line of make's output says it is doing. */
function stepOf(line: string): { step: string; percent?: number } | undefined {
  const percent = /^\s*(\d+)%\s+frame/.exec(line);
  if (percent) return { step: 'Rendering', percent: Number(percent[1]) };
  if (/^Voicing /.test(line)) return { step: 'Voicing the narration' };
  if (/^Bundling /.test(line)) return { step: 'Loading the stage' };
  if (/^Verifying /.test(line)) return { step: 'Checking every scene' };
  if (/^\s*Rendering \d+ frames/.test(line)) return { step: 'Rendering', percent: 0 };
  if (/^Rendered \d+ frames/.test(line)) return { step: 'Saving the video', percent: 100 };
  return undefined;
}
