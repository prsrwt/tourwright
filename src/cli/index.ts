#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config/config.ts';
import { runCheck } from './check.ts';

const USAGE = `Usage: tourwright <command> [options]

Commands:
  check <name>    Validate a walkthrough's script.json
  init            Set up tourwright in this app          (not yet available)
  new <name>      Create a walkthrough from a template   (not yet available)
  verify <name>   Render a still per beat and check them (not yet available)
  render <name>   Render out/<name>.mp4                  (not yet available)
  make <name>     Check, render and verify               (not yet available)
  doctor          Check ffmpeg, the browser and the voice (not yet available)

Options:
  --json          Machine-readable output (check)
  -h, --help      Show this help`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
  });
  const [command, name] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'check': {
      if (!name) {
        console.error('Usage: tourwright check <name>');
        return 1;
      }
      return runCheck(await loadConfig(process.cwd()), name, { json: values.json });
    }
    case 'init':
    case 'new':
    case 'verify':
    case 'render':
    case 'make':
    case 'doctor':
      console.error(`"${command}" is not available yet in this development build.`);
      return 1;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof ConfigError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error((error as Error).message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  },
);
