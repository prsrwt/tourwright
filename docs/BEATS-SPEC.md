# Beats, highlights and counting figures: design and implementation

This note covers the scripting layer behind `.claude/skills/walkthrough`. The skill documents the target behaviour. Until the changes below land, `beats`, `settings`, `lexicon`, `check`, `stills` and `new` do not exist, and only `focus` scenes work.

## 1. What changes

Today a scene can only say "go here" (`focus`). This adds:

- **Cue markers** in narration (`[claim]`) and **beats** tied to them, which move the camera, move a highlighter and count figures. Timing is derived from the spoken audio, so it survives any narration change.
- A **highlighter** that outlines a target, dims the rest and slides between targets.
- **Countables**: numeric fixture values that the real component renders as they count up.
- **Per-walkthrough settings** with defaults, covering video, voice, camera, highlight, count and captions.
- **Targets on screenshots**, so image scenes can use camera and highlight beats.
- Three commands: `check` (static validation and writing rules), `stills` (a frame per beat plus a timing report) and `new` (scaffold).

Existing scripts keep working. `focus: X` is sugar for a camera beat at `start`.

## 2. What goes in the skill and what goes in the tool

The rule: **if a program can detect the mistake, the tool catches it; the skill only covers judgement.**

| Tool (code) | Skill (prose) |
| --- | --- |
| Schema, defaults, validation of names, cues and beats | What story to tell and which screen to use |
| Cue timing, lead, clamping, interruption, cross-scene continuity | Where to put cues relative to words |
| Writing lint: dashes, sentence length, US spellings, banned phrases | Plain English for treasurers, not giving tax advice |
| Stale voice detection | Stage or screenshot decision |
| Stills and timing report | How to read the stills and judge them |
| Colour tokens, easing presets | When to override defaults |

## 3. Schema

The source of truth is a zod schema in `src/schema/script.ts`. `npm run schema` emits `schema/script.schema.json` using zod 4's `z.toJSONSchema`, so editors can validate through `$schema`. The full field reference is in `.claude/skills/walkthrough/references/script-schema.md`. Implement exactly that; key types:

```ts
type Script = {
  title: string; subtitle?: string;
  settings?: DeepPartial<Settings>;
  lexicon?: Record<string, string>;
  scenes: Scene[];
};

type Scene = { id?: string; say: string; tail?: number; focus?: string; beats?: Beat[] }
  & ({ stage: string } | { image: string });

type Beat = {
  at: string;              // cue name, "start" or "end"
  offset?: number;         // seconds
  camera?: { to: string; zoom?: 'fit' | 'width' | number; align?: 'center' | 'top';
             sweep?: boolean; ease?: EaseName; duration?: number };
  highlight?: string | false | ({ on: string } & Partial<HighlightSettings>);
  count?: string | string[] | { value: string; from?: number; duration?: number };
};

type EaseName = 'linear' | 'inOutSine' | 'inOutCubic' | 'outCubic' | 'outExpo' | 'spring';
```

Settings defaults live in `src/settings/defaults.ts` and match the reference exactly. `resolveSettings(script.settings)` deep-merges them, and per-beat highlight overrides merge over that.

Cue syntax: `/\[([a-z0-9-]+)\]/g`. `start` and `end` are reserved and must not be written as markers.

## 4. Timing pipeline

### 4.1 Voice step (`src/voice/`)

For each scene:

1. `display = say` with markers removed and whitespace collapsed. This is what captions show.
2. `spoken = display` with the lexicon applied (whole words, case-sensitive, longest key first).
3. Split `spoken` into sentences on `.`, `?` or `!` followed by whitespace or the end. Keep a map from each marker to its sentence and its character offset within the spoken sentence (compute offsets on the marked-up string, then map through marker removal and lexicon substitution).
4. Synthesise **each sentence separately** with kokoro-js (`voice`, `speed`, `dtype` from settings). Measure each clip's speech start and end by trimming leading and trailing samples below -40 dBFS. Concatenate the clips with `sentenceGap` seconds of silence. Write one WAV per scene as today.
5. Resolve each cue:
   - **At a sentence start:** `t = sentence.speechStart`, with `exact: true`.
   - **Inside a sentence:** `t = speechStart + (speechEnd - speechStart) * w_before / w_total`, with `exact: false`. Weights are phoneme counts if kokoro-js exposes its phonemiser (check `kokoro-js` exports; it phonemises internally before tokenising). Otherwise use a weighted character count: letters and digits 1, comma 6, other punctuation 0.
   - `start` = 0; `end` = the last sentence's speechEnd.
