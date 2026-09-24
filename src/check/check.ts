// Static checks on a script: schema, cue markers, beats and writing rules. Checks that need the
// app's stages (stage and target names) run later, against the bundle.

import { Script, sceneId, type Scene } from '../schema/script.ts';
import { resolveSettings } from '../schema/settings.ts';
import { isValidCueName, parseNarration, RESERVED_CUES } from '../narration/parse.ts';
import { closest, formatPath, type Diagnostic } from './diagnostic.ts';
import { issuesToDiagnostics } from './zodIssues.ts';

export const MAX_SENTENCE_WORDS = 25;

export interface CheckResult {
  /** The parsed script, when it matched the schema. */
  script?: Script;
  diagnostics: Diagnostic[];
}

export function checkScript(raw: unknown): CheckResult {
  const diagnostics = findDashes(raw);
  const parsed = Script.safeParse(raw);
  if (!parsed.success) {
    diagnostics.push(...issuesToDiagnostics(Script, parsed.error.issues));
    return { diagnostics };
  }
  const script = parsed.data;
  diagnostics.push(...checkSceneIds(script), ...checkLayout(script), ...script.scenes.flatMap((scene, i) => checkScene(scene, i)));
  return { script, diagnostics };
}

/** The page is laid out at layoutWidth by the video's shape; the height must be a whole number of pixels. */
function checkLayout(script: Script): Diagnostic[] {
  const { width, height, layoutWidth } = resolveSettings(script.settings).video;
  if (layoutWidth === undefined || Number.isInteger((height * layoutWidth) / width)) return [];
  const fits = [960, 1024, 1152, 1280, 1366, 1440, 1536, 1600, 1920].filter((w) => Number.isInteger((height * w) / width));
  return [
    {
      level: 'error',
      path: 'settings.video.layoutWidth',
      message: `A layout ${layoutWidth} wide in a ${width} by ${height} video would be ${((height * layoutWidth) / width).toFixed(2)} pixels high. It must be a whole number.`,
      fix: `use one of ${fits.map(String).join(', ')}.`,
    },
  ];
}

function checkSceneIds(script: Script): Diagnostic[] {
  const seen = new Map<string, number>();
  const out: Diagnostic[] = [];
  script.scenes.forEach((scene, i) => {
    const id = sceneId(scene, i);
    const first = seen.get(id);
    if (first !== undefined) {
      out.push({
        level: 'error',
        path: `scenes[${i}].id`,
        message: `Scene id "${id}" is already used by scenes[${first}].`,
        fix: `give this scene a different id, such as "${id}-2".`,
      });
    } else {
      seen.set(id, i);
    }
  });
  return out;
}

