// Reads the app's own TypeScript, with its own compiler and tsconfig, so props are typed exactly
// as the app sees them, path aliases included. TypeScript 7 (the native compiler) has no
// JavaScript API yet, so an app on it needs TypeScript 5 or 6 installed for this.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TS from 'typescript5';

export type TypeScript = typeof TS;

export class AnalyzeError extends Error {}

export function loadTypeScript(root: string): TypeScript {
  let ts: TypeScript;
  try {
    ts = createRequire(join(root, 'package.json'))('typescript') as TypeScript;
  } catch {
    throw new AnalyzeError('This app has no TypeScript installed, which reading component props needs.\nFix: npm install -D typescript');
  }
  if (typeof ts.createProgram !== 'function') {
    throw new AnalyzeError(
      `This app has TypeScript ${ts.version}, which has no compiler API for tools to read types with.\nFix: npm install -D typescript@5 (the app can keep its own compiler for builds).`,
    );
  }
  return ts;
}

export interface AppProgram {
  ts: TypeScript;
  program: TS.Program;
  checker: TS.TypeChecker;
  source(file: string): TS.SourceFile;
}

/** A program over `files`, with the app's compiler options. Imports are followed from there. */
export function appProgram(root: string, files: readonly string[]): AppProgram {
  const ts = loadTypeScript(root);
  const configFile = ts.findConfigFile(root, (f) => existsSync(f), 'tsconfig.json');
  let options: TS.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, allowJs: true, esModuleInterop: true, skipLibCheck: true };
  if (configFile) {
    const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    if (parsed) options = { ...parsed.options, noEmit: true };
  }
  const program = ts.createProgram({ rootNames: [...files], options });
  return {
    ts,
    program,
    checker: program.getTypeChecker(),
    source(file) {
      const found = program.getSourceFile(file);
      if (!found) throw new AnalyzeError(`TypeScript could not read ${file}.`);
      return found;
    },
  };
}
