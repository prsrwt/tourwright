// wait: how the agent learns what the user decided in Muse. It blocks until the user approves
// the current version, asks for changes, or answers one of the agent's questions, then says so
// and what to do next, with an exit code a script or agent can branch on. Without it an agent
// hands the video over and never hears that it was approved, or keeps asking.

import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import { describeBoxes, type BoxScript } from '../studio/boxes.ts';
import type { Note, Review, StudioState } from '../studio/protocol.ts';
import { formatReview, reviewState, type ReviewState } from '../studio/review.ts';
import { readNotes } from '../studio/server.ts';
import { museState } from './launch.ts';
import { printNote } from './notes.ts';
import { finalVideo } from '../render/record.ts';

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
  const boxesBefore = boxes(config, name);
  const deadline = timeout ? Date.now() + timeout * 1000 : Infinity;
  if (start.approved) return approved(config, name, start, deadline, interval);

  // What the user had already said before the wait began does not end it; only something new does.
  const seen = verdictKey(start.review);
  const before = new Map(readNotes(config, name).map((n) => [n.id, { status: n.status, text: n.text, userReplies: userReplies(n) }]));
  console.log(`Waiting for the user to review "${name}" in Muse (npx tourwright muse ${name})${timeout ? `, for up to ${timeout} s` : ''}...`);

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
    if (state.approved) return (logIf(boxChanges(config, name, boxesBefore)), await approved(config, name, state, deadline, interval));
    if (state.current && state.review?.status === 'changes-requested' && verdictKey(state.review) !== seen) {
      // The notes the user sent with the request, in full, so the agent can start on them at once.
      const ids = state.review.notes ?? [];
      const sent = notes.filter((n) => ids.includes(n.id));
      const alsoOpen = notes.filter((n) => n.status === 'open' && !ids.includes(n.id));
      console.log(`${formatReview(name, state)}\n`);
      console.log(`The user sent ${sent.length ? `${sent.length} note${sent.length === 1 ? '' : 's'}` : 'a request'} for you to handle:\n`);
      for (const note of [...sent, ...alsoOpen]) printNote(note, dirname(scriptPath(config, name)));
      console.log(settled(notes, before));
      logIf(boxChanges(config, name, boxesBefore));
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
      logIf(boxChanges(config, name, boxesBefore));
      console.log(handle(name));
      return WAIT.feedback;
    }
  }
  const state = reviewState(config, name);
  console.log(`${formatReview(name, state)}\n`);
  console.log(settled(readNotes(config, name), before));
  logIf(boxChanges(config, name, boxesBefore));
  console.log(`Still waiting: the user has not approved "${name}" or asked for changes yet. ${openCount(readNotes(config, name))}\nNext: run "npx tourwright wait ${name}" again to keep waiting.`);
  return WAIT.timeout;
}

async function approved(config: ResolvedConfig, name: string, state: ReviewState, deadline: number, interval: number): Promise<number> {
  console.log(`${formatReview(name, state)}\n`);
  // Edits made in Muse change script.json after the last render, and a draft has the silent voice,
  // so the MP4 on disk is the final video only when its render record says so.
  let video = finalVideo(config, name, state);
  const shown = relative(process.cwd(), video.file) || video.file;
  const done = `Done: "${name}" is finished, and ${shown} is the approved version. Tell the user it is finished and carry on with what comes next. There is nothing more to ask about this video.`;
  if (video.ready) return (console.log(done), WAIT.approved);

  // Muse asks the reviewer whether to render the final video once they approve it, and renders it
  // itself: leave that to them, rather than render it a second time.
  let muse = await museState(config, name);
  const inMuse = (s: StudioState | undefined) => s?.renderOffer === 'pending' || s?.render?.status === 'running';
  if (inMuse(muse)) console.log(muse!.render?.status === 'running' ? 'The user is rendering the final video in Muse. Waiting for it to finish...' : 'Muse is asking the user whether to render the final video now. Waiting for their answer...');
  while (inMuse(muse) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))));
    muse = await museState(config, name);
    video = finalVideo(config, name, reviewState(config, name));
  }
  if (video.ready) return (console.log(done), WAIT.approved);
  if (inMuse(muse)) {
    const where = muse!.render?.status === 'running' ? `Muse is rendering the final video (${muse!.render.step.toLowerCase()}, ${muse!.render.percent}%)` : 'Muse is still asking the user whether to render the final video now';
    console.log(`Still waiting: the user approved "${name}", and ${where}.\nNext: run "npx tourwright wait ${name}" again to keep waiting. Don't render it yourself meanwhile.`);
    return WAIT.timeout;
  }
  // A render from Muse for this approval that failed: the approval stands, but the video needs you.
  const render = muse?.render;
  if (render?.status === 'failed' && state.review && render.started >= state.review.at) {
    console.log(`The user tried to render the final video in Muse, and it failed:\n\n${render.error ?? '(no output)'}\n`);
    console.log(`Next: fix what it says, then render the final cut with "npx tourwright make ${name} --require-approval --no-review" (with the real voice, so without --fake-voice), and tell the user it is finished.`);
    return WAIT.feedback;
  }
  if (muse?.renderOffer === 'declined') {
    console.log(`Done: the user approved "${name}", and chose not to render the final video yet (${video.why.charAt(0).toLowerCase()}${video.why.slice(1)}). Don't render it unless they ask: tell the user it is approved, and that Muse can render it whenever they are ready, then carry on with what comes next.`);
    return WAIT.approved;
  }
  console.log(`Done: the user approved "${name}". ${video.why}, so render the final cut with "npx tourwright make ${name} --require-approval --no-review" (with the real voice, so without --fake-voice), then tell the user it is finished and carry on with what comes next.`);
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

function logIf(text: string): void {
  if (text) console.log(text);
}

function boxes(config: ResolvedConfig, name: string): string[] {
  try {
    return describeBoxes(JSON.parse(readFileSync(scriptPath(config, name), 'utf8')) as BoxScript);
  } catch {
    // A script mid-edit, or broken: nothing to compare, and check will say what is wrong.
    return [];
  }
}

/**
 * Narration boxes the user placed, moved or deleted in Muse while the agent waited. They are the
 * user's own choices, so the agent should know them and not put its own back over them.
 */
function boxChanges(config: ResolvedConfig, name: string, before: string[]): string {
  const now = boxes(config, name);
  const added = now.filter((line) => !before.includes(line));
  const removed = before.filter((line) => !now.includes(line));
  if (!added.length && !removed.length) return '';
  return [
    'The user changed the narration boxes themselves in Muse. They are in script.json now; keep them unless a note asks otherwise:',
    ...added.map((line) => `  now: ${line}`),
    ...removed.map((line) => `  was: ${line}`),
    '',
  ].join('\n');
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
