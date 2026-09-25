// Writes the sample data the "muse" stage shows Muse with: the intro walkthrough's timeline, and a
// note's snippet cut from one of its verify stills, as Muse would save them. Run it again after
// changing the intro: node tourwright/explainer/muse-fixture.mts (from examples/next-app, after
// "npx tourwright verify intro --fake-voice").

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../../../../src/config/config.ts';
import { prepare } from '../../../../src/pipeline/prepare.ts';

const here = import.meta.dirname;
const config = await loadConfig(process.cwd(), { ...process.env, TOURWRIGHT_VOICE: 'fake' });
const { timeline } = await prepare(config, 'intro', { log: () => undefined });
writeFileSync(join(here, 'muse-timeline.json'), JSON.stringify(timeline, null, 2) + '\n');

// The task table's Status column, as a reviewer might draw a box around it.
await sharp(join(config.out, 'intro', 'stills', 'tasks-table.png'))
  .extract({ left: 1180, top: 225, width: 230, height: 250 })
  .toFile(join(here, 'snippet.png'));
console.log('Wrote muse-timeline.json and snippet.png.');
