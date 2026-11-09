# Pure factor evaluation

`createEvaluator({python}).evaluate(values, profile, referenceValues, ctx)` forwards exactly `python.execute('evaluate', {values, profile, referenceValues}, ctx)`. The bridge owns file access, budgets, matrix key verification, immutable evidence publication, and evaluation identities.

The numerical entry point is:

```python
evaluate(keys, factors, labels, references, profile, diagnosticValues)
```

`keys` is an aligned list of `{symbol, barIndex, time}`. `factors` maps candidate IDs to numeric/null lists; `labels` is one numeric/null list; `references` maps reference column IDs to numeric/null lists. Row order is never inferred or silently repaired. The bridge must verify exact keys and `rowOrderDigest` for every matrix before decoding. The evaluator additionally checks lengths, unique symbol/bar pairs, and the chronological UTC calendar.

`diagnosticValues` is the decoded form of the shared contract:

```json
{
  "covariates": {"regime": [0, 0, 1, 1]},
  "sensitivityMatrix": {"neighbor-2": [1, 2, 3, 4]},
  "sensitivity": [
    {
      "candidateId": "candidate",
      "argumentPath": [1],
      "neighbors": [{"value": 2, "column": "neighbor-2"}]
    }
  ]
}
```

Either matrix may be `null`; unavailable auxiliary evidence makes its diagnostic `incomplete`. The evaluator cannot fetch covariates, change parameter values, execute formulas, or infer that a parameter path is applicable. Sensitivity consumes only the matching declared path and already computed columns.

The return value is one `{id, status: 'ok', value}` or `{id, status: 'failed', error}` per candidate. A malformed candidate column preserves its siblings. A shared labels/reference/key/profile error fails all affected items. Successful `value` contains only `pairs`, the seven metric fields, `diagnostics`, `eligibility`, `reasons`, and `details`. Here `details` and each diagnostic's `evidence` are plain JSON objects; the bridge publishes them and replaces them with references. The bridge also adds `id`, `candidateId`, `valuesId`, `valuesRef`, `context`, `profile`, and `partition`.

## Metrics and axes

A metric is `{value: finiteNumber, status: 'computed'}` or `{value: null, status: 'unavailable', reason: string}`. A measured zero is a computed value. Missingness, constant inputs, insufficient observations, and an inapplicable statistic never become zero. All nonfinite numeric inputs are treated as missing and counted in details; strings and booleans are rejected.

| Field | Convention |
|---|---|
| `pairs` | Count of rows with finite factor and target values, including pairs in groups that later fail the minimum group size. |
| `coverage` | Finite factor rows divided by all declared key rows. Details separately provide label coverage, pair coverage, and missing/nonfinite counts. |
| `ic` | Pearson correlation of factor and continuous target, calculated separately in each eligible group, then averaged with equal group weights. |
| `rankIC` | Spearman correlation with average ranks for ties, using the same grouping and weights. |
| `score` | Alpha/risk: absolute value of the equal-weight signed group RankIC. State: equal-weight group eta-squared. |
| `stability` | Sample standard deviation of signed window RankIC, or window eta-squared for state. **Lower is more stable.** At least two valid windows are needed. Full window results and exclusions are retained. |
| `maxReferenceCorrelation` | Maximum across references of the mean absolute eligible-group Spearman correlation. Opposite signs in different symbols/dates cannot cancel redundancy. |
| `complement` | Continuous target: partial Spearman association after residualizing ranked factor and ranked target on an intercept and ranked references. State: partial eta-squared of category indicators added to an intercept/reference model of the factor. |

Time-series groups are individual symbols. `minPairs` is the minimum finite temporal pair count **per symbol**. The metric averages eligible symbols equally, regardless of their histories' lengths. It does not pool levels across symbols.

Cross-sectional groups contain eligible symbols at one frozen bar/time. `minPairs` is the **minimum same-time breadth**. The metric averages eligible timestamps equally. A narrow date cannot borrow observations from another date. Details retain each group's pair count, availability reason, eligible-group count, and excluded-group count.

Stability windows partition the full `[minBarIndex, maxBarIndex + 1)` interval into `stabilityWindows` fixed chronological intervals with integer boundaries. Calendar gaps remain gaps; windows are not balanced by the number of surviving observations. Each window uses the profile's normal axis and minimum size. The scalar describes available windows; details disclose every missing window.

Risk targets are continuous numeric labels and use the continuous association metrics. State targets are numeric **category codes**. Eta-squared is between-category factor sum of squares divided by total factor sum of squares; it requires at least two categories and at least two observations in every category. Relabeling categories cannot change the result. State IC and RankIC are unavailable, with reason `categorical_target_uses_eta_squared`.

Reference comparisons use pairwise finite factor/reference overlap, independently of target availability. Residual association instead uses complete factor/target/all-reference overlap. The intercept/reference design must have full column rank, and at least two residual degrees of freedom must remain. State partial eta-squared additionally checks category replication, the full category/reference design rank, and its remaining degrees of freedom. An explained factor/target, constant reference, deficient design, or insufficient overlap produces an unavailable residual metric. Low redundancy alone does not establish complementary predictive information.

