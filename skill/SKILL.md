---
name: walkthrough
description: Script, check, verify and render a narrated walkthrough video of this app's real React components with Tourwright. Use this whenever someone asks for a demo video, product tour, screen walkthrough, explainer or onboarding video, or "a video showing how X works", or wants to change an existing walkthrough's narration, camera moves, highlights or timing. Also use it when touching files under tourwright/.
---

# Walkthrough videos

Tourwright turns one file, `script.json`, into a narrated MP4 of the app's real components. You write the narration and mark where things should happen; the tool speaks it, times every camera move and highlight against the spoken words, and renders the video. You never write seconds or frame numbers: each scene lasts as long as its narration plus a short tail.

You cannot watch the video, so the tool turns everything worth checking into text and one image: a timing table and a contact sheet of stills. The loop is: write, `check`, `verify`, read the report, fix, repeat. Render only when verify is clean.

Reference files, read when you reach the step that needs them:

- `references/script-schema.md`: every field of `script.json`, the settings and their defaults, and a complete example. Read before writing beats.
- `references/stages.md`: how stages and targets work, and how to add them. Read if the screen has no stage yet, or you need a target that does not exist.
- `references/narration.md`: how to write narration that sounds right when spoken. Read before writing narration.

## Where things live

| Path | What it is |
| --- | --- |
| `tourwright.config.mts` (or `.ts`) | Config: preset, folders, voice backend |
| `tourwright/stages.tsx` | Stages: the app's real components with fixture data, and their targets |
| `tourwright/walkthroughs/<name>/script.json` | One walkthrough |
| `tourwright/out/<name>.mp4` | The rendered video |
| `tourwright/out/<name>/` | `report.json`, `timing.md`, `contact-sheet.png` and `stills/` from verify |

## Commands

| Command | What it does |
| --- | --- |
| `npx tourwright new <name>` | Create `tourwright/walkthroughs/<name>/script.json` from a template |
| `npx tourwright check <name>` | Validate the script: schema, cues, beats, writing rules. Fast; no browser |
| `npx tourwright verify <name>` | Voice the narration, render a still at every beat, and check each against the live page |
| `npx tourwright render <name>` | Render the MP4 |
| `npx tourwright make <name>` | Check and verify, then render only if every still passes |
| `npx tourwright doctor` | Report ffmpeg, the browser and the voice, with the fix for anything missing |

Add `--json` to `check` or `verify` for machine-readable output. Add `--fake-voice` to `verify`, `render` or `make` to iterate without the voice model: narration is silent, but its timing is realistic, so stills and timing reports are still meaningful. Use the real voice for the final render.

## The workflow

Work through these in order. Each step says how you know it is done.

1. **Pick the screen and the story.** One screen per video, one job per video ("how to read the weekly dashboard", not "everything on the dashboard"). Done when you can say in one sentence what the viewer will be able to do afterwards.
2. **Find or build the stage.** Open `tourwright/stages.tsx`. If a stage renders the screen, use it. If not, read `references/stages.md` and add one. Done when the stage renders the real components with fixtures and every part you will talk about is a target.
3. **Scaffold:** `npx tourwright new <name>` with a short kebab-case name, such as `weekly-dashboard`.
4. **Write the narration** as plain `say` text first, with no cues or beats. Aim for about 140 words a minute. Done when every sentence passes `references/narration.md`.
5. **Mark cues and add beats.** Put a `[cue]` at the start of the sentence where something should happen on screen, then add a beat for it. See "Placing cues and beats".
6. **Check:** `npx tourwright check <name>`. Fix every error. Read every warning and fix it unless you can say why it is fine.
7. **Verify:** `npx tourwright verify <name>`. Fix every error, then do the checks in "Verifying" below. Repeat from step 4 or 5 as needed.
8. **Make:** `npx tourwright make <name>` with the real voice. It verifies again, then renders.
9. **Hand over** the MP4 path, the script path, the total duration and anything you were unsure about, such as a pronunciation you worked around with the lexicon.

