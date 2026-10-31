# Guarded cancellation guidance

Real Agent workflow-execution first sent cancellation request fields `action`, `order`, `symbol` and `comment`. The native guard requires exactly `action` and `order` and rejected that request before submission. The Agent then removed the extras and received native retcode 10009 for order REDACTED_IDENTIFIER; native history confirmed CANCELED.

The public schema accepts general trading request fields, but the optional cancellation guard description and trading guide did not state the exact two-field restriction. This change makes that existing restriction explicit in the public tool description, native rejection message and trading guide. Guard predicates, ownership checks, submission behavior, permissions and public input shape are unchanged.

- Existing Python guard tests: 34 passed (`guard-tests.log`).
- Existing catalog/history tests: 8 passed (`catalog-tests.log`).
- Oxlint passed (`lint.log`); staged diff check passed.
- Local commit: `319325c`.
- MT5 2.1.10 was installed with the same model/profile/workspace; the new independent Agent acceptance is recorded in `../pending-status-acceptance`.

The old rejection remains in `../workflow-execution/frozen-files/integer-cancel.json`; the successful correction is a separate receipt. This documentation repair does not relabel the initial request as successful.
