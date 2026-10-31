# Factor research

An independent optional Sesame API 1 package (`>=0.2.0-0`). Use it only for factor
work. It evaluates explicitly selected factor values; it does not inject Qlib,
genetic search, causal discovery or any named investment theory.

The original Node.js CLI uses only built-ins. It reads fixed development and
holdout JSON separately, checks point-in-time declarations, computes tie-aware
rank IC and train-only rank redundancy, and provides a gross-one flat-to-flat
long/short diagnostic with explicit round-trip costs. It never runs formulas,
downloads data, trains a model or sends an order.

From this package directory, using existing Node.js 22+:

```sh
node scripts/factor.mjs screen examples/plan.demo.json examples/development.demo.json --out screen.json
node scripts/factor.mjs select examples/plan.demo.json screen.json rank_signal --out selection.json
node scripts/factor.mjs holdout examples/plan.demo.json examples/holdout.demo.json screen.json selection.json --out holdout.json
```

These 96 rows are entirely invented, including availability timestamps and one
delisting. They are reproducible software fixtures, not market performance.
The constant factor deliberately produces undefined IC and no portfolio tails.
Only the selected factor is evaluated on holdout; the script does not rank all
holdout candidates. Preserve selection and prior trials in immutable artifacts:
local JSON hashes cannot prove that a researcher never viewed or retried data.

See the [skill](skills/factor-research/SKILL.md), [contract](skills/factor-research/references/execution.md)
and [provenance](PROVENANCE.md). There are no new tools or engine dependencies;
use the existing data/workspace/report tools and a selected backend for an actual
strategy backtest. Statistics use binary floating point and make no significance,
causality, implementability or return guarantee.
