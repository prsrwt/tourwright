// The studio server: prepares the walkthrough, serves its state, soundtrack and notes to the studio
// page, and watches script.json so an edit from anywhere (the studio, an editor, an agent) shows
// up at once. script.json stays the single source of truth.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import { prepare, PrepareError } from '../pipeline/prepare.ts';
import { buildSoundtrack } from '../timing/audio.ts';
import { API, NOTE_SCOPES, NOTE_STATUSES, type NewNoteRequest, type Note, type NotesFile, type ReplyRequest, type Review, type ReviewRequest, type SaveScriptRequest, type StudioState } from './protocol.ts';
import { hashScript as hash, readReview, reviewPath, writeReview } from './review.ts';

export function notesPath(config: ResolvedConfig, name: string): string {
  return join(dirname(scriptPath(config, name)), 'notes.json');
}

export class NotesError extends Error {}

/**
 * The notes, or none if there is no file yet. A file that cannot be read is an error, never "no
 * notes": silently finding none is how a note gets missed.
 */
export function readNotes(config: ResolvedConfig, name: string): Note[] {
  const file = notesPath(config, name);
  if (!existsSync(file)) return [];
  // Windows tools often start a file with a byte order mark, which JSON.parse rejects.
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new NotesError(`${file} is not valid JSON: ${(error as Error).message}\nFix: correct it by hand; each note needs "id", "ms", "text" and "status".`);
  }
  const notes = (parsed as Partial<NotesFile>)?.notes;
  if (!Array.isArray(notes)) throw new NotesError(`${file} has no "notes" list.\nFix: it should look like { "notes": [ ... ] }.`);
  return notes.map((note: unknown, i) => upgradeNote(note, `${file}, notes[${i}]`));
}

/** An older note in the current shape: "done" was the old "fixed", and a resolution the agent's reply. */
function upgradeNote(raw: unknown, where: string): Note {
  const { resolution, ...note } = raw as Omit<Partial<Note>, 'status'> & { status?: string; resolution?: string };
  const status = note.status === 'done' ? 'fixed' : note.status;
  if (!NOTE_STATUSES.includes(status as Note['status'])) {
    throw new NotesError(`${where} has the status ${JSON.stringify(note.status)}.\nFix: use one of ${NOTE_STATUSES.map((s) => `"${s}"`).join(', ')}.`);
  }
  const scope = note.scope ?? 'moment';
  if (!NOTE_SCOPES.includes(scope)) {
    throw new NotesError(`${where} has the scope ${JSON.stringify(note.scope)}.\nFix: use one of ${NOTE_SCOPES.map((s) => `"${s}"`).join(', ')}, or leave it out for "moment".`);
  }
  const replies = Array.isArray(note.replies) ? note.replies : [];
  if (resolution && !replies.length) replies.push({ from: 'agent', text: resolution, at: note.created ?? '' });
  return { ...note, scope, status: status as Note['status'], replies } as Note;
}

/** Writes the notes back, in the shape readNotes returns. Muse, if open, shows the change at once. */
export function writeNotes(config: ResolvedConfig, name: string, notes: Note[]): void {
  writeFileSync(notesPath(config, name), JSON.stringify({ notes } satisfies NotesFile, null, 2) + '\n');
}

export interface Studio {
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  close(): void;
  /** Resolves once the first preparation has finished, whether or not it succeeded. */
  ready: Promise<void>;
  /** How many Muse tabs are connected now, by their live event streams. */
  connections(): number;
}

