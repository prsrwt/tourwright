// One render of a video at a time. Two at once (Muse's final render while the agent runs make, say)
// would write the same temporary file and leave a corrupt MP4, so the second is refused at once.

import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { RenderError } from './render.ts';

/** Beside the working files, not the video, which may be in a shared folder such as Downloads. */
export function renderLockPath(config: ResolvedConfig, name: string): string {
  return join(config.out, `${name}.render.lock`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Takes the lock for rendering a video, held in `lock`, or throws if another live process holds it. Returns the release. */
export function lockRender(lock: string, name: string): () => void {
  mkdirSync(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(lock, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(lock, 'utf8').trim());
      if (holder && holder !== process.pid && alive(holder)) {
        throw new RenderError(`"${name}" is already being rendered (process ${holder}), by Muse or another make.\nFix: wait for that render to finish, then run this again if it is still needed.`);
      }
      // Left by a render that crashed: take it over.
      rmSync(lock, { force: true });
    }
  }
  throw new RenderError(`Could not take the render lock ${lock}.`);
}
