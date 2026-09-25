// Snippets: when a note points at part of the screen (a target, or a box drawn around anything),
// Muse keeps a picture of exactly that part, so the agent sees what the user meant rather than
// working it out from coordinates. It is rendered the way verify renders stills, in a headless
// player on the same stage server, so it matches the video pixel for pixel.

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openPlayer, type PlayerPage } from '../render/page.ts';
import type { Rect } from '../runtime/motion.ts';
import type { Timeline } from '../timing/timeline.ts';

/** Where a note's snippet lives, relative to its walkthrough's folder. */
export const snippetFile = (id: string) => `notes/${id}.png`;

export interface Snippets {
  /** Renders the frame and saves the part inside `rect` (layout pixels) to `file`. */
  take(url: string, timeline: Timeline, frame: number, rect: Rect, file: string): Promise<void>;
  close(): Promise<void>;
}

/** One headless player, opened on the first snippet and closed a minute after the last. */
export function snippets(): Snippets {
  let player: Promise<PlayerPage> | undefined;
  let loaded: Timeline | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const close = async () => {
    const open = player;
    player = undefined;
    loaded = undefined;
    if (open) await (await open.catch(() => undefined))?.close();
  };
  return {
    take(url, timeline, frame, rect, file) {
      // One at a time: the player shows one frame at once.
      const job = queue.then(async () => {
        if (idle) clearTimeout(idle);
        if (!player) {
          player = openPlayer(url, timeline);
          loaded = timeline;
        }
        const { page } = await player;
        if (loaded !== timeline) {
          await page.evaluate((t) => window.__tour.start(t), timeline);
          loaded = timeline;
        }
        await page.evaluate((f) => window.__tour.setFrame(f, 'settle'), frame);
        const { width, height } = timeline.layout;
        const x = Math.max(0, Math.floor(rect.x));
        const y = Math.max(0, Math.floor(rect.y));
        const clip = { x, y, width: Math.max(1, Math.min(width, Math.ceil(rect.x + rect.w)) - x), height: Math.max(1, Math.min(height, Math.ceil(rect.y + rect.h)) - y) };
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file, clip, animations: 'disabled', caret: 'hide' });
        idle = setTimeout(() => void close(), 60_000);
        idle.unref?.();
      });
      queue = job.catch(() => undefined);
      return job;
    },
    close: async () => {
      if (idle) clearTimeout(idle);
      await close();
    },
  };
}

export function removeSnippet(dir: string, id: string): void {
  rmSync(join(dir, snippetFile(id)), { force: true });
}
