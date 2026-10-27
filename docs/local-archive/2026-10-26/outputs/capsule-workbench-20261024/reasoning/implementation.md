# Public reasoning summary projection

Implemented 2026-10-24. This lane used local SDK/SSE fixtures only; it did not contact a real model, change credentials, restart the application, or build the desktop package.

## Changed files

- `modules/agent/public-reasoning.js` — public Responses summary collector and a private ModelRuntime facade per session.
- `modules/agent/message-segments.js` — independent reasoning segments, streaming lifecycle and completion boundaries.
- `modules/agent/runtime.js` — per-session extension registration, per-request response ownership, persistence, unsubscribe, and interrupted-summary crash recovery.
- `tests/public-reasoning.test.js` — five substantive regressions, including the installed Pi SDK with an isolated HTTP Responses SSE server.
- `tests/message-segments-runtime.test.js` — extends the existing restart recovery regression to public summaries.

The before directory contains the pre-edit versions of message-segments.js, runtime.js, compaction.js (reference only), and the existing runtime test. All unrelated worktree changes were retained. No dependencies or SDK files changed. Frontend/types/OpenAPI were owned by the parent/frontend lane.

## Source and lifecycle

Verified against installed `@earendil-works/pi-coding-agent` and `pi-ai` 0.99.1:

- `pi-coding-agent/dist/core/sdk.js` sends `{data, provider, api, model}` through the `provider_stream_event` extension before normalized events.
- `pi-ai/dist/api/openai-responses-shared.js` merges public summary and other reasoning into normalized thinking; those normalized events are deliberately excluded here.
- `pi-coding-agent/dist/core/cache-warmer.js` copies the original callbacks but replaces the request signal.
- `pi-agent-core/dist/agent-loop.js` forwards the active agent signal and session ID into streamSimple for the foreground request.

At session creation, `installPublicReasoning` adds a builtin extension using the same loader pattern as installCompaction and returns an independent Proxy facade. Shared `runtime.sessionModels` is never overwritten. Other methods are bound to their original runtime.

The host subscribes before session.prompt. Each actual streamSimple call binds the then-current message ID and MessageSegments instance. Only a request with the exact session ID and current agent signal is eligible. The facade forwards the original callback unchanged in purpose; a WeakMap attaches that event object to its eligible collector only until callback dispatch finishes. Cache warming has a different signal, compaction uses its own runtime/routing context, and callbacks after unsubscribe cannot rejoin a new prompt.

The collector accepts only:

- `response.reasoning_summary_text.delta`
- `response.reasoning_summary_text.done`
- `response.reasoning_summary_part.done` with summary_text/text
- `response.output_item.done` with reasoning.summary entries of summary_text/text

`response.created` supplies identity only. Private reasoning, generic SDK thinking, encrypted_content, signatures, item.content and arbitrary raw fields never enter the projection or helper logs. Summary fragments are keyed by response/item/index. Sequence numbers suppress replayed SSE events; final events reconcile text instead of appending it again. Independent summary parts are separated by blank lines.

Only nonempty summary text creates a segment. The database receives full message updates during summary streaming. `message.content`, answer deltas, and final_segment_id remain exclusively answer text. Answer output/tool start closes an open summary; assistant completion closes it; cancellation, errors, truncation, and crash recovery mark unfinished summaries interrupted. A safe-point user insertion changes only the next request's ownership.

## Verification

- New collector/facade/real-SDK test file: 5/5 passed.
- Existing message-segment/runtime/safe-steering regression group: 17/17 passed before the final crash-recovery assertion was added; safe-steering implementation was unchanged afterward.
- Final focused run (`public-reasoning`, `message-segments`, `message-segments-runtime`): 16/16 passed in 45.8 seconds, including the final crash-recovery change; full output in `test-output.txt`.
- Node syntax checks for helper/runtime passed.
- Targeted oxlint and git diff --check passed. Git only reported preexisting repository CRLF normalization notices.

The SDK fixture proves streamed persistence before completion, summary:auto request configuration, tool execution, inserted-message ownership, final answer separation, cancellation, and API history without private fields. Facade tests cover simultaneous sessions sharing one runtime, cache warming, compaction, continued original callbacks and late callbacks. Restart recovery preserves summary text and changes streaming to interrupted.

## Minimal real-provider check

Use an isolated workspace and a configured Responses model that returns public summaries. Send one modest request requiring a tool and a final answer. Observe a nonempty reasoning segment in message updates, followed by completed; verify the answer copy/content omit it. While a second request is still summarizing, stop it and confirm interrupted. Optional: insert a user message at the tool boundary and verify each response retains its own summary. A model that returns no public summary should produce no empty placeholder and no private-thinking fallback.

Only providers that emit these explicit public Responses summary events are projected. No claim is made that generic thinking from another API is public, nor that every model emits a summary on every request.
