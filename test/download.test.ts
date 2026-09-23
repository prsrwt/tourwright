// The model download against a local server that misbehaves on purpose: it cuts connections
// partway through a file, like the networks where Kokoro's own download kept failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFiles, isComplete } from '../src/voice/download.ts';

interface Flaky {
  url: string;
  requests: { file: string; range?: string }[];
  close(): Promise<void>;
}

/** Serves `files`. The first `cuts` responses for each file stop after `cutAt` bytes. */
async function flakyServer(files: Record<string, Buffer>, options: { cuts?: number; cutAt?: number; ignoreRange?: boolean } = {}): Promise<Flaky> {
  const requests: Flaky['requests'] = [];
  const served = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const file = decodeURIComponent(req.url!.slice(1));
    const body = files[file];
    requests.push({ file, ...(req.headers.range && { range: req.headers.range }) });
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    let start = 0;
    if (range && !options.ignoreRange) {
      start = Number(range[1]);
      if (start >= body.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end();
        return;
      }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`, 'Content-Length': body.length - start });
    } else {
      res.writeHead(200, { 'Content-Length': body.length });
    }
    const count = (served.get(file) ?? 0) + 1;
    served.set(file, count);
    if (count <= (options.cuts ?? 0)) {
      // Send part of the file, then drop the connection mid-transfer.
      res.write(body.subarray(start, Math.min(body.length, start + (options.cutAt ?? 1000))));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(body.subarray(start));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, requests, close: () => new Promise((done) => server.close(() => done())) };
}

const bytes = (n: number, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 3) % 251));

test('a download that keeps getting cut resumes each time, and ends up whole', async () => {
  const model = bytes(10_000);
  const server = await flakyServer({ 'config.json': Buffer.from('{}'), 'onnx/model.onnx': model }, { cuts: 3, cutAt: 1500 });
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-dl-'));
  try {
    await downloadFiles({ baseUrl: server.url, dir, files: ['config.json', 'onnx/model.onnx'], backoff: 1 });
    assert.deepEqual(readFileSync(join(dir, 'onnx', 'model.onnx')), model);
    assert.ok(isComplete(dir, ['config.json', 'onnx/model.onnx']));
    // Each retry asked only for what was missing, not the whole file again.
    const ranges = server.requests.filter((r) => r.file === 'onnx/model.onnx').map((r) => r.range);
    assert.deepEqual(ranges, [undefined, 'bytes=1500-', 'bytes=3000-', 'bytes=4500-']);
    assert.ok(!existsSync(join(dir, 'onnx', 'model.onnx.partial')));
  } finally {
    await server.close();
  }
});

test('a complete download is not fetched again', async () => {
  const server = await flakyServer({ 'config.json': Buffer.from('{"a":1}') });
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-dl-'));
  try {
    await downloadFiles({ baseUrl: server.url, dir, files: ['config.json'], backoff: 1 });
    await downloadFiles({ baseUrl: server.url, dir, files: ['config.json'], backoff: 1 });
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('a truncated file left by an older version is finished, and a whole one is confirmed', async () => {
  const model = bytes(8_000);
  const server = await flakyServer({ 'model.onnx': model, 'config.json': Buffer.from('{"b":2}') });
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-dl-'));
  try {
    // What transformers.js did on a reset: a cut-off file under the real name, and no manifest.
    writeFileSync(join(dir, 'model.onnx'), model.subarray(0, 3_000));
    writeFileSync(join(dir, 'config.json'), '{"b":2}');
    assert.equal(isComplete(dir, ['model.onnx', 'config.json']), false);
    await downloadFiles({ baseUrl: server.url, dir, files: ['model.onnx', 'config.json'], backoff: 1 });
    assert.deepEqual(readFileSync(join(dir, 'model.onnx')), model);
    assert.ok(isComplete(dir, ['model.onnx', 'config.json']));
    assert.deepEqual(
      server.requests.map((r) => [r.file, r.range]),
      [
        ['model.onnx', 'bytes=3000-'],
        ['config.json', 'bytes=7-'],
        ['config.json', 'bytes=0-0'],
      ],
    );
  } finally {
    await server.close();
  }
});

test('a server that ignores the range restarts the file instead of corrupting it', async () => {
  const model = bytes(6_000, 11);
  const server = await flakyServer({ 'model.onnx': model }, { ignoreRange: true, cuts: 1, cutAt: 2_000 });
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-dl-'));
  try {
    await downloadFiles({ baseUrl: server.url, dir, files: ['model.onnx'], backoff: 1 });
    assert.deepEqual(readFileSync(join(dir, 'model.onnx')), model);
  } finally {
    await server.close();
  }
});

test('a missing file fails at once with the server\'s answer, and gives up after the tries', async () => {
  const server = await flakyServer({ 'model.onnx': bytes(5_000) }, { cuts: 100, cutAt: 100 });
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-dl-'));
  mkdirSync(dir, { recursive: true });
  try {
    await assert.rejects(downloadFiles({ baseUrl: server.url, dir, files: ['nope.json'], backoff: 1 }), /404/);
    assert.equal(server.requests.length, 1);
    await assert.rejects(downloadFiles({ baseUrl: server.url, dir, files: ['model.onnx'], tries: 3, backoff: 1 }), /gave up after 3 attempts/);
    assert.ok(existsSync(join(dir, 'model.onnx.partial')), 'what was downloaded is kept for next time');
  } finally {
    await server.close();
  }
});
