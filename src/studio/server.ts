// The studio server: prepares the walkthrough, serves its state, soundtrack and notes to the studio
// page, and watches script.json so an edit from anywhere (the studio, an editor, an agent) shows
// up at once. script.json stays the single source of truth.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { scriptPath } from '../config/walkthroughs.ts';
import { prepare, PrepareError } from '../pipeline/prepare.ts';
import { buildSoundtrack } from '../timing/audio.ts';
import { API, type Note, type NotesFile, type SaveScriptRequest, type StudioState } from './protocol.ts';

export function notesPath(config: ResolvedConfig, name: string): string {
  return join(dirname(scriptPath(config, name)), 'notes.json');
}

export function readNotes(config: ResolvedConfig, name: string): Note[] {
  const file = notesPath(config, name);
  if (!existsSync(file)) return [];
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as NotesFile).notes ?? [];
  } catch {
    return [];
  }
}

export interface Studio {
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  close(): void;
  /** Resolves once the first preparation has finished, whether or not it succeeded. */
  ready: Promise<void>;
}

export function createStudio(config: ResolvedConfig, name: string, log: (line: string) => void): Studio {
  const file = scriptPath(config, name);
  const state: StudioState = { name, version: 0, scriptHash: '', script: undefined, diagnostics: [], preparing: false, notes: readNotes(config, name) };
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
        // The agent marks notes done here.
        state.notes = readNotes(config, name);
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

  const ready = reprepare();

  return {
    ready,
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
            return send(409, { error: 'script.json changed since this edit began (in an editor, or by the agent). The studio has reloaded it; make the edit again.' });
          }
          writeFileSync(file, JSON.stringify(script, null, 2) + '\n');
          await reprepare();
          return send(200, { scriptHash: state.scriptHash });
        }
        if (route === 'POST /notes') {
          const input = body as Omit<Note, 'id' | 'status' | 'created'>;
          const note: Note = { ...input, id: randomUUID().slice(0, 8), status: 'open', created: new Date().toISOString() };
          state.notes.push(note);
          state.notes.sort((a, b) => a.ms - b.ms);
          saveNotes();
          return send(200, note);
        }
        const noteRoute = /^(PATCH|DELETE) \/notes\/([\w-]+)$/.exec(route);
        if (noteRoute) {
          const index = state.notes.findIndex((n) => n.id === noteRoute[2]);
          if (index === -1) return send(404, { error: 'No such note.' });
          if (noteRoute[1] === 'DELETE') state.notes.splice(index, 1);
          else state.notes[index] = { ...state.notes[index]!, ...(body as Partial<Pick<Note, 'text' | 'status'>>) };
          saveNotes();
          return send(200, {});
        }
        return send(404, { error: `No route ${route}.` });
      }, (error: unknown) => send(400, { error: (error as Error).message }));
    },
  };
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
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
