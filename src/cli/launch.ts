// Opens Muse by itself after make, so someone who only ever asks an agent for a video still finds
// the page where they review it. Muse runs as its own background process, so make (often run by an
// agent) finishes as usual; one Muse serves each walkthrough, and it closes itself once nobody has
// had it open for a while.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedConfig } from '../config/config.ts';
import { API } from '../studio/protocol.ts';
import { openBrowser } from './studio.ts';

/** How long a background Muse waits with no tab open before it closes itself. */
export const MUSE_IDLE_SECONDS = 600;

/** out/<name>/muse.json: the Muse serving a walkthrough, while it runs. */
export interface MuseRecord {
  pid: number;
  port: number;
  url: string;
  started: string;
}

export function musePath(config: ResolvedConfig, name: string): string {
  return join(config.out, name, 'muse.json');
}

export function writeMuseRecord(config: ResolvedConfig, name: string, record: MuseRecord): void {
  writeFileSync(musePath(config, name), JSON.stringify(record, null, 2) + '\n');
}

/** Removes the record, but only if it is still this process's: a newer Muse may have replaced it. */
export function clearMuseRecord(config: ResolvedConfig, name: string, pid: number): void {
  if (readMuseRecord(config, name)?.pid === pid) rmSync(musePath(config, name), { force: true });
}

function readMuseRecord(config: ResolvedConfig, name: string): MuseRecord | undefined {
  const file = musePath(config, name);
  if (!existsSync(file)) return undefined;
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as Partial<MuseRecord>;
    return typeof record.pid === 'number' && typeof record.url === 'string' && typeof record.port === 'number' ? (record as MuseRecord) : undefined;
  } catch {
    // A half-written or hand-edited file: treat it as no Muse, and start a fresh one.
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Gone, or (EPERM) another user's process that happens to have the same id: not ours to reuse.
    return false;
  }
}

/**
 * The Muse recorded for this walkthrough, if it is still running and still serving it. A process id
 * alone is not enough: after a restart another program may have been given the same one.
 */
export async function liveMuse(config: ResolvedConfig, name: string): Promise<MuseRecord | undefined> {
  const record = readMuseRecord(config, name);
  if (!record || !alive(record.pid)) return undefined;
  try {
    const res = await fetch(new URL(`${API}/state`, record.url), { signal: AbortSignal.timeout(3000) });
    const state = (await res.json()) as { name?: string };
    return res.ok && state.name === name ? record : undefined;
  } catch {
    return undefined;
  }
}

export type LaunchOutcome =
  /** Started a background Muse and opened the browser to it. */
  | 'opened'
  /** A Muse was already running for this walkthrough; opened the browser to it again. */
  | 'reused'
  /** Started (or found) a Muse, but there is no screen here to open it on, so printed its link. */
  | 'link'
  /** Running in CI: started nothing. */
  | 'ci'
  /** Turned off with --no-review or "review": false. */
  | 'off'
  /** The background Muse did not start. */
  | 'failed';

export interface LaunchOptions {
  /** False when make was given --no-review. */
  review?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Opens a URL in the default browser. Tests replace it. */
  open?: (url: string) => void;
  /** Seconds a background Muse waits with no tab open before it closes. Tests shorten it. */
  idleSeconds?: number;
  /** How long to wait for a new Muse to start serving, in milliseconds. */
  startTimeout?: number;
}

export interface LaunchResult {
  outcome: LaunchOutcome;
  url?: string;
  /** What to print, ready to show. */
  message: string;
}

/** Whether a browser window opened here would be seen by anyone. */
export function canOpenBrowser(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (env.CI) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

// The CLI entry this module belongs to: TypeScript when running from source, JavaScript once built.
const cliEntry = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './index.ts' : './index.js', import.meta.url));

/**
 * Starts Muse for a walkthrough in the background (or finds the one already running), opens the
 * browser to it where someone can see it, and returns straight away. Never throws: a Muse that
 * fails to start is reported, not a failed make.
 */
export async function launchMuse(config: ResolvedConfig, name: string, options: LaunchOptions = {}): Promise<LaunchResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const open = options.open ?? openBrowser;
  const idle = options.idleSeconds ?? MUSE_IDLE_SECONDS;
  const command = `npx tourwright muse ${name}`;
  const closes = `It closes by itself ${describeSeconds(idle)} after its tab is closed.`;

  if (options.review === false || !config.review) {
    return { outcome: 'off', message: `Review it in Muse with "${command}".` };
  }
  if (env.CI) {
    return { outcome: 'ci', message: `Not opening Muse: this looks like CI (CI is set). Review it with "${command}" on a machine with a browser.` };
  }
  const visible = canOpenBrowser(env, platform);
  const shown = (url: string, outcome: 'opened' | 'reused'): LaunchResult => {
    if (!visible) {
      return {
        outcome: 'link',
        url,
        message: `Muse is ready to review it: ${url}\nThere is no screen here to open it on, so open that link in a browser that can reach this machine. ${closes}`,
      };
    }
    open(url);
    return {
      outcome,
      url,
      message: `${outcome === 'reused' ? 'Muse was already open for it; showed it again' : 'Opened Muse to review it'}: ${url}\nWatch it, leave notes, and approve it there. ${closes}`,
    };
  };

  const running = await liveMuse(config, name);
  if (running) return shown(running.url, 'reused');

  // A record left by a Muse that has gone: it would only confuse the wait below.
  rmSync(musePath(config, name), { force: true });
  const child = spawn(process.execPath, [cliEntry, 'muse', name, '--no-open', '--background', '--idle', String(idle)], {
    cwd: config.root,
    env: { ...env, ...(config.voice.backend === 'fake' && { TOURWRIGHT_VOICE: 'fake' }) },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let exited: number | null | undefined;
  child.on('exit', (code) => (exited = code));
  child.on('error', () => (exited = -1));
  child.unref();

  // It writes its record once it is serving: bundling has started, and the page can load.
  const deadline = Date.now() + (options.startTimeout ?? 60_000);
  while (Date.now() < deadline && exited === undefined) {
    const record = readMuseRecord(config, name);
    if (record && record.pid === child.pid) return shown(record.url, 'opened');
    await new Promise((done) => setTimeout(done, 100));
  }
  if (exited === undefined) child.kill();
  return {
    outcome: 'failed',
    message: `Muse did not start${exited === undefined ? ' within a minute' : ''}, so it has not opened.\nFix: run "${command}" to open it and see what went wrong.`,
  };
}

function describeSeconds(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
