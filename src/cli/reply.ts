// reply: the agent's answer to a note left in Muse, in one command. Editing notes.json by hand
// costs an agent a read of the whole file and a careful rewrite of it, and a slip breaks the file
// for Muse; this appends the reply, sets the status and leaves everything else as it was.

import type { ResolvedConfig } from '../config/config.ts';
import type { NoteStatus } from '../studio/protocol.ts';
import { NotesError, readNotes, writeNotes } from '../studio/server.ts';

export interface ReplyOptions {
  /** What was changed: marks the note fixed, for the user to approve. */
  fixed?: string;
  /** What the agent needs to know: marks the note a question, for the user to answer. */
  question?: string;
}

export function runReply(config: ResolvedConfig, name: string, id: string | undefined, options: ReplyOptions): number {
  const usage = `Usage: tourwright reply ${name} <note id> --fixed "what you changed"   (or --question "what you need to know")`;
  if (!id) {
    console.error(`${usage}\nFix: give the note's id, shown in brackets by "npx tourwright notes ${name}".`);
    return 1;
  }
  const given = (['fixed', 'question'] as const).filter((k) => options[k] !== undefined);
  if (given.length !== 1 || !options[given[0]!]!.trim()) {
    console.error(`Say either --fixed "what you changed" or --question "what you need to know", with some text.\n${usage}`);
    return 1;
  }
  const status: NoteStatus = given[0]!;
  const text = options[status as 'fixed' | 'question']!.trim();

  const notes = readNotes(config, name);
  const note = notes.find((n) => n.id === id);
  if (!note) {
    const ids = notes.map((n) => n.id);
    throw new NotesError(`There is no note "${id}" for "${name}".${ids.length ? ` Notes: ${ids.join(', ')}.` : ' It has no notes.'}\nFix: copy the id from "npx tourwright notes ${name}".`);
  }
  if (note.status === 'closed') {
    throw new NotesError(`Note "${id}" is closed: the user has approved it.\nFix: leave it as it is. If it needs more work, the user reopens it with a reply in Muse.`);
  }
  note.replies.push({ from: 'agent', text, at: new Date().toISOString() });
  note.status = status;
  writeNotes(config, name, notes);
  console.log(status === 'fixed' ? `Replied to note ${id} and marked it fixed. The user approves it in Muse, or sends it back.` : `Asked on note ${id}. It waits for the user's answer in Muse.`);
  return 0;
}
