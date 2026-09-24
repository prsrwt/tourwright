---
name: walkthrough
description: Script, check, verify and render a narrated walkthrough video of this app's real React components with Tourwright. Use this whenever someone asks for a demo video, product tour, screen walkthrough, explainer or onboarding video, or "a video showing how X works", or wants to change an existing walkthrough's narration, camera moves, highlights or timing. Also use it when touching files under tourwright/.
---

# Walkthrough videos

Tourwright turns one file, `script.json`, into a narrated MP4 of the app's real components. You write the narration and mark where things should happen; the tool speaks it, times every camera move and highlight against the spoken words, and renders the video. You never write seconds or frame numbers: each scene lasts as long as its narration plus a short tail.

You cannot watch the video, so the tool turns everything worth checking into text and one image: a timing table, a description of what is on screen at each still, and a contact sheet of stills. The loop is: write, `check`, `verify`, read the report, fix, repeat. Render only when verify is clean.

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
| `tourwright/out/<name>/` | `report.json`, `timing.md`, `screen.md`, `contact-sheet.png` and `stills/` from verify |

## Commands

| Command | What it does |
| --- | --- |
| `npx tourwright new <name>` | Create `tourwright/walkthroughs/<name>/script.json` from a template |
| `npx tourwright check <name>` | Validate the script: schema, cues, beats, writing rules. Fast; no browser |
| `npx tourwright verify <name>` | Voice the narration, render a still at every beat, and check each against the live page |
| `npx tourwright describe <name>` | Say in words what is on screen once each beat has settled, or at one moment with `--at <seconds>`: how much of the frame each target fills and whether it is cut off, the highlight and the text inside it, the caption and the stage's values |
| `npx tourwright render <name>` | Render the MP4 |
| `npx tourwright make <name>` | Check and verify, then render only if every still passes |
| `npx tourwright doctor` | Report ffmpeg, the browser and the voice, with the fix for anything missing |
| `npx tourwright inspect <stage>` | List a stage's targets, every component it renders with each prop's type and what the stage passes, and the props that could move |
| `npx tourwright studio <name>` | Open the walkthrough in the browser: play it with narration, edit beats and narration, and leave notes pinned to moments |
| `npx tourwright notes <name>` | List the open notes left in the studio, each with its time, scene and the sentence being spoken |
| `npx tourwright scaffold <page-file>` | Draft a stage from a page component: its sections in order, each a target, with typed placeholder fixtures, in `tourwright/scaffold/` |

Add `--json` to `check`, `verify`, `describe` or `notes` for machine-readable output. Add `--fake-voice` to `verify`, `describe`, `render` or `make` to iterate without the voice model: narration is silent, but its timing is realistic, so stills and timing reports are still meaningful. Use the real voice for the final render.

## The workflow

Work through these in order. Each step says how you know it is done.

