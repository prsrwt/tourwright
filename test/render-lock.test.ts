// One render of a video at a time: two at once wrote the same temporary file and left a corrupt MP4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockRender } from '../src/render/lock.ts';

test('a second render of the same video is refused while the first runs, and allowed after', () => {
  const video = join(mkdtempSync(join(tmpdir(), 'tourwright-lock-')), 'intro.mp4');
  const release = lockRender(`${video}.lock`, 'intro');
  // Another process holding it: this process stands in for it by writing a live pid it does not own.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
  try {
    writeFileSync(`${video}.lock`, String(other.pid));
    assert.throws(() => lockRender(`${video}.lock`, 'intro'), /already being rendered/);
  } finally {
    other.kill();
  }
  release();
  assert.equal(existsSync(`${video}.lock`), false);
  lockRender(`${video}.lock`, 'intro')();
});

test('a lock left by a render that crashed is taken over', () => {
  const video = join(mkdtempSync(join(tmpdir(), 'tourwright-lock-')), 'intro.mp4');
  // A pid that is not running.
  writeFileSync(`${video}.lock`, '999999');
  const release = lockRender(`${video}.lock`, 'intro');
  release();
  assert.equal(existsSync(`${video}.lock`), false);
});
