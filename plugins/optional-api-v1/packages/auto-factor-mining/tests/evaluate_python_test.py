"""Numerical regression tests for the pure evaluator; synthetic data only."""

from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np


MODULE = Path(__file__).resolve().parents[1] / "python" / "evaluate.py"
SPEC = importlib.util.spec_from_file_location("factor_pure_evaluate", MODULE)
evaluator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluator)


def keys(n, symbols=("A",), bars=None):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    grid = list(range(n)) if bars is None else bars
    return [{"symbol": symbol, "barIndex": bar, "time": (start + timedelta(hours=bar)).isoformat().replace("+00:00", "Z")} for symbol in symbols for bar in grid]


def profile(kind="alpha", axis="time_series", **changes):
    result = {"id": "synthetic", "version": 1, "kind": kind, "axis": axis, "minPairs": 3, "minCoverage": 0.8, "stabilityWindows": 2, "maxReferenceCorrelation": 0.95, "score": "eta_squared" if kind == "state" else "abs_rank_ic", "diagnostics": []}
    result.update(changes)
    return result


def diagnostic(kind, required=False, **options):
    default = {"placebo": {"blockBars": 3, "seed": 7, "confidence": 0.95}, "bootstrap": {"blockBars": 3, "seed": 7, "confidence": 0.95}, "walk_forward": {"foldBars": 6}, "regimes": {"field": "regime", "bins": [0.5]}, "sensitivity": {"argumentPath": [1], "neighbors": [2, 4]}, "quantiles": {"count": 3}}[kind]
    repetitions = options.pop("repetitions", 99)
    result = {"kind": kind, "required": required, "options": {**default, **options}}
    if kind in ("placebo", "bootstrap"):
        result["repetitions"] = repetitions
    return result


def run(x, y=None, *, key_rows=None, p=None, refs=None, aux=None, candidate="candidate"):
    y = x if y is None else y
    items = evaluator.evaluate(keys(len(x)) if key_rows is None else key_rows, {candidate: list(x)}, list(y), {} if refs is None else refs, profile() if p is None else p, {} if aux is None else aux)
    if items[0]["status"] != "ok":
        raise AssertionError(items)
    return items[0]["value"]


