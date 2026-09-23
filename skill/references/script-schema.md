# script.json reference

Location: `tools/walkthrough/public/walkthroughs/<name>/script.json`. Add `"$schema": "../../../schema/script.schema.json"` at the top so your editor autocompletes and validates fields.

## Contents

1. Top level
2. Scenes
3. Cue markers
4. Beats: camera, highlight, count
5. How timing works
6. Settings and defaults
7. Image scenes and capture targets
8. Complete example (about 60 seconds)

## 1. Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Title card heading |
| `subtitle` | no | Title card subheading |
| `settings` | no | Overrides for this walkthrough (section 6). Anything left out uses the default. |
| `lexicon` | no | Map of written word to how the voice should say it, for example `{ "GASDS": "G A S D S" }`. It only affects audio; captions show the written form. Matches whole words and is case-sensitive. |
| `scenes` | yes | Array of scenes, played in order |

## 2. Scenes

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | no | Short kebab-case name used in check output and still filenames. Defaults to the scene's index. |
| `stage` | one of these two | Registered stage name, for example `gasdsPage` |
| `image` | one of these two | Screenshot path relative to the walkthrough folder, for example `screens/02-simple.png` |
| `say` | yes | Narration, with optional `[cue]` markers |
| `beats` | no | Actions tied to cues (section 4) |
| `focus` | no | Shorthand for `beats: [{ "at": "start", "camera": { "to": <focus> } }]`. Kept for older scripts. Don't use it together with `beats`. |
| `tail` | no | Seconds held after the narration ends. Defaults to `settings.voice.tail` (0.7). |

A scene with no beats and no focus behaves as it always has: stages hold the previous framing, and images get a slow push-in.

## 3. Cue markers

