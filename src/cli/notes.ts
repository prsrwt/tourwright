import { relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { formatScreen } from '../runtime/screen.ts';
import type { Note, NoteStatus } from '../studio/protocol.ts';
import { formatReview, reviewState } from '../studio/review.ts';
import { notesPath, readNotes } from '../studio/server.ts';

/** The order notes are listed in, and what each group means for the agent. */
const GROUPS: { status: NoteStatus; title: string }[] = [
  { status: 'question', title: 'Waiting for the user to answer your question' },
  { status: 'open', title: 'Open: yours to handle' },
  { status: 'fixed', title: 'Fixed: waiting for the user to approve' },
  { status: 'closed', title: 'Closed: approved by the user' },
];

/**
 * Prints the studio notes by status, questions first: where each is in the video, what was being
 * said and shown, the note and its thread. Then where the whole video's review stands.
 */
export function runNotes(config: ResolvedConfig, name: string, options: { json: boolean }): number {
  const notes = readNotes(config, name);
  const review = reviewState(config, name);
  const ordered = GROUPS.flatMap((g) => notes.filter((n) => n.status === g.status));
  if (options.json) {
    console.log(JSON.stringify({ review, notes: ordered }, null, 2));
    return 0;
  }
  const file = relative(process.cwd(), notesPath(config, name)) || notesPath(config, name);
  console.log(`${formatReview(name, review)}\n`);
  if (!notes.length) {
    console.log(`No notes for "${name}" (${file}).`);
    return 0;
  }
  const count = (status: NoteStatus) => notes.filter((n) => n.status === status).length;
  console.log(`${notes.length} note${notes.length === 1 ? '' : 's'} for "${name}" (${file}): ${GROUPS.map((g) => `${count(g.status)} ${g.status}`).join(', ')}.\n`);
  for (const group of GROUPS) {
    const list = notes.filter((n) => n.status === group.status);
    if (!list.length) continue;
    console.log(`## ${group.title} (${list.length})\n`);
    for (const note of list) {
      if (note.status === 'closed') {
        // Settled: one line each, so the ones that need work stay easy to find.
        console.log(`[${note.id}] at ${(note.ms / 1000).toFixed(3)} s, ${where(note)}: ${oneLine(note.text)}`);
        continue;
      }
      printNote(note);
    }
    if (group.status === 'closed') console.log('');
  }
  console.log(
    [
      'To answer a note, edit the notes file. Add a reply to its "replies": { "from": "agent", "text": "...", "at": "<ISO time>" }, then set its "status":',
      '- "fixed" once you have made the change, with a reply saying what you changed;',
      '- "question" if you are unsure what the user wants, with a reply asking them.',
      'Never set "closed": only the user approves a fix.',
    ].join('\n'),
  );
  return 0;
}

function printNote(note: Note): void {
  const scope = note.scope === 'scene' ? ', about the whole scene' : note.scope === 'all' ? ', about the whole video' : '';
  console.log(`[${note.id}] at ${(note.ms / 1000).toFixed(3)} s (frame ${note.frame}), in ${where(note)}${scope}`);
  if (note.target) {
    const r = note.rect;
    console.log(`  on target "${note.target}"${r ? `, on screen at x ${r.x}, y ${r.y}, ${r.w} by ${r.h} (layout pixels)` : ''}`);
  }
  if (note.sentence) console.log(`  while saying: "${note.sentence}"`);
  console.log(`  ${note.text.replace(/\n/g, '\n  ')}`);
  for (const reply of note.replies) console.log(`  ${reply.from === 'agent' ? 'Agent' : 'User'}: ${reply.text.replace(/\n/g, '\n    ')}`);
  if (note.screen) console.log(`  On screen at ${formatScreen(note.screen, '  ').trimStart()}`);
  console.log('');
}

function where(note: Note): string {
  return note.sceneIndex >= 0 ? `scene "${note.scene}" (scenes[${note.sceneIndex}])` : 'the title card';
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}
