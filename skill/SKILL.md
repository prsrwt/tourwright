---
name: walkthrough
description: Script, check, verify and render a narrated walkthrough video of this app's real React components with Tourwright. Use this whenever someone asks for a demo video, product tour, screen walkthrough, explainer or onboarding video, or "a video showing how X works", or wants to change an existing walkthrough's narration, camera moves, highlights or timing. Also use it when touching files under tourwright/.
---

# Walkthrough videos

Tourwright turns one file, `script.json`, into a narrated MP4 of the app's real components. You write the narration and mark, with a `[cue]` at the start of a sentence, where the camera or highlight should move; the tool speaks it, times every move against the words and renders the video. You never write seconds or frame numbers.

You cannot watch the video, so everything worth checking comes back as text: what is on screen at each still (`screen.md`), where each cue lands in the words (`timing.md`), and errors with their fix. The loop is: write, `check`, `verify`, read, fix. Render only when verify is clean.

Read these when you reach the step that needs them, not before:

| File | When |
| --- | --- |
| `references/planning.md` | Before the storyboard (what to explain) and before placing cues and beats |
| `references/narration.md` | Before writing narration |
| `references/script-schema.md` | For any field of `script.json` or a setting you have not used yet |
| `references/stages.md` | If the screen has no stage, a target is missing, or something should move |
| `references/verifying.md` | When verify reports something unclear, or before calling a video done the first time |
| `references/muse.md` | When the user asks you to handle their notes, and before handing a video over |

## Where things live

| Path | What it is |
| --- | --- |
| `tourwright.config.mts` (or `.ts`) | Config: preset, folders, voice, and `review` (open Muse after make; default true) |
| `tourwright/stages.tsx` | Stages: the app's real components with fixture data, and their targets |
| `tourwright/walkthroughs/<name>/` | `script.json`, and the user's `notes.json` and `review.json` from Muse |
| `tourwright/out/<name>.mp4` | The rendered video |
| `tourwright/out/<name>/` | From verify: `screen.md`, `timing.md`, `report.json`, `contact-sheet.png`, `stills/` |

## Commands

| Command | What it does |
| --- | --- |
| `new <name> --from-stage <stage>` | Draft the scenes, cues and beats from what the stage renders; you write only the narration. Without `--from-stage`, a one-scene template |
| `check <name> [--fix]` | Validate the script, no browser. `--fix` applies the fixes with one right answer |
| `verify <name> [--fix]` | Render a still at every beat and check each against the page; says which stills changed since the last run |
| `describe <name> [--at <seconds>]` | What is on screen at every beat, or at one moment, as text |
| `inspect <stage>` | A stage's targets, its components' props and what could move |
| `scaffold <page-file>` | Draft a stage from a page component's own sections |
| `make <name>` | Check, verify, render, then open Muse for the user to review. `--require-approval` for the final video |
| `notes <name>` | The user's notes from Muse, questions first, and whether this version is approved |
| `reply <name> <id> --fixed "..."` | Answer a note (`--question "..."` to ask instead) |
| `wait <name>` | Wait until the user approves in Muse, asks for changes or answers your question. Exit 0: approved, finished. 2: feedback to handle. 3: still waiting |
| `muse <name>` | Open Muse, the review page, in the browser |
| `doctor` | Check ffmpeg, the browser and the voice, with the fix for anything missing |

All run as `npx tourwright <command>`. Add `--fake-voice` to `verify`, `describe` or `make` until the final render: the narration is silent but timed as it will be, and needs no voice model. Add `--json` for machine-readable output.

## Keep it cheap

Each turn and each file you read costs. The tool is built so you rarely need more than this:

- **Start from `new --from-stage`**, not a blank script: the scenes, targets, cues and beats are already right, and only the narration is left.
- **Run `check --fix` and `verify --fix`** before reading errors: typos with one right answer are fixed for you, and only what needs judgement is left.
- **Read `screen.md` before any image.** It says what each still shows. Open the contact sheet, or one still, only for something the text cannot settle (a colour, an overlap).
- **After an edit, read only what changed.** verify names the stills that changed since the last run, and `screen.md` marks each one; the rest are pixel for pixel the same.
- **Use `--fake-voice`** until the final `make`, and `describe --at <seconds>` rather than a new verify when you only need one moment.
- **Answer notes with `reply`**, never by editing `notes.json`.

## The workflow

1. **Pin down the brief.** One screen, one job per video. Who is watching, what they already know, and the features it must show. Ask the user what the code cannot tell you. Done when you can say in one sentence what the viewer will be able to do afterwards.
2. **Classify every part of the screen** as Explain, Mention or Skip (`references/planning.md`), using `inspect <stage>` and the components themselves. For each Explain part, note what could move (a count, a meter, a toggle). Done when each part has a level and a reason.
3. **Get the storyboard approved before writing beats.** Show the user a table: each scene, what it shows, why it matters, its level, what moves and roughly how many seconds. Apply their corrections.
4. **Find or build the stage** in `tourwright/stages.tsx`; if there is none, start from `scaffold` and `references/stages.md`. Done when every part the storyboard shows is a target.
5. **Draft:** `new <name> --from-stage <stage>`. Delete the scenes the storyboard does not need, and reorder if it says so.
6. **Write the narration** into each `say`, keeping each placeholder's `[cue]` at the start of its sentence (`references/narration.md`). About 140 words a minute.
7. **Adjust cues and beats** where the storyboard differs from the draft (`references/planning.md`).
8. **`check <name> --fix`.** Fix every error left; fix each warning or be able to say why it is fine.
9. **`verify <name> --fix --fake-voice`**, then the checks under "Verifying" below. Repeat from 6 or 7.
10. **`make <name>`** with the real voice. It verifies, renders, and opens Muse in the user's browser; its last lines say whether Muse opened, or give the link or command instead.
11. **Hand over** the MP4 path, the duration and anything you were unsure about. Tell the user Muse has opened in their browser (or give them the link or command), that there they can watch it, leave notes at any moment, and then either approve it or press "Request changes". It is not finished until they approve it (`references/muse.md`).
12. **`wait <name>`** to hear their decision, and act on what it says (`references/muse.md`). Approved (exit 0): the video is finished. Say so, render the final cut if it tells you to, and move on to what comes next without asking about this video again. Feedback (exit 2): handle the notes, `make` it again, and wait again. Still waiting (exit 3): run `wait` again, or stop if the user has said they will come back to it later.

## Verifying

Before calling a walkthrough done:

1. **verify is clean**: no errors, and a reason for each warning left.
2. **Each still shows what its sentence talks about**: read `screen.md` (the framing, what is cut off, the highlight and its text, the caption).
3. **Cues land on the right words**: `timing.md` marks each with `**[here]**`.
4. **The length is sensible**: the total is at the top of `timing.md`.
5. **Every must-show feature has a still**, and Explain parts get more time than Mention parts.
6. **Nothing on screen is real data**: every name and amount comes from fixtures.

`references/verifying.md` explains each error and warning verify can give.

## Things not to do

- Don't copy an app component into a stage, or draw fake UI over a real one. Stages render the real components; change their composition or fixtures instead.
- Don't write durations, frame numbers or seconds in a script. Move the cue or rewrite the sentence.
- Don't animate with timers (`setTimeout`, `setInterval`, `requestAnimationFrame`) or `Date.now` in a stage: the clock is frozen. Use a stage value (`references/stages.md`). The app's own CSS transitions are fine.
- Don't hide or unmount parts of the app for a tighter shot. Zoom instead.
- Don't write `review.json`, and never call a video finished until it approves the current script.
- Don't commit anything under `tourwright/out/`.
