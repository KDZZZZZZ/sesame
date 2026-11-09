"""Pure, aligned factor statistics. File IO and evidence identities live in worker.py.

The only public entry point is evaluate(keys, factors, labels, references, profile,
diagnosticValues). All evidence returned here is JSON data, never artifact handles.
"""

from datetime import datetime, timezone
import math

import numpy as np
from scipy.stats import rankdata


def _metric(value=None, reason=None):
    if value is None or not math.isfinite(float(value)):
        return {"value": None, "status": "unavailable", "reason": reason or "nonfinite_statistic"}
    return {"value": float(value), "status": "computed"}


def _mean(metrics, reason="no_eligible_groups"):
    values = [m["value"] for m in metrics if m["status"] == "computed"]
    return _metric(math.fsum(values) / len(values)) if values else _metric(reason=reason)


def _finite_mean(values):
    scale = float(np.max(np.abs(values)))
    return 0.0 if scale == 0 else float(np.clip(np.mean(values / scale), -1, 1) * scale)


def _array(values, length, name):
    if not isinstance(values, (list, tuple, np.ndarray)) or len(values) != length:
        raise ValueError(f"{name}: aligned vector must contain {length} rows")
    if any(v is not None and (isinstance(v, (bool, np.bool_)) or not isinstance(v, (int, float, np.number))) for v in values):
        raise ValueError(f"{name}: values must be numbers or null")
    return np.asarray([np.nan if v is None else v for v in values], dtype=float)


