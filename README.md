# Tourwright

Narrated walkthrough videos of your app's **real React components**. You write one script; the tool
speaks it, moves a camera and a narration box (an outline on whatever is being talked about) around your own UI, and renders an MP4.

Everything runs locally: the voice is a model on your machine, and nothing is uploaded.

> Status: pre-v0.1, in development. See `docs/ROADMAP.md`.

**[Watch the introduction: Tourwright and Muse, from install to the final video](docs/media/tourwright-intro.mp4)** (3 minutes). Made with Tourwright, and reviewed and approved in Muse.

**[Watch the setup walkthrough](docs/media/setup.mp4)** 


https://github.com/user-attachments/assets/d119e1e4-0926-449d-ae5f-e00f2badd022


## First run

In a React app (Next.js, or Vite with React), with Node 22.18 or later:

```bash
npm install -D tourwright
npx tourwright init                               # config, a starter stage, an intro script, the agent skill
npx playwright install --only-shell chromium      # once per machine
npx tourwright make intro                         # -> tourwright/out/intro.mp4
```

`init` prints these steps too, and adds `npm install -D ffmpeg-static` if it finds no ffmpeg.
`npx tourwright doctor` reports anything missing, with the command that fixes it. The CLI also
answers to `walkthrough`.

Every video has captions of the narration, burned in by default so they show in Slack, on GitHub
and anywhere else a video plays muted. `make` also writes `<name>.vtt` next to the MP4, for web
pages that add subtitles with a `<track>`. For switchable subtitles instead, set
`"captions": { "mode": "soft" }`, which puts them inside the MP4 as a subtitle track.

### What gets downloaded, and where

| What | Size | When | Where it is kept |
| --- | --- | --- | --- |
| Headless Chromium (Playwright) | about 115 MB | `npx playwright install --only-shell chromium` | Playwright's cache: `%LOCALAPPDATA%\ms-playwright` on Windows, `~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS |
| Kokoro voice model, `fp32` (the default) | about 326 MB | the first `verify`, `render` or `make` | `%LOCALAPPDATA%\tourwright\models`, `~/.cache/tourwright/models` or `~/Library/Caches/tourwright/models`; `TOURWRIGHT_CACHE` overrides it |
| Kokoro voice model, `q8` (`"dtype": "q8"` in a script's voice settings) | about 92 MB | as above | as above |
| ffmpeg, only if you have none on the PATH | about 80 MB | `npm install -D ffmpeg-static` | the app's `node_modules` |

The model is shared by every app on the machine. Narration audio is cached per sentence in
`tourwright/out/.cache/voice`, so only changed sentences are spoken again.

Add `--fake-voice` to `verify`, `render` or `make` to work without the model: narration is
silent, but its timing is realistic, so checks and stills still mean something. In CI, the
environment variable `TOURWRIGHT_VOICE=fake` does the same.

The model download resumes where it stopped if the connection drops, and a file is only used
once its size matches the server's, so a flaky network costs time but never leaves a broken model.

### npm install-script warnings

npm 11 lists packages whose install scripts it has not been told to trust. Installing Tourwright
names `onnxruntime-node`, `sharp` and `protobufjs` (from the voice model's runtime), and
`ffmpeg-static` if you add it. The voice runs without any of them being approved. `ffmpeg-static`
downloads its binary in its install script; if `doctor` reports ffmpeg missing after installing it,
run `npm approve-scripts ffmpeg-static` and then `npm rebuild ffmpeg-static`, or install ffmpeg
itself.

### Trying it without changing package.json

To try Tourwright in an app without adding it to `package.json`, install everything in **one**
command: `npm install --no-save` removes anything an earlier `--no-save` install added.

```bash
npm install --no-save tourwright ffmpeg-static
```

## Commands

| Command | What it does |
| --- | --- |
| `init` | Set up Tourwright in this app. Never overwrites a file. |
| `new <name>` | Create a walkthrough from a template. `--from-stage <stage>` drafts its scenes, cues and beats from what the stage renders, leaving only the narration to write |
| `check <name>` | Validate a script: schema, cues, beats, writing rules. No browser. `--fix` applies the fixes that have exactly one right answer |
| `verify <name>` | Render a still at every beat and check each against the live page. Writes a report, a timing table, a description of each still and a contact sheet, and says which stills changed since the last run. `--fix` also corrects misspelt stage and target names |
| `describe <name>` | Say in words what is on screen at every beat, or at one moment with `--at <seconds>`: what the camera shows, the narration box and its text, the caption and the stage's values |
| `render <name>` | Render the MP4 |
| `make <name>` | Check and verify, then render only if every still passes, then open Muse in the browser to review it. `--no-review`, or `"review": false` in the config, leaves it closed; in CI, or with no screen, it prints the link or command instead. `--require-approval` renders only a version the user has approved in Muse |
| `doctor` | Report ffmpeg, the browser and the voice. `--voice` downloads the model and speaks a test sentence. |
| `muse <name>` | Open Muse, the review page, in a browser tab (`studio` works too): play it with narration and captions (at any speed, a scene on loop, or scene by scene), click a target to move the camera or narration box to it, put a narration box on anything (a target, or a box you draw) and time it by dragging its edges on a track under the scrubber, edit beats and narration, leave notes for the agent pinned to the millisecond (or on a clicked target), talk each one through with the agent (filter them by whose turn it is, reword, reopen or delete them), approve the video, and render the final video with the real voice (Muse asks once you approve, saying what is still in progress) |
| `notes <name>` | List the notes left in Muse by status, questions first, with their threads, and whether the current version is approved |
| `reply <name> <id>` | Answer a note left in Muse: `--fixed "what changed"` or `--question "what you need to know"`. Only the user closes a note |
| `wait <name>` | Wait until the user approves the video in Muse, asks for changes or answers the agent's question, then say what to do next. Exits 0 when approved, 2 with feedback to handle, 3 after `--timeout <seconds>` (540 by default, 0 for no limit). This is how an agent learns the video is finished and moves on |
| `inspect <stage>` | List a stage's targets, its components' props with their real types, and which could move in a video |
| `scaffold <page-file>` | Draft a stage from a page component's own sections, with typed placeholder fixtures |

## Why

A screen recording is out of date the moment the UI changes. Tourwright renders from your
components, so a video can be regenerated whenever they do.

## How it works

`docs/ARCHITECTURE.md` has the pipeline and the decisions behind it. In short: your stages are
bundled with Vite, a player page renders them frame by frame, a stepper drives the browser and
pipes frames to ffmpeg, and the narration's own length decides how long each scene lasts.

## For agents

`skill/` holds the `walkthrough` skill: how to write a script, run the checks and verify the
result from a timing report and a contact sheet of stills. `init` copies it into a project's
`.claude/skills/`.

## Developing

```bash
npm install
npx playwright install --only-shell chromium
npm run typecheck && npm test
npm run build                                  # the example app uses the built package
cd examples/next-app && npx tourwright make intro --fake-voice
```

## Licence

MIT for this code. Kokoro's model weights are Apache-2.0; ffmpeg runs as a separate binary. See
`docs/ARCHITECTURE.md` for the licence questions still open before release.
