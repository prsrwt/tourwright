import { formatInspection, inspectStage, type StageTargets } from '../analyze/inspect.ts';
import { startStageServer } from '../bundle/server.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { openPlayer } from '../render/page.ts';
import type { StageReport } from '../runtime/player.tsx';
import { isSteps } from '../runtime/stage.ts';
import { parseNarration } from '../narration/parse.ts';
import type { Script } from '../schema/script.ts';
import { resolveSettings } from '../schema/settings.ts';
import { buildTimeline } from '../timing/timeline.ts';
import { SAMPLE_RATE } from '../voice/backend.ts';

export interface InspectOptions {
  json: boolean;
}

/** Lists a stage's components, their props, what could move, and (from the browser) its targets. */
export async function runInspect(config: ResolvedConfig, stage: string, options: InspectOptions): Promise<number> {
  const inspection = inspectStage(config.root, config.stages, stage);
  const targets = await stageTargets(config, stage);
  if (options.json) console.log(JSON.stringify({ ...inspection, targets }, null, 2));
  else console.log(formatInspection(inspection, targets));
  return 0;
}

/** A throwaway timeline for rendering a stage: one sentence per step, no voice involved. */
function timelineFor(stage: string, beats: Script['scenes'][number]['beats'], sentences: number) {
  const say = Array.from({ length: sentences }, (_, i) => `[s${i}]Step ${i}.`).join(' ');
  const script: Script = { title: 'Inspect', scenes: [{ stage, say, ...(beats?.length && { beats }) }] };
  // Unused cues are fine here: this script is never checked, only laid out.
  const audio = parseNarration(say).sentences.map((s) => ({ text: s.text, spoken: s.text, cues: s.cues, file: '', samples: SAMPLE_RATE }));
  return buildTimeline(script, resolveSettings(undefined), [audio]);
}

/**
 * Renders the stage and reads the targets it offers. Targets behind a toggle or a steps value only
 * exist in some states, so every steps value is walked through its steps, and each such target is
 * listed with the state it needs.
 */
export async function stageTargets(config: ResolvedConfig, stage: string): Promise<StageTargets> {
  const server = await startStageServer(config);
  try {
    const player = await openPlayer(server.url, timelineFor(stage, [], 1));
    try {
      const first = player.ready.stages[stage];
      if (!first) return { always: [], sometimes: [] };
      const steps = Object.entries(first.values).filter(([, def]) => isSteps(def));
      if (!steps.length) return { always: first.available, sometimes: [] };

      // One beat per step: each steps value moves on, one at a time, from its first step to its last.
      const beats: NonNullable<Script['scenes'][number]['beats']> = [];
      for (const [name, def] of steps) {
        for (let i = 1; i < (def as { steps: unknown[] }).steps.length; i++) beats.push({ at: `s${beats.length}`, animate: name });
      }
      const report = (await player.page.evaluate((t) => window.__tour.start(t), timelineFor(stage, beats, beats.length + 1))).stages[stage]!;
      return describeStates(report);
    } finally {
      await player.close();
    }
  } finally {
    await server.close();
  }
}

/** Targets in every state are always there; the rest are listed with the states they appear in. */
function describeStates(report: StageReport): StageTargets {
  const states = Object.entries(report.availableIn);
  const always = report.available.filter((t) => states.every(([, list]) => list.includes(t)));
  const sometimes = report.available
    .filter((t) => !always.includes(t))
    .map((target) => ({ target, when: states.filter(([, list]) => list.includes(target)).map(([state]) => stateLabel(report, state)) }));
  return { always, sometimes };
}

/** "details=1&progress=0" as "details = true, progress = null". */
function stateLabel(report: StageReport, state: string): string {
  return state
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const [name, index] = part.split('=') as [string, string];
      const def = report.values[name];
      return `${name} = ${def && isSteps(def) ? JSON.stringify(def.steps[Number(index)]) : index}`;
    })
    .join(', ');
}
