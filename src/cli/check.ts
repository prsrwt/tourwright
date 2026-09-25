import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { checkScript } from '../check/check.ts';
import { formatDiagnostics, type Diagnostic } from '../check/diagnostic.ts';
import { applyEdits, describeFixes, writeScript } from '../check/fix.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, readScriptJson, scriptPath } from '../config/walkthroughs.ts';

export interface CheckOptions {
  json: boolean;
  /** Apply the fixes that have exactly one right answer to script.json, then check again. */
  fix?: boolean;
}

/** Returns the process exit code: 0 when there are no errors. */
export function runCheck(config: ResolvedConfig, name: string, options: CheckOptions): number {
  const file = scriptPath(config, name);
  const shown = relative(process.cwd(), file) || file;
  if (!existsSync(file)) {
    const known = listWalkthroughs(config);
    console.error(`No walkthrough "${name}": ${shown} does not exist.`);
    console.error(known.length ? `Walkthroughs: ${known.join(', ')}.` : 'There are no walkthroughs yet.');
    console.error(`Fix: run "npx tourwright new ${name}" to create it.`);
    return 1;
  }

  const read = readScriptJson(file);
  let diagnostics: Diagnostic[] = read.raw === undefined ? read.diagnostics : checkScript(read.raw).diagnostics;
  let fixed: Diagnostic[] = [];
  if (options.fix && read.raw !== undefined) {
    fixed = applyEdits(read.raw, diagnostics);
    if (fixed.length) {
      writeScript(file, read.raw);
      diagnostics = checkScript(read.raw).diagnostics;
    }
  }
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.length - errors;

  if (options.json) {
    console.log(JSON.stringify({ file, errors, warnings, diagnostics, ...(options.fix && { fixed }) }, null, 2));
  } else {
    if (fixed.length) console.log(`${describeFixes(fixed)}\n`);
    else if (!options.fix && diagnostics.some((d) => d.edit)) console.log('Some of these have exactly one right fix: "--fix" applies them.\n');
    if (diagnostics.length) console.log(`${formatDiagnostics(diagnostics)}\n`);
    console.log(`${shown}: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`);
    console.log('Stage and target names are checked by verify and render, against the real components.');
  }
  return errors ? 1 : 0;
}
