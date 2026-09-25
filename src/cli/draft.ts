// new --from-stage: a first script drafted from what a stage actually renders, so an agent starts
// from the right scenes, targets, cues and beats and writes only the narration. It renders the
// stage once, with the silent voice, and reads where each target is: one scene per top-level
// target, in page order, and a highlight beat for each target inside it.

import { rmSync, writeFileSync } from 'node:fs';
import type { ResolvedConfig } from '../config/config.ts';
import { prepare } from '../pipeline/prepare.ts';
import { openSession } from '../pipeline/session.ts';
import type { Rect } from '../runtime/motion.ts';
import { NAME_PATTERN } from '../schema/script.ts';
import { createBackend } from '../voice/backend.ts';

export class DraftError extends Error {}

/** Laid out like a typical laptop screen, as "new" does, so the draft frames what verify will see. */
const SETTINGS = { video: { layoutWidth: 1280 } };

interface Part {
  name: string;
  rect: Rect;
  inside: Part[];
}

/** Writes a drafted script to `file`, returning a line describing it. */
export async function draftFromStage(config: ResolvedConfig, name: string, stage: string, file: string, schema: string, title: string): Promise<string> {
  // A one-scene probe on the stage, voiced silently: only where things are matters here.
  writeFileSync(file, JSON.stringify({ title, settings: SETTINGS, scenes: [{ stage, say: 'Probe.' }] }));
  let parts: Part[];
  try {
    const prepared = await prepare(config, name, { backend: await createBackend('fake') });
    const session = await openSession(config, prepared, () => undefined);
    try {
      const report = session.player.ready.stages[stage];
      if (!report?.registered) {
        const names = session.player.ready.registered;
        throw new DraftError(`There is no stage "${stage}".${names.length ? ` Stages: ${names.map((n) => `"${n}"`).join(', ')}.` : ''}\nFix: use one of those names, or add the stage to ${config.stages}.`);
      }
      const t = prepared.timeline;
      await session.player.page.evaluate((f) => window.__tour.setFrame(f, 'settle'), t.scenes[0]!.from);
      const found = await session.player.page.evaluate(() => window.__tour.targetsOnScreen());
      if (!found.length) {
        throw new DraftError(`Stage "${stage}" has no targets to build scenes around.\nFix: wrap each section the video should visit in data-focus="name", or list selectors in the stage's "targets". See "references/stages.md" in the skill.`);
      }
      parts = nest(found);
    } finally {
      await session.close();
    }
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }

  const used = new Set<string>(['overview']);
  const idFor = (target: string) => {
    let id = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
    if (!NAME_PATTERN.test(id)) id = 'part';
    let unique = id;
    for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`;
    used.add(unique);
    return unique;
  };
  const scenes = [
    { id: 'overview', stage, say: '[open]Say what this screen is for, in one sentence.', beats: [{ at: 'open', camera: { to: 'all' } }] },
    ...parts.map((part) => {
      const id = idFor(part.name);
      const say = [`[${id}]Say what ${part.name} shows, and why it matters.`, ...part.inside.map((child) => `[${idFor(child.name)}]Say what ${child.name} tells the viewer.`)];
      const cues = say.map((sentence) => /^\[([^\]]+)\]/.exec(sentence)![1]!);
      return {
        id,
        stage,
        say: say.join(' '),
        beats: [
          { at: cues[0], camera: { to: part.name, zoom: 'fit' }, highlight: part.name },
          ...part.inside.map((child, i) => ({ at: cues[i + 1], highlight: child.name })),
          { at: 'end', highlight: false },
        ],
      };
    }),
  ];
  writeFileSync(file, JSON.stringify({ $schema: schema, title, settings: SETTINGS, scenes }, null, 2) + '\n');
  const inner = parts.reduce((n, p) => n + p.inside.length, 0);
  return `Drafted ${scenes.length} scenes from stage "${stage}": an overview, then ${parts.map((p) => p.name).join(', ')} in page order${inner ? `, with ${inner} highlight${inner === 1 ? '' : 's'} on the parts inside them` : ''}.`;
}

/**
 * Top-level targets in reading order (top to bottom, then left to right), each with the targets it
 * contains, however deeply: a target inside several belongs to the outermost, which is its scene.
 */
function nest(targets: { name: string; rect: Rect }[]): Part[] {
  const area = (r: Rect) => r.w * r.h;
  const contains = (a: Rect, b: Rect) => a !== b && b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1 && area(a) > area(b);
  const byOrder = (a: { rect: Rect }, b: { rect: Rect }) => a.rect.y - b.rect.y || a.rect.x - b.rect.x;
  const parts: Part[] = targets.map((t) => ({ name: t.name, rect: t.rect, inside: [] }));
  const top: Part[] = [];
  for (const part of parts) {
    const parents = parts.filter((p) => contains(p.rect, part.rect)).sort((a, b) => area(a.rect) - area(b.rect));
    const scene = parents.at(-1);
    if (scene) scene.inside.push(part);
    else top.push(part);
  }
  for (const part of top) part.inside.sort(byOrder);
  return top.sort(byOrder);
}
