---
name: walkthrough
description: Script, voice, render and verify a narrated product walkthrough video of a SwiftCause screen using the tool in tools/walkthrough (Playwright capture, kokoro voice, Remotion render). Use this whenever someone asks for a demo video, product tour, screen walkthrough, explainer video, onboarding video or "a video showing how X works" for any part of the app, or wants to edit an existing walkthrough's narration, camera moves, highlights or timing. Also use it when touching files under tools/walkthrough/public/walkthroughs/.
---

# Walkthrough videos

This skill turns a screen of the app into a short narrated MP4 for UK charity treasurers. You write one file, `script.json`. The tool speaks it, times every camera move and highlight against the spoken words, and renders the video. You never set durations by hand: each scene lasts as long as its narration plus a short tail.

All paths below are relative to `tools/walkthrough/` unless they start with `.claude/`, `docs/` or `src/app`.

Reference files, read when you reach the step that needs them:

- `references/script-schema.md`: every field of `script.json`, settings and defaults, and a complete 60-second example. Read before writing beats.
- `references/stages.md`: how staged scenes, focus targets and counting figures work, and how to add them. Read if the screen has no stage, or you need a target or countable that does not exist.
- `references/narration.md`: word lists for British spelling and phrases to avoid. Read before writing narration.

## Before you start

