import { relative } from 'node:path';
import { formatDiagnostics } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare, type Prepared } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import { verifyWalkthrough, type VerifyReport } from '../verify/verify.ts';

export async function verifyPrepared(config: ResolvedConfig, prepared: Prepared, log: (line: string) => void): Promise<VerifyReport> {
  const session = await openSession(config, prepared, log);
  try {
    log(`Verifying ${prepared.name}...`);
    return await verifyWalkthrough(prepared.name, prepared.timeline, session.player, prepared.outDir, [...prepared.warnings, ...session.diagnostics]);
  } finally {
    await session.close();
  }
}

export function printVerifyReport(report: VerifyReport): void {
  const shown = (path: string) => relative(process.cwd(), path) || path;
  if (report.diagnostics.length) console.log(`${formatDiagnostics(report.diagnostics)}\n`);
  console.log(`${report.name}: ${report.seconds.toFixed(1)} s, ${report.stills.length} stills, ${report.errors} ${report.errors === 1 ? 'error' : 'errors'}, ${report.warnings} ${report.warnings === 1 ? 'warning' : 'warnings'}.`);
  console.log(`  Contact sheet  ${shown(report.files.contactSheet)}  (look at this: every still, labelled)`);
  console.log(`  Timing         ${shown(report.files.timing)}  (each cue and the words heard around it)`);
  console.log(`  Stills         ${shown(report.files.stills)}`);
  console.log(`  Report         ${shown(report.files.report)}`);
}

export async function runVerify(config: ResolvedConfig, name: string, options: { json: boolean }): Promise<number> {
  const log = options.json ? () => undefined : (line: string) => console.log(line);
  const report = await verifyPrepared(config, await prepare(config, name, { log }), log);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printVerifyReport(report);
  return report.ok ? 0 : 1;
}
