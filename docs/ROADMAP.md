# Roadmap

## v0.1: one app, one kind of scene, end to end

**In**

- Stage scenes only: the app's real components, bundled by Tourwright with Vite, with typed fixtures.
- `script.json`: title, scenes, narration with cue markers at sentence starts, and beats for camera,
  highlight and stage values. One highlight style (outline).
- Stage values: numbers that count up and steps that flip (a toggle), as a function of the frame.
- Captions: burned in, as a subtitle track, or off, with a WebVTT file beside the video.
- Voice: kokoro-js, sentence by sentence, plus a **fake voice backend** that produces silence of a
  deterministic length, so CI and an agent's iteration loop never need the model download.
- Frame stepper, ffmpeg muxing, audio placed by frame, and repeated frames reused rather than
  captured again.
- Commands: `init`, `new` (with `--from-stage`), `check` and `verify` (with `--fix`), `describe`,
  `render`, `make`, `doctor`, `inspect`, `scaffold`, `muse`, `notes`, `reply`.
- Muse, the review page: playback, editing, notes pinned to the millisecond and talked through with
  the agent, and approval of one exact version. `make` opens it by itself.
- The `walkthrough` skill, copied into a project by `init`.
- The Next preset (module shims) plus plain Vite React. Nothing else.
- Example app in `examples/next-app`, used by CI, the tests and the README video.
- CI on Ubuntu, Windows and macOS.

**Out, deliberately**

- Page scenes (a URL of the running app), sweep, extra highlight styles, mid-sentence cues.
- Parallel rendering. Measured, and not worth it once repeated frames are skipped: on the intro
  (749 frames, 4 cores), splitting the capture between 2 or 4 pages in one browser took 13.7 s and
  14.2 s against 13.6 s for one page, and separate browsers 11.8 s and 13.1 s. What remains is
  ffmpeg's encode (about 7.5 s alone) and the screenshots, which the browser serialises. Worth
  measuring again on machines with many more cores.

**Frame skipping, measured.** A narration video mostly holds still: in the intro, 625 of 749 frames
are the frame before, pixel for pixel. A screenshot costs about 60 ms and drawing a frame about 3 ms,
so the player now returns a signature of everything that decides a frame's pixels, and the renderer
reuses the last screenshot when it has not changed. The intro renders in 16.7 s rather than 49.7 s.

**Done when**, and where each stands:

1. A clean first run works on Windows and Ubuntu: `npx tourwright init`, then
   `npx tourwright make intro`, with no undocumented step. The README lists every first-run
   download, its size and where it is cached. *CI makes the example on Ubuntu, Windows and macOS,
   and tests cover `init`; a first run on a clean machine outside CI is still to record.*
2. Lengthening a sentence and rendering again moves every later beat, with no time edited
   by hand. *Done: covered by the timeline tests.*
3. Rendering the same script twice on the same machine produces identical frame hashes. *Done:
   the render tests also require skipping repeated frames to give the same hashes.*
4. Fault injection is caught with a message that names the fix: a misspelt target, a target off
   screen, a blank page, a thrown error. *Done: the e2e tests inject each.*
5. Claude Code, given only the skill, produces a tour of a second example screen that passes
   `verify`, unattended. Keep the transcript. *Done on 2026-09-25: the Team screen, in 33 turns
   with no human input; verify passed with 0 errors and 0 warnings. Prompt, transcript and result
   are in [docs/agent-runs/team](agent-runs/team/README.md). The voice was the fake one, because
   that machine could not reach the model.*
6. The SwiftCause GASDS tour is re-made with Tourwright at parity with the Remotion version. Only
   then does `tools/walkthrough` get deleted there. *In progress: a trial run fed fixes back into
   Tourwright; parity is not yet recorded.*
7. A 60-second tour renders within an agreed budget on a laptop. The budget, agreed on 2026-09-25:
   at most 1 s of rendering per second of video, so a 60-second tour renders in a minute or less.
   *Measured with `npm run bench`: 0.67 s of rendering per second of 1080p video on a 4-core Linux
   machine (the 25 s intro in 16.7 s), within budget. A run on a laptop is still to record.*
8. No em dashes or en dashes anywhere in the repo. *Done: a test enforces it.*

## v0.2

Page scenes for real end-to-end flows, mid-sentence cues (estimated and marked as such), setup
actions before a shot, more highlight styles, a Vite example.

**PR mode** also belongs here: `/walkthrough <PR>` reads the diff, finds the changed components,
extends a stage and its fixtures, drafts narration in a chosen register (demo, educational or
explanation), renders, and hands back the MP4 with its timing report. It proposes the script and
fixtures for a human to glance at rather than publishing unattended, because inventing fixtures is
the step most likely to be wrong.

**Proof:** someone other than the author makes a video in their own app.

## v0.3

Regression mode: `verify --baseline` in CI, so tours re-render when the UI changes and fail visibly
when they no longer match. Optional speech-recognition check for pronunciation. More voice backends
(the interface is one function: sentence in, samples out). macOS CI.

**Proof:** a repo regenerates its documentation videos on every UI change.

That is also the stronger pitch: product videos that never go stale, because they re-render from
the real UI. "An AI makes videos" is a crowded claim; "your demos cannot drift from your app" is not.
