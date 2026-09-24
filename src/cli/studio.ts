import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startStageServer, STUDIO_PATH } from '../bundle/server.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, scriptPath } from '../config/walkthroughs.ts';
import { createStudio } from '../studio/server.ts';

export interface StudioOptions {
  /** Open the default browser. */
  open: boolean;
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
  console.log(`Muse for "${name}": ${url}`);
  console.log('Edits save to script.json, and notes to notes.json beside it. Press Ctrl+C to stop.');
  if (options.open) openBrowser(url);
  await studio.ready;

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  studio.close();
  await server.close();
  return 0;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  // If there is no browser to open, the URL printed above is enough.
  spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => undefined).unref();
}
