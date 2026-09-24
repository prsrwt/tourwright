// Stage values as pure functions of the frame, shared by the player (in the browser) and verify
// (in Node). A number eases from its start to its end value when a beat animates it; a steps
// value moves to its next step at each beat that animates it.

import type { Timeline } from '../timing/timeline.ts';
import { EASES } from './motion.ts';
import { isSteps, type NumberValue, type StepsValue, type ValueDefinitions } from './stage.ts';

export interface StageValues {
  /** Every value of a stage at a frame, as its render function receives them. */
  at(stage: string, frame: number): Record<string, unknown>;
  /**
   * The same, but with every number at its end value: what the layout is measured with, since
   * a number counting up barely moves the layout while a step (a toggle) can change it entirely.
   */
  forLayout(stage: string, frame: number): Record<string, unknown>;
  /** Which step each steps value is on: equal keys mean the same layout. */
  state(stage: string, frame: number): string;
  /** The numbers part way through counting to their end value at a frame. */
  counting(stage: string, frame: number): string[];
}

interface NumberTrack {
  from: number;
  frames: number;
  ease: (t: number) => number;
}

export interface ValueProblem {
  scene: number;
  beat: number;
  message: string;
  fix: string;
}

export function buildValues(timeline: Timeline, definitions: Record<string, ValueDefinitions | undefined>): StageValues & { problems: ValueProblem[] } {
  const numbers = new Map<string, NumberTrack>();
  const steps = new Map<string, number[]>();
  const problems: ValueProblem[] = [];
  const key = (stage: string, name: string) => `${stage}\u0000${name}`;

  for (const scene of timeline.scenes) {
    const defs = definitions[scene.stage] ?? {};
    for (const beat of scene.beats) {
      if (!beat.animate) continue;
      for (const name of beat.animate.values) {
        const def = defs[name];
        const where = { scene: scene.index, beat: beat.index };
        if (!def) {
          const known = Object.keys(defs);
          problems.push({
            ...where,
            message: `"${name}" is not a value of stage "${scene.stage}". ${known.length ? `Values: ${known.map((v) => `"${v}"`).join(', ')}.` : 'The stage declares no values.'}`,
            fix: known.length ? 'use one of those, or declare it in the stage\'s "values".' : `declare it in the stage's "values", such as ${name}: { from: 0, to: 100 }.`,
          });
          continue;
        }
        if (isSteps(def)) {
          const list = steps.get(key(scene.stage, name)) ?? [];
          if (list.length >= def.steps.length - 1) {
            problems.push({
              ...where,
              message: `"${name}" has ${def.steps.length} steps, so it can move on ${def.steps.length - 1} times, and this is move ${list.length + 1}.`,
              fix: 'remove this animate, or add the step it should move to in the stage\'s "values".',
            });
            continue;
          }
          list.push(beat.animate.from);
          steps.set(key(scene.stage, name), list);
        } else if (numbers.has(key(scene.stage, name))) {
          problems.push({
            ...where,
            message: `"${name}" is a number and was already animated. A number moves once, from its "from" to its "to".`,
            fix: 'remove this animate, or use a steps value for something that changes more than once.',
          });
        } else {
          numbers.set(key(scene.stage, name), { from: beat.animate.from, frames: beat.animate.frames, ease: EASES[beat.animate.ease] });
        }
      }
    }
  }

  const numberAt = (stage: string, name: string, def: NumberValue, frame: number, settled: boolean): number => {
    const track = numbers.get(key(stage, name));
    // A number no beat animates shows its real value throughout.
    if (!track || settled) return def.to;
    const t = frame < track.from ? 0 : frame >= track.from + track.frames ? 1 : track.ease((frame - track.from) / track.frames);
    const factor = 10 ** (def.decimals ?? 0);
    return Math.round((def.from + (def.to - def.from) * t) * factor) / factor;
  };
  // A step takes effect on the frame after its animation starts, so the start frame still shows
  // the old step, exactly as a number shows its "from" value there.
  const stepIndex = (stage: string, name: string, def: StepsValue, frame: number): number =>
    Math.min(def.steps.length - 1, (steps.get(key(stage, name)) ?? []).filter((at) => at < frame).length);

  const values = (stage: string, frame: number, settled: boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(definitions[stage] ?? {})) {
      out[name] = isSteps(def) ? def.steps[stepIndex(stage, name, def, frame)] : numberAt(stage, name, def, frame, settled);
    }
    return out;
  };

  return {
    problems,
    at: (stage, frame) => values(stage, frame, false),
    forLayout: (stage, frame) => values(stage, frame, true),
    state: (stage, frame) =>
      Object.entries(definitions[stage] ?? {})
        .filter(([, def]) => isSteps(def))
        .map(([name, def]) => `${name}=${stepIndex(stage, name, def as StepsValue, frame)}`)
        .join('&'),
    counting: (stage, frame) =>
      Object.keys(definitions[stage] ?? {}).filter((name) => {
        const track = numbers.get(key(stage, name));
        return track !== undefined && frame >= track.from && frame < track.from + track.frames;
      }),
  };
}
