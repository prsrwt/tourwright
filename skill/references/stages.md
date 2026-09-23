# Stages, targets and countables

A stage renders the app's real components with typed fixture data inside the app shell (sidebar and header). Because it is live React rather than a screenshot, the camera can land anywhere and figures can count up. Read this file when you need a target or countable that does not exist yet, or a stage for a new screen.

The golden rule: **stages compose real components; they never copy them.** If you find yourself re-creating markup, stop. You are drifting from the real app, and the next UI change will make the video lie.

## Where things live

| File | Role |
| --- | --- |
| `src/stage/registry.tsx` | Registers each stage: its component, fixtures, targets and countables |
| `src/stage/<Name>Page.tsx` | Composition: shell plus the real sections, each wrapped with `data-focus` |
| `src/stage/fixtures.ts` | Fixture data, typed against the app's real interfaces |
| `src/stage/Camera.tsx` | Measures targets and moves the camera; you don't edit it to make a video |
| `src/stage/Highlighter.tsx` | Draws the highlight; you don't edit it to make a video |

## Adding a focus target

A target is a named element the camera and highlighter can find. There are two ways to declare one, in order of preference.

1. **Wrap a section in the stage composition.** For a whole section that the composition already renders:

   ```tsx
   <div data-focus="collections">
     <GasdsCollectionsSection {...fixtures.collections} />
   </div>
   ```

   The wrapper must not change layout. Use a plain block element with no styles, or `display: contents` only if the camera can still measure it (check the still).

2. **Point at an element inside a real component** with a selector in the registry, when the element you want sits inside a component you must not change:

   ```ts
   targets: {
     collections: { focus: 'collections' },
     'claim-total': { selector: "[data-testid='gasds-claim-total']" },
   }
   ```

   Use an existing `data-testid` or a stable role or label. If there is no stable hook, adding a `data-testid` to the app component is an acceptable small app change. Make it in its own commit so reviewers can see it; it doesn't alter behaviour or styling. Never target by class names or DOM position; they break silently.

Then list the target in the stage's registry entry. `npm run check` validates scripts against that list, and the render fails loudly if a listed target is missing from the DOM.

Choose targets at the level the narration speaks about. The camera likes sections; the highlighter likes the specific thing being named. Every target must be visible in the fixture state without any clicking.

## Adding a countable

A countable is a numeric fixture value that the stage can show at any in-between value. The real component then renders the counting number itself, with its own formatting, so nothing is faked.

```ts
countables: {
  claimTotal: countable({
    get: (f) => f.summary.claimableAmount,
    set: (f, v) => ({ ...f, summary: { ...f.summary, claimableAmount: v } }),
    round: 'pence',      // 'pence' (2 decimal places) or 'integer'
  }),
}
```

The stage component receives fixtures as a prop, with countables already applied for the current frame. Keep the lens typed against the fixture type so a change to the app's interfaces fails `npm run typecheck`.

If the component calculates the figure itself from other props (for example, summing donations), a countable on a summary field won't move it. Either set the inputs so the derived figure passes through the counting values (for example, scale one input), or don't count that figure. Never paint a number over the real component.

## Building a new stage

Only do this when the decision rule in SKILL.md says so.

1. Create `src/stage/<Name>Page.tsx`. Render the app shell and the screen's real section components, imported from the app, the same way `GasdsPage.tsx` does. Wrap each section the narration will visit in `data-focus`.
2. Add fixtures to `src/stage/fixtures.ts`, typed with the app's real interfaces. Use obviously fictional names and round amounts (for example "Riverside Community Choir", £1,250.00). Never paste data from a real account, even an anonymised one.
3. Register the stage in `src/stage/registry.tsx` with its targets and any countables.
4. Run `npm run typecheck` in the tool. If a component needs a provider (theme, router, query client), add a stub provider in the stage, not a copy of the component.
5. Make a two-scene test script that visits every target, then run `npm run stills` and check that each target is framed correctly before writing the real script.
6. Follow `docs/DESIGN.md` and `docs/COLOR_SYSTEM.md`. The stage must look like the app, because it is the app.

## Things that break stages

- **Anything time-based inside components:** `Date.now()`, relative dates ("2 days ago"), timers, CSS transitions, skeleton loaders. Pass fixed dates in fixtures and turn off transitions in the stage (for example with a class that sets `transition: none` on the stage root).
- **Data fetching.** Stage components must get everything from props or stub providers. A component that fetches on mount needs its data layer stubbed with fixtures.
- **Fonts loading late.** The tool waits for fonts before rendering. If text reflows in the first frames, the target boxes are measured wrong; check the first still of each scene.