1. **Pin down the brief.** One screen per video, one job per video ("how to read the weekly dashboard", not "everything on the dashboard"). Establish who is watching, what they already know, and the features the video must show. Done when you can say in one sentence what the viewer will be able to do afterwards, and you have the list of must-show features. Ask the user for anything you cannot tell from the code.
2. **Understand the screen and classify every part.** If a stage exists, run `npx tourwright inspect <stage>`: it lists every component with its props' real types and flags what could move, so plan from that rather than guessing. Read the components themselves and, where they exist, their tests and docs, then sort every section into **Explain**, **Mention** or **Skip** (see "Deciding what to explain"). For each Explain part, look for what can move: a quantity that can count up or fill a meter, a status that can advance, a switch that can flip (see `references/stages.md`, "Making parts move"). Done when each part has a level and a one-line reason, and each Explain part has its animation or a reason it has none.
3. **Draft the storyboard, and get it approved. Do not write beats before this.** Show the user a table: for each scene, what it shows, why it matters to the viewer, its level, what moves (if anything), and roughly how many seconds. Wait for their answer and apply their corrections. This is where a misunderstanding of the product is cheapest to fix. Done when the user has approved it.
4. **Find or build the stage.** Open `tourwright/stages.tsx`. If a stage renders the screen, use it. If not, start from `npx tourwright scaffold <the page component's file>`, which drafts one from the page's own sections, then replace its placeholders with fictional fixtures and read `references/stages.md`. Done when the stage renders the real components with fixtures and every part the storyboard shows is a target.
5. **Scaffold:** `npx tourwright new <name>` with a short kebab-case name, such as `weekly-dashboard`.
6. **Write the narration** as plain `say` text first, with no cues or beats, following the storyboard's scenes and seconds. Aim for about 140 words a minute. Done when every sentence passes `references/narration.md`.
7. **Mark cues and add beats.** Put a `[cue]` at the start of the sentence where something should happen on screen, then add a beat for it. See "Placing cues and beats".
8. **Check:** `npx tourwright check <name>`. Fix every error. Read every warning and fix it unless you can say why it is fine.
9. **Verify:** `npx tourwright verify <name>`. Fix every error, then do the checks in "Verifying" below, including coverage. Repeat from step 6 or 7 as needed.
10. **Make:** `npx tourwright make <name>` with the real voice. It verifies again, then renders.
11. **Hand over** the MP4 path, the script path, the total duration and anything you were unsure about, such as a pronunciation you worked around with the lexicon.

## Studio notes

The user can review a walkthrough in `npx tourwright studio <name>` and leave notes pinned to exact
moments. They live in `tourwright/walkthroughs/<name>/notes.json` beside the script. When the user
asks you to handle them ("check the studio notes", "fix my notes"):

1. Run `npx tourwright notes <name>`. Each open note has its time to the millisecond, its frame,
   the scene (with its index in `script.json`) and the sentence being spoken, so you know exactly
   which beat or sentence it is about.
2. **Understand the moment before you change anything.** Under each note is what was on screen
   when it was written: what the camera showed, the highlight and the text inside it, the caption
   and the stage's values. Read it to see what the user was looking at. For a note without one, run
   `npx tourwright describe <name> --at <seconds>` with the note's time.
3. Make the change in `script.json` (or the stage, if the note is about what is on screen), then
   verify, and check in `screen.md` that the still nearest the note now shows what the note asked for.
4. In `notes.json`, set that note's `"status"` to `"done"` and add a one-line `"resolution"` saying
   what you changed. The studio shows it to the user straight away. If you disagree with a note,
   leave it open and say why in the `"resolution"`.

Edits made in the studio are written to `script.json` too. If the user has the studio open, it
reloads when you change the file, so you both always see the same script.

## Deciding what to explain

A demo fails in two ways: it skips what the viewer needed, or it spends their attention on what they did not. Before writing anything, give every part of the screen one of three levels.

| Level | What belongs here | How it is shown |
| --- | --- | --- |
| **Explain** | New to this viewer, affects money or decisions, or easy to get wrong. The reason the screen exists. | Its own scene: two or three sentences, the camera zooms in, the highlight names it |
| **Mention** | Needed for context, but familiar or self-explanatory: filters, pickers, standard tables | One sentence, a highlight at most, usually no zoom |
| **Skip** | Standard chrome (sidebars, headers, settings links) and anything that does not serve this video's job | Not shown on its own. It can stay in a wide shot. |

Rules, from research on how people learn from narrated video:

- **Show a thing when it is named** (temporal contiguity). This is what cues are for: never describe something the camera has already left, or zoom to something before it is mentioned.
- **Point at what you talk about, and only that** (signalling). One highlight at a time, on what the current sentence names. Clear it when the narration moves on.
- **Leave out what does not serve the goal** (coherence). A Skip item that gets a scene of its own dilutes the ones that matter.
- **One idea per scene** (segmenting). If a scene needs "and also", split it.
- **Name the key terms before the details that use them** (pre-training). Say what GASDS is before showing the GASDS total; say what "overdue" means before counting overdue tasks.
- **Spend time in proportion to importance.** Explain items get most of the seconds. If a Mention item takes longer than an Explain item, the storyboard is upside down.

