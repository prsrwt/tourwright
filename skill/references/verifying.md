# Verifying

What each check means, in full. The short version is in SKILL.md; read this when verify reports something you do not understand, or before you call a walkthrough done for the first time.

Don't report a walkthrough as done until all of these hold.

1. **Verify is clean.** `npx tourwright verify <name>` shows no errors, and any warning left has a reason you can state.
2. **Read `screen.md`, then look at the contact sheet.** `tourwright/out/<name>/screen.md` says, for every still, what the camera shows (each target's share of the frame, and anything cut off at an edge), where the narration box is and the text inside it, the caption and the stage's values. Read it first: it tells you what each still shows without guessing from pixels. Then open `tourwright/out/<name>/contact-sheet.png`: every still, labelled `<scene>-<cue>` with its time. Each still is the frame where that beat's movement has settled. For each one, confirm that the target is the thing being talked about, the highlight outlines that element and not its neighbour or parent, the framing makes sense, and the caption (burned in by default) reads correctly and does not hide what the narration is about. Open a still in `stills/` at full size if the sheet is too small to judge.
3. **Timing lands on the words.** Open `tourwright/out/<name>/timing.md`. For each cue it shows the words heard around it, with `**[here]**` where the cue lands. Confirm each one is where you meant.
4. **Duration is sensible.** The total is at the top of `timing.md`. A "60-second" video between 50 and 75 seconds is fine.
5. **Coverage.** Go through the brief's must-show features one by one and name the still where each appears. A feature with no still is missing, however good the rest looks. Check the seconds too: each Explain item should have more time than any Mention item.
6. **No real data.** Every name, amount and reference on screen comes from fixtures. If anything looks real, stop and find out where it came from.
7. **After make,** confirm `tourwright/out/<name>.mp4` exists and its duration matches the timing report.

What verify checks for you, so you know what an error means:

| Error | What it means |
| --- | --- |
| `"x" is not a stage` / `is not a target` | A name is misspelt or not registered. The message lists the valid ones and the likely fix. |
| `cut off by the frame` | The camera's zoom is too tight for the target, or the narration box is on something the camera is not showing. |
| `is blank` | The still is almost all one colour: the stage rendered nothing, or the camera framed empty space. |
| `threw while rendering` / `Console error` | The stage or a component failed. Fix the fixtures or the stage, not the script. |

And its pacing warnings, each of which has legitimate exceptions, so fix it or say why not:

| Warning | What it means |
| --- | --- |
| `The camera moves to "x" only 0.4 s after settling` | The viewer had no time to take in the last view. Say more about it first, or drop a move. |
| `lasts 31.2 s` / `lasts only 2.1 s` | The scene holds more than one idea, or flashes past. Split or merge it. |
| `narration box on "x" stays on through 3 more sentences` | The narration moved on but the screen is still dimmed around the old target. Clear or move the narration box. |
| `zooms to "x" straight away` | The video never showed the whole screen, so the viewer does not know where they are. Open wide. |
| `the caption covers 35% of target "x"` | Frame the target higher, or move captions to the top. |
| `The narration names "Export report", but no such text is on screen` | A label named in quotes or after "use", "select", "open" and similar is not on the page while it is said. Say what the screen says; the fix suggests the nearest real label. |
