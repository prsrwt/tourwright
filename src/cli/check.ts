import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { checkScript } from '../check/check.ts';
import { formatDiagnostics, type Diagnostic } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, readScriptJson, scriptPath } from '../config/walkthroughs.ts';

export interface CheckOptions {
  json: boolean;
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
  const diagnostics: Diagnostic[] = read.raw === undefined ? read.diagnostics : checkScript(read.raw).diagnostics;
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.length - errors;

  if (options.json) {
    console.log(JSON.stringify({ file, errors, warnings, diagnostics }, null, 2));
  } else {
    if (diagnostics.length) console.log(`${formatDiagnostics(diagnostics)}\n`);
    console.log(`${shown}: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`);
    console.log('Stage and target names are not checked yet; that needs the stage bundle.');
  }
  return errors ? 1 : 0;
}