## Optional diagnostics

All diagnostics evaluate a fixed candidate. Their statuses express the explicit checks below; they do not establish economic usefulness or remove search selection bias.

| Kind | Method and status criterion |
|---|---|
| `placebo` | Partition the frozen calendar into `blockBars` intervals. Permute complete target time blocks jointly across symbols, keeping within-block order. Compare observed absolute mean RankIC (state: eta-squared) against the block-permuted distribution. Use `(1 + exceedances) / (1 + repetitions)`; pass when it is at most `1 - confidence`. Insufficient permutation resolution, fewer than two blocks, or unavailable replicate statistics is incomplete. |
| `bootstrap` | Sample the same number of nonoverlapping time blocks with replacement. Factor/target pairs and all contemporaneous symbols travel together. Repeated timestamps count as separate sampled CS groups. Produce a percentile interval for the signed association or state separation. Continuous targets pass if the interval excludes zero. State passes when its descriptive interval is available; the interval is explicitly **not** a test of zero categorical separation. Inadequate tail resolution or unavailable draws is incomplete. |
| `walk_forward` | Evaluate disjoint complete chronological folds of `foldBars` using the same candidate, with zero refits or reselection. Report the trailing excluded calendar bars. Require at least two computable folds meeting coverage. Continuous folds pass when their nonzero directions agree; state folds pass when separation is positive throughout. No direction is fitted from later folds. Adjacent labels may overlap: the evaluator has no target horizon, does not repurge fold endpoints, and does not claim independent folds or repeated out-of-sample searches. |
| `regimes` | Use the explicitly supplied available-at covariate and frozen ordered bin thresholds, with intervals `[lower, upper)`. Missing covariates are counted. Every declared regime must have computable association. Pass when continuous directions agree across regimes, or state separation is positive throughout. Empty or insufficient regimes are incomplete. No threshold is fitted from the evaluated labels. |
| `sensitivity` | Evaluate each explicitly requested neighbor column matching the candidate and exact argument path. Report association, score, and coverage. All neighbors must be present, computable, and meet coverage. Pass when direction/separation is retained across the baseline and declared neighbors. Missing paths, columns, or data are incomplete. There is no evaluator-side formula computation or hidden parameter search. |
| `quantiles` | Form factor rank bins within the profile's groups, keep ties together using their average ranks, and retain only groups with all requested bins populated. Average label summaries with equal group weights. Continuous targets report bin label means and rank monotonicity; pass for nonconstant monotone means in either direction. State targets report category proportions, never means of category codes; pass means a complete descriptive summary exists, while monotonicity remains inapplicable. No complete groups is incomplete. |

Resampling uses a local NumPy generator seeded by the declared diagnostic seed. Block length is measured on the frozen bar grid. It is a caller choice, not an automatically validated dependence horizon. Missing rows remain missing, and an unavailable replicate is reported rather than silently dropped. Placebo preserves contemporaneous symbol structure: persistent symbol-level relations may survive time permutation and correctly fail the null check.

The process bridge estimates work and enforces the attempt's diagnostic budget before calling this pure function. It may omit work from a private profile copy, append an `incomplete` diagnostic result for each omitted request, and restore the original requested profile on the published evaluation. It must also apply the required-diagnostic eligibility rule to those appended results. The pure function has no implicit budget, process state, or cancellation context.

## Eligibility and provenance

`supported` means the profile's stated sufficiency and required checks are satisfied. It is possible for a measured zero to be supported: the profile has no minimum effect-size threshold. Insufficient pairs, factor coverage, association, stability, or a wholly uncomputable declared reference comparison give `insufficient`. A missing required diagnostic also gives `insufficient`. Exceeding the maximum reference correlation or failing a required diagnostic gives `invalid`; invalid takes precedence when both kinds of problem exist. Optional diagnostic failures/incompleteness are retained without independently changing eligibility.

The evaluator produces factor/target evidence only. It creates no positions, costs, PnL, Sharpe ratio, drawdowns, old Monte Carlo proxy, DSR, or PBO. Full trial/failed/duplicate history, development-only feedback, prior holdout exposure, and whole-search multiplicity provenance belong to the workflow and report. No diagnostic here certifies an untouched holdout or corrects an entire adaptive search.

## Validation

Synthetic numerical tests cover known positive/negative/zero relationships, ties, missing/nonfinite values, both axes, categorical invariance, reference overlap and rank failures, all six diagnostics, deterministic blocks, auxiliary-input gaps, and required/optional handling. Run them using the prepared private Python:

```powershell
& 'E:/brief2great/sesame/.omx/runtime/factor-python/venv/Scripts/python.exe' -m unittest discover -s 'plugins/optional-api-v1/packages/auto-factor-mining/tests' -p 'evaluate*_test.py' -v
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/packages/auto-factor-mining/tests/evaluate.test.js
```
