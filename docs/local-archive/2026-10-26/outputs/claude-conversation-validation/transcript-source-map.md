# Transcript implementation evidence

Upstream: `oleyyu/OpenClaudeDesktop`, pinned `c8f9880e1ab23c559f14e771970aac42962b7f6a`, `new-2.42304.0/app/src/`.

| Upstream | Sesame implementation | Treatment |
| --- | --- | --- |
| `source-disclosure.jsx` | `modules/frontend/src/features/conversation/transcript-disclosure.tsx` | Actual measured-height component ported to TypeScript; imports mapped to existing React/Lucide, expansion made controlled so real reasoning phases open and close independently. Original ResizeObserver, transition interruption, reduced-motion and exit semantics retained. Focus restoration added for automatic collapse. |
| `source-disclosure.css` | `transcript-disclosure.css` | Copied verbatim. Existing Sesame theme supplies CDS token aliases. |
| `tool-group-expansion.mjs` | `tool-group-expansion.mjs` | Copied verbatim. Existing explicit expansion survives remounts and remains scoped by conversation/group. |
| `reasoning-model.mjs` | `transcript-reasoning.mjs` | Independent `TITLE_LINE`, `stripInlineEmphasis` and `plainReasoningText` source copied; unrelated upstream model imports and placement logic omitted. |
| `source-tool-group.jsx` | `reply-segments.tsx` | Source grouped-tool structure and expansion-store integration adapted to Sesame tool records. Only adjacent tools group. Public paragraphs, thoughts and inserted user messages retain their sequence. Running/error/interrupted rows remain visible without opening completed records. |
| `source-tool-group.css` | `transcript-tool-group.css` | Initial classic group-presentation block copied; unrelated standalone-tool rules omitted. |
| `source-transcript.css`, `source-session.css` | `conversation.css`, `conversation.tsx`, `message-item.tsx` | Source layout classes, 768px centered column, 32px gutters, 48px top reserve, 10/15px row gaps, right-aligned user group/bubble and attachment structure ported. Existing Sesame scroll anchors, composer-height reserve, reading font and theme preserved. Light bubble uses source alpha-style neutral tint via Sesame tokens. |
| `source-turn-footer.css` | `transcript-footer.css`, `reply-copy-button.tsx` | CSS copied verbatim; actual source MessageActions/footer/icon-button markup adapted to Sesame copy and retry operations. |

No generated bundled runtime, private service integration, additional dependency or unimplemented placeholder tool output was imported.

Validation completed on the integrated frontend build:

- `node --test tests/transcript-presentation.test.js`: 2 passing.
- `node tests/conversation-status-ui.cjs`: passing, including one status owner, no fake thinking, phase-local manual override, new thinking phase open, completion collapse and no Agent heading.
- `node tests/conversation-transcript-ui.cjs`: passing, including chronological public prose, adjacent groups, error/active visibility, keyboard operation, final-answer copy and narrow transcript containment.
- Frontend TypeScript check and targeted oxlint: passing.
- Screenshots inspected in `status/` and `transcript/` under this folder. Final quiet-gray user-bubble tint adjustment needs the parent's next integrated rebuild; no functional change followed browser validation.

Baseline copies for every existing edited file: `E:/brief2great/sesame/outputs/claude-conversation-baseline/transcript/`.
No files staged or committed by this lane. Parent owns `THIRD_PARTY_NOTICES.md` and distributed MIT license.
