# OpenClaudeDesktop display rules

Reference: oleyyu/OpenClaudeDesktop commit c8f9880e1ab23c559f14e771970aac42962b7f6a, new-2.42304.0. MIT attribution remains in the host notices.

1. Use the upstream Normal / Thinking / Verbose view model and bounded per-session preference store. Default to Normal. Normal filters reasoning before grouping tools; Thinking shows real provider summaries; Verbose forces expansion without changing manual choices.
2. Reuse existing transcript, disclosure and tool expansion components. Single tools remain independent rows. Multiple adjacent tools group; visible prose, compaction and user input remain ordered boundaries.
3. Adapt existing host status strings into actual compaction history and one terminal outcome. Do not retain obsolete request/retry labels or invent successful compaction. Do not change model, plugin or execution APIs.
4. Lock the changed status behavior with regression fixtures before editing. Validate pure view/group/status models, typecheck/lint, conversation browser suites, attachments/menu and existing queue/steering/retry boundaries. Inspect screenshots.
5. Deliver the verified frontend to the existing E: runtime, preserving its user data and all 58 plugins. Check the current activity before any reload/restart. Keep evidence and backups on E:.

Ownership: claude_transcript owns grouping/disclosure behavior; claude_composer owns the view model/store/menu; root owns status projection, conversation wiring and integrated verification/delivery. Existing unrelated edits are retained.
