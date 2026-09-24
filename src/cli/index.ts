#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatDiagnostics } from '../check/diagnostic.ts';
import { ConfigError, loadConfig } from '../config/config.ts';
import { StagesMissingError } from '../bundle/server.ts';
import { PrepareError } from '../pipeline/prepare.ts';
import { BrowserMissingError } from '../render/page.ts';
import { RenderError } from '../render/render.ts';
import { AnalyzeError } from '../analyze/program.ts';
import { NotesError } from '../studio/server.ts';
import { ReviewError } from '../studio/review.ts';
import { DescribeError } from './describe.ts';
import { runCheck } from './check.ts';

const USAGE = `Usage: tourwright <command> [options]

Commands:
  check <name>    Validate a walkthrough's script.json
  init            Set up Tourwright in this app
  new <name>      Create a walkthrough from a template
  verify <name>   Render a still per beat and check them against the page
  describe <name> Say what is on screen at every beat, or at one moment (--at <seconds>)
  render <name>   Render the MP4
  make <name>     Check and verify, then render if every still passes, and open Muse to review it
                  (--no-review, or "review": false in the config, to leave Muse closed)
  doctor          Check ffmpeg, the browser and the voice
  inspect <stage> List a stage's targets, its components' props, and what could move
  scaffold <page> Draft a stage from a page component's sections (--stage <name>)
  muse <name>     Open Muse: watch, edit, leave notes on and approve a walkthrough in the browser
                  (--no-open; "studio" still works)
  notes <name>    List the notes left in Muse by status, questions first, and the review

Options:
  --json          Machine-readable output (check, verify, describe, inspect, notes)
  --at <seconds>  The moment to describe, in seconds from the start (describe)
  --fake-voice    Silent narration with realistic timing: no voice model (verify, describe, render, make)
  --voice         Download the voice model if needed and test it (doctor)
  -h, --help      Show this help

The environment variable TOURWRIGHT_VOICE=fake does the same as --fake-voice, for CI.`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    // So "--no-open" turns off a flag that defaults to on.
    allowNegative: true,
    options: {
      json: { type: 'boolean', default: false },
      voice: { type: 'boolean', default: false },
      'fake-voice': { type: 'boolean', default: false },
      stage: { type: 'string' },
      at: { type: 'string' },
      open: { type: 'boolean', default: true },
      review: { type: 'boolean', default: true },
      // Set by make when it starts Muse in the background; not for typing.
      background: { type: 'boolean', default: false },
      idle: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, name] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  // --fake-voice works the same in every shell; the variable form differs between bash and PowerShell.
  const env = values['fake-voice'] ? { ...process.env, TOURWRIGHT_VOICE: 'fake' } : process.env;
  const config = () => loadConfig(process.cwd(), env);
  const needName = (): string | undefined => {
    if (!name) console.error(`Usage: tourwright ${command} <name>`);
    return name;
  };

  switch (command) {
    case 'check': {
      const n = needName();
      return n ? runCheck(await config(), n, { json: values.json }) : 1;
    }
    case 'render': {
      const n = needName();
      if (!n) return 1;
      const { runRender } = await import('./render.ts');
      return runRender(await config(), n);
    }
    case 'verify': {
      const n = needName();
      if (!n) return 1;
      const { runVerify } = await import('./verify.ts');
      return runVerify(await config(), n, { json: values.json });
    }
    case 'describe': {
      const n = needName();
      if (!n) return 1;
      const { runDescribe } = await import('./describe.ts');
      return runDescribe(await config(), n, { json: values.json, ...(values.at !== undefined && { at: values.at }) });
    }
    case 'doctor': {
      const { runDoctor } = await import('./doctor.ts');
      try {
        return await runDoctor(await config(), undefined, { voice: values.voice });
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        return runDoctor(undefined, error.message, { voice: values.voice });
      }
    }
    case 'inspect': {
      const n = needName();
      if (!n) return 1;
      const { runInspect } = await import('./inspect.ts');
      return runInspect(await config(), n, { json: values.json });
    }
    case 'muse':
    case 'studio': {
      const n = needName();
      if (!n) return 1;
      const { runStudio } = await import('./studio.ts');
      return runStudio(await config(), n, { open: values.open, background: values.background, ...(values.idle !== undefined && { idleSeconds: Number(values.idle) }) });
    }
    case 'notes': {
      const n = needName();
      if (!n) return 1;
      const { runNotes } = await import('./notes.ts');
      return runNotes(await config(), n, { json: values.json });
    }
    case 'scaffold': {
      if (!name) {
        console.error('Usage: tourwright scaffold <page-file> [--stage <name>]');
        return 1;
      }
      const { runScaffold } = await import('./scaffold.ts');
      return runScaffold(await config(), name, values.stage === undefined ? {} : { stage: values.stage });
    }
    case 'init': {
      const { runInit } = await import('./init.ts');
      return runInit(process.cwd());
    }
    case 'new': {
      const n = needName();
      if (!n) return 1;
      const { runNew } = await import('./new.ts');
      return runNew(await config(), n);
    }
    case 'make': {
      const n = needName();
      if (!n) return 1;
      const { runMake } = await import('./make.ts');
      return runMake(await config(), n, { review: values.review });
    }
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

/** Errors whose message already says what is wrong and how to fix it, so no stack trace. */
const EXPECTED = [ConfigError, PrepareError, StagesMissingError, BrowserMissingError, RenderError, AnalyzeError, NotesError, ReviewError, DescribeError];

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof PrepareError && error.diagnostics.length) {
      console.error(`${formatDiagnostics(error.diagnostics)}\n\n${error.message}`);
    } else if (EXPECTED.some((type) => error instanceof type) || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error((error as Error).message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  },
);