class CoreEvaluationTests(unittest.TestCase):
    def test_shared_contract_fixture_preserves_purged_missing_labels(self):
        fixture = json.loads((MODULE.parent.parent / "tests" / "fixtures" / "contracts.json").read_text(encoding="utf-8"))
        matrix = fixture["artifacts"]["matrix-shard"]["payload"]
        labels = fixture["artifacts"]["label-shard"]["payload"]
        p = profile(diagnostics=[diagnostic("regimes", True), diagnostic("sensitivity", True)])
        item = evaluator.evaluate(matrix["keys"], matrix["columns"], labels["columns"]["target"], {}, p, fixture["computeValuesHandle"]["diagnosticValues"])[0]
        self.assertEqual(item["status"], "ok")
        self.assertEqual(item["value"]["pairs"], 0)
        self.assertEqual(item["value"]["coverage"]["value"], 0.5)
        self.assertEqual(item["value"]["eligibility"], "insufficient")
        self.assertEqual([d["status"] for d in item["value"]["diagnostics"]], ["incomplete", "incomplete"])
        json.dumps(item, allow_nan=False)

    def test_known_positive_negative_and_zero(self):
        x = [1, 2, 3, 4] * 3
        for y, expected in [(x, 1), ([-v for v in x], -1), ([2, 4, 1, 3] * 3, 0)]:
            with self.subTest(expected=expected):
                value = run(x, y)
                self.assertAlmostEqual(value["ic"]["value"], expected, places=12)
                self.assertAlmostEqual(value["rankIC"]["value"], expected, places=12)
                self.assertAlmostEqual(value["score"]["value"], abs(expected), places=12)
                self.assertEqual(value["rankIC"]["status"], "computed")
                self.assertEqual(value["eligibility"], "supported")

    def test_ties_use_average_ranks(self):
        x = [1, 1, 2, 3, 3, 4] * 2
        y = [1, 2, 2, 3, 4, 4] * 2
        value = run(x, y)
        expected = np.corrcoef(evaluator.rankdata(x), evaluator.rankdata(y))[0, 1]
        self.assertAlmostEqual(value["rankIC"]["value"], expected)

    def test_constant_factor_is_unavailable_not_zero(self):
        value = run([1] * 12, list(range(12)))
        self.assertIsNone(value["score"]["value"])
        self.assertEqual(value["details"]["groups"][0]["association"]["reason"], "constant_factor")
        self.assertEqual(value["eligibility"], "insufficient")

    def test_constant_label_is_unavailable(self):
        value = run(list(range(12)), [2] * 12)
        self.assertEqual(value["details"]["groups"][0]["association"]["reason"], "constant_label")

    def test_missing_values_pairwise_coverage_and_nonfinite_counts(self):
        x = [None, 2, 3, 4, 5, 6, float("inf"), 8, 9, 10, 11, 12]
        y = [1, None, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        value = run(x, y, p=profile(minCoverage=0.9))
        self.assertEqual(value["pairs"], 9)
        self.assertAlmostEqual(value["coverage"]["value"], 10 / 12)
        self.assertAlmostEqual(value["details"]["labelCoverage"]["value"], 11 / 12)
        self.assertAlmostEqual(value["details"]["pairCoverage"]["value"], 9 / 12)
        self.assertEqual(value["details"]["factorMissingOrNonfinite"], 2)
        self.assertEqual(value["eligibility"], "insufficient")
        json.dumps(value, allow_nan=False)

    def test_time_series_does_not_pool_symbol_level_effects(self):
        x = list(range(12)) + list(range(100, 112))
        y = list(range(12, 0, -1)) + list(range(112, 100, -1))
        value = run(x, y, key_rows=keys(12, ("A", "B")))
        self.assertGreater(np.corrcoef(x, y)[0, 1], 0.9)
        self.assertAlmostEqual(value["rankIC"]["value"], -1)
        self.assertEqual(value["details"]["eligibleGroups"], 2)

    def test_time_series_equal_weights_not_pair_weights(self):
        rows = keys(12) + keys(6, ("B",))
        x = list(range(12)) + list(range(6))
        y = list(range(12)) + list(range(6, 0, -1))
        self.assertAlmostEqual(run(x, y, key_rows=rows)["rankIC"]["value"], 0)

    def test_cross_section_same_time_associations(self):
        rows = keys(8, ("A", "B", "C", "D"))
        x = [symbol * 10 + time for symbol in range(4) for time in range(8)]
        y = [-symbol * 2 + time * 50 for symbol in range(4) for time in range(8)]
        value = run(x, y, key_rows=rows, p=profile(axis="cross_section"))
        self.assertAlmostEqual(value["rankIC"]["value"], -1)
        self.assertEqual(value["details"]["eligibleGroups"], 8)

    def test_narrow_cross_sections_cannot_borrow_other_dates(self):
        value = run(list(range(24)), key_rows=keys(12, ("A", "B")), p=profile(axis="cross_section"))
        self.assertEqual(value["pairs"], 24)
        self.assertIsNone(value["rankIC"]["value"])
        self.assertEqual(value["details"]["excludedGroups"], 12)

    def test_excluded_cross_sections_are_counted(self):
        rows = keys(6, ("A", "B", "C"))
        x = [1] * 6 + [2] * 6 + [3] * 6
        x[12] = None
        value = run(x, key_rows=rows, p=profile(axis="cross_section"))
        self.assertEqual(value["details"]["eligibleGroups"], 5)
        self.assertEqual(value["details"]["excludedGroups"], 1)

    def test_stability_uses_fixed_calendar_windows_and_sample_sd(self):
        value = run([1, 2, 3, 1, 2, 3], [1, 2, 3, 3, 2, 1], key_rows=keys(6, bars=[0, 1, 2, 100, 101, 102]))
        self.assertAlmostEqual(value["stability"]["value"], np.sqrt(2))
        self.assertEqual(value["details"]["stability"]["windows"][0]["endBarIndexExclusive"], 51)

    def test_empty_or_tiny_windows_are_unavailable(self):
        value = run([1, 2, 3], p=profile(stabilityWindows=3))
        self.assertEqual(value["stability"]["reason"], "fewer_than_two_valid_chronological_windows")
        self.assertIn("stability_unavailable", value["reasons"])

    def test_state_eta_squared_ignores_numeric_category_order(self):
        x, y = [1, 1, 3, 3] * 4, [0, 0, 1, 1] * 4
        value = run(x, y, p=profile(kind="state"))
        relabeled = run(x, [90 if v == 0 else -200 for v in y], p=profile(kind="state"))
        self.assertEqual(value["score"]["value"], 1)
        self.assertEqual(value["score"], relabeled["score"])
        self.assertIsNone(value["rankIC"]["value"])
        self.assertEqual(value["ic"]["reason"], "categorical_target_uses_eta_squared")

    def test_state_requires_replication_and_more_than_one_category(self):
        for labels in [[1] * 12, list(range(12))]:
            value = run(list(range(12)), labels, p=profile(kind="state"))
            self.assertIsNone(value["score"]["value"])
            self.assertEqual(value["eligibility"], "insufficient")

    def test_state_cross_section_uses_same_time_separation(self):
        rows = keys(8, ("A", "B", "C", "D"))
        x, y = [1] * 16 + [3] * 16, [5] * 16 + [-5] * 16
        value = run(x, y, key_rows=rows, p=profile(kind="state", axis="cross_section"))
        self.assertAlmostEqual(value["score"]["value"], 1)
        self.assertEqual(value["details"]["eligibleGroups"], 8)

    def test_risk_labels_remain_continuous(self):
        x = list(range(12))
        value = run(x, [v ** 2 for v in x], p=profile(kind="risk"))
        self.assertAlmostEqual(value["rankIC"]["value"], 1)
        self.assertLess(value["ic"]["value"], 1)

    def test_per_candidate_invalid_vector_preserves_sibling(self):
        items = evaluator.evaluate(keys(12), {"bad": [1], "good": list(range(12))}, list(range(12)), {}, profile(), {})
        self.assertEqual([i["status"] for i in items], ["failed", "ok"])
        self.assertEqual(items[0]["error"]["code"], "INVALID_EVALUATION_INPUT")

    def test_duplicate_keys_and_misaligned_shared_vectors_fail(self):
        for rows, labels, refs in [(keys(3) + keys(3), list(range(6)), {}), (keys(6), [1], {}), (keys(6), list(range(6)), {"ref": [1]})]:
            items = evaluator.evaluate(rows, {"candidate": list(range(len(rows)))}, labels, refs, profile(), {})
            self.assertEqual(items[0]["status"], "failed")

    def test_bool_values_and_unknown_profile_fields_rejected(self):
        p = profile()
        p["hiddenTradeRule"] = 1
        for values, selected in [([True] * 12, profile()), (list(range(12)), p)]:
            items = evaluator.evaluate(keys(12), {"candidate": values}, list(range(12)), {}, selected, {})
            self.assertEqual(items[0]["status"], "failed")

    def test_inconsistent_calendar_rejected(self):
        rows = keys(3, ("A", "B"))
        rows[3]["time"] = rows[4]["time"]
        items = evaluator.evaluate(rows, {"candidate": list(range(6))}, list(range(6)), {}, profile(), {})
        self.assertEqual(items[0]["status"], "failed")

    def test_order_does_not_change_aligned_results(self):
        rows, x, y = keys(12, ("A", "B")), np.arange(24), np.arange(24) ** 2
        order = np.random.default_rng(4).permutation(24)
        normal = run(x, y, key_rows=rows)
        shuffled = run(x[order], y[order], key_rows=[rows[int(i)] for i in order])
        for name in ("ic", "rankIC", "score", "stability"):
            self.assertAlmostEqual(normal[name]["value"], shuffled[name]["value"])

    def test_empty_input_is_insufficient_and_serializable(self):
        value = run([], [])
        self.assertEqual(value["eligibility"], "insufficient")
        self.assertEqual(value["pairs"], 0)
        json.dumps(value, allow_nan=False)

    def test_state_zero_separation_is_computed_not_missing(self):
        value = run([-1, 1, -1, 1] * 6, [0, 0, 1, 1] * 6, p=profile(kind="state"))
        self.assertEqual(value["score"], {"value": 0.0, "status": "computed"})

    def test_unknown_diagnostic_profile_is_rejected(self):
        p = profile(diagnostics=[{"kind": "unknown", "required": True, "options": {}}])
        item = evaluator.evaluate(keys(12), {"candidate": list(range(12))}, list(range(12)), {}, p, {})[0]
        self.assertEqual(item["status"], "failed")


class ReferenceTests(unittest.TestCase):
    def test_abs_redundancy_does_not_cancel_opposite_symbol_correlations(self):
        x = list(range(12)) * 2
        ref = list(range(12)) + list(range(12, 0, -1))
        value = run(x, key_rows=keys(12, ("A", "B")), refs={"r": ref})
        self.assertAlmostEqual(value["maxReferenceCorrelation"]["value"], 1)
        self.assertAlmostEqual(value["details"]["references"]["comparisons"][0]["meanSignedCorrelation"]["value"], 0)
        self.assertEqual(value["eligibility"], "invalid")

    def test_reference_overlap_is_pairwise_not_label_filtered(self):
        x = list(range(12))
        y = [None] * 6 + list(range(6, 12))
        ref = list(range(6)) + [None] * 6
        value = run(x, y, refs={"r": ref})
        self.assertEqual(value["details"]["references"]["comparisons"][0]["groups"][0]["pairs"], 6)
        self.assertAlmostEqual(value["maxReferenceCorrelation"]["value"], 1)
        self.assertIsNone(value["complement"]["value"])

    def test_no_reference_does_not_claim_complementarity(self):
        value = run(list(range(12)))
        self.assertEqual(value["complement"]["reason"], "no_references")
        self.assertEqual(value["maxReferenceCorrelation"]["reason"], "no_references")

    def test_rank_deficient_references_disable_residual_claim(self):
        rng = np.random.default_rng(42)
        x, ref = rng.normal(size=60).tolist(), rng.normal(size=60).tolist()
        value = run(x, refs={"a": ref, "duplicate": ref})
        self.assertIsNone(value["complement"]["value"])
        self.assertEqual(value["details"]["references"]["residualGroups"][0]["association"]["reason"], "reference_rank_deficient")

    def test_residual_insufficient_degrees_of_freedom(self):
        value = run([1, 2, 3, 4], refs={"a": [2, 4, 1, 3], "b": [4, 2, 3, 1]})
        self.assertEqual(value["details"]["references"]["residualGroups"][0]["association"]["reason"], "insufficient_residual_degrees_of_freedom")

    def test_partial_spearman_can_preserve_independent_association(self):
        rng = np.random.default_rng(13)
        x, ref = rng.normal(size=80).tolist(), rng.normal(size=80).tolist()
        value = run(x, refs={"r": ref})
        self.assertAlmostEqual(value["complement"]["value"], 1)

    def test_explained_factor_is_unavailable_not_zero_complement(self):
        x = list(range(12))
        value = run(x, refs={"same": x})
        self.assertIsNone(value["complement"]["value"])
        self.assertEqual(value["details"]["references"]["residualGroups"][0]["association"]["reason"], "factor_explained_by_references")

    def test_constant_reference_cannot_be_treated_as_zero_redundancy(self):
        value = run(list(range(12)), refs={"constant": [1] * 12})
        self.assertIsNone(value["maxReferenceCorrelation"]["value"])
        self.assertIn("reference_comparison_incomplete", value["reasons"])

    def test_state_partial_eta_squared_is_category_code_invariant(self):
        rng = np.random.default_rng(13)
        labels = np.tile([0, 1], 40)
        ref = rng.normal(size=80)
        x = ref + labels * 5 + rng.normal(scale=0.01, size=80)
        a = run(x, labels, refs={"r": ref.tolist()}, p=profile(kind="state"))
        b = run(x, np.where(labels, -5, 300), refs={"r": ref.tolist()}, p=profile(kind="state"))
        self.assertGreater(a["complement"]["value"], 0.99)
        self.assertAlmostEqual(a["complement"]["value"], b["complement"]["value"])


class DiagnosticTests(unittest.TestCase):
    def test_missing_optional_and_required_auxiliary_are_distinct(self):
        x = list(range(24))
        for required in (False, True):
            value = run(x, p=profile(diagnostics=[diagnostic("regimes", required), diagnostic("sensitivity", required)]))
            self.assertEqual([d["status"] for d in value["diagnostics"]], ["incomplete", "incomplete"])
            self.assertEqual(value["eligibility"], "insufficient" if required else "supported")

    def test_bad_auxiliary_does_not_destroy_main_metrics_or_other_diagnostics(self):
        value = run(list(range(24)), p=profile(diagnostics=[diagnostic("regimes", True), diagnostic("quantiles")]), aux={"covariates": {"regime": [1]}})
        self.assertEqual(value["diagnostics"][0]["status"], "incomplete")
        self.assertEqual(value["diagnostics"][1]["status"], "passed")
        self.assertAlmostEqual(value["score"]["value"], 1)

    def test_bootstrap_resamples_factor_label_pairs_together(self):
        rng = np.random.default_rng(20)
        x = rng.normal(size=48).tolist()
        value = run(x, p=profile(diagnostics=[diagnostic("bootstrap")]))
        d = value["diagnostics"][0]
        self.assertEqual(d["status"], "passed")
        self.assertTrue(all(abs(v - 1) < 1e-12 for v in d["evidence"]["distribution"]))
        self.assertEqual(d["evidence"]["method"], "paired_nonoverlapping_time_block_bootstrap")

    def test_blocks_preserve_cross_sectional_dependence(self):
        rows = keys(8, ("A", "B", "C"))
        symbols, bars, _ = evaluator._keys(rows)
        groups = evaluator._block_groups(symbols, bars, "cross_section", [1, 2, 1, 2])
        self.assertEqual(len(groups), 4)
        for _, indexes in groups:
            self.assertEqual(set(symbols[indexes]), {"A", "B", "C"})
            self.assertEqual(len(set(bars[indexes])), 1)
        self.assertEqual(groups[0][1].tolist(), groups[2][1].tolist())

    def test_placebo_uses_blocks_and_reproducible_permutation_pvalue(self):
        x = np.random.default_rng(1).normal(size=90).tolist()
        p = profile(diagnostics=[diagnostic("placebo", True, repetitions=99)])
        first, second = run(x, p=p), run(x, p=p)
        d = first["diagnostics"][0]
        self.assertEqual(first, second)
        self.assertEqual(d["status"], "passed")
        self.assertLessEqual(d["evidence"]["pValue"], 0.05)
        self.assertEqual(d["evidence"]["blocks"], 30)

    def test_placebo_respects_pvalue_resolution(self):
        x = np.random.default_rng(1).normal(size=30).tolist()
        value = run(x, p=profile(diagnostics=[diagnostic("placebo", True, repetitions=2)]))
        self.assertEqual(value["diagnostics"][0]["reason"], "insufficient_permutation_resolution")
        self.assertEqual(value["eligibility"], "insufficient")

    def test_resampling_requires_multiple_calendar_blocks(self):
        value = run(list(range(24)), p=profile(diagnostics=[diagnostic("bootstrap", True, blockBars=100)]))
        self.assertEqual(value["diagnostics"][0]["reason"], "fewer_than_two_time_blocks")

    def test_bootstrap_requires_enough_draws_for_requested_tails(self):
        value = run(list(range(24)), p=profile(diagnostics=[diagnostic("bootstrap", True, repetitions=5)]))
        self.assertEqual(value["diagnostics"][0]["reason"], "insufficient_bootstrap_tail_resolution")
        self.assertEqual(value["eligibility"], "insufficient")

    def test_block_count_uses_calendar_grid_not_observation_count(self):
        rows = keys(12, bars=list(range(6)) + list(range(100, 106)))
        value = run(list(range(12)), key_rows=rows, p=profile(diagnostics=[diagnostic("bootstrap", blockBars=10)]))
        self.assertEqual(value["diagnostics"][0]["evidence"]["blocks"], 2)

    def test_cross_sectional_placebo_preserves_persistent_symbol_effect(self):
        rows = keys(30, ("A", "B", "C", "D"))
        x = [float(symbol) for symbol in range(4) for _ in range(30)]
        value = run(x, key_rows=rows, p=profile(axis="cross_section", diagnostics=[diagnostic("placebo", True)]))
        self.assertEqual(value["diagnostics"][0]["status"], "failed")
        self.assertEqual(value["diagnostics"][0]["evidence"]["pValue"], 1)
        self.assertEqual(value["eligibility"], "invalid")

    def test_walk_forward_is_fixed_candidate_and_disjoint(self):
        value = run(list(range(26)), p=profile(diagnostics=[diagnostic("walk_forward")]))
        d = value["diagnostics"][0]
        self.assertEqual(d["status"], "passed")
        self.assertEqual(d["evidence"]["refits"], 0)
        self.assertEqual(len(d["evidence"]["folds"]), 4)
        self.assertEqual(d["evidence"]["excludedTrailingBars"], 2)
        self.assertEqual(d["evidence"]["folds"][1]["startBarIndex"], d["evidence"]["folds"][0]["endBarIndexExclusive"])

    def test_walk_forward_sign_reversal_fails_required_diagnostic(self):
        x = list(range(6)) * 4
        y = list(range(6)) * 2 + list(range(6, 0, -1)) * 2
        value = run(x, y, p=profile(diagnostics=[diagnostic("walk_forward", True)]))
        self.assertEqual(value["diagnostics"][0]["status"], "failed")
        self.assertEqual(value["eligibility"], "invalid")

    def test_walk_forward_one_fold_is_incomplete(self):
        value = run(list(range(8)), p=profile(diagnostics=[diagnostic("walk_forward", True)]))
        self.assertEqual(value["diagnostics"][0]["status"], "incomplete")

    def test_regimes_use_supplied_fixed_bins(self):
        x = list(range(12)) * 2
        value = run(x, p=profile(diagnostics=[diagnostic("regimes", True)]), aux={"covariates": {"regime": [0] * 12 + [1] * 12}})
        d = value["diagnostics"][0]
        self.assertEqual(d["status"], "passed")
        self.assertEqual([r["rows"] for r in d["evidence"]["regimes"]], [12, 12])
        self.assertEqual(d["evidence"]["regimes"][1]["lowerInclusive"], 0.5)

    def test_empty_declared_regime_is_incomplete(self):
        value = run(list(range(24)), p=profile(diagnostics=[diagnostic("regimes", True)]), aux={"covariates": {"regime": [0] * 24}})
        self.assertEqual(value["diagnostics"][0]["reason"], "insufficient_declared_regime_samples")

    def test_precomputed_sensitivity_neighbors_are_compared(self):
        x = list(range(24))
        aux = {"sensitivityMatrix": {"n2": [v * 2 for v in x], "n4": [v + 4 for v in x]}, "sensitivity": [{"candidateId": "candidate", "argumentPath": [1], "neighbors": [{"value": 2, "column": "n2"}, {"value": 4, "column": "n4"}]}]}
        value = run(x, p=profile(diagnostics=[diagnostic("sensitivity", True)]), aux=aux)
        self.assertEqual(value["diagnostics"][0]["status"], "passed")
        self.assertFalse(value["diagnostics"][0]["evidence"]["computedByEvaluator"])
        aux["sensitivityMatrix"]["n4"] = [-v for v in x]
        changed = run(x, p=profile(diagnostics=[diagnostic("sensitivity", True)]), aux=aux)
        self.assertEqual(changed["diagnostics"][0]["status"], "failed")

    def test_sensitivity_path_mismatch_or_missing_neighbor_is_incomplete(self):
        for path in ([0], [1]):
            aux = {"sensitivityMatrix": {"n2": list(range(24))}, "sensitivity": [{"candidateId": "candidate", "argumentPath": path, "neighbors": [{"value": 2, "column": "n2"}]}]}
            value = run(list(range(24)), p=profile(diagnostics=[diagnostic("sensitivity", True)]), aux=aux)
            self.assertEqual(value["diagnostics"][0]["status"], "incomplete")

    def test_quantiles_summarize_future_labels_and_direction(self):
        x = list(range(24))
        for sign in (1, -1):
            value = run(x, [sign * v for v in x], p=profile(diagnostics=[diagnostic("quantiles")]))
            d = value["diagnostics"][0]
            self.assertEqual(d["status"], "passed")
            self.assertAlmostEqual(d["evidence"]["monotonicity"]["value"], sign)
            self.assertEqual([b["pairs"] for b in d["evidence"]["bins"]], [8, 8, 8])

    def test_quantiles_never_break_ties_by_row_order(self):
        x = [1] * 10 + [2] * 2
        value = run(x, list(range(12)), p=profile(diagnostics=[diagnostic("quantiles", True)]))
        self.assertEqual(value["diagnostics"][0]["status"], "incomplete")
        self.assertEqual(value["diagnostics"][0]["evidence"]["exclusions"][0]["reason"], "ties_leave_empty_quantiles")

    def test_state_quantiles_report_class_proportions_not_category_means(self):
        x, y = list(range(24)), [100] * 12 + [-9] * 12
        value = run(x, y, p=profile(kind="state", diagnostics=[diagnostic("quantiles")]))
        d = value["diagnostics"][0]
        self.assertEqual(d["status"], "passed")
        self.assertNotIn("meanLabel", d["evidence"]["bins"][0])
        self.assertEqual(d["evidence"]["monotonicity"]["reason"], "categorical_labels_have_no_numeric_order")

    def test_state_bootstrap_is_a_descriptive_interval_not_significance(self):
        value = run([1, 1, 4, 4] * 12, [0, 0, 1, 1] * 12, p=profile(kind="state", diagnostics=[diagnostic("bootstrap", blockBars=4)]))
        d = value["diagnostics"][0]
        self.assertEqual(d["status"], "passed")
        self.assertEqual(d["evidence"]["decision"], "descriptive_interval_available_not_a_zero_separation_test")

    def test_quantile_label_means_do_not_overflow_finite_inputs(self):
        value = run(list(range(24)), [1e308] * 24, p=profile(diagnostics=[diagnostic("quantiles")]))
        self.assertTrue(all(b["meanLabel"] == 1e308 for b in value["diagnostics"][0]["evidence"]["bins"]))
        json.dumps(value, allow_nan=False)

    def test_all_six_diagnostics_serialize_finite_evidence(self):
        x = np.random.default_rng(3).normal(size=96).tolist()
        aux = {"covariates": {"regime": [0] * 48 + [1] * 48}, "sensitivityMatrix": {"n2": [v * 2 for v in x], "n4": [v * 4 for v in x]}, "sensitivity": [{"candidateId": "candidate", "argumentPath": [1], "neighbors": [{"value": 2, "column": "n2"}, {"value": 4, "column": "n4"}]}]}
        ds = [diagnostic(kind, True) for kind in ("placebo", "bootstrap", "walk_forward", "regimes", "sensitivity", "quantiles")]
        value = run(x, p=profile(diagnostics=ds), aux=aux)
        self.assertEqual([d["status"] for d in value["diagnostics"]], ["passed"] * 6)
        self.assertEqual(value["eligibility"], "supported")
        json.dumps(value, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
