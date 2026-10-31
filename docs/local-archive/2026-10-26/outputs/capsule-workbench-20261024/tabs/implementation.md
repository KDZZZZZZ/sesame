# Gray capsule tab bar

Latest user requirements supersede the earlier metal-edge treatment: the tab bar is now borderless, selected tabs are more visibly neutral gray, tabs have capsule ends, and a persistent `+` opens a closable catalog tab. Research/Strategy belongs only to the catalog page; the root lane owns that layout and state integration.

## Files owned and changed in this slice

- `mt5agent/modules/frontend/src/features/report-dock/dock-tabs.tsx`
- `mt5agent/modules/frontend/src/features/report-dock/dock-tabs.css`
- `mt5agent/tests/dock-tabs-ui/fixture.tsx`
- `mt5agent/tests/dock-tabs-ui/run.mjs`

The prior contents of all four files are in `before/`. This slice did not edit `report-dock.tsx`, Catalog, `workspace-store.ts`, global `index.css`, application data or packaged output.

## Implementation

- `DockTabs` accepts optional `onOpenCatalog?: () => void`; without a callback it calls the existing store's `showCatalog()`. The callback receives no event argument. `+` renders even with zero tabs, has Chinese/English labels and works by pointer, Enter and Space.
- The new `type: 'catalog'` tab supplied by the root-owned store uses `FolderOpen`, a localized Catalog title, and the same activation/close controls. It does not trigger a run request. The store owns catalog reuse and the empty `active: ''` state.
- Closing the last tab restores keyboard focus to `+`. Closing an existing catalog tab preserves the other open tabs and the store's selection behavior.
- `+` follows the actual tab group instead of sitting against the right edge of a wide empty strip. During overflow the list shrinks and scrolls while `+` keeps its fixed space. Full workbench chrome spacing remains the root lane's integration responsibility.
- The strip container and tab list explicitly have no border, shadow or colored background. Capsule tabs have no borders or inset edge shadows. The selected surface is a solid neutral gray (`#dedede` light / `#303030` dark); there is no colored underline or static blue tint.
- The previously verified Oops card pointer-light mechanism remains, with reduced intensity: blue in the light theme, blue/purple in the dark theme, visible only on hover or keyboard focus. Keyboard focus centers the light, reduced motion fixes it without transition, and touch does not leave a sticky hover. Focus outlines are retained only for keyboard accessibility.

## Verification

- `node tests/dock-tabs-ui/run.mjs`: **PASS, 5 grouped scenarios**. Uses actual DockTabs and workspace store in isolated Chromium with no live backend or model. Covers activation, arrows/Home/End, selected/inactive/last close, focus recovery, callback/default + behavior, catalog reuse and close, English names, touch, running indicator, pointer highlight, reduced motion and zero unexpected requests/JavaScript errors.
- Both themes at **1100, 390 and 280px**: selected capsule, close and + stay visible; no page overflow. Tests also verify neutral gray resting colors, pill radius, zero tab/strip border and shadow, and no colored underline DOM.
- Fresh frontend app TypeScript check using the separate build-info file in this evidence directory: **PASS**.
- Targeted oxlint for `dock-tabs.tsx`: **PASS**. Targeted `git diff --check`: **PASS**.
- Inspected the wide light/dark, narrow resting/hover and empty/catalog screenshots. The screenshot matrix is `tabs-{light,dark}-{1100,390,280}{,-hover,-focus}.png`, plus `tabs-empty.png`, `tabs-empty-focus.png`, `tabs-catalog.png`. Results are in `tabs-ui-results.json`.

The fixture's catalog contents only establish that the Research/Strategy controls are inside the catalog page; they are not a visual verification of the root-owned production Catalog component. This slice did not package, restart or operate the live application.
