import { relative } from 'node:path';
import { checkScript } from '../check/check.ts';
import { formatDiagnostics, type Diagnostic } from '../check/diagnostic.ts';
import { applyEdits, describeFixes, writeScript } from '../check/fix.ts';
import { readScriptJson, scriptPath } from '../config/walkthroughs.ts';
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
  console.log(`  Screen         ${shown(report.files.screen)}  (what is on screen at each still, as text)`);
  console.log(`  Stills         ${shown(report.files.stills)}`);
  console.log(`  Report         ${shown(report.files.report)}`);
}

export async function runVerify(config: ResolvedConfig, name: string, options: { json: boolean; fix?: boolean }): Promise<number> {
  const log = options.json ? () => undefined : (line: string) => console.log(line);
  const fixed: Diagnostic[] = [];
  // Fixes with one right answer: first those check can see, then the stage and target names only
  // the real components can confirm, verifying once more after those.
  const applyFixes = (diagnostics: readonly Diagnostic[]) => {
    const file = scriptPath(config, name);
    const read = readScriptJson(file);
    if (read.raw === undefined) return 0;
    const now = applyEdits(read.raw, diagnostics);
    if (now.length) writeScript(file, read.raw);
    fixed.push(...now);
    return now.length;
  };
  if (options.fix) {
    const read = readScriptJson(scriptPath(config, name));
    if (read.raw !== undefined) applyFixes(checkScript(read.raw).diagnostics);
  }
  let report = await verifyPrepared(config, await prepare(config, name, { log }), log);
  if (options.fix && applyFixes(report.diagnostics)) report = await verifyPrepared(config, await prepare(config, name, { log }), log);
  if (fixed.length && !options.json) console.log(`${describeFixes(fixed)}\n`);
  else if (!options.fix && !options.json && report.diagnostics.some((d) => d.edit)) console.log('Some problems below have exactly one right fix: "verify --fix" applies them.\n');
  if (options.json) console.log(JSON.stringify(options.fix ? { ...report, fixed } : report, null, 2));
  else printVerifyReport(report);
  return report.ok ? 0 : 1;
}
