# Streaming reasoning and operation summaries

User decision: always use the first sentence of the first paragraph of the actual displayable reasoning text. There is no separate provider-wide intent field and no extra model call to manufacture a summary.

- Parse the first paragraph before formatting; strip only display markup and segment its first sentence using the platform's sentence segmenter. Preserve original language, punctuation and full text.
- Associate a tool only with reasoning that appeared before it in the same source reply, resetting at public prose, user input and compaction boundaries. A group uses the first tool's preceding intent; never attach a later thought backwards to earlier actions. Without reasoning retain existing labels.
- In Normal mode, temporarily show the actual current streaming reasoning in a bounded scrolling region. Update on provider deltas without simulated typing. Stop following if the user scrolls upward; use the existing outer reading-position behavior. Once reasoning finishes, Normal hides the body again; Thinking/Verbose history behavior and independent expansion remain.
- Keep model execution, provider payloads and host/plugin interfaces unchanged. Research documents provider differences, but do not treat every normalized thinking event as a public summary.
- Validate extraction and source boundaries with unit tests; verify live deltas, collapse-to-summary, independent disclosure, no repeated status, wide/narrow layouts and scrolling with browser fixtures. Deliver only the frontend to the same live E: profile, retaining running tasks.

Root owns helper/renderer/wiring. claude_composer owns the new browser suite. claude_transcript and attachment_backend perform bounded read-only reference research. Baselines and evidence stay on E:.
