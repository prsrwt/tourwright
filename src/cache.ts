import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where downloads shared by every app live: the voice model. TOURWRIGHT_CACHE overrides it.
 * Per-walkthrough audio is cached in the app's own out folder instead, next to what it belongs to.
 */
export function sharedCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TOURWRIGHT_CACHE) return env.TOURWRIGHT_CACHE;
  if (process.platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'tourwright');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'tourwright');
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'tourwright');
}

export function modelCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(sharedCacheDir(env), 'models');
}
