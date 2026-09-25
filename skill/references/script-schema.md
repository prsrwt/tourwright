# script.json reference

Location: `tourwright/walkthroughs/<name>/script.json`. Keep the `$schema` line that `new` writes, so your editor autocompletes and validates fields.

## Contents

1. Top level
2. Scenes
3. Cue markers
4. Beats: camera and narration box
5. How timing works
6. Settings and defaults
7. Complete example

## 1. Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Title card heading, shown for 2.5 seconds before the first scene |
| `subtitle` | no | Title card subheading |
| `settings` | no | Overrides for this walkthrough (section 6). Anything left out uses the default. |
| `lexicon` | no | Map of written word to how the voice should say it, such as `{ "SQL": "sequel" }`. Whole words, case-sensitive. It only changes the audio. |
| `scenes` | yes | Scenes, played in order |
| `areas` | no | Named boxes on a stage, `{ "area-export": { "stage": "invoice", "x": 1369, "y": 96, "w": 257, "h": 57 } }` in the stage's own layout pixels. Usually drawn by the user in Muse. A camera or narration box can go to one by name, like any target. |

## 2. Scenes

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | no | Short kebab-case name used in reports and still filenames. Defaults to the scene's number. |
| `stage` | yes | A stage registered in `tourwright/stages.tsx` |
| `say` | yes | Narration, with optional `[cue]` markers |
| `beats` | no | Actions tied to cues (section 4) |
| `tail` | no | Seconds held after the narration ends. Defaults to `settings.voice.tail` (0.7). |

A scene with no beats holds whatever framing the previous scene ended on, if it uses the same stage. A scene on a different stage starts on the whole stage with no narration box.

## 3. Cue markers

Write `[name]` at the start of a sentence in `say`. Names use lowercase letters, digits and single hyphens. `start` and `end` exist in every scene without being written.

- Markers are removed before the text is spoken.
- A marker in the middle of a sentence is an error: only sentence starts have exact times. Split the sentence instead.
- Every marker must be used by a beat, and every beat's `at` must be a marker, `start` or `end`. Check enforces both.

## 4. Beats

```json
{ "at": "total", "camera": { "to": "claim-total", "zoom": "fit" }, "highlight": "claim-total" }
```

`at` is required, and a beat needs `camera`, `highlight`, `animate`, or a combination. Each cue has at most one beat.

### animate

`"animate": "claimTotal"`, or several at once: `"animate": ["claimTotal", "donationCount"]`. The
names are values the stage declares (see `stages.md`, "Making parts move").

- A **number** eases from its `from` to its `to` over `settings.animate.duration` (1.2 s), then stays there, including in later scenes on the same stage. Before its beat it shows `from`. A number no beat animates shows its `to` throughout. Each number animates once.
- A **steps** value moves on to its next step at each beat that animates it, so `[null, "claimed", "paid"]` can be animated twice. A toggle `[false, true]` flips once, and its CSS transition plays.
- The animation starts when the same beat's camera move settles, so the viewer is already looking at it. Without a camera move, it starts at the cue.
- Verify adds a still of the moment each animation starts (`<scene>-<cue>-before`), so the contact sheet shows its range, and warns if an animation changed nothing on the page.

### camera

| Field | Default | Meaning |
| --- | --- | --- |
| `to` | required | A target name, or `all` for the whole stage |
| `zoom` | `"fit"` | `"fit"` fits the whole target with padding. `"width"` fits its width. A number is an absolute scale where 1 shows the full width of the stage. Clamped to `settings.camera.maxZoom`, and never further out than the whole stage. |
| `align` | `"center"` | `"center"` or `"top"`. With `"width"` on a target taller than the frame, use `"top"`. |
| `ease` | `settings.camera.ease` | Easing preset (section 6) |
| `duration` | `settings.camera.duration` | Seconds the move takes |

The camera never shows space beyond the edge of the stage: near an edge, it stops at the edge instead of centring the target.

### highlight (the narration box)

- `"claim-total"`: outline that target and dim everything else. From nothing it fades in; from another target it slides and resizes.
- `false`: fade the outline and the dimming out.

The narration box carries into the next scene if that scene uses the same stage, and clears at a cut to a different stage.

The target can also be an area from the top-level `areas`: a box the user drew in Muse around something with no target of its own, such as one button in a toolbar. verify reports the text inside it like any target's.

## 5. How timing works

Narration is spoken sentence by sentence, with `settings.voice.sentenceGap` seconds between sentences, so each sentence's start is known exactly. For a beat whose cue lands at time `t`:

