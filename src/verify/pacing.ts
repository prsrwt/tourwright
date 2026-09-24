// Pacing checks on the timeline: the mechanical mistakes that make a demo feel rushed or
// muddled, whatever it is about. They are warnings, because each has legitimate exceptions;
// deciding what deserves attention is the author's job, not the tool's.

import type { Diagnostic } from '../check/diagnostic.ts';
import type { TimedBeat, TimedScene, Timeline } from '../timing/timeline.ts';

/** After the camera settles, the viewer needs this long to take in the new view. */
export const MIN_SETTLED_SECONDS = 1;
/** Longer scenes should usually be split: one idea per scene. */
export const MAX_SCENE_SECONDS = 25;
/** Shorter scenes flash past before the viewer has read the screen. */
export const MIN_SCENE_SECONDS = 3;
/** A highlight left on while the narration moves on this many sentences has outstayed its welcome. */
export const MAX_HIGHLIGHT_SENTENCES = 2;
/** The opening wide shot should last at least this long before the first zoom. */
export const MIN_OPENING_SECONDS = 2;

/** Consecutive scenes on the same stage: the camera and highlight carry over within a run. */
function stageRuns(timeline: Timeline): TimedScene[][] {
  const runs: TimedScene[][] = [];
  for (const scene of timeline.scenes) {
    const run = runs[runs.length - 1];
    if (run && run[0]!.stage === scene.stage) run.push(scene);
    else runs.push([scene]);
  }
  return runs;
}

export function pacingDiagnostics(timeline: Timeline): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seconds = (frames: number) => frames / timeline.fps;
  const beatPath = (scene: TimedScene, beat: TimedBeat, field: string) => `scenes[${scene.index}].beats[${beat.index}].${field}`;

  // Camera moves in order, carrying over between scenes on the same stage.
  let previous: { scene: TimedScene; beat: TimedBeat } | undefined;
  for (const scene of timeline.scenes) {
    if (previous && previous.scene.stage !== scene.stage) previous = undefined;
    const moves = scene.beats.filter((b) => b.camera).sort((a, b) => a.camera!.from - b.camera!.from);
    for (const beat of moves) {
      if (previous) {
        const settled = previous.beat.camera!.from + previous.beat.camera!.frames;
        const held = seconds(beat.camera!.from - settled);
        if (held < MIN_SETTLED_SECONDS) {
          out.push({
            level: 'warning',
            path: beatPath(scene, beat, 'camera'),
            message: `The camera moves to "${beat.camera!.to}" ${held < 0 ? 'before the previous move has finished' : `only ${held.toFixed(1)} s after settling on "${previous.beat.camera!.to}"`}. Viewers need about ${MIN_SETTLED_SECONDS} s to take in each view.`,
            fix: `say a little more about "${previous.beat.camera!.to}" before moving on, or drop one of the two moves.`,
          });
        }
      }
      previous = { scene, beat };
    }
  }

  for (const scene of timeline.scenes) {
    const length = seconds(scene.frames);
    if (length > MAX_SCENE_SECONDS) {
      out.push({
        level: 'warning',
        path: `scenes[${scene.index}]`,
        message: `Scene "${scene.id}" lasts ${length.toFixed(1)} s. Scenes over ${MAX_SCENE_SECONDS} s usually cover more than one idea.`,
        fix: 'split it into two scenes, one idea each.',
      });
    } else if (length < MIN_SCENE_SECONDS) {
      out.push({
        level: 'warning',
        path: `scenes[${scene.index}]`,
        message: `Scene "${scene.id}" lasts only ${length.toFixed(1)} s, which flashes past before the viewer has read the screen.`,
        fix: 'merge it into a neighbouring scene, or say a little more about what it shows.',
      });
    }
  }

  // A highlight should last while the narration is about its target. It carries into the next
  // scene when that scene is on the same stage, so count across scenes: the sentences that start
  // after it lands and before it is moved, cleared, or cut away from with a change of stage.
  for (const run of stageRuns(timeline)) {
    const lights = run.flatMap((scene) => scene.beats.filter((b) => b.highlight).map((beat) => ({ scene, beat })));
    lights.sort((a, b) => a.beat.highlight!.from - b.beat.highlight!.from);
    const last = run[run.length - 1]!;
    const runEnd = last.from + last.frames;
    const sentences = run.flatMap((scene) => scene.sentences);
    lights.forEach(({ scene, beat }, i) => {
      if (!beat.highlight!.to) return; // Clearing is never lingering.
      const ends = lights[i + 1]?.beat.highlight!.from ?? runEnd;
      const after = sentences.filter((s) => s.from > beat.cue && s.from < ends);
      if (after.length > MAX_HIGHLIGHT_SENTENCES) {
        const into = after.some((s) => s.from >= scene.from + scene.frames) ? ', into the next scene' : '';
        out.push({
          level: 'warning',
          path: beatPath(scene, beat, 'highlight'),
          message: `The highlight on "${beat.highlight!.to}" stays on through ${after.length} more sentences${into}, up to "${after[after.length - 1]!.text}". A highlight that lingers after the narration moves on points at the wrong thing.`,
          fix: `clear it with { "at": "<cue>", "highlight": false } where the narration moves on, or move it to what is being talked about.`,
        });
      }
    });
  }

  const first = timeline.scenes[0];
  const opening = first?.beats.filter((b) => b.camera).sort((a, b) => a.camera!.from - b.camera!.from)[0];
  if (first && opening && opening.camera!.to !== 'all' && seconds(opening.camera!.from - first.from) < MIN_OPENING_SECONDS) {
    out.push({
      level: 'warning',
      path: beatPath(first, opening, 'camera.to'),
      message: `The video zooms to "${opening.camera!.to}" straight away. Viewers first need to see the whole screen, to know where they are.`,
      fix: 'open on { "camera": { "to": "all" } } for the first sentence, then zoom in on the next.',
    });
  }

  return out;
}
