// --fix: applies the diagnostics that carry an exact edit (a typo with one close match, a dash)
// to script.json, so an agent spends no turn on a fix that has only one right answer. Anything
// that needs judgement is left, and still reported.

import { writeFileSync } from 'node:fs';
import type { Diagnostic } from './diagnostic.ts';

/** Applies each edit it can to `raw` in place; returns the diagnostics it fixed. */
export function applyEdits(raw: unknown, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const fixed: Diagnostic[] = [];
  for (const d of diagnostics) {
    if (!d.edit || !d.edit.path.length) continue;
    let node = raw as Record<string | number, unknown> | undefined;
    const path = d.edit.path;
    for (const key of path.slice(0, -1)) node = node?.[key] as Record<string | number, unknown> | undefined;
    if (node === undefined || node === null || typeof node !== 'object') continue;
    node[path.at(-1)!] = d.edit.value;
    fixed.push(d);
  }
  return fixed;
}

/** Writes script.json back as Muse does: two-space JSON and a final newline. */
export function writeScript(file: string, raw: unknown): void {
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
}

export function describeFixes(fixed: readonly Diagnostic[]): string {
  return `Fixed ${fixed.length} ${fixed.length === 1 ? 'problem' : 'problems'} in script.json:\n${fixed.map((d) => `  ${d.path}: ${d.fix?.replace(/\.$/, '') ?? 'fixed'}`).join('\n')}`;
}
