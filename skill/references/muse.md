# Muse: notes and review

Read this when the user asks you to handle their notes, or before you hand a video over.

The user reviews a walkthrough in Muse, a page in their browser. `make` opens it by itself after a
successful render, and `npx tourwright muse <name>` opens it at any time. A Muse that make started
closes itself 10 minutes after its tab is closed, and make reuses one that is still open. There the
user leaves notes pinned to exact moments, and approves the whole video (or asks for changes) once
they are happy with it. Notes live in `tourwright/walkthroughs/<name>/notes.json` and the video's
review in `review.json`, both beside the script.

Each note has a `"status"` that says whose turn it is:

| Status | Meaning | Whose turn |
| --- | --- | --- |
| `open` | The user wants something changed, or has answered your question | Yours |
| `question` | You asked the user something in a reply | The user's |
| `fixed` | You made the change and said what you did | The user's: they approve it or send it back |
| `closed` | The user approved the fix | Nobody's |

A note also has a `"scope"`: `moment` (the time it is pinned to, the default), `scene` (the whole
scene) or `all` (the whole video). It may name a `"target"` the user clicked in the preview, with
its `"rect"` on screen in layout pixels, so you know exactly which element they meant. Its
`"replies"` are the conversation so far, oldest first.

When the user asks you to handle notes ("check my notes in Muse", "fix my notes"):

1. Run `npx tourwright notes <name>`. It lists the notes by status: questions still waiting on the
   user first, then the open notes (yours to handle), then fixed and closed ones. Each has its time
   to the millisecond, its frame, the scene (with its index in `script.json`), its scope and target,
   the sentence being spoken and its replies. The top line says where the video's review stands.
2. **Understand the moment before you change anything.** Under each note is what was on screen
   when it was written: what the camera showed, the highlight and the text inside it, the caption
   and the stage's values. Read it to see what the user was looking at. For a note without one, run
   `npx tourwright describe <name> --at <seconds>` with the note's time.
3. **Handle each `open` note.** Read the whole thread: the latest reply from the user may change
   what the note asks for. A `scene` or `all` note may need the same change in several places.
4. **If you are unsure what the user wants, ask rather than guess:**
   `npx tourwright reply <name> <id> --question "one clear question"`. Do not change the script for
   that note yet.
5. Otherwise make the change in `script.json` (or the stage, if the note is about what is on
   screen), then verify, and check in `screen.md` that the still nearest the note now shows what the
   note asked for.
6. **Record what you did:** `npx tourwright reply <name> <id> --fixed "Zoomed to 2x on the stat
   cards at the cards cue."` It adds your reply and marks the note fixed; Muse shows it at once.
   Use it rather than editing `notes.json` by hand.
7. **Only the user closes a note**, by approving it in Muse; `reply` refuses a closed one. Leave
   `fixed` and `question` notes alone unless the user replies again, which moves the note back to
   `open`. If you disagree with a note, say why with `--question`.

**The video is finished only when the user has approved it.** `review.json` records the user's
verdict with a `scriptHash` of the `script.json` it was given for, and it counts only while that
hash matches the current script: any edit afterwards, yours included, means the user must look
again. `notes` and `make` print where it stands. Never write `review.json` yourself, and never call
a video finished, or hand it over as final, until it says the current script is approved. If the
review asks for changes, its comment is a note about the whole video: handle it like one, then ask
the user to review again.

## Waiting for the user's decision

After you hand a video over, run `npx tourwright wait <name>`. It returns as soon as the user does
something that needs you, says what happened and what to do next, and its exit code says which:

| Exit | What happened | What you do |
| --- | --- | --- |
| 0 | The user approved the current version | The video is finished. If it says the MP4 is older than the approved script (they edited in Muse), render the final cut with `make <name> --require-approval --no-review`. Tell the user it is done, then carry on with the rest of your task. Don't ask them to review it again |
| 2 | They asked for changes, or answered one of your questions | Run `notes <name>`, handle the open notes as above, `make` it again, then `wait` again |
| 3 | Nothing yet, after `--timeout` (540 s by default, just under the longest command Claude Code runs) | Run `wait` again. Run it in the background if your tools can, so you can keep talking to the user |

If the video is already approved, `wait` returns 0 at once, so it is always safe to run. A request
for changes the user made before you started waiting does not end the wait: that one you have
already seen. Notes on their own don't end it either, because the user may still be adding them;
it ends when they press "Request changes" or approve.

Edits made in Muse are written to `script.json` too. If the user has Muse open, it
reloads when you change the file, so you both always see the same script.