Write `[name]` in `say` immediately before the word the beat should land on. Names use lowercase letters, digits and hyphens. Two cues always exist without being written: `start` (the scene's first frame) and `end` (when the narration finishes).

- Markers are removed before the text is spoken or captioned.
- Every marker must be used by a beat, and every beat's `at` must be a marker, `start` or `end`. The check step enforces both.
- The voice step knows the exact time of cues at the start of a sentence. Cues inside a sentence are estimated from the share of the sentence spoken before them, and are marked `estimated` in the timing report.

## 4. Beats

```json
{ "at": "claim", "offset": 0, "camera": { ... }, "highlight": ..., "count": ... }
```

`at` is required. `offset` shifts the cue time by that many seconds (negative is earlier). You should rarely need it; moving the marker is usually better. A beat needs at least one of `camera`, `highlight` or `count`.

### camera

| Field | Default | Meaning |
| --- | --- | --- |
| `to` | required | A target name, or `all` (the whole stage or screenshot). Stages also have `content` (the main area, without the sidebar and header). |
| `zoom` | `"fit"` | `"fit"` fits the whole target in frame with padding. `"width"` fits the target's width. A number is an absolute scale, where 1 shows the full width of the stage or screenshot. Clamped to `settings.camera.maxZoom`. |
| `align` | `"center"` | `"center"` or `"top"`. With `"width"` on a target taller than the frame, use `"top"`. |
| `sweep` | `false` | If true, after arriving the camera pans steadily from the top of the target to its bottom until the next camera beat or the end of the scene. This is how to "scroll down" a long section. |
| `ease` | `settings.camera.ease` | Easing preset (section 6) |
| `duration` | `settings.camera.duration` | Seconds the move takes |

### highlight

- `"claim-total"`: outline that target using the walkthrough's highlight settings.
- `{ "on": "claim-total", "style": "spotlight", "padding": 16 }`: the same, with any `settings.highlight` field overridden for this beat.
- `false`: fade the highlight and the dimming out.

The highlight slides and resizes from its previous target to the new one. It carries into the next scene if that scene uses the same stage, and clears at a cut to a different stage or image.

### count

- `"claimTotal"`: count this countable from its starting value to its fixture value.
- `["claimTotal", "donationCount"]`: count several at once.
- `{ "value": "claimTotal", "from": 0, "duration": 1.6 }`: override the start value or duration.

Counting is stage-only. A countable that is counted anywhere in a walkthrough shows its `from` value in every earlier scene, counts at its beat, and keeps its final value afterwards, so it never jumps between scenes.

## 5. How timing works

After the voice step, every cue has a time in seconds within its scene. For each beat, with cue time `t`:

- **Camera and highlight moves start at `t - lead`** (lead defaults to 0.4 seconds) and take `duration` (0.9 for the camera, 0.5 for the highlight). The viewer's eye is already moving when the word is spoken, and the move settles about half a second later.
- **A count starts when the camera move in the same beat settles.** Without a camera move, it starts at `t`.
- **Moves that would start before the scene starts at the scene start.** The check step warns if a move would not finish before the scene ends.
- **If a new move begins while another is still running,** it starts from wherever the camera is at that frame. Nothing snaps.
- **A scene's camera starts where the previous scene's ended** if both use the same stage. Otherwise it starts on `all`.

Everything is computed from the frame number, so changing a sentence and running the voice step again moves every beat with it. You never retime anything by hand.

## 6. Settings and defaults

Put only what you are changing in `script.json`. These are the defaults:

```json
"settings": {
  "video":     { "width": 1920, "height": 1080, "fps": 30, "crf": 30, "codec": "h264" },
  "voice":     { "voice": "bm_fable", "speed": 0.95, "dtype": "fp32", "sentenceGap": 0.3, "tail": 0.7 },
  "camera":    { "frame": "all", "ease": "inOutCubic", "duration": 0.9, "lead": 0.4, "padding": 48, "maxZoom": 2.5, "pushIn": 1.06 },
  "highlight": { "style": "outline", "color": "primary", "stroke": 3, "radius": 12, "padding": 10, "dim": 0.5, "slide": 0.5, "fade": 0.3 },
  "count":     { "duration": 1.2, "ease": "outCubic" },
  "captions":  { "mode": "sentence", "position": "bottom", "size": 40, "background": "pill" }
}
```

- `video`: output size, frame rate and quality. A lower `crf` gives higher quality and a bigger file. For a quick draft, `{ "width": 1280, "height": 720, "crf": 34 }`.
- `voice.voice`: any kokoro voice ID. `bm_fable` and `bm_george` are British male; `bf_emma` and `bf_isabella` are British female. Stick to British voices for this audience. `sentenceGap` is the pause between sentences in seconds.
- `camera.frame`: what `all` means for the opening shot. `"all"` includes the sidebar and header, and `"content"` shows the main area only. Either way the sidebar stays in the layout.
- `camera.pushIn`: how far an image scene with no camera beats slowly zooms over its duration.
- `highlight.style`: `"outline"` (coloured border and dimmed surroundings), `"spotlight"` (dimmed surroundings with a soft edge and no border) or `"tint"` (a light fill in the highlight colour, with no dimming).
- `highlight.color`: a colour token name from `docs/COLOR_SYSTEM.md`. `dim` is the opacity of the darkening outside the highlight, from 0 to 1.
- `captions.mode`: `"sentence"` shows the current sentence and `"off"` hides captions. `background` is `"pill"`, `"bar"` or `"none"`.
- Easing presets: `linear`, `inOutSine`, `inOutCubic`, `outCubic`, `outExpo`, `spring`. Use `inOutCubic` for camera moves and `outCubic` for counts and highlights. `spring` is for playful moments and is rarely right for this audience.

Settings that affect audio (the `voice` block and `lexicon`) require the voice step to run again. The tool detects this and tells you.

## 7. Image scenes and capture targets

Screenshots are captured by `npm run capture -- <name>`. Each capture step that produces a screenshot can list named targets as CSS selectors. Prefer existing `data-testid` or role-based selectors:

```json
{ "shot": "02-simple.png", "targets": { "claim-total": "[data-testid='gasds-claim-total']", "collections": "role=table[name='Collections']" } }
```

Capture saves each target's box next to the screenshot as `screens/02-simple.targets.json`. Image scene beats can then use those names with `camera.to` and `highlight`, exactly as with a stage. `all` is always available. If a selector matches nothing, capture fails and names it.

## 8. Complete example (about 60 seconds)

The target names and button labels here are illustrative; use the real labels from the screen. Run `npm run check -- --targets gasdsPage` for the real ones.

```json
{
  "$schema": "../../../schema/script.schema.json",
  "title": "Your GASDS claim",
  "subtitle": "Checking and making a small donations claim",
  "lexicon": { "GASDS": "G A S D S" },
  "settings": { "highlight": { "style": "outline" } },
  "scenes": [
    {
      "id": "intro",
      "stage": "gasdsPage",
      "say": "This is the Gift Aid Small Donations Scheme page, or GASDS. [what]It works out what your charity can claim on small donations that have no Gift Aid declaration.",
      "beats": [
        { "at": "start", "camera": { "to": "all" } },
        { "at": "what", "camera": { "to": "content", "zoom": "fit" } }
      ]
    },
    {
      "id": "method",
      "stage": "gasdsPage",
      "say": "[method]Start by choosing how you are claiming. The method you pick decides which donations are counted.",
      "beats": [
        { "at": "method", "camera": { "to": "method", "zoom": "fit" }, "highlight": "method" }
      ]
    },
    {
      "id": "collections",
      "stage": "gasdsPage",
      "say": "[list]Below that, every eligible collection is listed with its date and total. [records]Check these against your own records before you claim.",
      "beats": [
        { "at": "list", "camera": { "to": "collections", "zoom": "width", "align": "top", "sweep": true }, "highlight": "collections" },
        { "at": "records", "highlight": false }
      ]
    },
    {
      "id": "total",
      "stage": "gasdsPage",
      "say": "[total]This is the top-up we calculate you can claim. It is based on the eligible donations above, up to the yearly limit.",
      "beats": [
        { "at": "total", "camera": { "to": "claim-total", "zoom": "fit" }, "highlight": "claim-total", "count": "claimTotal" }
      ]
    },
    {
      "id": "next",
      "stage": "gasdsPage",
      "say": "When the figures match your records, [action]use Prepare claim to create your submission for HMRC.",
      "beats": [
        { "at": "action", "camera": { "to": "claim-actions", "zoom": "fit" }, "highlight": "claim-actions" },
        { "at": "end", "highlight": false }
      ]
    }
  ]
}
```
