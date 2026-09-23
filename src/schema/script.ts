import { z } from 'zod';
import { EASE_NAMES, SettingsInput } from './settings.ts';

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const kebabName = z.string().regex(NAME_PATTERN, {
  error: 'Use lowercase letters, digits and single hyphens, for example "claim-total".',
});

export const Camera = z
  .strictObject({
    to: z.string().min(1).describe('A target name registered for the stage, or "all" for the whole stage.'),
    zoom: z
      .union([z.enum(['fit', 'width']), z.number().positive()], {
        error: 'zoom must be "fit", "width" or a number above 0.',
      })
      .optional()
      .describe('"fit" fits the whole target, "width" fits its width, a number is an absolute scale (1 = the whole stage width).'),
    align: z.enum(['center', 'top']).optional(),
    ease: z.enum(EASE_NAMES).optional(),
    duration: z.number().positive().optional().describe('Seconds the move takes.'),
  })
  .describe('Move the camera to a target.');

export const Beat = z
  .strictObject({
    at: z.string().min(1).describe('A cue marker from this scene\'s "say", or "start" or "end".'),
    camera: Camera.optional(),
    highlight: z
      .union([z.string().min(1), z.literal(false)], {
        error: 'highlight must be a target name, or false to clear the highlight.',
      })
      .optional()
      .describe('Outline a target, or false to clear the highlight.'),
    animate: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional()
      .describe("A value the stage declares, or several: a number eases to its end value (a total counts up, a meter fills), and a list of steps moves to its next step (a toggle flips). Starts when this beat's camera move settles."),
  })
  .describe('An action tied to a cue.');

export const Scene = z.strictObject({
  id: kebabName.optional().describe('Short name used in reports and still filenames. Defaults to the scene number.'),
  stage: z.string().min(1).describe('A stage registered in the app\'s stages file.'),
  say: z.string().describe('Narration. A [cue] marker may only start a sentence.'),
  tail: z.number().min(0).optional().describe('Seconds held after the narration ends. Defaults to settings.voice.tail.'),
  beats: z.array(Beat).optional(),
});

export const Script = z.strictObject({
  $schema: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  settings: SettingsInput.optional(),
  lexicon: z
    .record(z.string().min(1), z.string())
    .optional()
    .describe('Written word to how the voice should say it. Whole words, case-sensitive.'),
  scenes: z.array(Scene).min(1, { error: 'A walkthrough needs at least one scene.' }),
});

export type Camera = z.infer<typeof Camera>;
export type Beat = z.infer<typeof Beat>;
export type Scene = z.infer<typeof Scene>;
export type Script = z.infer<typeof Script>;

/** A scene's id, or its 1-based number when it has none. */
export function sceneId(scene: Scene, index: number): string {
  return scene.id ?? String(index + 1);
}
