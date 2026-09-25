import { z } from 'zod';

export const EASE_NAMES = ['linear', 'inOutSine', 'inOutCubic', 'outCubic', 'outExpo'] as const;
export type EaseName = (typeof EASE_NAMES)[number];

// Each rate divides the voice's 24 kHz sample rate exactly, so a frame is a whole number of
// audio samples and the soundtrack can be placed by frame without drift.
export const FRAME_RATES = [24, 25, 30, 50, 60] as const;

/**
 * burned: drawn into the video, so they show everywhere, including where players ignore
 * subtitle tracks. soft: a subtitle track inside the MP4, which players show and let viewers
 * turn off. Both write a .vtt file next to the MP4. off: none of these.
 */
export const CAPTION_MODES = ['burned', 'soft', 'off'] as const;

export interface Settings {
  /**
   * width and height are the video's pixels. layoutWidth is how wide the page is laid out, in CSS
   * pixels, as on the screen the app is used on; the height follows the video's shape. The page
   * is then scaled up to the video's size, like a high-resolution screen, so an app built for
   * 1280 wide looks as it does in use, with sharp text. Left out, it is the video's width.
   */
  video: { width: number; height: number; fps: (typeof FRAME_RATES)[number]; crf: number; layoutWidth?: number };
  voice: { voice: string; speed: number; dtype: 'fp32' | 'fp16' | 'q8' | 'q4'; sentenceGap: number; tail: number };
  camera: { ease: EaseName; duration: number; lead: number; padding: number; maxZoom: number };
  highlight: {
    color: string;
    stroke: number;
    radius: number;
    padding: number;
    dim: number;
    slide: number;
    fade: number;
  };
  captions: { mode: (typeof CAPTION_MODES)[number]; size: number; position: 'bottom' | 'top' };
  animate: { duration: number; ease: EaseName };
  title: { background: string; color: string; seconds: number };
}

export const DEFAULT_SETTINGS: Settings = {
  video: { width: 1920, height: 1080, fps: 30, crf: 23 },
  voice: { voice: 'af_bella', speed: 1, dtype: 'fp32', sentenceGap: 0.3, tail: 0.7 },
  camera: { ease: 'inOutCubic', duration: 0.9, lead: 0.4, padding: 48, maxZoom: 2.5 },
  highlight: { color: '#2563eb', stroke: 3, radius: 12, padding: 10, dim: 0.5, slide: 0.5, fade: 0.3 },
  captions: { mode: 'burned', size: 40, position: 'bottom' },
  animate: { duration: 1.2, ease: 'outCubic' },
  title: { background: '#0f172a', color: '#ffffff', seconds: 2.5 },
};

const seconds = z.number().min(0);
const evenPixels = z
  .number()
  .int()
  .min(64)
  .max(7680)
  .refine((n) => n % 2 === 0, { error: 'Video width and height must be even numbers (H.264 requires it).' });

export const SettingsInput = z
  .strictObject({
    video: z
      .strictObject({
        width: evenPixels.optional(),
        height: evenPixels.optional(),
        fps: z.literal(FRAME_RATES).optional(),
        crf: z.number().int().min(0).max(51).optional(),
        layoutWidth: z
          .number()
          .int()
          .min(320)
          .max(7680)
          .optional()
          .describe('How wide the page is laid out, as on the screen the app is used on, such as 1280. Scaled up to the video width.'),
      })
      .optional(),
    voice: z
      .strictObject({
        voice: z.string().min(1).optional(),
        speed: z.number().min(0.5).max(2).optional(),
        dtype: z.enum(['fp32', 'fp16', 'q8', 'q4']).optional(),
        sentenceGap: seconds.optional(),
        tail: seconds.optional(),
      })
      .optional(),
    camera: z
      .strictObject({
        ease: z.enum(EASE_NAMES).optional(),
        duration: z.number().positive().optional(),
        lead: seconds.optional(),
        padding: z.number().min(0).optional(),
        maxZoom: z.number().min(1).optional(),
      })
      .optional(),
    highlight: z
      .strictObject({
        color: z.string().min(1).optional(),
        stroke: z.number().min(0).optional(),
        radius: z.number().min(0).optional(),
        padding: z.number().min(0).optional(),
        dim: z.number().min(0).max(1).optional(),
        slide: seconds.optional(),
        fade: seconds.optional(),
      })
      .optional(),
    captions: z
      .strictObject({
        mode: z.enum(CAPTION_MODES).optional(),
        size: z.number().min(12).max(120).optional().describe('Text size in pixels at 1080p, scaled for other heights.'),
        position: z.enum(['bottom', 'top']).optional(),
      })
      .optional()
      .describe('Captions of the narration, one sentence at a time.'),
    animate: z
      .strictObject({
        duration: z.number().positive().optional().describe('Seconds a number takes to reach its end value.'),
        ease: z.enum(EASE_NAMES).optional(),
      })
      .optional(),
    title: z
      .strictObject({
        background: z.string().min(1).optional().describe("The title card's background: any CSS colour, such as the app's brand colour."),
        color: z.string().min(1).optional().describe('The colour of the title and subtitle text.'),
        seconds: seconds.optional().describe('How long the title card shows. 0 leaves it out and opens on the first scene.'),
      })
      .optional()
      .describe('The title card that opens the video.'),
  })
  .describe('Overrides for this walkthrough. Anything left out uses the default.');

export type SettingsInput = z.infer<typeof SettingsInput>;

/** Merges a script's overrides over the defaults, one group at a time. */
export function resolveSettings(input: SettingsInput | undefined): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    video: { ...d.video, ...input?.video },
    voice: { ...d.voice, ...input?.voice },
    camera: { ...d.camera, ...input?.camera },
    highlight: { ...d.highlight, ...input?.highlight },
    captions: { ...d.captions, ...input?.captions },
    animate: { ...d.animate, ...input?.animate },
    title: { ...d.title, ...input?.title },
  };
}
