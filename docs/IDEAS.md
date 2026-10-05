# Ideas: tours with little or no agent

Notes from a design conversation on 2026-09-29, kept for when this work starts. Nothing here is
built yet. The roadmap stays the source of truth for what is planned; move an idea there once it is
agreed.

## The goal

Make demo videos cost close to nothing per video. Rendering, the voice, `check` and `verify` are
already free: they run locally. What costs money is the agent.

## Where the cost goes today

The unattended Team run (`docs/agent-runs/team/`) took 33 turns, 229 s and $0.75 for one screen.
The agent is paying for four jobs that need judgement:

1. **Building the stage:** reading components, choosing targets, inventing fixtures. Probably the
   biggest share.
2. **The storyboard:** what to explain, mention or skip.
3. **Narration.** `new --from-stage` already drafts scenes, cues and beats, but leaves placeholders
   ("Say what list shows, and why it matters").
4. **The check, verify, read, fix loop.**

The principle: the agent is only needed where the tool has to guess. Tell it instead, and the agent
drops out.

## Idea 1: auto-labels, with no source edits

A label is a stable name for an element (`data-tour="TaskTable"`). Names can be derived without AI:

- every component's root element gets its component name;
- key elements inside (buttons, links, headings, form fields) get a name from their visible text or
  `aria-label`, for example `TaskTable/new-task-button`.

**How:** Tourwright already bundles stages with Vite, so a small Vite (Babel) plugin can stamp the
labels while bundling. The app's source never changes, and new components are labelled
automatically. Plugins that add component names to the DOM already exist; read them for the
approach.

**Alternative:** a codemod that writes the attributes into the `.tsx` files once, for teams that
want labels visible and committed. The TypeScript analysis behind `scaffold` and `inspect` is the
place to build it.

**Limits:**

- Components that render several root elements (fragments) need one wrapper.
- Third-party components that do not forward props cannot take the attribute.
- Repeated list items share a label; often fine, since a selector matching several elements already
  targets the box around all of them.

Labels would become targets, the same as `data-focus` today, and `inspect` would list them.

## Idea 2: one prompt describes every label, once

A name is not narration: "TaskTable" does not say why it matters. That needs understanding, but it
can be **one batch call, not an agent loop**:

> Here are the labels and each component's code. For each, one sentence: what it shows and why a
> user cares.

- The answers go into `tour-labels.json`, readable and editable by hand.
- Cache each entry by a hash of its component's code (the same trick as the per-sentence voice
  cache), so only new or changed components are sent again.
- Large apps: send in chunks.
- Which model: the user's local Claude Code (`claude -p`, no extra API cost) or an API key.
  Undecided.

## Idea 3: tours from the labels file

`new --from-labels "tour for new admins"` picks and orders labels and writes a finished
`script.json` with real narration, not placeholders. Then `check`, `verify` and `render` as usual.

Picking and ordering for a given audience is still a choice: the user makes it, or one more small
prompt does. Still no loop.

## Idea 4: optional inline narration

Let developers write the line themselves where they build the component:

```tsx
<section data-tour="capacity" data-tour-step="3" data-tour-say="Next to each person is a bar showing how full their week is.">
```

Open question: where narration should live.

- **(a) Inline** in `data-tour-say`: one place, simplest. But long text in JSX is clumsy, and one
  component cannot say different things in two tours.
- **(b) In the tour's `script.json`**, keyed by label: several tours per screen, same format as
  today.
- **Both** (suggested): inline as the default, the script overrides it.

## Idea 5: record by demoing

The laziest authoring: use the app normally in a visible browser window and talk while clicking,
like recording a Loom.

- Each click becomes a target and a beat.
- Speech is transcribed locally (Whisper), split into sentences, with a cue where each click
  happened.
- The result is an ordinary `script.json`, rendered with the Kokoro voice, deterministic, and
  re-rendered whenever the UI changes. At most one AI call to tidy "umm, so, here you can" into
  clean narration.

It records a running app, so it needs **page scenes** (roadmap v0.2) first. A `tourwright record`
command can open a headed Playwright browser and inject the click overlay (`npx playwright codegen`
already records clicks as selectors), so no extra app is needed.

**Ben**, the user's desktop browser (Tauri, `C:\dev\ben`), could host this
instead: it can inject scripts into any page and use the microphone directly. The saving is the
same either way. The deciding question is product, not technical: Ben is meant to be a calm study
browser, and a developer tool pulls it away from that.

## What none of this removes

- **Stage fixtures** stay the biggest cost until page scenes exist. Labels do not invent data.
- **Muse review** stays: `verify` can say a video is correct, only the user can say it is right.

## Suggested order

1. **Auto-labels** (idea 1): free, no source edits, and everything below builds on it. Test:
   `inspect` on the example app lists every component.
2. **One prompt, one labels file** (idea 2). Test: run it, edit a line, run it again; only changed
   components are described again.
3. **Tours from labels** (ideas 3 and 4). Test: a full video of the Team screen with no agent loop.
4. **Page scenes, then record by demoing** (idea 5), as the headline feature of v0.2.

Expected result: about $0.75 and 33 agent turns per screen today, against nothing per video for a
labelled screen, plus one batch prompt per site, repeated only for new or changed components.
