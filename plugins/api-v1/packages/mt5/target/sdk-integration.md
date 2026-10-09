# Implement a frozen SVL source with the Product SDK

Read `target/examples/Strategy.mq5` with `plugin_read`. It is a complete MQL5 lifecycle example using the packaged SDK signatures. It contains no order or strategy logic and is not a translation, backtest or profitability example. The opt-in native test `mt5-sdk-example-native.test.js` compiles these exact bytes with installed MetaEditor and the installed standard library; it never runs the resulting EA. Read `backend/sdk/Results.mqh`, `Telemetry.mqh`, `Risk.mqh` and `Trade.mqh` before implementing strategy actions.

## Source and translation

1. Load `sesame/strategy-authoring`, read its skill and language example, write the user's rules as SVL, validate and publish `strategy.source`. Generate the graph from that source. Resolve ambiguous input, bar timing, entry/exit, position sizing and risk semantics in the source first.
2. Call `mt5_target` and preserve its complete ArtifactRef. For long code, follow [file registration](translation-file.md): assemble the same source ref, target ref, files, `source_map`, `parameter_map` and declared adaptations in one workspace JSON file, then call `mt5_translation_file(operation_id, manifest_path)`. Small content can use `mt5_translation` inline. Never repeat a long already-written program in tool arguments. The native entry is `Experts/Strategy.mq5`; strategy headers belong in `Include/Strategy`. Do not submit Product headers, `Build.mqh`, `strategy.json` or hand-authored `observability/rules.json`.
3. Use `mode:"live"` when the intended workflow includes deployment after a successful backtest. This mode can also backtest. A `mode:"backtest"` translation cannot be mounted. Neither mode starts trading. A live translation must explicitly call `ProductExecutionAllowed()` in its entry; the compiler does not rewrite immutable translated source.
4. Map every SVL node to real source lines. Instrument only actually evaluated nodes, using their exact node IDs; mark unobservable nodes with reasons. Map every scalar parameter to a declared MQL5 `input` and every instrument/account parameter to its binding. Native quantities use `lot`, one actual symbol and one timeframe; perform any unit conversion explicitly in SVL. Names starting `Product_` belong to the controller.
5. Call `mt5_compile` with the returned `project_id` and `revision`. Inspect real file/line diagnostics. To change translated code, fix the SVL source if semantics change, then register a new translation with a new stable operation ID. Never relabel old source maps or results as belonging to edited code.

## Required native hooks

| Callback or operation | Required SDK behavior |
| --- | --- |
| `OnInit` | Check `ProductExecutionAllowed()`, open trace, start the timer, then emit `lifecycle/platform.expert/"initialized"` only after successful initialization. Clean up on failure. |
| `OnTick` | Check `ProductTestCanceled()` and authorization; call `ProductEquity()` and `ProductRisk.Refresh()`. Evaluate only observed and ready inputs. |
| `OnTimer` | Check cancellation and authorization. Emit a bounded heartbeat while alive so the observer can distinguish current evidence from stale state. A timer firing does not imply a bar closed. |
| Strategy decision | Set a stable `ProductDecisionId`, then call `ProductEmit(kind, exactSourceNodeId, validJsonValue)` for the branch actually taken. Preserve pending intent and native ticket ownership for later callbacks. |
| Order request | Use `CProductTrade::OrderSend(request,result)` so platform authorization, limits and request-result telemetry apply. Supply a valid protective stop for a new position. Inspect the real retcode and tickets; a sent request is not a confirmed fill. Do not automatically repeat timeout, partial or unknown requests. |
| `OnTradeTransaction` | Call `ProductTransaction(tx,request,result)` and reconcile real order/deal/position identifiers with owned intents. Transactions from another EA or a manual order are not proof of this strategy's decision. |
| `OnTester` | Return `ProductTesterResult()`. It writes the real metrics, deals, final equity and completion evidence. Do not replace it with handcrafted result JSON. |
| `OnDeinit` | Kill the timer, emit lifecycle evidence and close trace. Do not close the trace before `OnTester` finishes. |

For closed bars, observe an actual change of `iTime(_Symbol,_Period,0)`, then use the previous completed bar with enough warmup. Explicitly handle the first observation so startup does not invent a close event. Use the actual bound symbol, broker time and series order. Commit source state once per input event; failed or uncertain orders require reconciliation, not a fabricated successful state. SDK telemetry does not implement these strategy semantics for you.

The SDK writes broker wall time and native binary64 values. The host uses decimal34. Source-map registration checks identities and bounds, not numerical or behavioral equivalence; preserve the declared limitations and any fixed tolerance policy. The current target has no injected native response/replay driver. Do not turn a graph or host replay into a claim of native equivalence.

## Tester, deployment and reports

Use the successful frozen `build_id` with `mt5_backtest start`, an explicit configuration and a stable `command_id`. Poll `wait/get`. Only a `succeeded` pass with real metrics and SDK output proves that native test completed. Model 1 is M1 OHLC; model 4 is real ticks. Distinguish the data model, broker dates, costs, warmup, sample selection and uncertainty in the report.

Each translated pass exposes `run_record:{id,version}` and, once collected, `result_artifact`. `run_record` pins the actual observed record version; read the tool again after status changes before publishing a final report. Legacy native runs return `run_record:null` and must not be presented as SVL runs. Use `mt5_report_data` for native dataset IDs and `report_data` to freeze each as a complete DataRef; DataRefs already in a result artifact can be bound directly. Author the report with the reports plugin's skill and `window.report.readData`.

In `report_publish.related`, bind source/translation/result through `artifact` and run through `record`, for example `{role:"run",record:pass.run_record}` using the actual returned value. Do not pass `backtest_ids` to `report_publish` or expect automatically inserted MT5 components. Keep the complete ArtifactRefs and real record versions. Publish the HTML, call `report_check`, and correct any failed rendering in a new report revision.

When the user has requested strategy execution, call `mt5_deployment check` for the successful pass. Verify the actual account, demo/live status, positions, permissions, risk limits and exact frozen artifact. `mount` requires the check's login/server/digest and one stable request ID. Preparation may restart the exact idle terminal after native checks; it must not replace another active terminal or pretend an unknown state is a fresh start. Read the returned deployment `run_record` and actual observation. `stop` stops the EA and does not close positions. A manual MCP trade and balance change are account evidence, but do not by themselves prove the translated EA executed a source decision.