def _keys(keys):
    if not isinstance(keys, list):
        raise ValueError("keys must be a list")
    symbols, bars, times = [], [], []
    seen, calendar, reverse = set(), {}, {}
    for key in keys:
        if not isinstance(key, dict) or set(key) != {"symbol", "barIndex", "time"}:
            raise ValueError("keys require symbol, barIndex and time only")
        symbol, bar, time = key["symbol"], key["barIndex"], key["time"]
        if not isinstance(symbol, str) or not symbol or type(bar) is not int or bar < 0 or not isinstance(time, str):
            raise ValueError("invalid aligned key")
        try:
            stamp = datetime.fromisoformat(time.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("key time must be UTC ISO") from exc
        if stamp.tzinfo is None or stamp.utcoffset() != timezone.utc.utcoffset(stamp):
            raise ValueError("key time must be UTC ISO")
        instant = stamp.timestamp()
        if (symbol, bar) in seen or (bar in calendar and calendar[bar] != instant) or (instant in reverse and reverse[instant] != bar):
            raise ValueError("duplicate keys or inconsistent frozen calendar")
        seen.add((symbol, bar))
        calendar[bar], reverse[instant] = instant, bar
        symbols.append(symbol)
        bars.append(bar)
        times.append(time)
    ordered = sorted(calendar)
    if any(calendar[a] >= calendar[b] for a, b in zip(ordered, ordered[1:])):
        raise ValueError("barIndex must follow chronological UTC order")
    return np.asarray(symbols), np.asarray(bars, dtype=np.int64), times


def _profile(profile):
    required = {"id", "version", "kind", "axis", "minPairs", "minCoverage", "stabilityWindows", "maxReferenceCorrelation", "score", "diagnostics"}
    if not isinstance(profile, dict) or set(profile) != required:
        raise ValueError("profile fields do not match the frozen contract")
    if not isinstance(profile["id"], str) or not profile["id"] or type(profile["version"]) is not int or profile["version"] != 1 or profile["kind"] not in ("alpha", "risk", "state") or profile["axis"] not in ("time_series", "cross_section"):
        raise ValueError("unsupported profile version, kind or axis")
    if type(profile["minPairs"]) is not int or profile["minPairs"] < 3:
        raise ValueError("minPairs must be at least three")
    if type(profile["stabilityWindows"]) is not int or not 2 <= profile["stabilityWindows"] <= 100:
        raise ValueError("stabilityWindows must be from two to 100")
    for name in ("minCoverage", "maxReferenceCorrelation"):
        if isinstance(profile[name], bool) or not isinstance(profile[name], (int, float)) or not 0 <= profile[name] <= 1:
            raise ValueError(f"{name} must be a proportion")
    if profile["score"] != ("eta_squared" if profile["kind"] == "state" else "abs_rank_ic"):
        raise ValueError("score does not match factor purpose")
    if not isinstance(profile["diagnostics"], list) or len(profile["diagnostics"]) > 6:
        raise ValueError("diagnostics must be a bounded list")
    if len({d.get("kind") for d in profile["diagnostics"] if isinstance(d, dict)}) != len(profile["diagnostics"]):
        raise ValueError("diagnostic kinds must be unique")
    for diagnostic in profile["diagnostics"]:
        _diagnostic_options(diagnostic)


def _groups(symbols, bars, axis, selected=None):
    selected = np.arange(len(bars)) if selected is None else np.asarray(selected, dtype=int)
    values = symbols if axis == "time_series" else bars
    grouped = {}
    for i in selected:
        key = str(values[i]) if axis == "time_series" else int(values[i])
        grouped.setdefault(key, []).append(int(i))
    return [(key, np.asarray(grouped[key], dtype=int)) for key in sorted(grouped)]


def _correlation(x, y, minimum, ranked=False):
    finite = np.isfinite(x) & np.isfinite(y)
    a, b = x[finite], y[finite]
    if len(a) < minimum:
        return _metric(reason="insufficient_pairs")
    if np.ptp(a) == 0 or np.ptp(b) == 0:
        return _metric(reason="constant_factor" if np.ptp(a) == 0 else "constant_label")
    if ranked:
        a, b = rankdata(a, method="average"), rankdata(b, method="average")
    # Scaling before centering prevents overflow for otherwise finite inputs.
    a, b = a / np.max(np.abs(a)), b / np.max(np.abs(b))
    a, b = a - np.mean(a), b - np.mean(b)
    denominator = np.linalg.norm(a) * np.linalg.norm(b)
    if denominator == 0:
        return _metric(reason="numerically_constant_input")
    return _metric(np.clip(np.dot(a, b) / denominator, -1, 1))


def _eta_squared(x, y, minimum):
    finite = np.isfinite(x) & np.isfinite(y)
    x, y = x[finite], y[finite]
    if len(x) < minimum:
        return _metric(reason="insufficient_pairs")
    if np.ptp(x) == 0:
        return _metric(reason="constant_factor")
    classes, counts = np.unique(y, return_counts=True)
    if len(classes) < 2:
        return _metric(reason="fewer_than_two_states")
    if np.any(counts < 2) or len(x) <= len(classes):
        return _metric(reason="insufficient_state_replication")
    x = x / np.max(np.abs(x))
    mean = np.mean(x)
    total = np.sum((x - mean) ** 2)
    between = math.fsum(int(count) * float(np.mean(x[y == state]) - mean) ** 2 for state, count in zip(classes, counts))
    return _metric(np.clip(between / total, 0, 1))


def _associations(x, y, groups, profile, details=True):
    state, minimum = profile["kind"] == "state", profile["minPairs"]
    records, linear, ranked, separated = [], [], [], []
    for key, indices in groups:
        a, b = x[indices], y[indices]
        pairs = int(np.sum(np.isfinite(a) & np.isfinite(b)))
        if state:
            eta = _eta_squared(a, b, minimum)
            separated.append(eta)
            if details:
                records.append({"group": key, "rows": len(indices), "pairs": pairs, "association": eta})
        else:
            rank = _correlation(a, b, minimum, True)
            ranked.append(rank)
            if details:
                ic = _correlation(a, b, minimum)
                linear.append(ic)
                records.append({"group": key, "rows": len(indices), "pairs": pairs, "ic": ic, "association": rank})
    association = _mean(separated if state else ranked)
    return {
        "association": association,
        "ic": _metric(reason="categorical_target_uses_eta_squared") if state else _mean(linear),
        "rankIC": _metric(reason="categorical_target_uses_eta_squared") if state else association,
        "groups": records,
        "eligibleGroups": sum(m["status"] == "computed" for m in (separated if state else ranked)),
        "excludedGroups": sum(m["status"] != "computed" for m in (separated if state else ranked)),
    }


def _score(association, profile):
    if association["status"] != "computed":
        return _metric(reason=association["reason"])
    return _metric(association["value"] if profile["kind"] == "state" else abs(association["value"]))


def _windows(bars, count):
    if not len(bars):
        return []
    start, end = int(np.min(bars)), int(np.max(bars)) + 1
    edges = [start + (end - start) * i // count for i in range(count + 1)]
    return [(a, b, np.flatnonzero((bars >= a) & (bars < b))) for a, b in zip(edges, edges[1:])]


def _stability(x, y, symbols, bars, profile):
    windows = []
    for start, end, indices in _windows(bars, profile["stabilityWindows"]):
        summary = _associations(x, y, _groups(symbols, bars, profile["axis"], indices), profile, False)
        windows.append({"startBarIndex": start, "endBarIndexExclusive": end, "rows": len(indices), "association": summary["association"], "eligibleGroups": summary["eligibleGroups"], "excludedGroups": summary["excludedGroups"]})
    values = [w["association"]["value"] for w in windows if w["association"]["status"] == "computed"]
    metric = _metric(np.std(values, ddof=1)) if len(values) >= 2 else _metric(reason="fewer_than_two_valid_chronological_windows")
    return metric, {"statistic": "sample_standard_deviation", "lowerIsMoreStable": True, "validWindows": len(values), "requestedWindows": profile["stabilityWindows"], "windows": windows}


def _residual_association(x, y, refs, indices, profile):
    mask = np.isfinite(x[indices]) & np.isfinite(y[indices])
    for ref in refs:
        mask &= np.isfinite(ref[indices])
    indices = indices[mask]
    n, p = len(indices), len(refs)
    if n < max(profile["minPairs"], p + 3):
        return _metric(reason="insufficient_residual_degrees_of_freedom"), n
    a, b = x[indices], y[indices]
    if np.ptp(a) == 0:
        return _metric(reason="constant_factor"), n
    state = profile["kind"] == "state"
    columns = []
    for ref in refs:
        column = ref[indices]
        if np.ptp(column) == 0:
            return _metric(reason="reference_rank_deficient"), n
        column = rankdata(column) if not state else column / np.max(np.abs(column))
        column = column - np.mean(column)
        columns.append(column / np.linalg.norm(column))
    design = np.column_stack([np.ones(n), *columns])
    if np.linalg.matrix_rank(design) != p + 1:
        return _metric(reason="reference_rank_deficient"), n
    a = a / np.max(np.abs(a)) if state else rankdata(a)
    a = a - np.mean(a)
    residual_a = a - design @ np.linalg.lstsq(design, a, rcond=None)[0]
    if np.linalg.norm(residual_a) <= 1e-10 * np.linalg.norm(a):
        return _metric(reason="factor_explained_by_references"), n
    if state:
        classes, counts = np.unique(b, return_counts=True)
        if len(classes) < 2 or np.any(counts < 2):
            return _metric(reason="insufficient_state_replication"), n
        full = np.column_stack([design, *[(b == c).astype(float) for c in classes[1:]]])
        if n < full.shape[1] + 2:
            return _metric(reason="insufficient_residual_degrees_of_freedom"), n
        if np.linalg.matrix_rank(full) != full.shape[1]:
            return _metric(reason="state_reference_rank_deficient"), n
        residual_full = a - full @ np.linalg.lstsq(full, a, rcond=None)[0]
        return _metric(np.clip(1 - np.dot(residual_full, residual_full) / np.dot(residual_a, residual_a), 0, 1)), n
    b = rankdata(b)
    b = b - np.mean(b)
    residual_b = b - design @ np.linalg.lstsq(design, b, rcond=None)[0]
    if np.linalg.norm(b) == 0 or np.linalg.norm(residual_b) <= 1e-10 * np.linalg.norm(b):
        return _metric(reason="label_explained_by_references"), n
    return _correlation(residual_a, residual_b, profile["minPairs"]), n


def _references(x, y, refs, groups, profile):
    if not refs:
        return _metric(reason="no_references"), _metric(reason="no_references"), {"comparisons": [], "residualGroups": [], "complete": True}
    comparisons = []
    for name, ref in refs.items():
        records = []
        for group, indices in groups:
            metric = _correlation(x[indices], ref[indices], profile["minPairs"], True)
            records.append({"group": group, "pairs": int(np.sum(np.isfinite(x[indices]) & np.isfinite(ref[indices]))), "correlation": metric})
        valid = [r["correlation"]["value"] for r in records if r["correlation"]["status"] == "computed"]
        comparisons.append({"reference": name, "meanSignedCorrelation": _metric(np.mean(valid)) if valid else _metric(reason="no_eligible_reference_groups"), "meanAbsoluteCorrelation": _metric(np.mean(np.abs(valid))) if valid else _metric(reason="no_eligible_reference_groups"), "groups": records})
    finite = [r["meanAbsoluteCorrelation"]["value"] for r in comparisons if r["meanAbsoluteCorrelation"]["status"] == "computed"]
    redundancy = _metric(max(finite)) if finite else _metric(reason="no_eligible_reference_groups")
    residuals = []
    for group, indices in groups:
        metric, pairs = _residual_association(x, y, list(refs.values()), indices, profile)
        residuals.append({"group": group, "pairs": pairs, "association": metric})
    complement = _mean([r["association"] for r in residuals], "no_eligible_residual_groups")
    return redundancy, complement, {"comparisons": comparisons, "residualGroups": residuals, "complete": len(finite) == len(refs), "redundancyMethod": "maximum_reference_mean_absolute_group_spearman", "complementMethod": "partial_eta_squared" if profile["kind"] == "state" else "partial_spearman", "interpretation": "Residual association is conditional descriptive evidence; low redundancy alone does not establish complementarity."}


def _diagnostic(kind, status, evidence=None, reason=None):
    result = {"kind": kind, "status": status, "evidence": evidence}
    if reason:
        result["reason"] = reason
    return result


def _diagnostic_options(diagnostic):
    options_by_kind = {"placebo": {"blockBars", "seed", "confidence"}, "bootstrap": {"blockBars", "seed", "confidence"}, "walk_forward": {"foldBars"}, "regimes": {"field", "bins"}, "sensitivity": {"argumentPath", "neighbors"}, "quantiles": {"count"}}
    kind = diagnostic.get("kind")
    if kind not in options_by_kind or type(diagnostic.get("required")) is not bool:
        raise ValueError("unknown diagnostic kind or required flag")
    resampling = kind in ("placebo", "bootstrap")
    allowed = {"kind", "required", "options", "repetitions"}
    required = allowed if resampling else allowed - {"repetitions"}
    if not required.issubset(diagnostic) or set(diagnostic) - allowed or not isinstance(diagnostic["options"], dict) or set(diagnostic["options"]) != options_by_kind[kind]:
        raise ValueError("diagnostic fields do not match the frozen contract")
    opts = diagnostic["options"]
    def integer(value, low, high):
        return type(value) is int and low <= value <= high
    if resampling and not (integer(diagnostic["repetitions"], 1, 10000) and integer(opts["blockBars"], 1, 100000) and integer(opts["seed"], 0, 2147483647) and isinstance(opts["confidence"], (int, float)) and not isinstance(opts["confidence"], bool) and 0 < opts["confidence"] < 1):
        raise ValueError("invalid resampling options")
    if kind == "walk_forward" and not integer(opts["foldBars"], 3, 1000000):
        raise ValueError("invalid foldBars")
    if kind == "quantiles" and not integer(opts["count"], 2, 20):
        raise ValueError("invalid quantile count")
    if kind == "regimes":
        bins = opts["bins"]
        if not isinstance(opts["field"], str) or not opts["field"] or not isinstance(bins, list) or not 1 <= len(bins) <= 20 or any(type(v) not in (int, float) or not math.isfinite(v) for v in bins) or any(a >= b for a, b in zip(bins, bins[1:])):
            raise ValueError("regimes need fixed increasing finite bins")
    if kind == "sensitivity":
        path, neighbors = opts["argumentPath"], opts["neighbors"]
        if not isinstance(path, list) or len(path) > 12 or any(not integer(v, 0, 1) for v in path) or not isinstance(neighbors, list) or not 1 <= len(neighbors) <= 16 or any(type(v) not in (int, float) or not math.isfinite(v) for v in neighbors) or len(set(neighbors)) != len(neighbors):
            raise ValueError("invalid sensitivity path or neighbors")
    return opts


def _block_groups(symbols, bars, axis, sampled_bars):
    # Each repeated timestamp is its own CS replicate; all symbols travel together.
    by_bar = dict(_groups(symbols, bars, "cross_section"))
    if axis == "cross_section":
        return [(i, by_bar[bar]) for i, bar in enumerate(sampled_bars)]
    indices = np.concatenate([by_bar[bar] for bar in sampled_bars])
    return _groups(symbols, bars, axis, indices)


def _resampling(kind, d, opts, x, y, symbols, bars, profile, observed):
    if observed["status"] != "computed" or not len(bars):
        return _diagnostic(kind, "incomplete", reason="association_unavailable")
    unique = sorted(set(int(bar) for bar in bars))
    blocks = {}
    for bar in unique:
        blocks.setdefault((bar - unique[0]) // opts["blockBars"], []).append(bar)
    blocks = list(blocks.values())
    if len(blocks) < 2:
        return _diagnostic(kind, "incomplete", {"blocks": len(blocks)}, "fewer_than_two_time_blocks")
    rng, samples, unavailable = np.random.default_rng(opts["seed"]), [], 0
    groups = _groups(symbols, bars, profile["axis"])
    lookup = {(str(symbol), int(bar)): i for i, (symbol, bar) in enumerate(zip(symbols, bars))}
    for _ in range(d["repetitions"]):
        if kind == "bootstrap":
            sampled = [bar for i in rng.integers(0, len(blocks), size=len(blocks)) for bar in blocks[int(i)]]
            metric = _associations(x, y, _block_groups(symbols, bars, profile["axis"], sampled), profile, False)["association"]
        else:
            shuffled = [bar for i in rng.permutation(len(blocks)) for bar in blocks[int(i)]]
            mapping = dict(zip(unique, shuffled))
            permuted = np.asarray([y[lookup[(str(symbol), mapping[int(bar)])]] if (str(symbol), mapping[int(bar)]) in lookup else np.nan for symbol, bar in zip(symbols, bars)])
            metric = _associations(x, permuted, groups, profile, False)["association"]
        if metric["status"] == "computed":
            samples.append(metric["value"])
        else:
            unavailable += 1
    evidence = {"method": "paired_nonoverlapping_time_block_bootstrap" if kind == "bootstrap" else "joint_label_time_block_permutation", "blockBars": opts["blockBars"], "blocks": len(blocks), "seed": opts["seed"], "requestedRepetitions": d["repetitions"], "computedRepetitions": len(samples), "unavailableRepetitions": unavailable, "confidence": opts["confidence"], "observed": observed, "distribution": samples, "dependence": "Shared timestamp blocks preserve within-block time order and contemporaneous symbol dependence.", "limitation": "Descriptive fixed-candidate evidence; block choice and whole-search multiplicity remain external."}
    if unavailable or not samples:
        return _diagnostic(kind, "incomplete", evidence, "unavailable_resampled_statistics")
    alpha = 1 - opts["confidence"]
    if kind == "placebo":
        null = np.asarray(samples) if profile["kind"] == "state" else np.abs(samples)
        actual = observed["value"] if profile["kind"] == "state" else abs(observed["value"])
        p = (1 + int(np.sum(null >= actual - 1e-14))) / (len(samples) + 1)
        evidence["pValue"], evidence["nullStatistic"] = p, "eta_squared" if profile["kind"] == "state" else "absolute_group_mean_rank_ic"
        if 1 / (len(samples) + 1) > alpha + 1e-12:
            return _diagnostic(kind, "incomplete", evidence, "insufficient_permutation_resolution")
        return _diagnostic(kind, "passed" if p <= alpha + 1e-12 else "failed", evidence, None if p <= alpha + 1e-12 else "null_not_rejected")
    if 1 / (len(samples) + 1) > alpha / 2 + 1e-12:
        return _diagnostic(kind, "incomplete", evidence, "insufficient_bootstrap_tail_resolution")
    low, high = np.quantile(samples, [alpha / 2, 1 - alpha / 2])
    evidence["interval"] = {"lower": float(low), "upper": float(high), "method": "percentile"}
    if profile["kind"] == "state":
        evidence["decision"] = "descriptive_interval_available_not_a_zero_separation_test"
        return _diagnostic(kind, "passed", evidence)
    passed = low > 0 or high < 0
    return _diagnostic(kind, "passed" if passed else "failed", evidence, None if passed else "interval_contains_zero")


def _consistent(metrics, state):
    values = [m["value"] for m in metrics]
    return all(v > 0 for v in values) or (not state and all(v < 0 for v in values))


def _walk_forward(opts, x, y, symbols, bars, profile):
    if not len(bars):
        return _diagnostic("walk_forward", "incomplete", reason="no_rows")
    start, end, size = int(np.min(bars)), int(np.max(bars)) + 1, opts["foldBars"]
    folds = []
    for left in range(start, end - size + 1, size):
        indices = np.flatnonzero((bars >= left) & (bars < left + size))
        result = _associations(x, y, _groups(symbols, bars, profile["axis"], indices), profile, False)
        coverage = _metric(np.mean(np.isfinite(x[indices]))) if len(indices) else _metric(reason="no_eligible_rows")
        folds.append({"startBarIndex": left, "endBarIndexExclusive": left + size, "rows": len(indices), "association": result["association"], "coverage": coverage})
    evidence = {"method": "fixed_candidate_disjoint_chronological_folds", "refits": 0, "foldBars": size, "folds": folds, "excludedTrailingBars": (end - start) % size, "limitation": "No candidate reselection or direction fitting. Fold label endpoints are not repurged; adjacent future labels can overlap, so folds are not independent trials."}
    if len(folds) < 2 or any(f["association"]["status"] != "computed" or f["coverage"]["status"] != "computed" or f["coverage"]["value"] < profile["minCoverage"] for f in folds):
        return _diagnostic("walk_forward", "incomplete", evidence, "insufficient_complete_folds")
    passed = _consistent([f["association"] for f in folds], profile["kind"] == "state")
    return _diagnostic("walk_forward", "passed" if passed else "failed", evidence, None if passed else "fold_association_not_consistent")


def _regimes(opts, x, y, symbols, bars, profile, auxiliary):
    covariates = auxiliary.get("covariates")
    if not isinstance(covariates, dict) or opts["field"] not in covariates:
        return _diagnostic("regimes", "incomplete", reason="missing_declared_covariate")
    covariate = _array(covariates[opts["field"]], len(x), "regime covariate")
    finite = np.isfinite(covariate)
    membership = np.searchsorted(opts["bins"], covariate, side="right")
    regimes = []
    for i in range(len(opts["bins"]) + 1):
        indices = np.flatnonzero(finite & (membership == i))
        summary = _associations(x, y, _groups(symbols, bars, profile["axis"], indices), profile, False)
        regimes.append({"bin": i, "lowerInclusive": None if i == 0 else opts["bins"][i - 1], "upperExclusive": None if i == len(opts["bins"]) else opts["bins"][i], "rows": len(indices), "association": summary["association"]})
    evidence = {"field": opts["field"], "fixedBins": opts["bins"], "missingCovariateRows": int(np.sum(~finite)), "regimes": regimes, "interpretation": "Conditional descriptive association using caller-frozen availability and bins."}
    if any(r["association"]["status"] != "computed" for r in regimes):
        return _diagnostic("regimes", "incomplete", evidence, "insufficient_declared_regime_samples")
    passed = _consistent([r["association"] for r in regimes], profile["kind"] == "state")
    return _diagnostic("regimes", "passed" if passed else "failed", evidence, None if passed else "regime_association_not_consistent")


def _sensitivity(candidate, opts, x, y, groups, profile, auxiliary, observed):
    matrix, mappings = auxiliary.get("sensitivityMatrix"), auxiliary.get("sensitivity")
    if not isinstance(matrix, dict) or not isinstance(mappings, list):
        return _diagnostic("sensitivity", "incomplete", reason="missing_precomputed_sensitivity")
    matching = [m for m in mappings if isinstance(m, dict) and m.get("candidateId") == candidate and m.get("argumentPath") == opts["argumentPath"]]
    if len(matching) != 1:
        return _diagnostic("sensitivity", "incomplete", reason="missing_or_ambiguous_parameter_path")
    neighbors = matching[0].get("neighbors")
    if not isinstance(neighbors, list):
        return _diagnostic("sensitivity", "incomplete", reason="missing_precomputed_neighbors")
    results = []
    for value in opts["neighbors"]:
        matches = [n for n in neighbors if isinstance(n, dict) and n.get("value") == value]
        if len(matches) != 1 or matches[0].get("column") not in matrix:
            return _diagnostic("sensitivity", "incomplete", {"neighbors": results}, "missing_or_ambiguous_precomputed_neighbor")
        neighbor = _array(matrix[matches[0]["column"]], len(x), "sensitivity neighbor")
        metric = _associations(neighbor, y, groups, profile, False)["association"]
        results.append({"parameterValue": value, "column": matches[0]["column"], "association": metric, "score": _score(metric, profile), "coverage": _metric(np.mean(np.isfinite(neighbor))) if len(neighbor) else _metric(reason="no_eligible_rows")})
    evidence = {"argumentPath": opts["argumentPath"], "baseline": observed, "neighbors": results, "computedByEvaluator": False, "interpretation": "Direction/separation across declared computed neighbors; no unrequested robustness threshold or parameter search."}
    if observed["status"] != "computed" or any(r["association"]["status"] != "computed" or r["coverage"]["status"] != "computed" or r["coverage"]["value"] < profile["minCoverage"] for r in results):
        return _diagnostic("sensitivity", "incomplete", evidence, "insufficient_neighbor_evidence")
    passed = _consistent([observed, *[r["association"] for r in results]], profile["kind"] == "state")
    return _diagnostic("sensitivity", "passed" if passed else "failed", evidence, None if passed else "neighbor_association_not_consistent")


def _quantiles(opts, x, y, groups, profile):
    count, state = opts["count"], profile["kind"] == "state"
    classes = sorted(set(float(v) for v in y[np.isfinite(y)])) if state else []
    bins, records = [[] for _ in range(count)], []
    excluded = 0
    for key, indices in groups:
        indices = indices[np.isfinite(x[indices]) & np.isfinite(y[indices])]
        if len(indices) < max(profile["minPairs"], count) or np.ptp(x[indices]) == 0:
            excluded += 1
            records.append({"group": key, "reason": "insufficient_pairs_or_constant_factor"})
            continue
        membership = np.minimum(count - 1, np.floor((rankdata(x[indices], method="average") - 0.5) * count / len(indices)).astype(int))
        if len(np.unique(membership)) < count:
            excluded += 1
            records.append({"group": key, "reason": "ties_leave_empty_quantiles"})
            continue
        for i in range(count):
            labels = y[indices[membership == i]]
            bins[i].append({"pairs": len(labels), "meanLabel": None if state else _finite_mean(labels), "stateProportions": [float(np.mean(labels == c)) for c in classes] if state else None})
    summary = []
    for i, members in enumerate(bins):
        item = {"quantile": i + 1, "pairs": sum(m["pairs"] for m in members), "groups": len(members)}
        if state:
            item["states"] = [{"state": c, "proportion": float(np.mean([m["stateProportions"][j] for m in members])) if members else None} for j, c in enumerate(classes)]
        else:
            item["meanLabel"] = _finite_mean(np.asarray([m["meanLabel"] for m in members])) if members else None
        summary.append(item)
    evidence = {"count": count, "method": "average_rank_ties_kept_together_equal_group_label_summaries", "bins": summary, "excludedGroups": excluded, "exclusions": records, "interpretation": "Descriptive future-label groups; quantile boundaries use this evaluated partition and are not fitted trading rules."}
    if not bins[0]:
        return _diagnostic("quantiles", "incomplete", evidence, "no_complete_quantile_groups")
    if state:
        evidence["monotonicity"] = _metric(reason="categorical_labels_have_no_numeric_order")
        return _diagnostic("quantiles", "passed", evidence)
    means = np.asarray([b["meanLabel"] for b in summary])
    evidence["monotonicity"] = _correlation(np.arange(count, dtype=float), means, 2, True)
    differences = np.diff(means)
    passed = (np.all(differences >= 0) and np.any(differences > 0)) or (np.all(differences <= 0) and np.any(differences < 0))
    return _diagnostic("quantiles", "passed" if passed else "failed", evidence, None if passed else "label_means_not_monotone")


def _diagnostics(candidate, x, y, symbols, bars, groups, profile, auxiliary, observed):
    results = []
    for d in profile["diagnostics"]:
        kind = d.get("kind") if isinstance(d, dict) else "unknown"
        try:
            opts = _diagnostic_options(d)
            if kind in ("placebo", "bootstrap"):
                result = _resampling(kind, d, opts, x, y, symbols, bars, profile, observed)
            elif kind == "walk_forward":
                result = _walk_forward(opts, x, y, symbols, bars, profile)
            elif kind == "regimes":
                result = _regimes(opts, x, y, symbols, bars, profile, auxiliary)
            elif kind == "sensitivity":
                result = _sensitivity(candidate, opts, x, y, groups, profile, auxiliary, observed)
            else:
                result = _quantiles(opts, x, y, groups, profile)
        except (ValueError, TypeError, KeyError, OverflowError, np.linalg.LinAlgError) as exc:
            result = _diagnostic(kind, "incomplete", {"error": str(exc)[:1000]}, "invalid_or_unaligned_diagnostic_input")
        results.append(result)
    return results


def _candidate(candidate, x, y, refs, symbols, bars, times, profile, auxiliary):
    groups = _groups(symbols, bars, profile["axis"])
    core = _associations(x, y, groups, profile)
    finite_x, finite_y = np.isfinite(x), np.isfinite(y)
    pairs = int(np.sum(finite_x & finite_y))
    coverage = _metric(np.mean(finite_x)) if len(x) else _metric(reason="no_eligible_rows")
    stability, windows = _stability(x, y, symbols, bars, profile)
    redundancy, complement, reference_details = _references(x, y, refs, groups, profile)
    score = _score(core["association"], profile)
    diagnostics = _diagnostics(candidate, x, y, symbols, bars, groups, profile, auxiliary, core["association"])
    insufficient, invalid = [], []
    if pairs < profile["minPairs"]:
        insufficient.append("insufficient_pairs")
    if coverage["status"] != "computed" or coverage["value"] < profile["minCoverage"]:
        insufficient.append("insufficient_factor_coverage")
    if score["status"] != "computed":
        insufficient.append("association_unavailable")
    if stability["status"] != "computed":
        insufficient.append("stability_unavailable")
    if not reference_details["complete"]:
        insufficient.append("reference_comparison_incomplete")
    if redundancy["status"] == "computed" and redundancy["value"] > profile["maxReferenceCorrelation"] + 1e-12:
        invalid.append("reference_correlation_exceeds_limit")
    for request, result in zip(profile["diagnostics"], diagnostics):
        if request.get("required"):
            if result["status"] == "failed":
                invalid.append(f"required_diagnostic_failed:{result['kind']}")
            elif result["status"] == "incomplete":
                insufficient.append(f"required_diagnostic_incomplete:{result['kind']}")
    details = {"axis": profile["axis"], "kind": profile["kind"], "rows": len(x), "pairs": pairs, "factorMissingOrNonfinite": int(np.sum(~finite_x)), "labelMissingOrNonfinite": int(np.sum(~finite_y)), "labelCoverage": _metric(np.mean(finite_y)) if len(y) else _metric(reason="no_eligible_rows"), "pairCoverage": _metric(pairs / len(x)) if len(x) else _metric(reason="no_eligible_rows"), "minimumPerGroup": profile["minPairs"], "coverageDenominator": "declared_key_rows", "aggregation": "equal_weight_within_symbol_temporal_associations" if profile["axis"] == "time_series" else "equal_weight_same_time_cross_sectional_associations", "stateStatistic": "eta_squared_factor_by_categorical_label" if profile["kind"] == "state" else None, "association": core["association"], "eligibleGroups": core["eligibleGroups"], "excludedGroups": core["excludedGroups"], "groups": core["groups"], "stability": windows, "references": reference_details, "limitations": ["Eligibility means the declared data and diagnostic requirements are met; it does not assert economic usefulness.", "Statistics do not correct whole-search multiplicity or certify untouched holdout data; trial and exposure provenance belongs to the workflow."]}
    return {"pairs": pairs, "coverage": coverage, "ic": core["ic"], "rankIC": core["rankIC"], "stability": stability, "maxReferenceCorrelation": redundancy, "complement": complement, "score": score, "diagnostics": diagnostics, "eligibility": "invalid" if invalid else "insufficient" if insufficient else "supported", "reasons": invalid + insufficient, "details": details}


def evaluate(keys, factors, labels, references, profile, diagnosticValues):
    """Return one Item per candidate, preserving successful siblings on bad columns.

    factors/references and decoded auxiliary matrices map column IDs to aligned
    numeric/null lists. The bridge has already verified matrix row-key identity.
    Shared malformed keys/labels/references fail every candidate, never realign.
    """
    if not isinstance(factors, dict):
        raise ValueError("factors must map candidate IDs to aligned vectors")
    def failed(candidate, exc):
        return {"id": candidate, "status": "failed", "error": {"code": "INVALID_EVALUATION_INPUT", "message": str(exc)[:2000], "retryable": False}}
    try:
        _profile(profile)
        symbols, bars, times = _keys(keys)
        y = _array(labels, len(keys), "labels")
        if not isinstance(references, dict):
            raise ValueError("references must map column IDs to aligned vectors")
        refs = {name: _array(values, len(keys), f"reference {name}") for name, values in references.items()}
        auxiliary = diagnosticValues if isinstance(diagnosticValues, dict) else {}
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        return [failed(candidate, exc) for candidate in factors]
    results = []
    for candidate, values in factors.items():
        try:
            if not isinstance(candidate, str) or not candidate:
                raise ValueError("candidate IDs must be nonempty strings")
            x = _array(values, len(keys), f"factor {candidate}")
            result = _candidate(candidate, x, y, refs, symbols, bars, times, profile, auxiliary)
            results.append({"id": candidate, "status": "ok", "value": result})
        except (ValueError, TypeError, KeyError, OverflowError, np.linalg.LinAlgError) as exc:
            results.append(failed(candidate, exc))
    return results
