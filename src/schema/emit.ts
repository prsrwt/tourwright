// Writes schema/script.schema.json from the zod schema, so editors can validate scripts through "$schema".
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Script } from './script.ts';

export function scriptJsonSchema(): string {
  const schema = z.toJSONSchema(Script, { target: 'draft-2020-12', io: 'input' });
  return JSON.stringify({ ...schema, title: 'Tourwright script' }, null, 2) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../../schema/script.schema.json', import.meta.url));
  mkdirSync(new URL('../../schema/', import.meta.url), { recursive: true });
  writeFileSync(out, scriptJsonSchema());
  console.log(`Wrote ${out}`);
}
