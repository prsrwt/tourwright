// The shared first half of render, verify and make: read and check the script, synthesise
// whatever narration is missing, and build the timeline.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkScript } from '../check/check.ts';
import type { Diagnostic } from '../check/diagnostic.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { listWalkthroughs, readScriptJson, scriptPath } from '../config/walkthroughs.ts';
import type { Script } from '../schema/script.ts';
import { resolveSettings } from '../schema/settings.ts';
import { buildTimeline, type Timeline } from '../timing/timeline.ts';
import { createBackend, type VoiceBackend } from '../voice/backend.ts';
import { voiceScript } from '../voice/synthesize.ts';

export class PrepareError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

export interface Prepared {
  name: string;
  script: Script;
  timeline: Timeline;
  /** Warnings from check; errors stop preparation. */
  warnings: Diagnostic[];
  /** Folder for this walkthrough's reports and stills. */
  outDir: string;
}

export interface PrepareOptions {
  log?: (line: string) => void;
  /** Overrides the configured backend, for tests. */
  backend?: VoiceBackend;
}

export function voiceCacheDir(config: ResolvedConfig): string {
  return join(config.out, '.cache', 'voice');
}

export async function prepare(config: ResolvedConfig, name: string, options: PrepareOptions = {}): Promise<Prepared> {
  const log = options.log ?? (() => undefined);
  const file = scriptPath(config, name);
  if (!existsSync(file)) {
    const known = listWalkthroughs(config);
    throw new PrepareError(
      `No walkthrough "${name}": ${file} does not exist.\n${known.length ? `Walkthroughs: ${known.join(', ')}.` : 'There are no walkthroughs yet.'}\nFix: run "npx tourwright new ${name}" to create it.`,
    );
  }
  const read = readScriptJson(file);
  const checked = read.raw === undefined ? { diagnostics: read.diagnostics } : checkScript(read.raw);
  const errors = checked.diagnostics.filter((d) => d.level === 'error');
  if (errors.length || !('script' in checked) || !checked.script) {
    throw new PrepareError(`${file} has ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}. Fix them, then run again.`, errors);
  }
  const script = checked.script;
  const settings = resolveSettings(script.settings);

  const backend = options.backend ?? (await createBackend(config.voice.backend));
  let announced = false;
  const voiced = await voiceScript(script, settings, backend, voiceCacheDir(config), (p) => {
    if (p.synthesised === 1 && !announced) {
      announced = true;
      log(`Voicing ${name} with the ${backend.id} voice...`);
    }
    if (p.synthesised > 0 && p.done === p.total) {
      log(p.synthesised === p.total ? `Voiced ${p.total} sentences.` : `Voiced ${p.synthesised} of ${p.total} sentences; the rest were cached.`);
    }
  });

  return {
    name,
    script,
    timeline: buildTimeline(script, settings, voiced.scenes),
    warnings: checked.diagnostics.filter((d) => d.level === 'warning'),
    outDir: join(config.out, name),
  };
}
