// WebVTT subtitles from the timeline's captions: the same sentences and frames the video shows.

import type { Timeline } from '../timing/timeline.ts';

export function captionsVtt(timeline: Timeline): string {
  const cues = timeline.captions.map((c, i) => `${i + 1}\n${timestamp(c.from / timeline.fps)} --> ${timestamp(c.to / timeline.fps)}\n${escapeVtt(c.text)}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** "-->" would end a cue's timing line early, and "<" and "&" start markup in WebVTT. */
function escapeVtt(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '-- >');
}