- **Camera and highlight moves start at `t - lead`** (lead defaults to 0.4 seconds) and take `duration` (0.9 seconds for the camera, `slide` or `fade` for the narration box).
- **A move that would start before its scene starts at the scene start.**
- **A move that begins while another is still running starts from wherever the camera is at that frame.** Nothing snaps.

Everything is computed from the frame number, so changing a sentence moves every later beat with it. You never retime anything by hand.

## 6. Settings and defaults

Put only what you are changing in `script.json`. These are the defaults:

```json
"settings": {
  "video":     { "width": 1920, "height": 1080, "fps": 30, "crf": 23 },
  "voice":     { "voice": "bm_fable", "speed": 1, "dtype": "fp32", "sentenceGap": 0.3, "tail": 0.7 },
  "camera":    { "ease": "inOutCubic", "duration": 0.9, "lead": 0.4, "padding": 48, "maxZoom": 2.5 },
  "highlight": { "color": "#2563eb", "stroke": 3, "radius": 12, "padding": 10, "dim": 0.5, "slide": 0.5, "fade": 0.3 },
  "captions":  { "mode": "burned", "size": 40, "position": "bottom" },
  "animate":   { "duration": 1.2, "ease": "outCubic" },
  "title":     { "background": "#0f172a", "color": "#ffffff", "seconds": 2.5 }
}
```

- `video`: output size, frame rate and quality. Width and height must be even. `fps` is one of 24, 25, 30, 50 or 60. A lower `crf` gives higher quality and a bigger file. For a quick draft, `{ "width": 1280, "height": 720 }`.
- `voice.voice`: any Kokoro voice ID. `bm_fable`, `bm_george` and `bm_lewis` are British male; `bf_emma` and `bf_isabella` are British female; `af_heart`, `af_bella`, `am_adam` and `am_michael` are American. `speed` runs from 0.5 to 2. `dtype` trades quality for download size: `fp32` (about 326 MB), `fp16`, `q8` (about 92 MB) or `q4`.
- `camera.padding` is pixels of space kept around a framed target. `maxZoom` limits how close the camera gets, as a multiple of the whole-stage width.
- `highlight.color` is any CSS colour. `dim` is the opacity of the darkening outside the narration box, from 0 to 1. `slide` and `fade` are seconds.
- `captions`: the narration, one sentence at a time, each shown from when it starts until the next sentence starts. They show the written words, not the lexicon's respellings. `mode` is `"burned"` (drawn into the video, so they show everywhere, including Slack and GitHub), `"soft"` (a subtitle track inside the MP4, which players show and viewers can turn off) or `"off"`. `burned` and `soft` both write `<name>.vtt` next to the MP4, for web pages that add subtitles with a `<track>`. `size` is pixels at 1080p. Verify warns when a caption covers more than 10% of a target; frame the target higher, or use `"position": "top"`.
- `title`: the card that opens the video with `title` and `subtitle`. Set `background` to the app's brand colour, taken from its own colour tokens (for example the `--brand` value in its global CSS), and `color` to the text colour that goes on it. `"seconds": 0` leaves the card out and opens on the first scene.
- Easing presets: `linear`, `inOutSine`, `inOutCubic`, `outCubic`, `outExpo`. Use `inOutCubic` for camera moves.

Audio is cached one file per sentence, keyed by the spoken text and the voice settings, so changing a sentence or a voice setting only re-voices what changed.

## 7. Complete example

```json
{
  "$schema": "../../../node_modules/tourwright/schema/script.schema.json",
  "title": "Your team dashboard",
  "subtitle": "What the dashboard shows you each week",
  "scenes": [
    {
      "id": "overview",
      "stage": "dashboard",
      "say": "[open]This is the dashboard. It shows how your team's week is going at a glance.",
      "beats": [{ "at": "open", "camera": { "to": "all" } }]
    },
    {
      "id": "stats",
      "stage": "dashboard",
      "say": "[cards]These cards count your open, completed and overdue tasks. [overdue]Overdue tasks are the ones to look at first.",
      "beats": [
        { "at": "cards", "camera": { "to": "stats", "zoom": "fit" }, "highlight": "stats" },
        { "at": "overdue", "highlight": "stat-overdue" }
      ]
    },
    {
      "id": "tasks",
      "stage": "dashboard",
      "say": "[table]Below them is every task due this week, with who owns it. [status]The status shows where each one stands.",
      "beats": [
        { "at": "table", "camera": { "to": "tasks", "zoom": "width", "align": "top" }, "highlight": "tasks" },
        { "at": "status", "highlight": "status-column" },
        { "at": "end", "highlight": false }
      ]
    }
  ]
}
```
