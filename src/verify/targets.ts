// Checks a script's stage and target names against what the bundle actually rendered. This is the
// half of check that needs the app: render and verify run it before anything else.

import { closest, type Diagnostic } from '../check/diagnostic.ts';
import type { ReadyReport } from '../runtime/player.tsx';
import type { Timeline } from '../timing/timeline.ts';
import { buildValues } from '../runtime/values.ts';

export function targetDiagnostics(timeline: Timeline, ready: ReadyReport): Diagnostic[] {
  const out: Diagnostic[] = [];
  const definitions = Object.fromEntries(Object.entries(ready.stages).map(([name, stage]) => [name, stage.values]));
  const values = buildValues(timeline, definitions);
  for (const problem of values.problems) {
    const scene = timeline.scenes[problem.scene]!;
    if (!ready.stages[scene.stage]?.registered) continue; // The unknown stage is reported below.
    out.push({ level: 'error', path: `scenes[${problem.scene}].beats[${problem.beat}].animate`, message: problem.message, fix: problem.fix });
  }
  for (const [name, stage] of Object.entries(ready.stages)) {
    for (const [target, reason] of Object.entries(stage.invalid)) {
      out.push({ level: 'error', path: '(stages file)', message: `Stage "${name}", target "${target}": ${reason}`, fix: 'fix the selector in the stage\'s "targets".' });
    }
  }

  for (const scene of timeline.scenes) {
    const at = `scenes[${scene.index}]`;
    const stage = ready.stages[scene.stage];
    if (!stage?.registered) {
      const guess = closest(scene.stage, ready.registered);
      out.push({
        level: 'error',
        path: `${at}.stage`,
        message: `"${scene.stage}" is not a stage. Registered: ${ready.registered.map((s) => `"${s}"`).join(', ') || 'none'}.`,
        fix: guess ? `change it to "${guess}".` : 'register it in the stages file, or use one of the registered stages.',
        ...(guess && { edit: { path: ['scenes', scene.index, 'stage'], value: guess } }),
      });
      continue;
    }
    for (const beat of scene.beats) {
      // Each target is looked up in the layout the stage has when the move arrives, the same one
      // the player frames it in.
      const refs: [string, string, number, (string | number)[]][] = [];
      const beatPath = ['scenes', scene.index, 'beats', beat.index];
      if (beat.camera && beat.camera.to !== 'all') refs.push([`${at}.beats[${beat.index}].camera.to`, beat.camera.to, beat.camera.from + beat.camera.frames, [...beatPath, 'camera', 'to']]);
      if (beat.highlight && beat.highlight.to !== false && beat.highlight.to !== 'all') {
        refs.push([`${at}.beats[${beat.index}].highlight`, beat.highlight.to, beat.highlight.from + timeline.highlightFrames.slide, [...beatPath, 'highlight']]);
      }
      for (const [path, target, frame, editPath] of refs) {
        const layout = stage.states[values.state(scene.stage, frame)];
        if (layout?.targets[target]) continue;
        const elsewhere = Object.values(stage.states).some((s) => s.targets[target]);
        if (elsewhere) {
          out.push({
            level: 'error',
            path,
            message: `Target "${target}" is not on the page at this point: it only appears once the stage's values change (a toggle, say).`,
            fix: `animate the value that shows "${target}" in an earlier beat, before the camera or narration box goes to it.`,
          });
          continue;
        }
        if (stage.available.includes(target)) {
          out.push({
            level: 'error',
            path,
            message: `Target "${target}" exists on stage "${scene.stage}" but has no size, so it cannot be framed.`,
            fix: 'make sure it renders visibly with the stage\'s fixtures, or target the element around it.',
          });
          continue;
        }
        const guess = closest(target, stage.available);
        out.push({
          level: 'error',
          path,
          message: `"${target}" is not a target on stage "${scene.stage}". Valid: ${['all', ...stage.available].map((t) => `"${t}"`).join(', ')}.`,
          fix: guess
            ? `change it to "${guess}".`
            : `wrap the element in <div data-focus="${target}"> in the stage, or add "${target}": "<css selector>" to the stage's "targets".`,
          ...(guess && { edit: { path: editPath, value: guess } }),
        });
      }
    }
  }
  return out;
}
