// The whole video's review: approved, or changes requested, for one exact version of script.json.
// An approval names the script's hash, so any edit afterwards (by the user, the studio or the
// agent) means the approval no longer counts, and the video needs looking at again.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import type { Review } from './protocol.ts';

export class ReviewError extends Error {}

/** A short hash of script.json's text: what the studio's saves and reviews are checked against. */
export function hashScript(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function reviewPath(config: ResolvedConfig, name: string): string {
  return join(dirname(scriptPath(config, name)), 'review.json');
}

/** The review, or undefined if the video has not been reviewed. A broken file is an error. */
export function readReview(config: ResolvedConfig, name: string): Review | undefined {
  const file = reviewPath(config, name);
  if (!existsSync(file)) return undefined;
  let parsed: Partial<Review>;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Partial<Review>;
  } catch (error) {
    throw new ReviewError(`${file} is not valid JSON: ${(error as Error).message}\nFix: review the video again in Muse, which rewrites it, or delete the file.`);
  }
  if ((parsed.status !== 'approved' && parsed.status !== 'changes-requested') || typeof parsed.scriptHash !== 'string') {
    throw new ReviewError(`${file} needs a "status" of "approved" or "changes-requested", and a "scriptHash".\nFix: review the video again in Muse, which rewrites it, or delete the file.`);
  }
  return parsed as Review;
}

export function writeReview(config: ResolvedConfig, name: string, review: Review): void {
  writeFileSync(reviewPath(config, name), JSON.stringify(review, null, 2) + '\n');
}

export interface ReviewState {
  review: Review | undefined;
  /** True when the review is for script.json as it is now. */
  current: boolean;
  /** True only when the current script.json is approved: the one state in which the video is finished. */
  approved: boolean;
}

export function reviewState(config: ResolvedConfig, name: string): ReviewState {
  const review = readReview(config, name);
  const current = !!review && review.scriptHash === hashScript(readFileSync(scriptPath(config, name), 'utf8'));
  return { review, current, approved: current && review?.status === 'approved' };
}

/** One line on where the review stands, with what to do next. */
export function formatReview(name: string, { review, current }: ReviewState): string {
  const muse = `npx tourwright muse ${name}`;
  if (!review) return `Review: not reviewed yet. The user approves the video in Muse (${muse}).`;
  const when = review.at ? ` on ${review.at.slice(0, 16).replace('T', ' ')} UTC` : '';
  if (review.status === 'approved') {
    return current
      ? `Review: approved${when}, for script.json as it is now.`
      : `Review: edited since approval. It was approved${when}, but script.json has changed since, so the approval no longer counts. The user needs to look again in Muse (${muse}).`;
  }
  const comment = review.comment ? `: "${review.comment}"` : '.';
  return current ? `Review: changes requested${when}${comment}` : `Review: changes were requested${when} on an earlier version${comment} The user has not reviewed the edits since.`;
}
