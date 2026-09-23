import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, readScriptJson, scriptPath } from '../config/walkthroughs.ts';
import { NAME_PATTERN } from '../schema/script.ts';
import { schemaPath } from './init.ts';
import { newScript } from './templates.ts';

export function runNew(config: ResolvedConfig, name: string): number {
  if (!NAME_PATTERN.test(name)) {
    console.error(`"${name}" is not a valid walkthrough name. Use lowercase letters, digits and single hyphens, such as "billing-overview".`);
    return 1;
  }
  const file = scriptPath(config, name);
  if (existsSync(file)) {
    console.error(`${relative(process.cwd(), file)} already exists. Edit it, or choose another name.`);
    return 1;
  }
  const stage = stageFromExisting(config) ?? 'example';
  const title = name.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, newScript(schemaPath(config.root, dirname(file)), title, stage));
  console.log(`Created ${relative(process.cwd(), file) || file}, using stage "${stage}".`);
  console.log(`Write the narration, then run "npx tourwright check ${name}" and "npx tourwright verify ${name}". Verify lists every stage and target if a name is wrong.`);
  return 0;
}

/** A stage some existing walkthrough uses: the likeliest right answer for a new one. */
function stageFromExisting(config: ResolvedConfig): string | undefined {
  for (const name of listWalkthroughs(config)) {
    const raw = readScriptJson(scriptPath(config, name)).raw as { scenes?: { stage?: unknown }[] } | undefined;
    const stage = raw?.scenes?.[0]?.stage;
    if (typeof stage === 'string' && stage) return stage;
  }
  return undefined;
}
