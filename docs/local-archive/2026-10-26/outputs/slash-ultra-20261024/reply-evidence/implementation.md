# Reply interaction verification

This lane implements compact public tool traces, collapsible work history, stable streaming prose, and reply copy actions. The official reference was inspected at https://www.beautifului.dev/ (Thinking, Streaming Text, Tool Chips); screenshots and DOM snapshots are in `../reference/reply-*`. The follow-up source pass reads the official registry TSX and linked repository foundation directly; exact source hashes and the source-view screenshot are in `../reference/beautifului-source-manifest.json` and `../reference/beautifului-source-view.png`. See `../reference/source-adaptation.md` for provenance and adaptations.

## Files

- `mt5agent/modules/frontend/src/features/conversation/reply-segments.tsx`
- `mt5agent/modules/frontend/src/features/conversation/reply-segments.css` (new)
- `mt5agent/modules/frontend/src/features/conversation/reply-copy-button.tsx` (new)
- `mt5agent/modules/frontend/src/features/conversation/message-item.tsx`
- `mt5agent/tests/reply-motion-ui/fixture.tsx` (new)
- `mt5agent/tests/reply-motion-ui/run.mjs` (new)

Existing source snapshots are in `../reply-before`. No shared `index.css`, `conversation.css`, composer, model picker, runtime, live data, or API was changed by this lane. No new dependencies were added.

## Behavior

- Adjacent tool calls wrap into compact chips without inventing arguments, outputs, timings or progress. Running, completed, failed and interrupted remain distinct.
- Only public process text/status is displayed; the host does not expose internal model reasoning here. Active work can be folded while the latest streamed paragraph stays visible. Completed final answers retain the existing final-segment contract and automatic collapse/focus recovery.
- Stream updates replace the current rendered Markdown immediately. The official source's solid 2px caret marks the current stream; prose is not replayed or animated per character. The caret follows the Markdown body so it cannot corrupt tables, lists or fenced code.
- Copy uses the authoritative final segment when available, the current text while streaming, otherwise public text segments/content. It preserves Markdown formatting in the copied text and excludes tool status, report UI labels and user interjections. Success lasts 1.8 seconds; failed writes show a retry state instead of success.
- Reduced-motion stops reply icons, transitions and the existing message entrance. The stream caret is static while streaming, as in the official source.

## Verification

- `node tests/reply-motion-ui/run.mjs`: PASS, isolated Vite-built actual React components in fresh headless Chromium. No live application/model calls. Covers streaming identity and immediate readability, folding/focus/keyboard behavior, terminal tool projection, user interjections, copy success/reset/failure/retry, report references, English labels, empty replies, 280/390/1000px light/dark layouts, reduced-motion and no script errors/unexpected requests.
- `node --test tests/terminal-tool-projection.test.js tests/conversation-replies.test.js`: 13 passing tests.
- `node node_modules/typescript/bin/tsc -b modules/frontend --pretty false`: PASS.
- Source pass reran all 5 UI scenarios and 13 reply projection tests successfully. Fresh frontend app typecheck used a separate evidence build-info file, avoiding the other lane's build cache; PASS.
- Targeted oxlint for the reply and tab TSX components: PASS.
- Targeted `git diff --check`: PASS (Git emits only the repository's existing LF/CRLF normalization notice).

The fixture verification is not a claim of running the packaged application. Parent integration owns the production frontend build and app verification.
