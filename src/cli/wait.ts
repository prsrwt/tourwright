// wait: how the agent learns what the user decided in Muse. It blocks until the user approves
// the current version, asks for changes, or answers one of the agent's questions, then says so
// and what to do next, with an exit code a script or agent can branch on. Without it an agent
// hands the video over and never hears that it was approved, or keeps asking.

import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import type { Note, Review } from '../studio/protocol.ts';
import { formatReview, reviewState, type ReviewState } from '../studio/review.ts';
import { readNotes } from '../studio/server.ts';
import { videoPath } from './render.ts';

/** Exit codes, so a caller can branch without reading the text. */
export const WAIT = { approved: 0, feedback: 2, timeout: 3 } as const;

export interface WaitOptions {
  /** Seconds to wait before giving up for now. 0 waits for as long as it takes. */
  timeout?: number;
  /** Milliseconds between looks at review.json and notes.json. */
  interval?: number;
}

/**
 * Just under ten minutes, the longest one command may run in Claude Code, so an agent's shell
 * never kills the wait first: a timeout says to wait again, which the agent can act on.
 */
export const DEFAULT_TIMEOUT = 540;

export async function runWait(config: ResolvedConfig, name: string, options: WaitOptions = {}): Promise<number> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? 500;
  const start = reviewState(config, name);
  if (start.approved) return approved(config, name, start);

  // What the user had already said before the wait began does not end it; only something new does.
  const seen = verdictKey(start.review);
  const asked = new Set(readNotes(config, name).filter((n) => n.status === 'question').map((n) => n.id));
  console.log(`Waiting for the user to review "${name}" in Muse (npx tourwright muse ${name})${timeout ? `, for up to ${timeout} s` : ''}...`);

  const deadline = timeout ? Date.now() + timeout * 1000 : Infinity;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, Math.min(interval, Math.max(0, deadline - Date.now()))));
    let state: ReviewState;
    let notes: Note[];
    try {
      state = reviewState(config, name);
      notes = readNotes(config, name);
    } catch {
      // Muse may be halfway through writing a file: look again next time.
      continue;
    }
    if (state.approved) return approved(config, name, state);
    if (state.current && state.review?.status === 'changes-requested' && verdictKey(state.review) !== seen) {
      console.log(`${formatReview(name, state)}\n`);
      console.log(`The user wants changes. ${openCount(notes)}\nNext: run "npx tourwright notes ${name}", handle each open note and the review's comment, make it again, then wait again.`);
      return WAIT.feedback;
    }
    const answered = notes.filter((n) => asked.has(n.id) && n.status === 'open');
    if (answered.length) {
      console.log(`The user answered your question on ${answered.map((n) => `[${n.id}]`).join(', ')}. ${openCount(notes)}\nNext: run "npx tourwright notes ${name}" and handle the open notes, then wait again.`);
      return WAIT.feedback;
    }
  }
  const state = reviewState(config, name);
  console.log(`${formatReview(name, state)}\n`);
  console.log(`Still waiting: the user has not approved "${name}" or asked for changes yet. ${openCount(readNotes(config, name))}\nNext: run "npx tourwright wait ${name}" again to keep waiting.`);
  return WAIT.timeout;
}

function approved(config: ResolvedConfig, name: string, state: ReviewState): number {
  console.log(`${formatReview(name, state)}\n`);
  const video = videoPath(config, name);
  const shown = relative(process.cwd(), video) || video;
  // Edits made in Muse change script.json after the last render, so the MP4 may be an earlier cut.
  const fresh = existsSync(video) && statSync(video).mtimeMs >= statSync(scriptPath(config, name)).mtimeMs;
  console.log(
    fresh
      ? `Done: "${name}" is finished, and ${shown} is the approved version. Tell the user it is finished and carry on with what comes next. There is nothing more to ask about this video.`
      : `Done: the user approved "${name}". ${existsSync(video) ? `${shown} is older than the approved script.json, so` : 'There is no video yet, so'} render the final cut with "npx tourwright make ${name} --require-approval --no-review", then tell the user it is finished and carry on with what comes next.`,
  );
  return WAIT.approved;
}

function verdictKey(review: Review | undefined): string {
  return review ? `${review.status} ${review.scriptHash} ${review.at}` : '';
}

function openCount(notes: Note[]): string {
  const open = notes.filter((n) => n.status === 'open').length;
  return open ? `${open} note${open === 1 ? ' is' : 's are'} open for you.` : 'No notes are open for you.';
}
