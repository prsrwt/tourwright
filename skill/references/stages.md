# Stages and targets

A stage renders the app's real components with fixture data. Because it is live React rather than a screenshot, the camera can land anywhere and every frame is sharp. Read this file when you need a stage for a new screen, or a target that does not exist yet.

The golden rule: **stages compose real components; they never copy them.** If you find yourself re-creating markup, stop. You are drifting from the real app, and the next UI change will make the video lie.

## Starting a stage from a page

`npx tourwright scaffold src/views/admin/GasdsManagement.tsx` reads the page component with the
app's own TypeScript and drafts a stage in `tourwright/scaffold/`: the page's own section
components in page order, each wrapped in `data-focus`, layout wrappers kept around them, a typed
props object per component with placeholders of the right types, no-ops for handlers, a note of
what the page passes each prop, and the props that could move. UI primitives (buttons, dialogs)
and components defined inside the page are left out and listed. It then type-checks the draft and
lists the placeholders still to fill in.

The draft is a starting point, never a finished stage: replace every placeholder with fictional
data that tells the story, delete the sections the video does not need (conditional ones, such as
loading states, are marked with the condition the page shows them under), and add it to the
stages file. `npx tourwright inspect <stage>` then shows what you have.

Reading types needs the TypeScript compiler API, which TypeScript 7 (the native compiler) does not
have yet. An app on TypeScript 7 alone needs `npm install -D typescript@5` for these two commands.

## The stages file

`tourwright/stages.tsx` default-exports every stage:

```tsx
import { defineStages } from 'tourwright/stage';
import '@/app/globals.css'; // the app's global styles, so components look as they do in the app
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { dashboard } from './fixtures';

export default defineStages({
  dashboard: {
    render: () => (
      <AppShell team={dashboard.team} active="/">
        <div data-focus="stats">
          <StatCards stats={dashboard.stats} />
        </div>
        <div data-focus="tasks">
          <TaskTable tasks={dashboard.tasks} />
        </div>
      </AppShell>
    ),
    targets: {
      'stat-overdue': '[data-testid="stat-overdue"]',
      'status-column': '[data-testid^="status-"]',
    },
  },
});
```

Tourwright bundles this file with Vite, using the app's own `node_modules`, `tsconfig` path aliases and PostCSS config (so Tailwind works unchanged). There is no dev server to start, no database to seed and no login.

The stage renders at the video's width (1920 pixels by default) and its natural height, like a browser window that size. `"to": "all"` frames the whole of it.

## Adding a target

A target is a named element the camera and highlighter can find. There are two ways to declare one, in order of preference.

1. **Wrap a section in `data-focus`** in the stage's `render`:

   ```tsx
   <div data-focus="collections">
     <CollectionsSection {...fixtures.collections} />
   </div>
   ```

   The wrapper must not change the layout. A plain `div` with no styles is usually right.

2. **Point at an element inside a component with a selector** in the stage's `targets`, when you cannot wrap it:

   ```ts
   targets: { 'claim-total': '[data-testid="claim-total"]' }
   ```

   Use an existing `data-testid` or another stable attribute. If there is none, adding a `data-testid` to the app component is an acceptable small change; make it in its own commit. Never target by class names or position in the page; they break silently. A selector that matches several elements targets the box around all of them, which is how to highlight a table column.

Choose targets at the level the narration speaks about. The camera likes sections; the highlighter likes the specific thing being named. Every target must be visible in the fixture state without any clicking. When a name is wrong, verify lists every target the stage offers.

## Making parts move: values

A meter that fills, a total that counts up, a toggle that flips, a progress strip that walks
through its steps: these are the moments that make a demo feel alive, and they show the viewer
what the feature *does*, not just what it looks like. Tourwright animates them by giving the real
component different props on each frame. The component draws every in-between state itself, so
nothing is faked and the animation stays right when the component changes.

Declare the values in the stage with `defineStage`, then use them in `render`:

```tsx
import { defineStage, defineStages } from 'tourwright/stage';

export default defineStages({
  gasds: defineStage({
    values: {
      claimTotal: { from: 0, to: 1732.5, decimals: 2 },        // a number: eases from "from" to "to" once
      details: { steps: [false, true] },                       // a toggle: flips once
      progress: { steps: [null, 'claimed', 'paid'] },          // steps: moves on one step per beat
    },
    render: ({ claimTotal, details, progress }) => (
      <>
        <GasdsLimitCard thisClaim={claimTotal} advancedView={details} {...fixtures.limit} />
        <GasdsProgressSteps latestBatchStatus={progress} eligibleCount={300} />
      </>
    ),
  }),
});
```

A script then animates a value from a beat: `{ "at": "total", "camera": { "to": "claim" }, "animate": "claimTotal" }`.
See `script-schema.md` for the timing.

**Finding what can move.** While classifying the screen, look at each component's props for:

- **Quantities**: totals, counts, amounts, percentages, "used against a limit". A number value, usually from 0 (or a smaller earlier figure) to the fixture's value. A meter or progress bar fills because its prop grows.
- **Progressions**: status fields, step indexes, "latest batch status". A steps value with the states in order.
- **Switches**: booleans that change what is shown, such as an "advanced view" or "show details". A steps value `[false, true]`. The switch slides and the sections it reveals appear, because CSS transitions are played by the frame.

Animate what the narration is explaining (the Explain items), not everything that could move.
One animation per scene is usually right.

**When a value changes nothing.** If a component works a figure out from other props (it sums a
list of donations, say), animating a summary prop moves nothing. Verify warns: "changed nothing
on the page". Animate the inputs instead, for example by scaling the list's amounts with a 0 to 1
value, or do not animate that figure. Never paint a number over the real component.

**Toggles change the layout.** When a steps value reveals or hides sections, Tourwright measures
the stage in each state, so the camera and highlight find the new sections. Flip the value in an
earlier beat than the one that moves the camera to what it reveals; verify reports a target that
"is not on the page at this point" otherwise.

## Fixtures

Put fixture data in a file next to the stages, typed with the app's real interfaces, so a change to those interfaces fails the type check instead of the video:

```ts
import type { Dashboard } from '@/lib/types';

export const dashboard: Dashboard = { team: 'Riverside Design', stats: [/* ... */], tasks: [/* ... */] };
```

Use obviously fictional names and round numbers. Never paste data from a real account, even an anonymised one.

## Next.js apps

With the `next` preset, these modules are replaced by stage-safe stand-ins: `next/link` (an anchor that never navigates), `next/image` (a plain `img`), `next/navigation` and `next/router` (routing does nothing; the path is `/`), `next/head` (renders nothing) and `next/dynamic`. `process.env.NEXT_PUBLIC_*` variables are read from the app's `.env` files.

Server components that fetch data cannot be staged directly. Stage the client components they render, and pass them fixtures, as a page would.

## Things that break stages

- **Anything time-based inside components:** `Date.now()`, relative dates ("2 days ago"), timers, skeleton loaders. The clock is frozen at 15 January 2026 10:00 UTC while rendering, so a component that shows "today" shows that date on every frame. Timers never fire, so a component that waits on one stays in its waiting state. Pass fixed dates in fixtures.
- **Data fetching.** Stage components must get everything from props or stub providers. A component that fetches on mount needs its data layer stubbed.
- **Providers.** If a component needs a provider (theme, router, query client), wrap the stage in a stub provider. Don't copy the component.
- **Console errors.** Verify fails on any console error, including React warnings such as a missing `key`. They are real bugs; fix them in the component or the fixtures.
