# Strategy research

An optional, method-neutral experiment workflow for Sesame API 1 (`>=0.2.0-0`).
It does not select a theory, create another engine, expand SVL, or send orders.
There are no new model tools: load the skill and use the existing workspace,
data, strategy-authoring, selected backend and report tools.

The original Node.js CLI checks a fixed experiment plan, chronological sample
availability/purge/embargo and a complete trial ledger. It uses only Node built-ins,
does not install dependencies or access the network, and accepts no executable
formula strings. Its input contract is documented in
[the execution reference](skills/strategy-research/references/execution.md).

From the package directory, with an existing Node.js 22 or newer:

```sh
node scripts/experiment.mjs plan examples/plan.demo.json
node scripts/experiment.mjs timing examples/plan.demo.json examples/timing.demo.json
node scripts/experiment.mjs ledger examples/plan.demo.json examples/trials.demo.json
```

The demo is entirely fictional and runs no strategy engine. Four aborted fixture
trials demonstrate bookkeeping; they are not four real backtests. All outputs
retain `provenance: demo`, and the unchecked engine remains a blocker.

For real work, freeze the plan and its selected engine/version before evaluation,
then run the installed backend against the actual fixed DataRef. Keep engine
failures, cancellations and unknown outcomes in the ledger. A checked JSON file
does not establish causal validity, tradability, profitability or vendor PIT quality.

This package does not depend on `factor-research`: load that separate package only
for factor work. ICT, price action, other discretionary methods and engine plugins
also remain separately selected. License and research sources: [PROVENANCE](PROVENANCE.md).
