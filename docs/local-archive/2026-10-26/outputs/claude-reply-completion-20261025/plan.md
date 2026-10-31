# Completed replies show the final answer

User request: after each conversation turn ends, collapse intermediate work and retain only the final reply by default.

- Only a completed message with an existing nonempty final_segment_id gets an outer View process disclosure. Never guess that partial commentary is a final answer.
- Partition the original parts before visibility filtering so the process identity survives display-mode changes. Inputs and the actual final answer stay outside; contiguous intermediate spans become independent collapsed sections.
- Normal/Thinking/Verbose all start with the outer section collapsed. Manually reopening a completed section survives mode changes and remounts, using an independent bounded cache. Existing inner tool/thought intentions remain independent.
- Streaming, paused, failed, canceled and no-final replies retain their current readable behavior. Report references, attachments and copy controls stay outside the history disclosure.
- Keep changes limited to frontend presentation. Reuse existing disclosure, grouping and cache mechanisms; no dependencies or host/plugin interface changes.
- Add regression coverage for completion boundaries and visibility, verify browser interaction/scrolling/modes, typecheck/lint/build, and update only the frontend of the same running E: profile after verifying drafts and state. Do not restart the host or send research/model requests.

Root owns product and pure tests. claude_composer owns browser tests and their necessary updated expectations. All baselines, temporary files, bundles and evidence stay on E:.
