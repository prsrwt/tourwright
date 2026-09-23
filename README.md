# Tourwright

Narrated walkthrough videos of your app's **real React components**. You write one script; the tool
speaks it, moves a camera and a highlighter around your own UI, and renders an MP4.

Everything runs locally: the voice is a model on your machine, and nothing is uploaded.

> Status: pre-v0.1, in development. See `docs/ROADMAP.md`.

```bash
npx tourwright init          # config, an example script, and the agent skill
npx tourwright make intro    # voice, render, verify -> out/intro.mp4
```

The CLI also answers to `walkthrough`.

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

## Licence

MIT for this code. Kokoro's model weights are Apache-2.0; ffmpeg runs as a separate binary. See
`docs/ARCHITECTURE.md` for the licence questions still open before release.
