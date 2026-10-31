# Report/task tab bar verification

The tab bar is the report dock header, not the independently draggable chart window toolbar. `ReportDock` retains its existing workspace tabs and mounted content. Only the existing tab UI was extracted to `DockTabs` so its actual production component can be exercised in an isolated fixture.

**Latest user preference, 2026-10-24:** gray metal tabs replace the earlier blue selection and colored underline. A subsequent request adds blue hover/focus light in the light theme and blue/purple light in the dark theme, based on the cards at https://me.oopsbox.cn/essays/. Current screenshots and test output are in `hover/`; `metal/` and this directory's root preserve the earlier iterations.

## Files

- `mt5agent/modules/frontend/src/features/report-dock/report-dock.tsx`
- `mt5agent/modules/frontend/src/features/report-dock/dock-tabs.tsx` (new)
- `mt5agent/modules/frontend/src/features/report-dock/dock-tabs.css` (new)
- `mt5agent/modules/frontend/src/index.css` (only deletion of the now-unused `.tab-underline` rule)
- `mt5agent/tests/dock-tabs-ui/fixture.tsx` (new)
- `mt5agent/tests/dock-tabs-ui/run.mjs` (new)

The original report dock snapshot is in `../tabs-before`. Intermediate snapshots are in `../tabs-before/source-pass`, `../tabs-before/metal-pass` and `../tabs-before/hover-pass`. No store, report/market interface or live application state was changed by this lane; no dependencies were added. The only shared stylesheet edit removes the obsolete tab underline rule.

## Result

- Compact header and tab/action shapes adapted directly from the official Beautiful UI `ChatComposer` source: 6px header inset, 6px tab/action radius, 8px start inset, 3px vertical text inset and 100ms hover transitions.
- Sesame's existing font remains. Both themes use neutral gray selected text, subtle vertical grayscale shading, a fine border and inset edge highlights. The rest of the application retains its blue/orange and blue/purple theme.
- Only pointer hover or keyboard focus adds a translucent inner highlight over the gray surface: blue in light mode, blue/purple in dark mode. Like the reference share card, the light follows the pointer using CSS variables without React state updates. Keyboard focus centers the light; pointer leave removes old coordinates and returns the tab to gray. The overlay cannot intercept input or alter layout.
- The colored underline DOM and local/global CSS remain removed, together with the no-longer-needed `LayoutGroup`, `motion` and `useId` usages. There is no outer glow or decorative loop. The highlight fades in/out over 180ms; reduced motion uses an immediate stationary light. Touch activation does not create a sticky mouse hover.
- Close buttons reserve their width. Desktop inactive controls appear on hover/focus; selected and touch controls remain visible.
- Arrow keys, Home/End, Delete and roving tab focus work. Closing keeps the original workspace-store selection rules and restores focus. Active tabs scroll within the strip; narrow layouts expose scroll buttons without scrolling the surrounding canvas.
- Real run state still controls the existing working indicator. The original tab bar did not support drag reordering; this change does not add it.

## Verification

- `node tests/dock-tabs-ui/run.mjs`: 4 grouped scenarios in actual React + production CSS, isolated headless Chromium. Tests tab activation, selected/inactive/last-tab close, focus, panel association, long titles, real run state, English labels, touch affordances, reduced motion, light/dark layouts at 1100/390/280px and no unexpected requests or JavaScript errors. The updated checks verify absent underline DOM, neutral underlying surface, pointer-tracked hover, return to gray, centered keyboard highlight, unchanged geometry, non-intercepting overlay and stationary reduced-motion/touch behavior. Current pass/fail result is recorded in `hover/tabs-ui-results.json`.
- The pointer check confirms tabs do not begin reordering and scoped CSS does not block the adjacent chart drag handle. It uses a fixture pointer handler plus production chart styles; it is not a full chart gesture/model integration test.
- Fresh frontend app typecheck and targeted oxlint: PASS. Targeted tracked-file `git diff --check`: PASS.
- Current images are under `hover/tabs-{light,dark}-{1100,390,280}{,-hover,-focus}.png`; test results are in `hover/tabs-ui-results.json`. The Beautiful UI source/reference remains in `../reference`; actual Oops card rest/hover screenshots, CSS, DOM and pointer-state measurements are in `../reference/oopsbox-hover`.

Official source provenance, exact hashes, retained theme adaptations and MIT notice location: `../reference/source-adaptation.md`. Parent integration owns the packaged build and live application verification.