1. `cd tools/walkthrough && npm install` (the tool has its own package.json; never add its dependencies to the app).
2. Start the Firebase emulator with seeded data. Videos are only ever made against the emulator. Never point capture at a real project, and never type real charity, donor or bank details into a script, fixture or seed.
3. Microsoft Edge must be installed (capture uses Playwright's `msedge` channel).

## The workflow

Work through these in order. Each step says how you know it is done.

1. **Pick the screen and the story.** One screen per video, one job per video ("how to check and submit a GASDS claim", not "everything on the GASDS page"). Done when you can say what the viewer will be able to do afterwards in one sentence.
2. **Choose the scene kind** (next section). Done when you know whether you are using a stage or screenshots.
3. **Scaffold:** `npm run new -- <name>` creates `public/walkthroughs/<name>/script.json` from a template. Use a short kebab-case name, such as `gasds-claim`.
4. **Write the narration** as plain `say` text first, with no cues or beats. Read it aloud. Aim for about 140 words for 60 seconds. Done when every sentence passes the narration rules below.
5. **Mark cues and add beats.** Put `[cue]` markers in the narration exactly where something should happen on screen, then add a beat for each one. See "Placing cues and beats".
6. **Check:** `npm run check -- <name>`. Fix every error. Read every warning and fix it unless you can say why it is fine.
7. **Voice:** `npm run voice -- <name>`. This synthesises the narration and works out when each cue is spoken.
8. **Verify timing and framing:** `npm run stills -- <name>`, then read `out/<name>/timing.md` and look at every image in `out/<name>/stills/`. See "Verifying".
9. **Render:** `npm run render -- <name>`, which writes `out/<name>.mp4`. Or run `npm run make -- <name>` to check, voice and render in one go once the script is settled.
10. **Final check** of the MP4 (see "Verifying"), then hand it over with the script path and the timing report.

If the tool reports that the narration changed since the voice step, run the voice step again. Never edit the voice manifest by hand.

## Stage or screenshots?

There are two kinds of scene, and you can mix them in one video.

- **Stage** (`"stage": "<name>"`): the app's real React components rendered live with typed fixture data. The camera can move smoothly between any focus targets, the highlighter can outline any target, and figures can count up. This produces the best result.
- **Image** (`"image": "screens/<file>.png"`): a screenshot of the real app captured from the emulator by `npm run capture -- <name>`. The camera can pan and zoom, and the highlighter works on any target that capture recorded. Figures cannot count up, because a screenshot is just pixels.

Decision rule:

1. Run `npm run check -- --stages`. If a stage exists for your screen, use it.
2. If no stage exists, use screenshots. Do not build a stage just to make one video.
3. Build a new stage only if the team has asked for one, or the screen will get several videos, or a counting figure is essential to the story. Follow `references/stages.md`. It is a code change that goes through review like any other.

You can open on a screenshot of a screen that has no stage and move to a stage when the story reaches it. The camera resets to a full view at the cut.

## Writing narration

The audience is UK charity treasurers. Many are volunteers. They are careful with money and nervous about getting HMRC claims wrong, and they know what Gift Aid is but not how our software works. They want to know what a figure means and what to do next, not how the interface was built.

Rules:

- **Plain English.** Short sentences, one idea each, 20 words at most. Active voice. Talk to the viewer as "you" and to the charity as "your charity".
- **British spelling and usage**: organisation, recognise, programme, cheque, colour. See `references/narration.md`.
- **No em dashes or en dashes**, in narration, captions, script fields or code comments. Use a full stop or a comma. The voice also reads dashes badly.
- **Use the words on the screen.** If the button says "Export claim", say "Export claim", not "download the file". Viewers match what they hear to what they see.
- **Say what things mean, not where they are.** "This is the top-up you can claim" beats "In the top right is a number".
- **Don't give tax advice or promise compliance.** Describe what the platform calculates and what the treasurer should check. Say "the figure we calculate you can claim", never "you are entitled to". If a rule matters (for example the £30 limit per donation), state it plainly and briefly, and make sure it matches current HMRC guidance in the app's docs.
- **Spell out acronyms once**: "the Gift Aid Small Donations Scheme, or GASDS". If the voice mispronounces a word, add it to the script's `lexicon`. The captions still show the written form.
- **Say figures as they appear on screen**, and check how the voice reads them after the voice step.
- **Avoid** "simply", "just", "easily", "seamless", "click here", exclamation marks and filler openers ("In this video we will..."). Say what the screen is for, then show it.
- **Structure for about 60 seconds:** 5 to 7 scenes of 1 to 3 sentences. The first scene says what the screen is for. The last says what to do next.

Weak: "Now we'll simply click over to the GASDS tab where you'll see a bunch of info about your claim!"

Better: "This is the Gift Aid Small Donations Scheme page. It works out what your charity can claim on small donations that have no Gift Aid declaration."

Follow `docs/DESIGN.md` for tone. When the two disagree, the design doc wins and this skill should be updated.

## Placing cues and beats

A cue is a marker in the narration, such as `[claim]`, placed immediately before the word the viewer should be looking at when they hear it. A beat is an action tied to a cue: move the camera, move the highlight, or count a figure up. The tool starts each movement slightly before the cue so the viewer's eye is already moving when the word arrives. You never write seconds.

```json
{
  "stage": "gasdsPage",
  "say": "[total]This is the top-up you can claim. It is worked out from the collections listed [list]below it.",
  "beats": [
    { "at": "total", "camera": { "to": "claim-total", "zoom": "fit" }, "highlight": "claim-total", "count": "claimTotal" },
    { "at": "list", "camera": { "to": "collections", "zoom": "width", "align": "top" }, "highlight": "collections" }
  ]
}
```

Rules of thumb:

- **One camera move per sentence at most.** More than that feels frantic. The check step warns when moves are less than 1.5 seconds apart.
- **Put the cue before the noun that names the thing**: "the [claim]claim total", not "[claim]the claim total is shown".
- **Put cues that need precise timing at the start of a sentence.** The voice step knows sentence starts exactly and estimates positions inside a sentence (to within about 0.2 seconds). Counts and highlights on a key figure deserve an exact cue.
- **Highlight what you name, and only what you name.** Clear the highlight (`"highlight": false`) when the narration moves on to something general, so the dimmed screen does not linger.
- **Count only figures that matter to the story**, usually one per video. A count starts when the camera arrives, so pair it with a camera beat on the same cue.
- **Open wide.** The first scene should show the whole app, sidebar included, so viewers can see where the page lives and find it again. After that, zoom in to the section being discussed. The sidebar stays in the layout the whole time. Framing decides whether it is visible; never hide it or remove it.
- **Zoom so text stays legible:** `"zoom": "fit"` on a section is usually right. Past about 2x, screen text starts to look soft in a screenshot; stages stay sharp.
- **To show a long list, "scroll" by moving the camera:** `{ "to": "collections", "zoom": "width", "align": "top", "sweep": true }` pans from the top of the target to its bottom until the next beat.
- **The existing shorthand `"focus": "<target>"`** on a scene still works. It means a camera move at the start of the scene.

To see which targets and countables a stage offers: `npm run check -- --targets <stage>`. For screenshots, targets are whatever capture recorded (see `references/script-schema.md`, "Image scenes").

## Customising a walkthrough

Every visual and audio setting has a default and can be overridden per walkthrough in the `settings` block of `script.json`: highlight style and colour, camera easing, move duration and zoom limits, caption style, voice and speed, resolution, frame rate and compression. Change only what the video needs. The full list and defaults are in `references/script-schema.md`. Colours are token names from `docs/COLOR_SYSTEM.md`, not arbitrary hex values. Do not edit the tool's source to change how one video looks. If a setting you need is missing, that is a tool change for review, not a local hack.

## Commands

Run all of these from `tools/walkthrough/`.

| Command | What it does |
| --- | --- |
| `npm run new -- <name>` | Scaffold `public/walkthroughs/<name>/script.json` |
| `npm run check -- <name>` | Validate the script: schema, stage and target names, cues and beats match, writing rules, stale voice |
| `npm run check -- --stages` | List registered stages |
| `npm run check -- --targets <stage>` | List a stage's focus targets and countables |
| `npm run capture -- <name>` | Drive the app on the emulator and save screenshots and target boxes |
| `npm run voice -- <name>` | Synthesise narration and resolve cue times |
| `npm run stills -- <name>` | Render a still at every beat and write `out/<name>/timing.md` |
| `npm run render -- <name>` | Render `out/<name>.mp4` |
| `npm run make -- <name>` | Check, voice, then render |
| `npm run studio -- <name>` | Open Remotion Studio to scrub the video (for people; agents should use stills) |

## Verifying

Don't report a walkthrough as done until all of these hold.

1. **Check is clean.** `npm run check -- <name>` shows no errors, and any warnings you left have a reason you can state.
2. **Timing lands on the words.** Open `out/<name>/timing.md`. For each cue it lists the time and the words spoken around it. Confirm each cue sits on the word you meant. If a cue marked `estimated` is off by more than a word, move it to a sentence start or split the sentence.
3. **Every still shows the right thing.** Look at every image in `out/<name>/stills/`. Each is named `<scene>-<cue>.png` and shows the frame where that beat's movement settles. For each one, confirm:
   - the target is fully in frame and not cropped by the edge;
   - the highlight outlines the element being talked about, not its neighbour or parent;
   - screen text is legible;
   - counted figures show their final values in the settled still and the starting value in the scene's first still.
4. **Duration is sensible.** The check step prints the total after voicing. A "60-second" video between 50 and 75 seconds is fine.
5. **No real data.** Every name, amount and reference on screen comes from fixtures or the emulator seed. If you see anything that looks real, stop and find out where it came from.
6. **The MP4 plays through.** After rendering, confirm `out/<name>.mp4` exists and its duration matches the check step's total (for example with `npx remotion ffprobe out/<name>.mp4`). Listen to at least the first and last scenes.

When you hand over, give the script path, the MP4 path, the total duration and anything you were unsure about, such as a pronunciation you worked around.

## Things not to do

- Don't copy an app component into the tool, and don't draw fake UI over a real one. Stages render the real components. If a stage needs something new, change the stage composition or its fixtures (see `references/stages.md`).
- Don't set durations, frame numbers or seconds in a script. If timing looks wrong, move the cue or rewrite the sentence.
- Don't animate with wall-clock time (`Date.now`, `setTimeout`, CSS transitions, anime.js and similar). Remotion renders frame by frame, and anything not computed from the frame number will flicker or freeze.
- Don't add dependencies to the app's package.json.
- Don't hide or unmount the sidebar to get a tighter shot. Zoom instead.
- Don't commit rendered MP4s, WAVs or stills unless the team asks. They are build output.
