# ABU research baselines

User request: renovate the useful public ABU capabilities into independent optional
plugins; runnable implementations must explicitly be baselines, not standard answers,
and Agents may improve them for a concrete task.

## Delivery

18 independently discoverable API 1 packages: abu-indicators, abu-trend,
abu-price-structure, abu-volatility, abu-similarity, abu-stock-screening,
abu-breakout, abu-moving-average, abu-trend-pullback, abu-seasonality,
abu-exit-rules, abu-position-sizing, abu-trade-metrics, abu-parameter-search,
abu-ml-features, abu-trade-judges, abu-model-lab, abu-backtest-lab.

Each ships a bounded read-only analysis tool and equivalent dependency-free Node
CLI, a synthetic fixture, tests, an independently loaded skill, assumptions,
improvement experiments and immutable upstream links. Each package is self-contained.
Reuse existing market data, workspace, frozen research artifacts, reports and native
execution engines. Do not add network vendors, broker execution or old framework
dependencies. Backtest-lab is an assumption/chronology diagnostic, not a new matching
engine. Trade judges use a documented transparent replacement baseline, not a claim
of ABU UMP/GMM equivalence. Model-lab separates chronological training and evaluation.

## Evidence and algorithm contract

Input: schema_version=1, source {id, kind: synthetic|historical|live}, explicit UTC
as_of, parameters and topic-specific data. Bars use closing time and available_at,
strictly increasing time, finite positive OHLC and nonnegative volume. Reject future
observations rather than quietly trim. Source declarations cannot establish vendor
history by themselves. All numerical code uses binary floating point.

Output: baseline flag and editable guidance, effective parameters, observations,
limitations, data/source metadata, input and implementation digests. Every proposed
improvement keeps the baseline unchanged, records hypothesis/change/trial, tests
chronological visibility and evaluates on the same fixed data with costs and a
declared holdout. No automatic replacement of mounted strategy or promotion to live
execution. Signals are observations for later decisions, not filled orders.

ABU reference commit d602d847677e4c2b77b0a122df30816ea68b5710. Preserve author and
GPL-3.0 attribution. This family is distributed as GPL-3.0-only source; no claim that
ABU's current hosted web/AI platform is included. Record replacements/deviations.

## Work and verification

Implement in three disjoint six-package lanes, with parent owning shared runtime,
manifests, integration, suite documentation/profile/lock and final review. Preserve
the pre-existing untracked manual-trading/assets directory and unrelated host work.
Verify numerical fixtures, bad input, warmup/degenerate cases, prefix stability,
time leakage and train/evaluation separation. Verify native tool/CLI agreement and
real host test/install/load/resource isolation in temporary state. Run static locks,
catalog/routing checks and scoped lint. Independent review precedes merge into dev;
published archives/catalogs remain immutable and are a separate release step.
