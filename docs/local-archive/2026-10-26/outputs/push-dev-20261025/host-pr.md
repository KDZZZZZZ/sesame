Integrate the current Sesame workspace into dev, including the accumulated agent, plugin, chart, reporting and conversation changes. Startup now shows a local splash immediately, defers report-renderer dependencies, and runs isolated plugin preflight checks with bounded concurrency. Closing the window keeps the existing research backend alive; the tray or a second launch restores the same window, while explicit Quit cleans up the backend.

- Agent and plugin integration: capability discovery, configuration and secrets, message ingress, child-agent completion delivery, research reports and persistent Ultra state.
- Workspace: updated conversation and reasoning presentation, image/file input, slash commands, tabs and layout resizing; chart drawings, historical indicators and cache loading fixes.
- Reports: shared rendering and charts, PDF/image exports, attachment navigation, fonts and Markdown fixes.
- Desktop: early splash with recovery actions, close-to-tray lifecycle, lazy report rendering and parallel isolated preflight. Historical release pins are retained; this updates development source, not a stable release.

Validation:

- Frontend typecheck and lint passed (one existing Fast Refresh warning); OpenAPI and source-contract validation passed.
- Agent messaging/notification/attachment/command checks: 91 passed. Configuration file: 13 passed. Plugin startup/lifecycle/update checks: 40 passed.
- Desktop: 17 focused unit tests and 8 real Electron lifecycle scenarios passed, plus the existing full desktop and frame-policy regressions; no page errors. Isolated measurement: splash visible in 406ms, workbench ready in 4.175s. Plugin activation preflight stage improved from 6.289s to 1.815s in the empty-profile comparison.
- Known validation gap: the Electron relative report-attachment download regression still intermittently exceeds the existing 40s parent-test deadline (final focused run: 11 passed, 2 failed, 1 cancelled). A diagnostic longer-timeout run passed, but the exact submitted test did not; this is not reported as fully green.

User data, credentials, generated artifacts and packaged binaries are excluded. The user's running application and research were not restarted during verification.
