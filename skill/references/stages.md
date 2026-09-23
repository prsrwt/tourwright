# Stages and targets

A stage renders the app's real components with fixture data. Because it is live React rather than a screenshot, the camera can land anywhere and every frame is sharp. Read this file when you need a stage for a new screen, or a target that does not exist yet.

The golden rule: **stages compose real components; they never copy them.** If you find yourself re-creating markup, stop. You are drifting from the real app, and the next UI change will make the video lie.

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
