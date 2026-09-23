// Checks a script's stage and target names against what the bundle actually rendered. This is the
// half of check that needs the app: render and verify run it before anything else.

import { closest, type Diagnostic } from '../check/diagnostic.ts';
import type { ReadyReport } from '../runtime/player.tsx';
import type { Timeline } from '../timing/timeline.ts';

export function targetDiagnostics(timeline: Timeline, ready: ReadyReport): Diagnostic[] {
  const out: Diagnostic[] = [];
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
      });
      continue;
    }
    for (const beat of scene.beats) {
      const refs: [string, string][] = [];
      if (beat.camera && beat.camera.to !== 'all') refs.push([`${at}.beats[${beat.index}].camera.to`, beat.camera.to]);
      if (beat.highlight && beat.highlight.to !== false && beat.highlight.to !== 'all') refs.push([`${at}.beats[${beat.index}].highlight`, beat.highlight.to]);
      for (const [path, target] of refs) {
        if (stage.targets[target]) continue;
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
        });
      }
    }
  }
  return out;
}
