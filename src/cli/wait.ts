// wait: how the agent learns what the user decided in Muse. It blocks until the user approves
// the current version, asks for changes, or answers one of the agent's questions, then says so
// and what to do next, with an exit code a script or agent can branch on. Without it an agent
// hands the video over and never hears that it was approved, or keeps asking.

import { existsSync, statSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import type { Note, Review } from '../studio/protocol.ts';
import { formatReview, reviewState, type ReviewState } from '../studio/review.ts';
import { readNotes } from '../studio/server.ts';
import { printNote } from './notes.ts';
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
  const before = new Map(readNotes(config, name).map((n) => [n.id, { status: n.status, text: n.text, userReplies: userReplies(n) }]));
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
      // The notes the user sent with the request, in full, so the agent can start on them at once.
      const ids = state.review.notes ?? [];
      const sent = notes.filter((n) => ids.includes(n.id));
      const alsoOpen = notes.filter((n) => n.status === 'open' && !ids.includes(n.id));
      console.log(`${formatReview(name, state)}\n`);
      console.log(`The user sent ${sent.length ? `${sent.length} note${sent.length === 1 ? '' : 's'}` : 'a request'} for you to handle:\n`);
      for (const note of [...sent, ...alsoOpen]) printNote(note, dirname(scriptPath(config, name)));
      console.log(settled(notes, before));
      console.log(handle(name));
      return WAIT.feedback;
    }
    // Every answer the user gives on a note is for the agent: an answer to its question, "not fixed
    // yet" on a fix, or a closed note reopened. A brand-new note is not, until the user sends it.
    // Rewording a note already sent changes what the agent was asked; rewording one not sent yet does not.
    const sentIds = state.current && state.review?.status === 'changes-requested' ? (state.review.notes ?? []) : [];
    const handedBack = notes.filter((n) => {
      const was = before.get(n.id);
      return was && n.status === 'open' && (was.status !== 'open' || userReplies(n) > was.userReplies || (n.text !== was.text && sentIds.includes(n.id)));
    });
    if (handedBack.length) {
      for (const note of handedBack) {
        const was = before.get(note.id)!.status;
        const what = was === 'question' ? 'answered your question' : was === 'fixed' ? 'says this is not fixed yet' : was === 'closed' ? 'reopened this note' : note.text !== before.get(note.id)!.text ? 'reworded a note they sent you' : 'replied';
        console.log(`The user ${what}:\n`);
        printNote(note, dirname(scriptPath(config, name)));
      }
      console.log(settled(notes, before));
      console.log(handle(name));
      return WAIT.feedback;
    }
  }
  const state = reviewState(config, name);
  console.log(`${formatReview(name, state)}\n`);
  console.log(settled(readNotes(config, name), before));
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

function userReplies(note: Note): number {
  return note.replies.filter((r) => r.from === 'you').length;
}

/**
 * What else the user did while the agent waited that needs nothing from it, so it still knows:
 * fixes they approved (the note's "Approve fix") and notes they deleted.
 */
function settled(notes: Note[], before: Map<string, { status: string }>): string {
  const approvedFixes = notes.filter((n) => n.status === 'closed' && before.get(n.id)?.status === 'fixed').map((n) => `[${n.id}]`);
  const deleted = [...before.keys()].filter((id) => !notes.some((n) => n.id === id)).map((id) => `[${id}]`);
  const lines = [
    ...(approvedFixes.length ? [`The user also approved your fix on ${approvedFixes.join(', ')}: those notes are closed.`] : []),
    ...(deleted.length ? [`The user deleted ${deleted.join(', ')}: nothing to do for those.`] : []),
  ];
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function handle(name: string): string {
  return [
    `Next: make each change (read references/muse.md if you are unsure how), then say what you did on each note with`,
    `npx tourwright reply ${name} <id> --fixed "what you changed" (or --question "what you need to know"),`,
    `make it again, and wait again with npx tourwright wait ${name}.`,
  ].join('\n');
}

function verdictKey(review: Review | undefined): string {
  return review ? `${review.status} ${review.scriptHash} ${review.at}` : '';
}

function openCount(notes: Note[]): string {
  const open = notes.filter((n) => n.status === 'open').length;
  return open ? `${open} note${open === 1 ? ' is' : 's are'} open for you.` : 'No notes are open for you.';
}
