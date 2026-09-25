// out/<name>/render.json: what the MP4 on disk was made from, so wait and Muse can tell whether it
// is the version the user approved, an earlier cut, or a draft with the silent stand-in voice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ResolvedConfig, VoiceBackend } from '../config/config.ts';
import { changedInputs, fingerprint, listFiles, type Inputs } from '../studio/fingerprint.ts';
import type { ReviewState } from '../studio/review.ts';

export interface RenderRecord {
  /** ISO time the render finished. */
  at: string;
  /** The voice it was narrated with: "fake" is silence, a draft and never the final video. */
  voice: VoiceBackend;
  /** Every file the render was made from, as a review records them. */
  inputs: Inputs;
}

export function renderRecordPath(config: ResolvedConfig, name: string): string {
  return join(config.out, name, 'render.json');
}

export function videoPath(config: ResolvedConfig, name: string): string {
  return join(config.out, `${name}.mp4`);
}

/** Records a finished render: the voice, and what the stage server loaded to make it. */
export function writeRenderRecord(config: ResolvedConfig, name: string, sources: Iterable<string>): RenderRecord {
  mkdirSync(join(config.out, name), { recursive: true });
  const record: RenderRecord = { at: new Date().toISOString(), voice: config.voice.backend, inputs: fingerprint(config, name, sources) };
  writeFileSync(renderRecordPath(config, name), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** The record, or undefined if there is none or it cannot be read: either way, nothing is known about the MP4. */
export function readRenderRecord(config: ResolvedConfig, name: string): RenderRecord | undefined {
  const file = renderRecordPath(config, name);
  if (!existsSync(file)) return undefined;
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as Partial<RenderRecord>;
    return typeof record.at === 'string' && typeof record.voice === 'string' && record.inputs && typeof record.inputs === 'object' ? (record as RenderRecord) : undefined;
  } catch {
    return undefined;
  }
}

export type FinalVideo =
  /** The MP4 on disk is the approved version, with the real voice. */
  | { ready: true; file: string }
  /** It is not, and `why` says so in a sentence fragment ("There is no video yet", ...). */
  | { ready: false; file: string; why: string };

/**
 * Whether the MP4 on disk is the final video: the version the user approved, narrated with the real
 * voice. Both the approval and the render have to match the files as they are now, so they match
 * each other.
 */
export function finalVideo(config: ResolvedConfig, name: string, review: ReviewState): FinalVideo {
  const file = videoPath(config, name);
  const shown = relative(process.cwd(), file) || file;
  const not = (why: string): FinalVideo => ({ ready: false, file, why });
  if (!existsSync(file)) return not('There is no video yet');
  const record = readRenderRecord(config, name);
  if (!record) return not(`Nothing records what ${shown} was made from (an older Tourwright rendered it)`);
  const changed = changedInputs(config, record.inputs);
  if (changed.length) return not(`${shown} was rendered before ${listFiles(changed)} changed`);
  if (record.voice === 'fake') return not(`${shown} has the silent stand-in voice (--fake-voice)`);
  if (!review.approved) return not(`The user has not approved this version yet`);
  return { ready: true, file };
}
