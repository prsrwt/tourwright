# Muse: notes and review

Read this when the user asks you to handle their notes, or before you hand a video over.

The user reviews a walkthrough in Muse, a page in their browser. `make` opens it by itself after a
successful render, and `npx tourwright muse <name>` opens it at any time. A Muse that make started
closes itself 10 minutes after its tab is closed, and make reuses one that is still open. There the
user leaves notes pinned to exact moments, and either sends you their notes or approves the whole video
once they are happy with it. Notes live in `tourwright/walkthroughs/<name>/notes.json` and the video's
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
`"replies"` are the conversation so far, oldest first. A note that points at part of the screen
without a target is on a box the user drew around it, such as one button inside a banner: its
`"rect"` is that box, `"areaText"` the text inside it, and `"snippet"` a picture of exactly that part
(a PNG beside `notes.json`). `notes` and `wait` print all three; open the picture when the text
does not settle what they meant.

When the user asks you to handle notes ("check my notes in Muse", "fix my notes"):

1. Run `npx tourwright notes <name>`. It lists the notes by status: questions still waiting on the
   user first, then the open notes (yours to handle), then fixed and closed ones. Each has its time
   to the millisecond, its frame, the scene (with its index in `script.json`), its scope and target,
   the sentence being spoken and its replies. The top line says where the video's review stands.
2. **Understand the moment before you change anything.** Under each note is what was on screen
   when it was written: what the camera showed, the narration box and the text inside it, the caption
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
verdict with a hash of every file that version was made from (`script.json`, the stages file,
fixtures, the components they import, the config), and it counts only while none of them has
changed: any edit afterwards, yours included, to the script or the stage code, means the user must
look again. `notes` and `make` print where it stands and name the files that changed. Never write
`review.json` yourself, and never call a video finished, or hand it over as final, until it says
the current version is approved. If the
review asks for changes, its comment is a note about the whole video: handle it like one, then ask
the user to review again.

## Waiting for the user's decision

After you hand a video over, run `npx tourwright wait <name>`. It returns as soon as the user does
something that needs you, says what happened and what to do next, and its exit code says which:

| Exit | What happened | What you do |
| --- | --- | --- |
| 0 | The user approved the current version | The video is finished. If it says the MP4 is not the approved version (it was rendered before an edit, or with `--fake-voice`), render the final cut with `make <name> --require-approval --no-review`, with the real voice. Tell the user it is done, then carry on with the rest of your task. Don't ask them to review it again |
| 2 | They sent you their notes (the "Send notes to the agent" button), answered your question, said a fix is "Not fixed yet", or reopened a note | It prints those notes in full, as `notes` would: handle each as above from step 2, `make` it again, then `wait` again |
| 3 | Nothing yet, after `--timeout` (540 s by default, just under the longest command Claude Code runs) | Run `wait` again. Run it in the background if your tools can, so you can keep talking to the user |

If the video is already approved, `wait` returns 0 at once, so it is always safe to run. A request
for changes the user made before you started waiting does not end the wait: that one you have
already seen. Notes on their own don't end it either, because the user may still be adding them;
it ends when they send them to you or approve. Approving one of your fixes, or deleting a note, needs nothing from you, so it does not end the wait on its own; `wait` reports it with whatever does. A review's `"notes"` lists the ids they sent.

## Narration boxes the user placed

In Muse the user can put a narration box on something themselves: "Add narration box", then a
target or a box they draw, and drag its edges on the narration box track under the scrubber to
set when it shows and when it goes. Both edges snap to sentence starts. Each edit is written into
`script.json` as you would write it: a `[cue]` at the sentence where it starts (reusing one that is
there), a beat moving the narration box there, one where it ends putting back whatever showed
before, and a drawn box added to `areas` under a name made from its text (`area-overdue`). Cues
and beats the edit left unused are removed. `wait` lists these changes with whatever ends the wait.
They are the user's choices: keep them, and do not put your own narration box back over them unless
a note asks you to.

Edits made in Muse are written to `script.json` too. If the user has Muse open, it
reloads when you change the file, so you both always see the same script.
