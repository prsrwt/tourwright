import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { formatDiagnostics } from '../check/diagnostic.ts';
import { issuesToDiagnostics } from '../check/zodIssues.ts';

export const CONFIG_FILES = ['tourwright.config.ts', 'tourwright.config.mts', 'tourwright.config.js', 'tourwright.config.mjs'];

export const PRESETS = ['next', 'vite-react'] as const;
export type Preset = (typeof PRESETS)[number];

export const VOICE_BACKENDS = ['kokoro', 'fake'] as const;
export type VoiceBackend = (typeof VOICE_BACKENDS)[number];

const ConfigInput = z.strictObject({
  preset: z.enum(PRESETS).optional().describe('How to bundle the app. Detected from package.json when left out.'),
  stages: z.string().min(1).optional().describe('The file that registers the stages. Default "tourwright/stages.tsx".'),
  walkthroughs: z.string().min(1).optional().describe('Folder holding one folder per walkthrough. Default "tourwright/walkthroughs".'),
  out: z.string().min(1).optional().describe('Folder for rendered videos and reports. Default "out".'),
  voice: z.strictObject({ backend: z.enum(VOICE_BACKENDS).optional() }).optional(),
});

export type UserConfig = z.infer<typeof ConfigInput>;

/** Identity function that gives a config file its types. */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

export interface ResolvedConfig {
  /** The folder holding the config file: the app's root. */
  root: string;
  configFile: string;
  preset: Preset;
  stages: string;
  walkthroughs: string;
  out: string;
  voice: { backend: VoiceBackend };
}

export class ConfigError extends Error {}

/** Finds the nearest config file at or above `from`. */
export function findConfigFile(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_FILES) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function loadConfig(from: string, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedConfig> {
  const configFile = findConfigFile(from);
  if (!configFile) {
    throw new ConfigError(`No tourwright config found in ${resolve(from)} or any folder above it.\nFix: run "npx tourwright init" in your app's folder.`);
  }
  let loaded: unknown;
  try {
    loaded = ((await import(pathToFileURL(configFile).href)) as { default?: unknown }).default;
  } catch (error) {
    throw new ConfigError(`Could not load ${configFile}: ${(error as Error).message}`);
  }
  if (loaded === undefined) {
    throw new ConfigError(`${configFile} has no default export.\nFix: end it with "export default defineConfig({ ... })".`);
  }
  const parsed = ConfigInput.safeParse(loaded);
  if (!parsed.success) {
    throw new ConfigError(`${configFile} is not valid:\n\n${formatDiagnostics(issuesToDiagnostics(ConfigInput, parsed.error.issues))}`);
  }
  return resolveConfig(parsed.data, configFile, env);
}

export function resolveConfig(input: UserConfig, configFile: string, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const root = dirname(configFile);
  const envBackend = env.TOURWRIGHT_VOICE;
  if (envBackend !== undefined && !(VOICE_BACKENDS as readonly string[]).includes(envBackend)) {
    throw new ConfigError(`TOURWRIGHT_VOICE is "${envBackend}". Valid values: ${VOICE_BACKENDS.join(', ')}.`);
  }
  return {
    root,
    configFile,
    preset: input.preset ?? detectPreset(root),
    stages: resolve(root, input.stages ?? 'tourwright/stages.tsx'),
    walkthroughs: resolve(root, input.walkthroughs ?? 'tourwright/walkthroughs'),
    out: resolve(root, input.out ?? 'out'),
    voice: { backend: (envBackend as VoiceBackend | undefined) ?? input.voice?.backend ?? 'kokoro' },
  };
}

function detectPreset(root: string): Preset {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return 'vite-react';
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return pkg.dependencies?.next !== undefined || pkg.devDependencies?.next !== undefined ? 'next' : 'vite-react';
}
