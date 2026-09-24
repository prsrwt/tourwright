// What the studio page and the studio server exchange. Types only, so both sides share them.

import type { Diagnostic } from '../check/diagnostic.ts';
import type { ScreenDescription } from '../runtime/screen.ts';
import type { Timeline } from '../timing/timeline.ts';

export const API = '/__tourwright/api';

/**
 * A note pinned to a moment of the video, for the agent. The moment is where the playhead was
 * when the note was written, to the millisecond, with the frame, scene and sentence it falls in,
 * so the agent knows exactly what the note is about.
 */
export interface Note {
  id: string;
  /** Milliseconds from the start of the video. */
  ms: number;
  frame: number;
  /** The scene's id and index in script.json, or "title" for the title card. */
  scene: string;
  sceneIndex: number;
  /** The sentence being spoken at that moment, if any. */
  sentence?: string;
  text: string;
  /** What was on screen when the note was written, read from the player's page. */
  screen?: ScreenDescription;
  status: 'open' | 'done';
  /** What the agent did about it, when done. */
  resolution?: string;
  created: string;
}

export interface NotesFile {
  notes: Note[];
}

export interface StudioState {
  name: string;
  /** Changes whenever the script, timeline or notes change. */
  version: number;
  /** A hash of script.json as last read, so a save can tell whether someone else changed it. */
  scriptHash: string;
  /** script.json as written, for editing. */
  script: unknown;
  /** The last timeline that prepared successfully: kept on screen while a broken edit is fixed. */
  timeline?: Timeline;
  /** check's findings, or why the current script could not be prepared. */
  diagnostics: Diagnostic[];
  /** True while narration is being voiced for a change. */
  preparing: boolean;
  /** Set when the current script.json could not be prepared. */
  error?: string;
  notes: Note[];
  /** Why notes.json could not be read, when it could not. */
  notesError?: string;
}

export interface SaveScriptRequest {
  /** The scriptHash the edit started from. */
  base: string;
  script: unknown;
}
