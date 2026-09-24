// ffmpeg runs as a separate process, which keeps Tourwright's own code MIT. It is not a
// dependency: Tourwright uses the ffmpeg on the PATH, or ffmpeg-static if the app installed it.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface FfmpegLocation {
  path: string;
  source: 'PATH' | 'ffmpeg-static';
  version: string;
}

export function findFfmpeg(appRoot: string): FfmpegLocation | undefined {
  const onPath = probe('ffmpeg');
  if (onPath) return { path: 'ffmpeg', source: 'PATH', version: onPath };
  try {
    const path = createRequire(join(appRoot, 'package.json'))('ffmpeg-static') as string | null;
    if (path && existsSync(path)) {
      const version = probe(path);
      if (version) return { path, source: 'ffmpeg-static', version };
    }
  } catch {
    // Not installed.
  }
  return undefined;
}

const INSTALL = 'install ffmpeg (winget install ffmpeg, brew install ffmpeg or apt install ffmpeg)';

/** Why ffmpeg could not be found, and the fix that will actually work on this machine. */
export function ffmpegMissing(appRoot: string): string {
  let staticPath: string | null | undefined;
  try {
    staticPath = createRequire(join(appRoot, 'package.json'))('ffmpeg-static') as string | null;
  } catch {
    staticPath = undefined;
  }
  if (staticPath !== undefined) {
    // The package is there but its binary is not: its install script, which downloads it, did not
    // run. npm 11 blocks install scripts until they are approved.
    return (
      'ffmpeg-static is installed but its ffmpeg binary is not, because its install script (which downloads it) did not run.\n' +
      `Fix: run "npm approve-scripts ffmpeg-static" and then "npm rebuild ffmpeg-static" in your app, or ${INSTALL}.`
    );
  }
  return `ffmpeg was not found on the PATH or as ffmpeg-static in this app.\nFix: ${INSTALL}, or run "npm install -D ffmpeg-static" in your app (about 80 MB, GPL-3.0).`;
}

function probe(command: string): string | undefined {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout) return undefined;
  return /ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? 'unknown';
}
