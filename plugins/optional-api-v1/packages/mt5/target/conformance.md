# SVL native conformance

The target accepts Agent-authored translations of the SVL versions explicitly listed in the frozen profile. A `software` operator capability describes an implementation path, not a native MQL5 operator or a certification. Registration always returns `translated_unverified`; the mapping validation stays `partial`. Unsupported events and undeclared operators are rejected before project creation. An external-input fixture does not install a live model/input bridge.

## Freeze the experiment before implementing it

1. Publish the actual `strategy.source`. Write a bounded JSON replay fixture with `runId`, `parameters`, optional `initialState`, and ordered `events`. It must use the actual native account/instrument bindings and parameter values when the source declares them.
2. Call `mt5_conformance` with `action:prepare`, a stable `operation_id`, `source`, `fixture_path`, and optionally `header_path`. It publishes the immutable fixture and reference result. The small generated `ConformanceFixture.mqh` contains only identities, never expected outputs.
3. Fix numerical tolerances at this step, before reading native results. `tolerances` is an optional array of exact JSON pointers such as `{path:"/events/0/trace/2/value",absolute:"0.00000001",relative:"0"}`. Only Decimal calculation trace values can have a tolerance. Order intents, quantities, branches, state, missingness, event identities and execution order remain exact. A missing or non-Decimal tolerance path fails preparation.

## Execute the actual translated computation

Include `<Product/Conformance.mqh>` and the generated identity header. In a Tester-only fixture path, use the frozen input values to call the same functions that implement the source. Do not copy reference outputs into the program, and do not call trade APIs: capture `order.submit/cancel` as JSON intents for comparison. Never change the frozen translation after compiling it.

- `ProductSvlBegin(fixtureDigest, sourceDigest, referenceRunId, parametersDigest)` starts the observed experiment. The reference run ID is the fixture's `runId`, not `Product_RunId` (the actual native pass ID).
- Before each input, call `ProductSvlInput(index, eventId, eventDigest)`. The digest is the SDK's canonical SHA256 of that entire fixed event. Preserve all input entries, including duplicates. The verifier checks order and completeness.
- After an input commits or pauses, call `ProductSvlEvent(eventJson)`. Its JSON is the actual SVL event result: `eventId/status/state/intents/trace`, and `error` when present. Duplicate inputs produce no extra result. Trace rows retain exact `nodeId/value/location`, and `functionId/callPath` for function and collection calls. A paused event keeps the previous committed state and emits no intents.
- `ProductSvlEnd(status, stateJson)` ends the run. Keep the normal Product lifecycle, `ProductTesterResult`, cancellation and equity hooks so the native Tester can verify completion. This helper records observations; it does not execute an interpreter or fabricate traces.

Run `mt5_compile`, then a real `mt5_backtest` on the same immutable project/build. This conformance path must make **zero trades**, including in the simulated account. The existing Tester runner handles its own private terminal; do not attach the fixture EA to the user's terminal. Preserve the returned actual `result_artifact`.

## Verify observations

Call `mt5_conformance` with `action:verify`, a new stable `operation_id`, the prepared `fixture`, exact `translation`, and actual Tester `result`. It checks the persisted successful pass/build/revision, EX5 identity, source, expanded native parameters, nontruncated observed trace, complete input sequence, function traces and every reference event/state/intent. User-authored result JSON and compile receipts are not accepted as native evidence.

The returned `strategy.validation` is `failed` on a mismatch, `partial` when the fixture matches but some source/function nodes were not observed, or `passed` for a matching fixture covering all nodes. Every result still declares `generalEquivalence:not_proven`: one fixture is not proof for every input, a broker matching model or live restart behavior. Add boundary/missing data, alternatives, warmup, clock/alignment, partial fills and recovery fixtures as applicable. Ordinary historic Tester output lacks injected input identity and cannot certify this comparison.

## Functions, modules and execution capabilities

`source_map` retains the root `nodeId`; nodes inside a function additionally require `functionId`. Module functions use the fully expanded ID returned by `strategy_graph`, such as `publisher/module/function`. Every expanded node needs its own mapping; repeated local node IDs in different functions are distinct. `unobservable` remains a limitation, not verified coverage.

Structured parameters (`record/array/series/timestamp/price`) use `{nativeInput:"JsonInput",encoding:"json"}` and an MQL5 `input string` parsed and typed by the translation. Scalar inputs keep the existing mapping. Native quantities remain `lot`; conversion is explicit source logic.

The target's `execution.features` distinguishes broker-native operations from software responsibilities and unsupported generic dispatch. OCO, bracket, reduce-only, trailing stops and net reversal require an explicit tested planner/ledger; declarations never downgrade them into unprotected orders. Account mode, symbol order/filling rules, native tickets and complete pending requests must be observed before constructing a runtime capability profile. The static target does not grant live execution authority.