export function createStudio(config: ResolvedConfig, name: string, log: (line: string) => void): Studio {
  const file = scriptPath(config, name);
  const state: StudioState = { name, version: 0, timelineVersion: 0, scriptHash: '', script: undefined, diagnostics: [], preparing: false, notes: [] };
  // A notes file that cannot be read keeps the last good notes on screen, and says why.
  const loadNotes = () => {
    try {
      state.notes = readNotes(config, name);
      delete state.notesError;
    } catch (error) {
      state.notesError = (error as Error).message;
    }
  };
  loadNotes();
  const loadReview = () => {
    try {
      const review = readReview(config, name);
      if (review) state.review = review;
      else delete state.review;
      delete state.reviewError;
    } catch (error) {
      state.reviewError = (error as Error).message;
    }
  };
  loadReview();
  let soundtrack: Buffer | undefined;
  const listeners = new Set<ServerResponse>();

  const changed = () => {
    state.version += 1;
    for (const res of listeners) res.write(`data: ${state.version}\n\n`);
  };

  let running: Promise<void> | undefined;
  let again = false;
  const reprepare = (): Promise<void> => {
    // One preparation at a time; changes that arrive during one trigger one more afterwards.
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        const text = readFileSync(file, 'utf8');
        state.scriptHash = hash(text);
        try {
          state.script = JSON.parse(text);
        } catch {
          // check reports the syntax error below.
        }
        state.preparing = true;
        changed();
        try {
          const prepared = await prepare(config, name, { log });
          state.timeline = prepared.timeline;
          state.timelineVersion += 1;
          state.diagnostics = prepared.warnings;
          delete state.error;
          soundtrack = buildSoundtrack(prepared.timeline);
        } catch (error) {
          state.diagnostics = error instanceof PrepareError ? error.diagnostics : [];
          state.error = (error as Error).message;
        }
        state.preparing = false;
        changed();
      } while (again);
      running = undefined;
    })();
    return running;
  };

  // Editors often write a file in several steps; wait for them to finish.
  let pending: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  watchers.push(
    watch(file, () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        // A save from the studio itself has already been prepared.
        if (hash(readFileSync(file, 'utf8')) !== state.scriptHash) void reprepare();
      }, 150);
    }),
  );
  const notesFile = notesPath(config, name);
  const watchNotes = () => {
    if (!existsSync(notesFile)) return;
    watchers.push(
      watch(notesFile, () => {
        // The agent replies to notes, and marks them fixed, here.
        loadNotes();
        changed();
      }),
    );
  };
  watchNotes();
  const saveNotes = () => {
    const first = !existsSync(notesFile);
    writeFileSync(notesFile, JSON.stringify({ notes: state.notes } satisfies NotesFile, null, 2) + '\n');
    if (first) watchNotes();
    changed();
  };

  // Only the studio writes a review, but one deleted or edited by hand should show at once.
  const reviewFile = reviewPath(config, name);
  let reviewWatched = false;
  const watchReview = () => {
    if (reviewWatched || !existsSync(reviewFile)) return;
    reviewWatched = true;
    watchers.push(
      watch(reviewFile, () => {
        loadReview();
        changed();
      }),
    );
  };
  watchReview();

  const ready = reprepare();

  return {
    ready,
    connections: () => listeners.size,
    close() {
      for (const w of watchers) w.close();
      for (const res of listeners) res.end();
    },
    handle(req, res, next) {
      const url = req.url?.split('?')[0] ?? '';
      if (!url.startsWith(API)) return next();
      const route = `${req.method} ${url.slice(API.length)}`;
      const send = (status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };

      if (route === 'GET /state') return send(200, state);
      if (route === 'GET /soundtrack.wav') {
        if (!soundtrack) return send(404, { error: 'Not prepared yet.' });
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(soundtrack);
      }
      if (route === 'GET /events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${state.version}\n\n`);
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
        return;
      }

      void readBody(req).then(async (body) => {
        if (route === 'PUT /script') {
          const { base, script } = body as SaveScriptRequest;
          const current = hash(readFileSync(file, 'utf8'));
          if (base !== current) {
            return send(409, { error: 'script.json changed since this edit began (in an editor, or by the agent). Muse has reloaded it; make the edit again.' });
          }
          writeFileSync(file, JSON.stringify(script, null, 2) + '\n');
          await reprepare();
          return send(200, { scriptHash: state.scriptHash });
        }
        if (route === 'PUT /review') {
          const { base, status, comment } = body as ReviewRequest;
          if (status !== 'approved' && status !== 'changes-requested') return send(400, { error: `The review status ${JSON.stringify(status)} is not one Muse knows.\nFix: send "approved" or "changes-requested".` });
          const current = hash(readFileSync(file, 'utf8'));
          if (base !== current) {
            return send(409, { error: 'script.json changed since you started watching this version, so this review would be for a version you have not seen.\nFix: Muse has reloaded it; watch it again, then review.' });
          }
          // Asking for changes sends the open notes with it: the agent gets what to change, not only that something should.
          const open = state.notes.filter((n) => n.status === 'open').map((n) => n.id);
          if (status === 'changes-requested' && !open.length && !comment?.trim()) {
            return send(400, { error: 'There is nothing to send yet.\nFix: leave a note where something should change, or say what should change.' });
          }
          const review: Review = {
            status,
            scriptHash: current,
            at: new Date().toISOString(),
            ...(comment?.trim() && { comment: comment.trim() }),
            ...(status === 'changes-requested' && open.length && { notes: open }),
          };
          writeReview(config, name, review);
          watchReview();
          state.review = review;
          delete state.reviewError;
          changed();
          return send(200, review);
        }
        if (route === 'POST /notes') {
          const { scope = 'moment', ...input } = body as NewNoteRequest;
          if (!NOTE_SCOPES.includes(scope)) return send(400, { error: badScope(scope) });
          const note: Note = { ...input, scope, id: randomUUID().slice(0, 8), status: 'open', replies: [], created: new Date().toISOString() };
          state.notes.push(note);
          state.notes.sort((a, b) => a.ms - b.ms);
          saveNotes();
          return send(200, note);
        }
        const noteRoute = /^(PATCH|DELETE|POST) \/notes\/([\w-]+)(\/reply)?$/.exec(route);
        if (noteRoute && (noteRoute[1] === 'POST') === !!noteRoute[3]) {
          const index = state.notes.findIndex((n) => n.id === noteRoute[2]);
          if (index === -1) return send(404, { error: 'No such note.' });
          const note = state.notes[index]!;
          const change = body as Partial<Pick<Note, 'text' | 'status' | 'scope'>> & ReplyRequest;
          if (change.status !== undefined && !NOTE_STATUSES.includes(change.status)) {
            return send(400, { error: `${JSON.stringify(change.status)} is not a note status.\nFix: use one of ${NOTE_STATUSES.join(', ')}.` });
          }
          if (change.scope !== undefined && !NOTE_SCOPES.includes(change.scope)) return send(400, { error: badScope(change.scope) });
          if (noteRoute[1] === 'DELETE') {
            state.notes.splice(index, 1);
          } else if (noteRoute[3]) {
            // A reply from the user hands the note back to the agent, unless it says otherwise.
            if (!change.text?.trim()) return send(400, { error: 'The reply is empty.\nFix: write what you want the agent to know, then send it.' });
            state.notes[index] = { ...note, status: change.status ?? 'open', replies: [...note.replies, { from: 'you', text: change.text.trim(), at: new Date().toISOString() }] };
          } else {
            state.notes[index] = { ...note, ...(change.text !== undefined && { text: change.text }), ...(change.status && { status: change.status }), ...(change.scope && { scope: change.scope }) };
          }
          saveNotes();
          return send(200, {});
        }
        return send(404, { error: `No route ${route}.` });
      }, (error: unknown) => send(400, { error: (error as Error).message }));
    },
  };
}

function badScope(scope: unknown): string {
  return `${JSON.stringify(scope)} is not a note scope.\nFix: use one of ${NOTE_SCOPES.join(', ')}.`;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => {
      try {
        done(data ? JSON.parse(data) : {});
      } catch {
        fail(new Error('The request body is not JSON.'));
      }
    });
    req.on('error', fail);
  });
}