Verify backs these up with pacing warnings: camera moves too close together, scenes too long or too short, highlights that linger, and a video that zooms in before showing the whole screen.

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
2. **Read `screen.md`, then look at the contact sheet.** `tourwright/out/<name>/screen.md` says, for every still, what the camera shows (each target's share of the frame, and anything cut off at an edge), what is highlighted and the text inside it, the caption and the stage's values. Read it first: it tells you what each still shows without guessing from pixels. Then open `tourwright/out/<name>/contact-sheet.png`: every still, labelled `<scene>-<cue>` with its time. Each still is the frame where that beat's movement has settled. For each one, confirm that the target is the thing being talked about, the highlight outlines that element and not its neighbour or parent, the framing makes sense, and the caption (burned in by default) reads correctly and does not hide what the narration is about. Open a still in `stills/` at full size if the sheet is too small to judge.
3. **Timing lands on the words.** Open `tourwright/out/<name>/timing.md`. For each cue it shows the words heard around it, with `**[here]**` where the cue lands. Confirm each one is where you meant.
4. **Duration is sensible.** The total is at the top of `timing.md`. A "60-second" video between 50 and 75 seconds is fine.
5. **Coverage.** Go through the brief's must-show features one by one and name the still where each appears. A feature with no still is missing, however good the rest looks. Check the seconds too: each Explain item should have more time than any Mention item.
6. **No real data.** Every name, amount and reference on screen comes from fixtures. If anything looks real, stop and find out where it came from.
7. **After make,** confirm `tourwright/out/<name>.mp4` exists and its duration matches the timing report.

What verify checks for you, so you know what an error means:

| Error | What it means |
| --- | --- |
| `"x" is not a stage` / `is not a target` | A name is misspelt or not registered. The message lists the valid ones and the likely fix. |
| `cut off by the frame` | The camera's zoom is too tight for the target, or a highlight is on something the camera is not showing. |
| `is blank` | The still is almost all one colour: the stage rendered nothing, or the camera framed empty space. |
| `threw while rendering` / `Console error` | The stage or a component failed. Fix the fixtures or the stage, not the script. |

And its pacing warnings, each of which has legitimate exceptions, so fix it or say why not:

| Warning | What it means |
| --- | --- |
| `The camera moves to "x" only 0.4 s after settling` | The viewer had no time to take in the last view. Say more about it first, or drop a move. |
| `lasts 31.2 s` / `lasts only 2.1 s` | The scene holds more than one idea, or flashes past. Split or merge it. |
| `highlight on "x" stays on through 3 more sentences` | The narration moved on but the screen is still dimmed around the old target. Clear or move the highlight. |
| `zooms to "x" straight away` | The video never showed the whole screen, so the viewer does not know where they are. Open wide. |
| `the caption covers 35% of target "x"` | Frame the target higher, or move captions to the top. |
| `The narration names "Export report", but no such text is on screen` | A label named in quotes or after "use", "select", "open" and similar is not on the page while it is said. Say what the screen says; the fix suggests the nearest real label. |

## Things not to do

- Don't copy an app component into a stage, and don't draw fake UI over a real one. Stages render the real components. If a stage needs something new, change its composition or fixtures.
- Don't write durations, frame numbers or seconds in a script. If timing looks wrong, move the cue or rewrite the sentence.
- Don't animate with JavaScript timers (`setTimeout`, `setInterval`, `requestAnimationFrame` loops) or `Date.now` in a stage. Rendering is frame by frame with the clock frozen, so they never fire. To make something move, use a stage value (see `references/stages.md`). The app's own CSS transitions and animations are fine: Tourwright plays them by the frame.
- Don't hide or unmount parts of the app to get a tighter shot. Zoom instead.
- Don't commit anything under `tourwright/out/`. It is build output.