## External Agent inputs: live bridge and frozen Tester timeline

`external.input` is a **software** capability, not an installed native service. Every such translation must contain one adaptation with `code:EXTERNAL_INPUT_BRIDGE`, `status:limited`, and exactly one immutable resource as evidence. The resource has only these keys, so addresses, tokens and passwords are rejected:

```json
{
  "format": "sesame.mt5.external-input/1",
  "mode": "live-http",
  "clock": "utc",
  "availability": "availableAt-and-expiry",
  "failurePolicy": "halt_new_risk",
  "transport": {
    "protocol": "sesame.decision/1",
    "endpoint": "runtime-loopback",
    "authentication": "runtime-bearer",
    "request": "async-job",
    "recovery": "reconcile-before-resubmit"
  }
}
```

For live use, start the strategy authoring plugin's bridge with `strategy_decision action:bridge_start`. The returned loopback endpoint and Bearer credential belong in private, temporary runtime configuration, **never** in SVL, MQL source, native `input` parameters (MT5 logs those), reports, translation manifests or this evidence resource. The bridge uses `POST /requests` to enqueue work, `GET /requests/{jobId}` to read completion, and `POST /timeline` with `{jobId,asOf}` to obtain the time-filtered signals, advice and guards. A queued response is not a signal. Preserve the logical request ID and job ID before polling; reconcile them after restart instead of blindly resubmitting.

The MQL translation must check full strategy/run/account/instrument scope, input knowledge time, `availableAt`, `expiresAt`, channel generation, guard retirement, and configured maximum age before opening new risk. A timeout, unavailable bridge, absent/expired signal or model failure pauses new risk; it does not erase positions or outstanding protective orders. Slow model work stays in the service; MQL timer callbacks perform bounded status checks. MT5 [WebRequest](https://www.mql5.com/en/docs/network/webrequest) is synchronous and unavailable in the Strategy Tester. This plugin neither adds a terminal URL whitelist nor enables trading when a translation is registered. A live bridge declaration is `nativeBridgeVerified:false` until its actual runtime behavior is independently observed.

For Tester, `mt5_conformance prepare` on an external-input source also returns `bridgeConfiguration` and `timelineDigest`, and stores `inputs/svl-timeline.ndjson` in the fixture artifact. Optional `timeline_path` writes those exact bytes to the working directory. Include them under that same fixed path in `files`, and use the returned configuration ref as the adaptation evidence. Its `mode` is `frozen-timeline`; `transport` contains only `path` and `digest`. Each row preserves the exact canonical event and its SHA256, with nondecreasing UTC `availableAtMs`. The file must be at most 1 MiB. A snapshot taken after the whole history is known must not be injected at the history's start; export the real arrival timeline and retain point-in-time evidence.

The private Tester runner stages only the frozen translation's timeline into its own pass output directory and records its digest. Include `<Product/FrozenInputs.mqh>` and call `ProductFrozenOpen(timelineDigest)` after opening Product trace. It checks actual file bytes using native SHA256 and records `external_input_file`. `ProductFrozenNext(utcReplayMs,eventJson)` returns `1` for the next arrived event, `0` for not yet available/end, and `-1` for an invalid or backwards clock. It never derives UTC from the broker clock. The caller still parses and type-checks the event, applies expiry/guard/risk rules, and calls its actual translated logic. `ProductFrozenEventDigest(eventJson)` hashes the canonical event actually read for `ProductSvlInput`. The conformance verifier requires both the staged-file receipt and the native file-hash observation to match its fixture.

`target/examples/FrozenTimeline.mq5` is a compilable, zero-order transport example. It emits read inputs only and is not a strategy, JSON parser, semantic interpreter or live model integration. The opt-in `mt5-svl-native-conformance.test.js` separately compiles and runs a small actual SVL function/clamp implementation against native frozen input bytes, then compares observed values and function traces. Passing that case covers those computations and transport only, not all operators or the live HTTP bridge.

## Reproduce acceptance

The offline contract suite is `node --import <sesame-repo>/modules/plugins/sdk-loader.js --test plugins/api-v1/tests/mt5-svl-conformance.test.js`. It deliberately labels its memory-ledger stand-ins as fixtures; they are not native evidence.

For native verification, run the `mt5-svl-native-conformance.test.js` test with `SESAME_SVL_NATIVE_TESTS=1` and `SESAME_TESTER_CONNECTION_JSON` pointing to an existing local connection configuration. Optional `SESAME_TESTER_SYMBOL`, `SESAME_TESTER_FROM`, `SESAME_TESTER_TO`, and `SESAME_TESTER_CACHE_DIRECTORY` select available history. `SESAME_SVL_NATIVE_REPORT` writes a credential-free receipt. The test compiles isolated native files, runs a private zero-order Tester, checks cleanup, and never attaches an EA or modifies the user's running terminal.
