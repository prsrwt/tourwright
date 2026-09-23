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

export const FFMPEG_MISSING =
  'ffmpeg was not found on the PATH or as ffmpeg-static in this app.\n' +
  'Fix: install ffmpeg (winget install ffmpeg, brew install ffmpeg or apt install ffmpeg), or run "npm install -D ffmpeg-static" in your app (about 80 MB, GPL-3.0).';

function probe(command: string): string | undefined {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout) return undefined;
  return /ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? 'unknown';
}
