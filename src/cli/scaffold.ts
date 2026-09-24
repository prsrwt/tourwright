import { basename, join, relative } from 'node:path';
import { scaffoldStage } from '../analyze/scaffold.ts';
import type { ResolvedConfig } from '../config/config.ts';

export interface ScaffoldOptions {
  /** The stage's name; by default from the page file's name. */
  stage?: string;
}

export function runScaffold(config: ResolvedConfig, pageFile: string, options: ScaffoldOptions): number {
  const stage =
    options.stage ??
    basename(pageFile)
      .replace(/\.[jt]sx?$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
  const result = scaffoldStage(config.root, pageFile, stage, join(config.root, 'tourwright', 'scaffold'));
  const shown = relative(process.cwd(), result.file) || result.file;

  console.log(`Drafted stage "${stage}" in ${shown}, from ${result.components.length} components of ${pageFile}:`);
  console.log(`  ${result.components.join(', ')}`);
  if (result.skipped.length) console.log(`Skipped (UI primitives and page-local components): ${result.skipped.join(', ')}.`);
  if (result.problems.length) {
    console.log(`\n${result.problems.length} placeholder${result.problems.length === 1 ? '' : 's'} the type check wants filled in with fixture data:`);
    for (const problem of result.problems.slice(0, 15)) console.log(`  ${problem}`);
    if (result.problems.length > 15) console.log(`  ...and ${result.problems.length - 15} more.`);
  }
  console.log(
    `\nNext: replace the placeholders with fictional data, delete sections the video does not need, then add the stage to ${relative(process.cwd(), config.stages) || config.stages}:\n` +
      `  import { ${camel(stage)} } from './scaffold/${stage}';\n` +
      `  export default defineStages({ ..., '${stage}': ${camel(stage)} });\n` +
      `Then "npx tourwright inspect ${stage}" lists its targets and what could move.`,
  );
  return 0;
}

function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
