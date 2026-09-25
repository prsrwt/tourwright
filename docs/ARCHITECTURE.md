# Architecture

Tourwright turns a script into a narrated walkthrough video of an app's **real components**. One
`script.json` per walkthrough: narration, cue markers and beats. Everything else is derived.

## The pipeline

```
script.json ──> voice (kokoro, local) ──> manifest with cue times
                                             │
                        stages.tsx ──> Vite bundle ──> player page
                                             │
                     frame stepper (Playwright) ──> PNG frames ──> ffmpeg ──> tourwright/out/<name>.mp4
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

Vite reads the app's PostCSS config by itself, so Tailwind works unchanged, and Vite 8 resolves
`tsconfig` path aliases when asked (`resolve.tsconfigPaths`). The Next preset adds stand-ins for
`next/link`, `next/image`, `next/navigation`, `next/router`, `next/head` and `next/dynamic`.

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
once: render each stage, wait for its fonts and images, measure every target
for each frame f:
  page.evaluate(() => window.__tour.setFrame(f))   // React re-renders synchronously
  screenshot, unless nothing on screen changed since f - 1
  pipe to ffmpeg
```

Most frames of a narration video are the frame before: the camera and highlight hold still while a
sentence is spoken. So `setFrame` returns a signature of everything that decides the pixels (the
stage and its values, the camera, the highlight, the caption, the title card), or none while a CSS
animation is still moving, and a frame whose signature matches the last reuses its screenshot. The
render tests require exactly the same frame hashes with and without it. Splitting the capture
between parallel pages was measured and did not pay (see the roadmap).

Measuring up front is the equivalent of Remotion's `delayRender`: the camera needs a target's box
before it can frame it. A stage is measured once per layout it takes: numbers counting up barely
move anything, but a steps value such as a toggle can reveal whole sections, so each distinct
combination of steps is measured once, and each frame looks up the one in force. Each frame then
renders synchronously with nothing to wait for.

Stage values are how parts of a real component move: a number eases from its start to its end
value, and a steps value moves through its states, all as a pure function of the frame. The
component receives the in-between props and draws them itself, so a meter fills because its real
prop grows, not because anything is painted over it.

The wall clock is frozen rather than merely avoided. Our own code never reads it, but an app's
components may ("2 days ago", a blinking cursor), so the stepper pins `Date.now` and timers with
Playwright's clock. CSS transitions and animations run on the browser's own clock instead, so the
player takes them over through the Web Animations API: each one is paused and set to the time the
frame number implies, counted from the frame it started on. A toggle then slides, and a spinner
spins, identically on every run. Stills for verify show each at its end.

Read Remotion's renderer for understanding, never for code: its licence forbids distributing a
derivative, which would put the project back inside the problem it is leaving.

### Stage scenes first, page scenes later

- **Stage scene:** the app's real components with typed fixtures, rendered in the bundle. No
  backend, no auth, and any state can be staged. This is v0.1.
- **Page scene:** a URL of the app actually running, for a true end-to-end flow. Needs the app and
  its data, so it is v0.2 and optional.

### Verification is the product, not the skill

An agent cannot watch a video, so every quality worth having becomes a number or an image:

- `check` validates the script against the schema, cues and writing rules, with no browser, and
  reports errors written for a model: what is wrong, the valid options, the exact fix.
- `verify` checks stage and target names against what the bundle actually rendered (with the same
  "did you mean" fixes), then renders the settle frame of every beat and asserts against the live
  DOM: the target is fully in frame, text is at least 12 px at the final scale, the frame is not
  blank, no stage threw and there were no console errors. It writes `report.json`, `timing.md`
  (each cue, its time, and the words spoken around it), `screen.md` (what each still shows, read
  from the page) and one labelled contact sheet of all the stills, so a model can look at one image.
- `describe` prints the same description of the screen for any moment. The player reads it from
  the DOM, not the image: each target's share of the frame and whether it is cut off, the
  highlight and the text inside it, the caption and the stage's values. Notes left in Muse save it too,
  so a note says what was on screen when it was written.
- `make` runs `verify` before `render`, and renders only if every still passes, so a broken script
  fails in seconds rather than after a full render.

The skill is documentation for that loop.

Output goes to `tourwright/out/` rather than `out/`, because a Next.js static export also writes to
`out/`.

### Review belongs to the user, and names a version

Verify can say a video is correct; only the person who asked for it can say it is right. Muse,
the review page (once called the studio), keeps that conversation beside the script, as files an
agent can read and write:

- `notes.json`: each note is a short thread with a status that says whose turn it is. `open`
  waits on the agent, `question` on the user's answer, `fixed` on the user's approval, and
  `closed` is approved. Only Muse closes a note, so an agent cannot mark its own work as
  accepted. A note can cover its moment, its scene or the whole video, and can name a target the
  user clicked in the preview.
- Muse opens by itself. Most people who get a video never open a terminal: they ask an agent,
  so they would never learn the page exists. After a successful render, `make` starts Muse as a
  detached background process and opens the browser to it, then returns as usual. The process
  records itself in `out/<name>/muse.json`, so the next make reopens it rather than starting a
  second one, and it closes itself once no tab has had its event stream open for 10 minutes. It
  never opens a browser where nobody would see it: in CI it starts nothing and prints the
  command, and on a Linux machine with no display it prints the link.
- `review.json`: the user's verdict on the whole video, with a hash of the `script.json` it was
  given for. The approval counts only while the hash matches, so any later edit, however small,
  asks for another look. `notes` and `make` print where it stands.

### Cue timing

Narration is synthesised sentence by sentence, so each sentence's start is known exactly. A cue
marker (`[claim]`) written at the start of a sentence gets an exact time. In v0.1 that is the only
place a cue may go: mid-sentence cues would need estimation or forced alignment, and the constraint
is worth more than the freedom. Timing therefore survives any rewording: change a sentence, render
again, and every later beat moves with it.

There is no separate voice command. `render`, `verify` and `make` synthesise whatever is missing,
cached one file per sentence under a hash of its spoken text and the voice settings. A manifest can
therefore never be stale, and only changed sentences are synthesised again. The fake backend
produces silence whose length depends only on the text, so tests and an agent's iteration loop
never need the model.

Frame rates are limited to 24, 25, 30, 50 and 60, each of which divides the voice's 24 kHz sample
rate exactly. A frame is then a whole number of samples, so audio placed by frame never drifts.

## Licences to settle before anything is published

- **phonemizer** (a dependency of kokoro-js) declares Apache-2.0, but its bundle references
  espeak-ng and contains GPL text. espeak-ng is GPL-3.0, so the declared licence looks wrong.
  Tourwright does not redistribute it, but no README may claim an Apache-2.0 voice stack until this
  is resolved.
- **ffmpeg** runs as a separate process, which keeps our own code MIT. Tourwright uses the `ffmpeg`
  on the PATH, or `ffmpeg-static` (GPL-3.0) if the app has installed it, and `doctor` reports which.
  It is not a dependency, not even an optional one: npm installs optional dependencies by default,
  so everyone would download about 80 MB whether or not they already have ffmpeg.
- **Kokoro** model weights are Apache-2.0.
