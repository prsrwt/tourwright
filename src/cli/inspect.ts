import { formatInspection, inspectStage } from '../analyze/inspect.ts';
import { startStageServer } from '../bundle/server.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { openPlayer } from '../render/page.ts';
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

/** Renders the stage once in the player and reads the targets it offers. */
async function stageTargets(config: ResolvedConfig, stage: string): Promise<string[]> {
  // A one-sentence timeline is all the player needs to render the stage; no voice is involved.
  const script = { title: 'Inspect', scenes: [{ stage, say: 'Inspect.' }] };
  const timeline = buildTimeline(script, resolveSettings(undefined), [[{ text: 'Inspect.', spoken: 'Inspect.', cues: [], file: '', samples: SAMPLE_RATE }]]);
  const server = await startStageServer(config);
  try {
    const player = await openPlayer(server.url, timeline);
    try {
      return player.ready.stages[stage]?.available ?? [];
    } finally {
      await player.close();
    }
  } finally {
    await server.close();
  }
}
