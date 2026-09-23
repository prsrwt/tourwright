// Starts the stage server and opens the player on a prepared timeline, then checks every stage
// and target name against what actually rendered.

import type { Diagnostic } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { startStageServer, type StageServer } from '../bundle/server.ts';
import { openPlayer, type PlayerPage } from '../render/page.ts';
import { targetDiagnostics } from '../verify/targets.ts';
import type { Prepared } from './prepare.ts';

export interface Session {
  player: PlayerPage;
  /** Stage and target problems. Errors mean nothing should be rendered. */
  diagnostics: Diagnostic[];
  close(): Promise<void>;
}

export async function openSession(config: ResolvedConfig, prepared: Prepared, log: (line: string) => void): Promise<Session> {
  log(`Bundling ${config.stages}...`);
  const server: StageServer = await startStageServer(config);
  let player: PlayerPage;
  try {
    player = await openPlayer(server.url, prepared.timeline);
  } catch (error) {
    await server.close();
    throw error;
  }
  const diagnostics = targetDiagnostics(prepared.timeline, player.ready);
  return {
    player,
    diagnostics,
    async close() {
      await player.close();
      await server.close();
    },
  };
}
