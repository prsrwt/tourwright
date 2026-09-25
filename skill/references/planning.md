# Planning a walkthrough

Read this before drafting the storyboard (what to explain) and before placing cues and beats.

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
