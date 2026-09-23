# Roadmap

## v0.1: one app, one kind of scene, end to end

**In**

- Stage scenes only: the app's real components, bundled by Tourwright with Vite, with typed fixtures.
- `script.json`: title, scenes, narration with cue markers at sentence starts, and beats for camera
  and highlight. One highlight style (outline).
- Voice: kokoro-js, sentence by sentence, plus a **fake voice backend** that produces silence of a
  deterministic length, so CI and an agent's iteration loop never need the model download.
- Frame stepper, ffmpeg muxing, audio placed by frame.
- Commands: `init`, `new`, `check`, `verify`, `render`, `make`, `doctor`.
- The `walkthrough` skill, copied into a project by `init`.
- The Next preset (module shims) plus plain Vite React. Nothing else.
- Example app in `examples/next-app`, used by CI, the tests and the README video.
- CI on Windows and Ubuntu.

**Out, deliberately**

- Page scenes (a URL of the running app), countables (figures counting up), captions, sweep,
  extra highlight styles, mid-sentence cues, parallel rendering, frame skipping, a preview UI,
  macOS CI.

Frame skipping is an optimisation: measure first. A 2,195-frame tour rendered acceptably without it
in the tool this project grew out of.

**Done when**

1. A clean first run works on Windows and Ubuntu: `npx tourwright init`, then
   `npx tourwright make intro`, with no undocumented step. The README lists every first-run
   download, its size and where it is cached.
2. Lengthening a sentence and re-running the voice step moves every later beat, with no time edited
   by hand.
3. Rendering the same script twice on the same machine produces identical frame hashes.
4. Fault injection is caught with a message that names the fix: a misspelt target, a target off
   screen, a blank page, a thrown error.
5. Claude Code, given only the skill, produces a tour of a second example screen that passes
   `verify`, unattended. Keep the transcript.
6. The SwiftCause GASDS tour is re-made with Tourwright at parity with the Remotion version. Only
   then does `tools/walkthrough` get deleted there.
7. A 60-second tour renders within an agreed budget on a laptop. Measure first, then set the number.
8. No em dashes or en dashes anywhere in the repo.

## v0.2

Page scenes for real end-to-end flows, countables, captions, mid-sentence cues (estimated and
marked as such), setup actions before a shot, more highlight styles, parallel rendering, a preview
command, a Vite example.

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
