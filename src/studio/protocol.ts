// What the studio page and the studio server exchange. Types and plain constants only, so both
// sides share them.

import type { Diagnostic } from '../check/diagnostic.ts';
import type { Rect } from '../runtime/motion.ts';
import type { ScreenDescription } from '../runtime/screen.ts';
import type { Timeline } from '../timing/timeline.ts';

export const API = '/__tourwright/api';

/**
 * Where a note stands, and so whose turn it is:
 * - open: waiting on the agent.
 * - question: the agent has asked something and is waiting on the user's answer.
 * - fixed: the agent says it is done, and the user has to approve it.
 * - closed: the user approved the fix. Only the user closes a note.
 */
export type NoteStatus = 'open' | 'question' | 'fixed' | 'closed';
export const NOTE_STATUSES: readonly NoteStatus[] = ['open', 'question', 'fixed', 'closed'];

/** What a note is about: the moment it is pinned to, its whole scene, or the whole video. */
export type NoteScope = 'moment' | 'scene' | 'all';
export const NOTE_SCOPES: readonly NoteScope[] = ['moment', 'scene', 'all'];

export interface Reply {
  from: 'you' | 'agent';
  text: string;
  /** ISO time the reply was written. */
  at: string;
}

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
  /** What the note covers. Default "moment". */
  scope: NoteScope;
  /** A target the user clicked in the preview, and where it was on screen, in layout pixels. */
  target?: string;
  rect?: Rect;
  /** What was on screen when the note was written, read from the player's page. */
  screen?: ScreenDescription;
  status: NoteStatus;
  /** The conversation about the note since it was written, oldest first. */
  replies: Reply[];
  created: string;
}

export interface NotesFile {
  notes: Note[];
}

export interface StudioState {
  name: string;
  /** Changes whenever the script, timeline or notes change. */
  version: number;
  /**
   * Changes only when a new timeline has been prepared. The player and the soundtrack reload on
   * this, not on `version`, so a note or a review arriving mid-playback does not interrupt it.
   */
  timelineVersion: number;
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
  /** The whole video's review, if there is one. It counts only while its scriptHash is the current one. */
  review?: Review;
  /** Why review.json could not be read, when it could not. */
  reviewError?: string;
}

/** walkthroughs/<name>/review.json: the user's verdict on one exact version of script.json. */
export interface Review {
  status: 'approved' | 'changes-requested';
  scriptHash: string;
  at: string;
  comment?: string;
}

export interface NewNoteRequest {
  ms: number;
  frame: number;
  scene: string;
  sceneIndex: number;
  sentence?: string;
  text: string;
  scope?: NoteScope;
  target?: string;
  rect?: Rect;
  screen?: ScreenDescription;
}

/** A reply from the user, and the status it moves the note to: "open" by default, back to the agent. */
export interface ReplyRequest {
  text: string;
  status?: NoteStatus;
}

export interface ReviewRequest {
  /** The scriptHash the user watched: a review of a version they have not seen is refused. */
  base: string;
  status: Review['status'];
  comment?: string;
}

export interface SaveScriptRequest {
  /** The scriptHash the edit started from. */
  base: string;
  script: unknown;
}
