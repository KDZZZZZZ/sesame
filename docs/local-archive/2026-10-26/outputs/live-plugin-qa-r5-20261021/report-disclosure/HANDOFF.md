# Factor report default disclosures

Only `auto-factor-mining/report.js` and `tests/report.test.js` were modified. The template diff against this task's byte baseline is 8 added / 4 removed lines. Tests add 91 lines.

The two evaluator JSON disclosures no longer have `open`. Research rationale and final selection reason exceeding 280 characters are placed, unchanged, in native closed disclosures named `研究依据与限制` and `完整选择理由`. Short prose stays inline. Status, candidate IDs and deterministic gate remain in their existing visible positions. Goal, repeated hypothesis, metrics, thresholds, calculations, events and archive behavior are untouched.

All long evidence remains in the HTML and exact embedded `run-snapshot`; escaping is unchanged. No existing published report was modified.

## Exact before snapshots

- `before/report.js`: 37089 bytes, SHA-256 `5e944932a8fb5bbb94450159e307090190fc70f8d91a8688bbdac0b0ea0eaf76`.
- `before/tests/report.test.js`: 5359 bytes, SHA-256 `feef39b80b112aff48ab956637cc0f325ea76044e61ba91618eafc9d94679723`.
- `before/baseline.json` records absolute source and baseline paths.

## Verification

The new evaluator contract tests were run before implementation: 3 expected failures (open receipt and missing prose disclosures), with existing cases passing. After the small template repair, all 11 report tests passed. Coverage includes both JSON receipts, long and short prose, visible status/selection/gate, complete source snapshot without mutation, escaped malicious text across all four disclosures, no fabricated final evidence for unselected/pending/unused-holdout states, and existing report regressions.

Oxlint passed. Git whitespace validation passed with `cr-at-eol` to respect the pre-existing Windows CRLF bytes; no repository configuration or global line-ending normalization was applied. Full command outputs and final hashes are in `verification.json`.

Parent owns the real published R5 run inspection at 1000/390 widths, expansion verification, and version/lock/inventory/installation. This lane used no live database, app, network, model or account.
