import { relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { formatScreen } from '../runtime/screen.ts';
import { notesPath, readNotes } from '../studio/server.ts';

/** Prints the open studio notes: where each is in the video, what was being said, and the note. */
export function runNotes(config: ResolvedConfig, name: string, options: { json: boolean }): number {
  const open = readNotes(config, name).filter((n) => n.status === 'open');
  if (options.json) {
    console.log(JSON.stringify(open, null, 2));
    return 0;
  }
  const file = relative(process.cwd(), notesPath(config, name)) || notesPath(config, name);
  if (!open.length) {
    console.log(`No open notes for "${name}" (${file}).`);
    return 0;
  }
  console.log(`${open.length} open note${open.length === 1 ? '' : 's'} for "${name}" (${file}):\n`);
  for (const note of open) {
    const seconds = (note.ms / 1000).toFixed(3);
    const where = note.sceneIndex >= 0 ? `scene "${note.scene}" (scenes[${note.sceneIndex}])` : 'the title card';
    console.log(`[${note.id}] at ${seconds} s (frame ${note.frame}), in ${where}`);
    if (note.sentence) console.log(`  while saying: "${note.sentence}"`);
    console.log(`  ${note.text.replace(/\n/g, '\n  ')}`);
    if (note.screen) console.log(`  On screen at ${formatScreen(note.screen, '  ').trimStart()}`);
    console.log('');
  }
  console.log('When a note is handled, set its "status" to "done" and add a short "resolution" in the notes file.');
  return 0;
}
