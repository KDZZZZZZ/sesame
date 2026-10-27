# Binance MCP export fix

Version: sesame/binance 1.0.1, package.json and plugin.json paired.

The native adapter already existed, but plugin.json had no mcp_export, so the authenticated Sesame MCP endpoint could initialize while advertising no Binance tools. The fix adds exactly binance_catalog, binance_account, binance_execution_identity, binance_execution_snapshot and binance_order_status. It does not export any order submission, test order, amendment, cancellation, prepare or submit alias. Native implementation and capability contracts are unchanged.

Validation: 42/42 tests passed (40 existing + 2 new MCP regressions); all 10 source files and the new test passed syntax checks; oxlint returned no diagnostics. The MCP regression assembles a trusted official bundle and uses the real Runtime and handleMCP. It covers initialize, tools/list, calls to all five exports, missing configuration, secret redaction, and rejection of unexported names. A local GET-only fetch fixture substitutes all exchange transport. No real credentials, authenticated Binance requests or exchange mutations were used.

The real host currently stores conv_mcp with agent_role external and scope main because its conversation scope is derived from parentage. This patch neither changes that behavior nor relies on a fabricated external context.kind; the explicit MCP export allowlist restricts the surface.

Evidence: before/ and after/ snapshots, snapshot.json hashes, tests.log, static-checks.json and mcp-fixture.json protocol transcript. No running Sesame process, user configuration, account or research task was touched. Parent integration owns global locks, inventory, packaging and deployment.