function checkScene(scene: Scene, index: number): Diagnostic[] {
  const out: Diagnostic[] = [];
  const at = `scenes[${index}]`;
  const narration = parseNarration(scene.say);

  if (narration.sentences.length === 0) {
    out.push({ level: 'error', path: `${at}.say`, message: 'The narration is empty. Every scene needs something to say.', fix: 'write at least one sentence.' });
  }

  for (const offset of narration.unclosed) {
    out.push({
      level: 'error',
      path: `${at}.say`,
      message: `"[" at character ${offset} has no closing "]". Square brackets are only for cue markers.`,
      fix: 'close the marker, as in "[claim]", or remove the bracket.',
    });
  }

  const cues = new Set<string>();
  for (const marker of narration.markers) {
    const written = `[${marker.name}]`;
    if (!isValidCueName(marker.name)) {
      const suggestion = marker.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue ${written} has an invalid name. Cue names use lowercase letters, digits and single hyphens.`,
        fix: suggestion ? `write it as "[${suggestion}]".` : 'give it a name such as "[claim]".',
      });
      continue;
    }
    if ((RESERVED_CUES as readonly string[]).includes(marker.name)) {
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue ${written} is reserved. "start" and "end" exist in every scene without being written.`,
        fix: `remove ${written} from the narration and use "at": "${marker.name}" in the beat.`,
      });
      continue;
    }
    if (cues.has(marker.name)) {
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue ${written} appears more than once in this scene.`,
        fix: `rename the second one, such as "[${marker.name}-2]", and give it its own beat.`,
      });
      continue;
    }
    cues.add(marker.name);

    const sentence = narration.sentences[marker.sentence];
    if (!sentence) {
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue ${written} comes after the last sentence, so nothing is spoken at it.`,
        fix: `remove ${written} and use "at": "end" in the beat instead.`,
      });
    } else if (!marker.atSentenceStart) {
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue ${written} is in the middle of a sentence: "${sentence.text}". A cue may only start a sentence, because only sentence starts have exact times.`,
        fix: `move it to the start of the sentence ("${written}${sentence.text}"), or split the sentence where the cue is.`,
      });
    }
  }

  for (const sentence of narration.sentences) {
    const words = sentence.text.split(' ').length;
    if (words > MAX_SENTENCE_WORDS) {
      out.push({
        level: 'warning',
        path: `${at}.say`,
        message: `Sentence has ${words} words (more than ${MAX_SENTENCE_WORDS}): "${sentence.text}"`,
        fix: 'split it into two sentences. Shorter sentences are easier to follow and give more places for cues.',
      });
    }
  }

  const valid = [...RESERVED_CUES, ...cues];
  const used = new Map<string, number>();
  (scene.beats ?? []).forEach((beat, b) => {
    const path = `${at}.beats[${b}]`;
    if (!valid.includes(beat.at)) {
      // Scene cues first, so a typo that ties with a reserved cue suggests the scene's own.
      const guess = closest(beat.at, [...cues, ...RESERVED_CUES]);
      out.push({
        level: 'error',
        path: `${path}.at`,
        message: `"${beat.at}" is not a cue in this scene. Valid: ${valid.map((c) => `"${c}"`).join(', ')}.`,
        fix: guess ? `change it to "${guess}".` : `add "[${beat.at}]" at the start of a sentence in "say", or use one of the valid cues.`,
      });
    }
    const earlier = used.get(beat.at);
    if (earlier !== undefined) {
      out.push({
        level: 'error',
        path: `${path}.at`,
        message: `beats[${earlier}] already uses "${beat.at}". Two beats on one cue would fight over the camera and highlight.`,
        fix: `merge this beat into beats[${earlier}].`,
      });
    } else {
      used.set(beat.at, b);
    }
    if (beat.camera === undefined && beat.highlight === undefined && beat.animate === undefined) {
      out.push({
        level: 'error',
        path,
        message: 'This beat does nothing. A beat needs "camera", "highlight" or "animate".',
        fix: `add "camera": { "to": "<target>" }, "highlight": "<target>" or "animate": "<value>", or remove the beat.`,
      });
    }
  });

  for (const cue of cues) {
    if (!used.has(cue)) {
      out.push({
        level: 'error',
        path: `${at}.say`,
        message: `Cue [${cue}] is not used by any beat.`,
        fix: `add a beat { "at": "${cue}", "camera": { "to": "<target>" } }, or remove the marker.`,
      });
    }
  }

  return out;
}

// U+2013 (en dash) and U+2014 (em dash), built from code points so this file contains neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** Em and en dashes are not allowed anywhere: the voice reads them badly and the house style bans them. */
function findDashes(value: unknown, path: PropertyKey[] = []): Diagnostic[] {
  const out: Diagnostic[] = [];
  const report = (text: string, where: PropertyKey[]) => {
    const index = text.search(DASHES);
    const snippet = text.slice(Math.max(0, index - 30), index + 30);
    out.push({
      level: 'error',
      path: formatPath(where),
      message: `Contains an em or en dash: "...${snippet}...".`,
      fix: 'use a full stop or a comma instead, or a plain hyphen in a range such as "10-20".',
    });
  };
  if (typeof value === 'string') {
    if (DASHES.test(value)) report(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => out.push(...findDashes(item, [...path, i])));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (DASHES.test(key)) report(key, [...path, key]);
      out.push(...findDashes(item, [...path, key]));
    }
  }
  return out;
}
