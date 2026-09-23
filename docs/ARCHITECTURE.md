# Architecture

Tourwright turns a script into a narrated walkthrough video of an app's **real components**. One
`script.json` per walkthrough: narration, cue markers and beats. Everything else is derived.

## The pipeline

```
script.json ──> voice (kokoro, local) ──> manifest with cue times
                                             │
                        stages.tsx ──> Vite bundle ──> player page
                                             │
                     frame stepper (Playwright) ──> PNG frames ──> ffmpeg ──> out/<name>.mp4
                                             │
                                          audio track (WAVs placed by frame)
```

Every step is a pure function of the frame number. Nothing animates on the wall clock, so a frame
renders the same whether it is the first or the thousandth.

## Decisions, and why

### Tourwright bundles the app's components itself

The app supplies a `stages.tsx` and its fixtures. Tourwright runs Vite over them, with the app's
own `node_modules`, `tsconfig` paths and PostCSS config, and serves a player page that imports
them. There is no dev server to start, no database to seed and no login to script.

This is how Remotion works (webpack rather than Vite), and it is the seam that decides whether a
tool works on an app it does not control. Proved on the SwiftCause admin: bundling its real GASDS
components needed about 30 lines of config (a path alias, a `next/link` stub and Tailwind's
`@source`), and nothing dragged the data layer in, because those components import their app types
with `import type`.

### Our own frame stepper rather than Remotion

Remotion renders React deterministically and does it well, but:

- Its licence is free only for individuals, non-profits and companies of up to three people. Most
  adopters of a tool aimed at "any React codebase" are larger, so the README would open with
  "and buy a licence". (The separate automation clause needs checking before it is quoted.)
- It would still leave the bundling problem above, since every app would need its own Remotion
  webpack configuration.

The stepper is small because the hard parts are already ours: animation is a function of the frame,
audio length is known before rendering, and the camera maths is our code.

```
for each frame f:
  page.evaluate(() => window.__tour.setFrame(f))   // React re-renders
  wait until the ready counter is zero             // fonts, images, measurements
  screenshot
  pipe to ffmpeg
```

The ready counter is the equivalent of Remotion's `delayRender`, which the camera already needs so
it can measure a target before framing it.

Read Remotion's renderer for understanding, never for code: its licence forbids distributing a
derivative, which would put the project back inside the problem it is leaving.

### Stage scenes first, page scenes later

- **Stage scene:** the app's real components with typed fixtures, rendered in the bundle. No
  backend, no auth, and any state can be staged. This is v0.1.
- **Page scene:** a URL of the app actually running, for a true end-to-end flow. Needs the app and
  its data, so it is v0.2 and optional.

### Verification is the product, not the skill

An agent cannot watch a video, so every quality worth having becomes a number or an image:

- `check` validates the script against the schema and the stage's real targets, and reports errors
  written for a model: what is wrong, the valid options, the exact fix.
- `verify` renders the settle frame of every beat and asserts against the live DOM: the target is
  fully in frame, text is legible at the final scale, the frame is not blank, no error overlay, no
  console errors. It writes `report.json`, `timing.md` (each cue, its time, and the words spoken
  around it) and one labelled contact sheet of all the stills, so a model can look at one image.

The skill is documentation for that loop.

### Cue timing

Narration is synthesised sentence by sentence, so each sentence's start is known exactly. A cue
marker (`[claim]`) written at the start of a sentence gets an exact time. In v0.1 that is the only
place a cue may go: mid-sentence cues would need estimation or forced alignment, and the constraint
is worth more than the freedom. Timing therefore survives any rewording: change a sentence, run the
voice step, and every later beat moves with it.

## Licences to settle before anything is published

- **phonemizer** (a dependency of kokoro-js) declares Apache-2.0, but its bundle references
  espeak-ng and contains GPL text. espeak-ng is GPL-3.0, so the declared licence looks wrong.
  Tourwright does not redistribute it, but no README may claim an Apache-2.0 voice stack until this
  is resolved.
- **ffmpeg** runs as a separate process. Prefer the system binary; fall back to `ffmpeg-static`
  (GPL-3.0) as an optional dependency, which keeps our own code MIT.
- **Kokoro** model weights are Apache-2.0.
