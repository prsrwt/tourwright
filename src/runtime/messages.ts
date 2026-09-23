// Wording shared by the player (in the browser) and verify (in Node).

/** How a stage that throws is reported, so verify can tell which stage failed. */
export function stageThrew(stage: string, message: string): string {
  return `Stage "${stage}" threw while rendering: ${message}`;
}

export function isStageThrow(message: string, stage: string): boolean {
  return message.startsWith(`Stage "${stage}" threw while rendering:`);
}
