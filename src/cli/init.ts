// Sets up Tourwright in an app: config, a starter stage, an intro walkthrough, and the agent
// skill. It never overwrites a file that already exists.

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILES, type Preset } from '../config/config.ts';
import { findFfmpeg } from '../render/ffmpeg.ts';
import { configFile, introScript, STAGES } from './templates.ts';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_IGNORE = 'tourwright/out/';

interface PackageJson {
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The $schema path from a walkthrough folder to the installed JSON Schema, for editor completion. */
export function schemaPath(root: string, walkthroughDir: string): string {
  return relative(walkthroughDir, join(root, 'node_modules', 'tourwright', 'schema', 'script.schema.json')).replace(/\\/g, '/');
}

export function runInit(root: string): number {
  const pkgFile = join(root, 'package.json');
  if (!existsSync(pkgFile)) {
    console.error(`There is no package.json in ${root}.\nFix: run "npx tourwright init" in your app's folder.`);
    return 1;
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as PackageJson;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const preset: Preset = deps.next !== undefined ? 'next' : 'vite-react';
  if (deps.react === undefined) {
    console.error('This app does not depend on react. Tourwright renders React components, so it needs a React app.');
    return 1;
  }

  const written: string[] = [];
  const kept: string[] = [];
  const write = (path: string, content: string) => {
    const file = join(root, path);
    if (existsSync(file)) {
      kept.push(path);
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(path);
  };

  // .mts unless the app is an ES module package, so Node loads the config without a warning.
  const existingConfig = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (existingConfig) kept.push(existingConfig);
  else write(pkg.type === 'module' ? 'tourwright.config.ts' : 'tourwright.config.mts', configFile(preset));

  write('tourwright/stages.tsx', STAGES);
  const introDir = join(root, 'tourwright', 'walkthroughs', 'intro');
  write('tourwright/walkthroughs/intro/script.json', introScript(schemaPath(root, introDir)));

  const skillTarget = join(root, '.claude', 'skills', 'walkthrough');
  if (existsSync(skillTarget)) {
    kept.push('.claude/skills/walkthrough/');
  } else {
    cpSync(join(packageRoot, 'skill'), skillTarget, { recursive: true });
    written.push('.claude/skills/walkthrough/');
  }

  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  if (!ignored.split(/\r?\n/).some((line) => line.trim() === OUT_IGNORE)) {
    appendFileSync(gitignore, `${ignored === '' || ignored.endsWith('\n') ? '' : '\n'}# Tourwright's rendered videos, stills and voice cache\n${OUT_IGNORE}\n`);
    written.push('.gitignore (added tourwright/out/)');
  }

  console.log(`Set up Tourwright for a ${preset === 'next' ? 'Next.js' : 'Vite React'} app.`);
  for (const path of written) console.log(`  created  ${path}`);
  for (const path of kept) console.log(`  kept     ${path} (already exists)`);

  const steps: string[] = [];
  if (deps.tourwright === undefined) steps.push('npm install -D tourwright');
  steps.push('npx playwright install --only-shell chromium   (once per machine, about 115 MB)');
  if (!findFfmpeg(root)) steps.push('npm install -D ffmpeg-static   (or install ffmpeg on your PATH)');
  steps.push('npx tourwright make intro   (the first run downloads the voice model, about 326 MB)');
  console.log(`\nNext:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
  console.log('\nThen replace the starter stage in tourwright/stages.tsx with your own components.');
  console.log('Add --fake-voice to verify, render or make to work with silent narration and no model download.');
  return 0;
}
