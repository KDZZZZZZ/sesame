---
name: svl-mql5
description: Translate frozen SVL source to MQL5 with a pinned target, exact code bytes, source maps and declared semantic limits.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

The goal is a native implementation of the selected frozen SVL source, with evidence for the behaviors actually tested. The host graph comes from that same source. Strategy logic changes belong in a new source revision; a different native implementation must not silently change the strategy being translated.

## Declared authoring inputs and interfaces

- mt5_target({}) returns the fixed target ArtifactRef and its supported modes, versions and limits. The declared resources target/README.md, target/sdk-integration.md, target/examples/Strategy.mq5 and backend/sdk contain actual native signatures and the complete lifecycle example. These are public authoring APIs, not hidden host internals. The example has no order logic; the frozen source supplies that logic. Authorization, cancellation, equity, transaction and OnTester hooks provide execution and evidence boundaries.
- mt5_translation registers authored files, fixed source and target references, parameter_map, source_map and adaptations. mt5_translation_file({operation_id,manifest_path}) accepts the same content in one workspace JSON manifest, excluding operation_id from the body; target/translation-file.md defines that file. It avoids repeating long source text in tool arguments. The same ID/path recovers an acknowledged snapshot after a lost response or file cleanup; changed bytes are a new operation.
- Each SVL node needs its actual generated file/line mapping and instrumentation status. Function/module nodes retain functionId and actual function/iteration trace. Unobservable nodes need reasons. A map proves structural correspondence, not native execution. Native binary64 and SVL decimal34 remain different semantics unless a fixed tolerance policy and observed cases support a narrower claim.

Every SVL parameter has an explicit mapping: {nativeInput:"ActualInputName"} for scalar inputs, {nativeInput:"JsonInput",encoding:"json"} for structured types, {binding:"instrument"} or {binding:"account"} for identities. Native quantity parameters use lot; source-unit conversions must be explicit. The plugin expands SVL defaults and sends mapped values to the native engine.

## Execution evidence and state meanings

mt5_compile({project_id,revision}) compiles a frozen registered revision. mt5_backtest runs that fixed build with explicit native Tester settings; task and pass states distinguish queued/running from succeeded/failed/canceled/unknown. A published source, graph, registered translation or successful compile is not a backtest. A pass's actual run_record and result_artifact are evidence for that pass, not for another build.

mt5_conformance has prepare and verify capabilities defined in target/conformance.md. Prepare freezes ordered inputs, reference results and explicit tolerances without running MT5. Fixing those before inspecting native results prevents tuning acceptance to the outcome. Verify compares the prepared fixture with the actual instrumented Tester result; it proves only covered cases. The zero-trade fixture does not submit orders, and uncovered behavior stays unverified.

External input needs a declared EXTERNAL_INPUT_BRIDGE adaptation with fixed secret-free configuration. Tester uses immutable arrival-ordered timeline bytes and Product/FrozenInputs.mqh; live execution uses the authoring plugin's asynchronous loopback bridge with runtime-only credentials and halts new risk on missing or expired outputs. A saved signal snapshot or translation does not install a live model loop. The public bridge section gives the interface for the chosen mode.

mt5_report_data returns actual sourceRef/query and roles. data_snapshot({source:sourceRef,input:query,operationId,title}) freezes a selected dataset, while existing result DataRefs can be reused directly. Reports can bind complete DataRefs and related {role,artifact} or {role:"run",record:{id,version}} references. report_check checks the published report; it cannot create missing MT5 execution evidence. Legacy trace and SVL nodes are linked only when exact translation mapping and real instrumentation establish the relationship.

## Live boundary

A live translation registers mode:"live" and uses ProductExecutionAllowed() before compilation. That mode can be tested in Tester; the same successful frozen build may later be mounted with explicit user trading intent and actual channel/account checks. A deployment receipt must show the native outcome; unknown commands are reconciled by existing IDs, not replayed. Account balance changes or unrelated manual trades do not prove that the translated EA ran.