## Placing cues and beats

A cue is a marker such as `[total]` written at the **start of a sentence**. A beat is an action tied to a cue: move the camera, move the highlight, or both. Two cues exist in every scene without being written: `start` (the scene's first frame) and `end` (when its narration finishes).

```json
{
  "stage": "dashboard",
  "say": "[cards]These cards count your open, completed and overdue tasks. [overdue]Overdue tasks are the ones to look at first.",
  "beats": [
    { "at": "cards", "camera": { "to": "stats", "zoom": "fit" }, "highlight": "stats" },
    { "at": "overdue", "highlight": "stat-overdue" }
  ]
}
```

A cue may only start a sentence, because sentence starts are the only times the voice knows exactly. If you want something to happen mid-sentence, split the sentence there. Each move starts slightly before its cue (0.4 seconds by default), so the viewer's eye is already moving when the words arrive.

Rules of thumb:

- **One camera move per sentence at most.** More than that feels frantic.
- **Open wide.** The first scene should show the whole stage (`"to": "all"`), so viewers see where the screen lives. Then zoom in to what is being discussed.
- **Highlight what you name, and only what you name.** Clear it (`"highlight": false`) when the narration moves on to something general, so the dimmed screen does not linger. An `end` beat is a good place.
- **Zoom so text stays legible.** `"zoom": "fit"` on a section is usually right. Verify warns when text in a target renders below 12 pixels.
- **Leave time to settle.** After a move, say a few more words about the thing you moved to before moving again.
- **Each cue has at most one beat.** Put the camera and the highlight on the same beat.

## Verifying

Don't report a walkthrough as done until all of these hold.

1. **Verify is clean.** `npx tourwright verify <name>` shows no errors, and any warning left has a reason you can state.
2. **Look at the contact sheet.** Open `tourwright/out/<name>/contact-sheet.png`: every still, labelled `<scene>-<cue>` with its time. Each still is the frame where that beat's movement has settled. For each one, confirm that the target is the thing being talked about, the highlight outlines that element and not its neighbour or parent, the framing makes sense, and the caption (burned in by default) reads correctly and does not hide what the narration is about. Open a still in `stills/` at full size if the sheet is too small to judge.
3. **Timing lands on the words.** Open `tourwright/out/<name>/timing.md`. For each cue it shows the words heard around it, with `**[here]**` where the cue lands. Confirm each one is where you meant.
4. **Duration is sensible.** The total is at the top of `timing.md`. A "60-second" video between 50 and 75 seconds is fine.
5. **No real data.** Every name, amount and reference on screen comes from fixtures. If anything looks real, stop and find out where it came from.
6. **After make,** confirm `tourwright/out/<name>.mp4` exists and its duration matches the timing report.

What verify checks for you, so you know what an error means:

| Error | What it means |
| --- | --- |
| `"x" is not a stage` / `is not a target` | A name is misspelt or not registered. The message lists the valid ones and the likely fix. |
| `cut off by the frame` | The camera's zoom is too tight for the target, or a highlight is on something the camera is not showing. |
| `is blank` | The still is almost all one colour: the stage rendered nothing, or the camera framed empty space. |
| `threw while rendering` / `Console error` | The stage or a component failed. Fix the fixtures or the stage, not the script. |

## Things not to do

- Don't copy an app component into a stage, and don't draw fake UI over a real one. Stages render the real components. If a stage needs something new, change its composition or fixtures.
- Don't write durations, frame numbers or seconds in a script. If timing looks wrong, move the cue or rewrite the sentence.
- Don't animate with the wall clock (`Date.now`, `setTimeout`, CSS transitions) in a stage. Rendering is frame by frame with the clock frozen, so anything time-based freezes.
- Don't hide or unmount parts of the app to get a tighter shot. Zoom instead.
- Don't commit anything under `tourwright/out/`. It is build output.