6. `hash = sha256(spoken + JSON.stringify(voiceSettings))`.

Synthesising sentence by sentence costs a little prosody across sentence joins, which is inaudible with a 0.3-second gap. In return, sentence-start cues are exact and the audio length is known. Forced alignment (for example Whisper word timestamps) would give exact mid-sentence times, but it adds a heavy dependency. Revisit it only if estimated cues prove too loose in practice.

Manifest v2 (same location as today's manifest):

```json
{
  "version": 2,
  "scenes": [
    {
      "index": 3, "id": "total", "hash": "<sha256>", "file": "voice/03.wav", "duration": 6.42,
      "sentences": [ { "display": "This is the top-up we calculate you can claim.", "speechStart": 0.08, "speechEnd": 2.61, "start": 0, "end": 2.7 } ],
      "cues": { "total": { "t": 0.08, "exact": true } }
    }
  ]
}
```

`duration` is the full clip length. Scene length stays `duration + tail`, as today.

### 4.2 Timeline (`src/timeline/buildTimeline.ts`)

A pure function with no DOM or React: `buildTimeline(script, manifest, settings) => Timeline`. It throws if any scene hash is stale, with the message `Narration for scene "<id>" changed since the voice step. Run: npm run voice -- <name>`.

Per scene, with `fps` from settings: `startFrame` accumulates; `frames = ceil((duration + tail) * fps)`. Per beat, with `t = cue.t + offset`:

- camera: `start = max(0, t - lead)`, `end = start + duration` (in frames, rounded).
- highlight: `start` as for the camera; `end = start + slide`.
- count: `start = camera ? camera.end : t`; `end = start + count.duration`.

Warnings (surfaced by `check` and `stills`): a move ends after the scene ends; camera moves start less than 1.5 seconds apart; `start` was clamped.

The timeline also records, for each countable, the first frame at which it is counted, so earlier scenes can hold its `from` value.

### 4.3 Evaluating a frame

For each frame, the state is a pure function of the frame, the timeline and the measured target boxes:

```ts
type Cam = { cx: number; cy: number; scale: number };   // centre in stage px, scale
cameraFor(box, zoom, align, frameSize, padding, maxZoom): Cam
```

- `fit`: `scale = min(fw / (w + 2p), fh / (h + 2p))`; `width`: `scale = fw / (w + 2p)`; a number is absolute, where 1 = `fw / stageWidth`. Clamp to `maxZoom * (fw / stageWidth)`. With `align: 'top'`, `cy` is placed so the box top sits `p` below the frame top.
- Clamp the resulting view so it never shows outside the stage (no empty margins).
- Fold camera beats in order. Beat `i` interpolates from `stateAt(beat_i.start)`, which is the result of every earlier beat at that frame, to `cameraFor(target_i)`, eased with `ease`. This is what makes interruptions smooth. Memoise per scene; nothing depends on anything but the frame.
- Interpolate the zoom in log space (`exp(lerp(log a, log b))`) so zooming feels even.
- `sweep`: after arriving, `cy` moves linearly from the target's top-aligned position to its bottom-aligned position until the next camera beat starts or the scene ends.
- Scene start state: the previous scene's final state if it used the same stage, otherwise `cameraFor(all)` (or `content` if `camera.frame` is `"content"`).
- Easing: map names to Remotion `Easing` (`Easing.inOut(Easing.cubic)` and so on). `spring` uses `spring({ frame: f - start, fps, config: { damping: 200 } })`.

No `Date.now`, timers, CSS transitions or real-time animation libraries anywhere.

## 5. Components

### 5.1 Stage registry (`src/stage/registry.tsx`)

```ts
defineStage({
  component: GasdsPage,                 // now receives { fixtures: GasdsFixtures }
  fixtures: gasdsFixtures,
  targets: {
    method: { focus: 'method' },
    'claim-total': { selector: "[data-testid='gasds-claim-total']" },
  },
  countables: {
    claimTotal: countable({ get, set, round: 'pence' }),
  },
});
```

`all` and `content` are built in: `all` is the stage root and `content` is the shell's main area, found by `data-focus="content"` on the shell. `check --stages` and `check --targets <stage>` read this registry. Registry types must keep countable lenses typed against the fixture type.

### 5.2 Stage scene

- Render the stage at its natural size inside a transform wrapper (`translate` and `scale` from the camera state).
- **Measuring:** on mount, call `delayRender()`, wait for `document.fonts.ready`, measure every registry target with `getBoundingClientRect` relative to the stage root (divided by the current scale), store the boxes, then `continueRender()`. Measure with countables at their final values, so layout does not shift as numbers grow. If a registered target is missing from the DOM, throw `Target "<name>" is registered for stage "<stage>" but not found in the DOM`.
- **Countables:** compute each countable's value for the frame (hold `from` before its first count frame, ease between `start` and `end`, hold the final value after), apply the `set` lenses to the fixtures, round, and pass the result as the `fixtures` prop.
- Add a stage-root class that disables CSS transitions and animations.

### 5.3 Highlighter (`src/stage/Highlighter.tsx`, used by both scene kinds)

A screen-space SVG overlay above the scene. For each frame, it computes the highlight rect as the target box projected through the camera state, plus padding. Drawing it in screen space keeps the stroke width constant while zooming.

- Slide: interpolate x, y, w and h from the previous rect to the new one over `slide`, using `outCubic`.
- Toggle on and off: fade opacity over `fade`.
- `outline`: dim path (`fill-rule="evenodd"`, full frame minus a rounded rect, black at opacity `dim`) plus a rounded-rect stroke in `color`.
- `spotlight`: the same dim path with the hole feathered (SVG blur on a mask), and no stroke.
- `tint`: rounded-rect fill in `color` at 15% opacity, and no dim.
- Colour: settings take token names from `docs/COLOR_SYSTEM.md`. Resolve with `getComputedStyle(document.documentElement).getPropertyValue('--<token>')`, which requires the app's global stylesheet to be loaded in the composition (stages already need it). Fall back to a hex value in defaults.ts only if the variable is empty, and log a warning.

### 5.4 Image scene

- If the scene has no beats, keep today's slow push-in (`camera.pushIn`).
- Otherwise, load `screens/<file>.targets.json` (see section 7) and use the same camera and highlighter code, with boxes in screenshot pixels and `all` = the full image.
- `count` on an image scene is a check error.

### 5.5 Captions (`src/Captions.tsx`)

When `captions.mode` is `"sentence"`, show `sentences[i].display` from `sentences[i].start` to `sentences[i+1].start` (the last one runs until the scene ends). Fade in and out over 6 frames. Position, size and background come from settings, and colours from tokens. The caption text never contains markers.

### 5.6 Root and render

- The composition uses `calculateMetadata`: it loads the script and manifest, resolves settings, builds the timeline, and returns `durationInFrames`, `width`, `height`, `fps` and props.
- The render script reads `crf` and `codec` from the resolved settings instead of hard-coded values.

## 6. Commands (`package.json` scripts, implemented in `scripts/`)

- `new <name>`: creates the folder and a template `script.json` with `$schema`, a title, and one stage scene with a `start` beat on `all`. Refuses if the folder exists.
- `check <name>`, errors (non-zero exit): schema invalid; unknown stage, target or countable; image file or targets file missing; unused marker, unknown `at`, or duplicate marker in a scene; `focus` together with `beats`; `count` on an image scene; any em dash (U+2014) or en dash (U+2013) in any string in the script.
- `check <name>`, warnings: a sentence over 20 words; US spellings or phrases from the lists in `references/narration.md` (keep the lists in `src/check/wordlists.ts` and the reference in sync); zoom over 2 on an image scene; stale voice. After voicing, also: timeline warnings (section 4.2), and the total duration printed.
- `check --stages` and `check --targets <stage>`: print from the registry.
- `stills <name>`: builds the timeline and uses `@remotion/renderer` `renderStill` for each scene's first frame and each beat's settle frame (the latest of its camera, highlight and count end frames). Writes `out/<name>/stills/<sceneId>-<cue>.png` and `out/<name>/timing.md`. The report has one row per cue: scene, cue, time, exact or estimated, and the words spoken around it (from the sentence text, using the same proportional position). Timeline warnings go at the top.
- `studio <name>`: opens Remotion Studio with that script selected.
- `make <name>`: check, then voice, then render. Stops on check errors.

## 7. Capture changes

Each capture step that saves a screenshot accepts an optional `targets: Record<string, string>` of Playwright selectors. After the screenshot, capture records each locator's `boundingBox()` in screenshot pixels (taking device scale factor into account) and writes `screens/<file>.targets.json`. A selector that matches nothing, or matches more than one element, fails the capture with its name.

## 8. File change list

| File | Change |
| --- | --- |
| `package.json` | Add `zod` (v4). Add scripts `new`, `check`, `stills`, `studio`, `schema`. `make` runs check first. |
| `src/schema/script.ts`, `schema/script.schema.json` | New: schema and generated JSON Schema |
| `src/settings/defaults.ts`, `src/settings/resolve.ts` | New |
| `src/voice/*` | Sentence synthesis, lexicon, cue resolution, hashing, manifest v2 |
| `src/timeline/buildTimeline.ts`, `src/timeline/evaluate.ts`, `src/timeline/ease.ts` | New, pure |
| `src/stage/registry.tsx` | `defineStage` with targets and countables |
| `src/stage/GasdsPage.tsx` | Takes a `fixtures` prop; adds `data-focus` wrappers for the targets it registers; the shell gets `data-focus="content"` |
| `src/stage/Camera.tsx` | Driven by the evaluated timeline state; measuring moved to the scene |
| `src/stage/Highlighter.tsx`, `src/stage/countables.ts` | New |
| `src/image/ImageScene.tsx` (or the current image scene file) | Target boxes, beats, push-in fallback |
| `src/Captions.tsx`, `src/Root.tsx` | Captions; `calculateMetadata` |
| capture script | `targets` sidecar |
| `scripts/new.ts`, `scripts/check.ts`, `scripts/stills.ts` | New |
| `src/check/wordlists.ts` | New |
| tests | See section 9 |

## 9. Tests and acceptance

Unit tests (using the tool's existing runner, or `node:test` via `tsx`):

- `buildTimeline`: lead and clamping, a count starting on camera settle, cross-scene carry-over, stale hash throws.
- `evaluate`: an interrupted move starts from its current state (no jump between consecutive frames: the camera delta per frame stays under a threshold), log-space zoom, sweep bounds, and countables holding `from` in earlier scenes.
- Cue resolution: sentence-start cues are exact; estimates increase monotonically through a sentence; the lexicon shifts offsets correctly.
- `check`: one fixture script per error rule.

Acceptance:

1. The existing GASDS script renders without edits, with the same camera path as before.
2. The example in `references/script-schema.md` (with real target names) renders, and every still shows its highlight on the intended element.
3. After lengthening one sentence and running `voice` again, every later beat in that scene moves by the added time, with no script edits.
4. Rendering the same frame twice gives byte-identical PNGs.
5. `rg "\x{2014}|\x{2013}" tools/walkthrough .claude/skills/walkthrough` returns nothing.
6. The app's `package.json` is unchanged.
7. An engineer new to the tool produces a 60-second tour of a screen of their choice using only the skill. This is the real test; run it with someone before calling this done.

## 10. Assumptions to confirm against the current code

These were written without the source in front of me. Check each one and adjust the spec, not the skill, where they differ.

- The Remotion public folder is `tools/walkthrough/public`, so walkthroughs live at `tools/walkthrough/public/walkthroughs/<name>/`.
- Where capture steps are defined today (code or a JSON file), so the `targets` field has a home.
- Whether `GasdsPage` imports fixtures directly. If so, change it to take them as a prop.
- Whether `kokoro-js` exposes its phonemiser (it decides the mid-sentence weighting).
- The real colour token names in `docs/COLOR_SYSTEM.md` and the CSS variable format, which the `"primary"` default assumes.
- Whether captions or a title card already exist, so this extends them rather than duplicating them.

## 11. Decisions made here that the team may want to revisit

- **Captions default to on** (`"sentence"`). Treasurers often watch without sound, and it is better for accessibility. Set `"off"` per walkthrough if needed.
- **The sidebar is never unmounted.** Framing decides visibility. `camera.frame: "content"` exists for a tighter default.
- **Screenshots support camera and highlight beats but not counts.** Counting needs live components.
- **Mid-sentence cues are estimated** rather than force-aligned. This keeps the tool light, and the skill steers authors towards sentence-start cues where precision matters.
