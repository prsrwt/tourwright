// What is on screen at one frame, read from the page's DOM, so an agent that cannot see the video
// knows what a viewer sees at that moment. The player fills it in; verify, describe and the
// studio's notes print it with formatScreen. Types and pure formatting only, so it runs in the
// browser and in Node alike.

/** Longest stretch of highlighted text reported, in characters. */
export const SCREEN_TEXT_LIMIT = 200;

export interface ScreenTarget {
  name: string;
  /** Share of the frame, from 0 to 1, that the visible part of the target fills. */
  share: number;
  /** Share of the target, from 0 to 1, that is inside the frame. */
  visible: number;
  /** The edges of the frame the target runs past, if any. */
  cut: ('top' | 'bottom' | 'left' | 'right')[];
}

export interface ScreenValue {
  name: string;
  /** The value as text: a number formatted to its decimals, a step as JSON. */
  text: string;
  /** True while a number is part way through counting to its end value. */
  counting: boolean;
}

export interface ScreenDescription {
  frame: number;
  /** Seconds from the start of the video. */
  seconds: number;
  /** True while the title card covers the stage. */
  title: boolean;
  /** The scene's id and index in script.json, or -1 for the title card. */
  scene: string;
  sceneIndex: number;
  stage: string;
  /** The sentence being heard at this frame, if any. */
  sentence: string | null;
  /** Targets at least partly in view, largest first. */
  targets: ScreenTarget[];
  /** The target the highlight is on, and the visible text inside it. */
  highlight: { target: string; text: string } | null;
  /** The caption drawn on the frame, or null when none is showing (or captions are not burned in). */
  caption: string | null;
  values: ScreenValue[];
}

/** One description as the block printed by describe, verify's screen.md and notes. */
export function formatScreen(d: ScreenDescription, indent = ''): string {
  const where = d.title ? 'the title card' : `scene "${d.scene}" (scenes[${d.sceneIndex}])`;
  const lines = [
    `${d.seconds.toFixed(3)} s · frame ${d.frame} · ${where}`,
    `  Saying:     ${d.sentence ? `"${d.sentence}"` : '(nothing)'}`,
    `  Camera:     ${d.title ? '(behind the title card) ' : ''}${cameraText(d.targets)}`,
    `  Highlight:  ${d.highlight?.target ?? '(none)'}`,
  ];
  if (d.highlight) lines.push(`  In view:    ${d.highlight.text ? `"${d.highlight.text}"` : '(no text)'}`);
  lines.push(`  Caption:    ${d.caption ? `"${d.caption}"` : '(none)'}`);
  if (d.values.length) lines.push(`  Values:     ${d.values.map((v) => `${v.name} = ${v.text}${v.counting ? ' (counting)' : ''}`).join(', ')}`);
  return lines.map((line) => indent + line).join('\n');
}

function cameraText(targets: ScreenTarget[]): string {
  if (!targets.length) return 'no targets in view';
  return targets
    .map((t) => {
      if (!t.cut.length) return `${t.name} fills ${percent(t.share)} of the frame`;
      return `${t.name} ${percent(t.visible)} visible, cut off at the ${joinEdges(t.cut)}`;
    })
    .join('; ');
}

function percent(share: number): string {
  const p = Math.round(share * 100);
  return p === 0 && share > 0 ? 'under 1%' : `${p}%`;
}

function joinEdges(edges: string[]): string {
  return edges.length > 1 ? `${edges.slice(0, -1).join(', ')} and ${edges.at(-1)}` : edges[0]!;
}

/** Collapses whitespace and trims text to about SCREEN_TEXT_LIMIT characters, at a word break. */
export function clipText(text: string, limit = SCREEN_TEXT_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
