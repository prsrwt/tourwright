// Downloads model files ourselves, because transformers.js neither resumes an interrupted
// download nor notices a truncated one: on a connection that resets, it can cache half a model
// as if it were whole. Here each file resumes where it stopped (an HTTP range request), is
// written under a temporary name, and is only moved into place once its size matches what the
// server said. A manifest records the files known to be complete.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface DownloadOptions {
  /** Base URL of the model, ending in "/", such as https://huggingface.co/<model>/resolve/main/. */
  baseUrl: string;
  /** Folder the files go in, keeping their relative paths. */
  dir: string;
  files: readonly string[];
  /** Attempts per file before giving up. Every attempt resumes, so progress is never lost. */
  tries?: number;
  /** Milliseconds between attempts, multiplied by the attempt number up to five times. */
  backoff?: number;
  log?: (line: string) => void;
}

export class DownloadError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const MANIFEST = '.tourwright-complete.json';

type Manifest = Record<string, number>;

function readManifest(dir: string): Manifest {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function writeManifest(dir: string, manifest: Manifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
}

/** True when every file is recorded as complete and still has its recorded size. No network. */
export function isComplete(dir: string, files: readonly string[]): boolean {
  const manifest = readManifest(dir);
  return files.every((file) => {
    const size = manifest[file];
    const path = join(dir, file);
    return size !== undefined && existsSync(path) && statSync(path).size === size;
  });
}

export async function downloadFiles(options: DownloadOptions): Promise<void> {
  const manifest = readManifest(options.dir);
  for (const file of options.files) {
    const path = join(options.dir, file);
    const recorded = manifest[file];
    if (recorded !== undefined && existsSync(path) && statSync(path).size === recorded) continue;
    manifest[file] = await downloadFile(file, path, options);
    writeManifest(options.dir, manifest);
  }
}

async function downloadFile(file: string, path: string, options: DownloadOptions): Promise<number> {
  const url = new URL(file, options.baseUrl).href;
  const partial = `${path}.partial`;
  const tries = options.tries ?? 30;
  const backoff = options.backoff ?? 1000;
  const log = options.log ?? (() => undefined);
  mkdirSync(dirname(path), { recursive: true });

  // A file already in place without a manifest entry came from an older version, which could
  // cache a truncated download. Treat it as a partial download: resuming either finishes it or,
  // if it is already whole, confirms its size.
  if (existsSync(path) && !existsSync(partial)) renameSync(path, partial);

  let lastError: unknown;
  let reported = -1;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const have = existsSync(partial) ? statSync(partial).size : 0;
    try {
      const response = await fetch(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
      let total: number;
      let append: boolean;
      if (response.status === 416) {
        // Nothing left to fetch: the partial file may already be whole. Check its real size.
        await response.body?.cancel();
        total = await remoteSize(url);
        if (total !== have) throw new DownloadError(`${file}: the server has ${total} bytes but ${have} are on disk.`, 'ESIZE');
        append = true;
      } else if (response.status === 206) {
        total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1]);
        append = true;
      } else if (response.status === 200) {
        // The server ignored the range: start again from the beginning.
        total = Number(response.headers.get('content-length'));
        append = false;
      } else {
        await response.body?.cancel();
        throw new DownloadError(`${file}: the server answered ${response.status} ${response.statusText}.`, `HTTP${response.status}`);
      }
      if (!Number.isFinite(total) || total <= 0) throw new DownloadError(`${file}: the server did not say how big the file is.`, 'ESIZE');

      if (response.status !== 416 && response.body) {
        const start = append ? have : 0;
        let received = start;
        // Each chunk is on disk before the next is read, so a connection cut mid-file keeps
        // everything that arrived before it. A write stream opens its file asynchronously, and
        // pipeline discards what is still queued for it when the source fails, losing progress.
        const fd = openSync(partial, append ? 'a' : 'w');
        try {
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            writeSync(fd, chunk);
            received += chunk.length;
            const percent = Math.floor((received / total) * 100);
            if (total > 5_000_000 && percent >= reported + 10) {
              reported = percent - (percent % 10);
              log(`  ${file}: ${reported}%`);
            }
          }
        } finally {
          closeSync(fd);
        }
      }

      const size = statSync(partial).size;
      if (size < total) throw new DownloadError(`${file}: the connection closed after ${size} of ${total} bytes.`, 'ETRUNCATED');
      if (size > total) {
        // More on disk than the server has: the partial file is not this file. Start over.
        rmSync(partial);
        throw new DownloadError(`${file}: ${size} bytes on disk but the server has ${total}.`, 'ESIZE');
      }
      renameSync(partial, path);
      return size;
    } catch (error) {
      lastError = error;
      if (error instanceof DownloadError && error.code.startsWith('HTTP4') && error.code !== 'HTTP416') throw error;
      if (attempt < tries) {
        // On a bad connection this can happen dozens of times: report the first and every fifth.
        if (attempt === 1 || attempt % 5 === 0) {
          const kept = existsSync(partial) ? statSync(partial).size : 0;
          log(`  ${file}: interrupted (${codeOf(error)}); retrying from ${(kept / 1e6).toFixed(1)} MB (attempt ${attempt + 1} of ${tries}).`);
        }
        await new Promise((done) => setTimeout(done, backoff * Math.min(attempt, 5)));
      }
    }
  }
  throw new DownloadError(`${file}: gave up after ${tries} attempts (${codeOf(lastError)}). What was downloaded is kept and will resume next time.`, codeOf(lastError));
}

/** The file's full size, from a one-byte range request. */
async function remoteSize(url: string): Promise<number> {
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  await response.body?.cancel();
  const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? response.headers.get('content-length'));
  if (!Number.isFinite(total)) throw new DownloadError(`Could not read the size of ${url}.`, 'ESIZE');
  return total;
}

export function codeOf(error: unknown): string {
  if (error instanceof DownloadError) return error.code;
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error as { code?: string })?.code ?? (error as Error)?.message ?? String(error);
}
