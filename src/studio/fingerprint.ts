// What a video is made from, file by file, so an approval (or a render) can tell later whether
// anything it covered has changed: script.json, the tourwright config, every file of the app the
// preview loaded (the stages file, its fixtures, the components they import, their CSS), and the
// lockfile, which stands in for everything installed in node_modules.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';

/** Each file, relative to the app's root with forward slashes, to a short hash of its contents. */
export type Inputs = Record<string, string>;

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

/**
 * A short hash of a file's contents, or undefined if it cannot be read. Text is hashed with its
 * line endings as "\n": git on Windows checks files out with "\r\n" (core.autocrlf), so a pull or
 * a branch switch rewrites the bytes of files nobody edited, and that must not undo an approval.
 */
export function hashFile(file: string): string | undefined {
  try {
    return shortHash(normalise(readFileSync(file)));
  } catch {
    return undefined;
  }
}

/**
 * The hashes a file may have been recorded under. Approvals written by earlier versions hashed the
 * raw bytes, with whichever line endings that checkout had, so those count too: the text with "\n"
 * and with "\r\n" endings.
 */
export function fileHashes(file: string): string[] {
  try {
    const text = normalise(readFileSync(file));
    const hashes = [shortHash(text)];
    if (!text.subarray(0, 8000).includes(0)) hashes.push(shortHash(Buffer.from(text.toString('latin1').replace(/\n/g, '\r\n'), 'latin1')));
    return hashes;
  } catch {
    return [];
  }
}

function shortHash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Text with "\r\n" line endings as "\n"; anything with a zero byte near the start is binary, and left alone. */
export function normalise(bytes: Buffer): Buffer {
  if (bytes.subarray(0, 8000).includes(0) || !bytes.includes(13)) return bytes;
  return Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** The nearest lockfile at or above the app's root: in a monorepo it sits at the top. */
export function findLockfile(root: string): string | undefined {
  let dir = resolve(root);
  for (;;) {
    for (const name of LOCKFILES) {
      if (existsSync(join(dir, name))) return join(dir, name);
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** How a file is named in Inputs. */
export function inputKey(config: ResolvedConfig, file: string): string {
  return relative(config.root, file).split(sep).join('/');
}

/** The files a video depends on, whatever its stage loads, and then the ones the preview loaded. */
export function inputFiles(config: ResolvedConfig, name: string, sources: Iterable<string>): string[] {
  const lockfile = findLockfile(config.root);
  return [...new Set([scriptPath(config, name), config.configFile, ...(lockfile ? [lockfile] : []), ...sources].map((f) => resolve(f)))];
}

export function fingerprint(config: ResolvedConfig, name: string, sources: Iterable<string>): Inputs {
  const out: Inputs = {};
  for (const file of inputFiles(config, name, sources).sort()) {
    const hash = hashFile(file);
    if (hash) out[inputKey(config, file)] = hash;
  }
  return out;
}

/** The files among `inputs` that are different now, or gone, in the order recorded. */
export function changedInputs(config: ResolvedConfig, inputs: Inputs): string[] {
  return Object.entries(inputs)
    .filter(([file, hash]) => !fileHashes(resolve(config.root, file)).includes(hash))
    .map(([file]) => file);
}

/** The files among `files` written after `since` (a time in milliseconds), named as in Inputs. */
export function writtenSince(config: ResolvedConfig, files: Iterable<string>, since: number): string[] {
  const out: string[] = [];
  for (const file of files) {
    try {
      if (statSync(file).mtimeMs > since) out.push(inputKey(config, file));
    } catch {
      // Deleted since it loaded: the next load says what is wrong, if anything.
    }
  }
  return out;
}

/** A few file names for a sentence: "a, b and c", or "a, b, c and 4 more". */
export function listFiles(files: string[]): string {
  const shown = files.length > 4 ? [...files.slice(0, 3), `${files.length - 3} more`] : files;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
}
