import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startStageServer, STUDIO_PATH } from '../bundle/server.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, scriptPath } from '../config/walkthroughs.ts';
import { createStudio } from '../studio/server.ts';
import { clearMuseRecord, MUSE_IDLE_SECONDS, writeMuseRecord } from './launch.ts';

export interface StudioOptions {
  /** Open the default browser. */
  open: boolean;
  /**
   * Started by make rather than by someone at a terminal: close once no tab has been connected for
   * `idleSeconds`, so a Muse nobody is looking at does not run forever.
   */
  background?: boolean;
  idleSeconds?: number;
}

/** Serves Muse, the studio, until Ctrl+C. */
export async function runStudio(config: ResolvedConfig, name: string, options: StudioOptions): Promise<number> {
  if (!existsSync(scriptPath(config, name))) {
    const known = listWalkthroughs(config);
    console.error(`No walkthrough "${name}". ${known.length ? `Walkthroughs: ${known.join(', ')}.` : 'There are no walkthroughs yet.'}\nFix: run "npx tourwright new ${name}" to create it.`);
    return 1;
  }
  const log = (line: string) => console.log(line);
  const studio = createStudio(config, name, log);
  const server = await startStageServer(config, { middleware: (req, res, next) => studio.handle(req, res, next) });
  const url = new URL(STUDIO_PATH, server.url).href;
  // Recorded so that make opens this Muse rather than starting a second one.
  mkdirSync(join(config.out, name), { recursive: true });
  writeMuseRecord(config, name, { pid: process.pid, port: Number(new URL(url).port), url, started: new Date().toISOString() });
  console.log(`Muse for "${name}": ${url}`);
  console.log('Edits save to script.json, and notes to notes.json beside it. Press Ctrl+C to stop.');
  if (options.open) openBrowser(url);

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (options.background) {
      // A tab keeps an event stream open, so no streams for the whole wait means nobody is looking.
      const idle = (options.idleSeconds ?? MUSE_IDLE_SECONDS) * 1000;
      let lastSeen = Date.now();
      const timer = setInterval(() => {
        if (studio.connections() > 0) lastSeen = Date.now();
        else if (Date.now() - lastSeen >= idle) {
          clearInterval(timer);
          stop();
        }
      }, Math.min(1000, idle / 4));
    }
  });
  clearMuseRecord(config, name, process.pid);
  studio.close();
  await server.close();
  // Nobody is waiting on a background Muse's exit code, and a stray handle must not keep it alive.
  if (options.background) process.exit(0);
  return 0;
}

/** Opens a URL in the default browser, if there is one. */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  // If there is no browser to open, the URL printed above is enough.
  spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => undefined).unref();
}
