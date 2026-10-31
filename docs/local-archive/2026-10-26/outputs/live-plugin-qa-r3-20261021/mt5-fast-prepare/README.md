# MT5 compact trading preparation

This lane contains only local package implementation and isolated fixtures. No real SDK, account, model, order, live Runtime or live database was used. Versions, inventory, lock files, installation and git index were left to the root.

New main-only entry:

`mt5_trading_prepare({symbol, command_id, user_authorized:true, expected_account?:{accountId,server,revision}})`

It uses existing configuration/terminal-permission helpers, without nesting their configuration locks. Normal connections skip mutations, initialization and restart. A confirmed native `-10004` gets one initialization of the configured terminal/account, never `login`. Specification, position and order requests are queued together; the Python worker remains serial. All settle before returning a failure. Latest native tick is read after the batch, then account/configuration is rechecked. Raw time is preserved. Successful duplicate calls refresh facts, while durable child command receipts prevent repeated permission changes and initialization.

The result is `{account,summary,terminal,spec,positions,orders,tick,readStartedAt,capturedAt,preparation}`. It is a technical snapshot, not an order or a promise of quote freshness, native MCP method authorization or broker acceptance. Python/account flags are checked separately. Existing terminal restart restrictions remain. No undocumented AI Assistant Trading INI setting is introduced.

Also fixes Python positional calls: only nonempty kwargs are forwarded. The C-call fixture exercises the worker's real AST and proves NULL kwargs for request/zero-argument calls, with enums and genuine keyword filters preserved and exactly one dispatch. Wrong-route errors now name the declared `agent_tool` instead of incorrectly claiming a different plugin.

Validation:

- `prepare-red.log`: missing new entry before implementation.
- `python-dispatch-red.log`: 2 passing / 2 failing regression checks before dispatch fix.
- `mt5-tests.log`: all 80 package JavaScript tests pass, including 16 compact preparation / routing / declaration regressions.
- `python-dispatch-green.log`: 4 offline CPython C-call tests pass.
- `manifest-validation.json`: 64 declared capabilities valid, zero diagnostics from the host's capability validator.
- `node --check`: changed JavaScript runtime files passed syntax checks.

`before/`, `after/`, `baseline.json`, `delta.json` and `task-delta.patch` isolate this lane from pre-existing architecture changes. `after/` and the patch are review evidence, not installer input. Root still needs formal package reload and real-model checks, including the actual installed SDK's read-only `order_check`, before claiming live recovery.
