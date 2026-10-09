# MQL5 target profile

Start with a frozen `strategy.source` SVL artifact. The host derives the graph from that source. Read the target profile and implement the actual native MQL5 program; `mt5_translation` records the exact source revision, every generated file and every source node mapping. Translation registration checks structure, not behavioral equivalence.

The initial profile provides Agent-authored translation, not an automatic operator compiler. `svl.operators` is empty for that reason. MQL5 has native callbacks for ticks, timers and trade transactions. Detect forming/closed bars explicitly from the observed broker series; do not synthesize a closed event merely because a local timer elapsed. External-input events are unsupported by this profile. FIX is optional and is not required by this target.

## Numerical policy

Native MQL5 arithmetic is binary64; SVL uses decimal34 with half-even rounding. Do not claim those are identical. Preserve units, validate lot steps and currency, declare adaptations, and fix a tolerance policy before a target replay. No numerical equivalence is certified by the translation tool. Fees, spread, broker execution rules and lot rounding need evidence from the actual target environment.

## Native program and evidence

Read [the complete lifecycle example](examples/Strategy.mq5) and [SDK integration workflow](sdk-integration.md) before implementing the translation. The example compiles the actual SDK interface without submitting orders; strategy semantics must still come from the frozen SVL source. The workflow covers live/backtest mode, required callbacks, parameter/node mapping and report references.

Use `Experts/Strategy.mq5` and `Include/Strategy/*.mqh`. Frozen compilation imports the installed standard library and the package Product SDK. Use the Product telemetry, risk, trade and result helpers according to their actual signatures in `backend/sdk`. The Tester expects the SDK completion marker, exact build ID, decimal deal fields, equity curve and ordered trace. A program lacking that evidence fails result validation rather than receiving synthetic results. Every SVL parameter has an explicit parameter_map to an MQL5 input or the instrument/account binding. This profile currently accepts native lot quantities and one native symbol/timeframe; unit conversion must be represented explicitly in the SVL source. Defaults are expanded before execution and supplied as native inputs. Source maps identify generated lines and whether each node is direct, inlined, a boundary, or unobservable. A mapping declaration does not make absent trace observable.

The native rules file is derived from SVL for the existing SDK trace format. It retains the source ArtifactRef; the host's SVL graph remains authoritative. Legacy visual-mql-v1 artifacts retain their own language and IDs.

## Recovery

Persist acknowledged native request IDs and the run/decision/intent mapping before treating a request as owned. Recover outstanding orders and positions from broker evidence after restart; never infer ownership by timing or automatically replay a command whose outcome is unknown. Account-scoped tickets may exceed JSON safe integers and must stay strings. Manual and external trades have unknown strategy correlation. Source state must commit per event, and a failed action must not leave a partially committed state advertised as valid.

A backtest translation may be compiled and sent to the real Tester. A live translation additionally needs broker/channel checks and explicit user intent to deploy. Compiling or publishing a translation never starts trading. Actual native Tester and live-channel evidence is independent from host SVL replay.
