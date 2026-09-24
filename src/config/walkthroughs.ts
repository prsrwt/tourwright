import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '../check/diagnostic.ts';
import type { ResolvedConfig } from './config.ts';

export function scriptPath(config: ResolvedConfig, name: string): string {
  return join(config.walkthroughs, name, 'script.json');
}

/** Names of the folders under the walkthroughs folder that hold a script.json. */
export function listWalkthroughs(config: ResolvedConfig): string[] {
  if (!existsSync(config.walkthroughs)) return [];
  return readdirSync(config.walkthroughs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(config.walkthroughs, entry.name, 'script.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Reads a script.json as plain JSON. A syntax error comes back as a diagnostic with its line and column. */
export function readScriptJson(file: string): { raw?: unknown; diagnostics: Diagnostic[] } {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return { raw: JSON.parse(text), diagnostics: [] };
  } catch (error) {
    const message = (error as Error).message;
    const position = /position (\d+)/.exec(message);
    let where = '';
    if (position) {
      const before = text.slice(0, Number(position[1]));
      const line = before.split('\n').length;
      const column = before.length - before.lastIndexOf('\n');
      where = ` at line ${line}, column ${column}`;
    }
    return {
      diagnostics: [
        {
          level: 'error',
          path: '',
          message: `script.json is not valid JSON${where}: ${message}`,
          fix: 'look for a missing comma or quote, or a trailing comma, just before that point.',
        },
      ],
    };
  }
}
