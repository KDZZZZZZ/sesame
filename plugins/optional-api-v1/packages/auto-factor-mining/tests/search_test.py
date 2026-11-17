"""Actual DEAP/Optuna tests; no substitute search engines or market data."""

import copy
import importlib.metadata
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "python"))

from formula import OPERATOR_DIGEST, canonical_json, validate_and_compile
from search import SearchError, propose


def field(name="close"):
    return {"field": name}


def call(name, *args):
    return {"call": name, "args": list(args)}


def formula(tree):
    return {"dsl": "qlib-expr/1", "tree": tree}


def request_fixture(max_candidates=100):
    with (PACKAGE / "tests" / "fixtures" / "contracts.json").open(encoding="utf-8") as handle:
        fixture = json.load(handle)
    snapshot = fixture["artifacts"]["snapshot"]["payload"]
    layout = {key: value for key, value in snapshot["layout"].items() if key != "holdout"}
    return {
        "requestId": "search-test", "need": "Find a causal price/volume development factor",
        "development": {"snapshotId": snapshot["id"], "source": snapshot["source"], "layout": layout,
                        "fields": ["close", "volume"], "calendarDigest": snapshot["calendarDigest"]},
        "space": {"fields": ["close", "volume"], "operators": ["Add", "Sub", "Mul", "Div", "Abs", "Log", "Ref", "Mean", "Std", "Min", "Max", "Sum", "Rank"],
                  "windows": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16], "lags": [1, 2, 3], "constants": [-1, 0, 0.5, 1, 2],
                  "maxNodes": 48, "maxDepth": 7, "maxLookbackBars": 20,
                  "seeds": [formula(field()), formula(call("Sub", field(), field("volume")))],
                  "templates": [{"tree": call("Mean", field(), {"parameter": "window"}),
                                 "domains": {"window": [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16]}}]},
        "profile": {"id": "alpha-dev", "version": 1, "kind": "alpha", "axis": "time_series", "minPairs": 3,
                    "minCoverage": 0.8, "stabilityWindows": 3, "maxReferenceCorrelation": 0.9,
                    "score": "abs_rank_ic", "diagnostics": []},
        "references": [],
        "budget": {"maxCandidates": max_candidates, "batchSize": 16, "maxWorkers": 2, "maxSeconds": 60,
                   "maxInputBytes": 8 * 1024 * 1024, "maxOutputBytes": 8 * 1024 * 1024, "seed": 19},
    }


def outcome(candidate, score=0.5, suffix="", status="valid"):
    return {"candidateId": candidate["id"], "evaluationId": "ev_" + candidate["id"] + suffix,
            "developmentScore": score, "status": status, "reasons": [] if status == "valid" else ["insufficient pairs"]}


class SearchTests(unittest.TestCase):
    def test_real_engines_all_methods_and_typed_structural_operations(self):
        request = request_fixture(90)
        checkpoint, feedback, methods, operations = None, [], set(), set()
        generated = []
        for _ in range(12):
            result = propose(request, checkpoint, feedback, 8)
            checkpoint = result["checkpoint"]
            generated.extend(result["candidates"])
            methods.update(candidate["origin"]["method"] for candidate in result["candidates"])
            feedback = [outcome(candidate, (index + 1) / 20) for index, candidate in enumerate(result["candidates"])]
            if result["exhausted"]:
                break
        checkpoint = propose(request, checkpoint, feedback, 0)["checkpoint"]
        operations.update(attempt["operation"] for attempt in checkpoint["attempts"] if attempt["method"] == "deap")
        self.assertEqual(methods, {"seed", "template", "random", "deap", "optuna"})
        self.assertTrue({"mutation", "crossover"}.issubset(operations))
        self.assertEqual(checkpoint["engines"]["deap"], importlib.metadata.version("deap"))
        self.assertEqual(checkpoint["engines"]["optuna"], importlib.metadata.version("optuna"))
        self.assertEqual(checkpoint["engines"]["operatorDigest"], OPERATOR_DIGEST)
        self.assertTrue(any(event["kind"] == "tell" and event["state"] == "COMPLETE" for event in checkpoint["events"]))
        self.assertEqual(len({candidate["id"] for candidate in generated}), len(generated))
        for candidate in generated:
            compiled = validate_and_compile(candidate["formula"], request["space"])
            self.assertLessEqual(compiled["lookback"], request["space"]["maxLookbackBars"])
            self.assertEqual(candidate["id"], "c_" + compiled["digest"][7:])

    def test_checkpoint_resume_replays_actual_optuna_and_preserves_inputs(self):
        request = request_fixture()
        first = propose(request, None, [], 8)
        checkpoint = first["checkpoint"]
        feedback = [outcome(candidate, index / 20) for index, candidate in enumerate(first["candidates"])]
        before = canonical_json({"request": request, "checkpoint": checkpoint, "feedback": feedback})
        continued = propose(request, checkpoint, feedback, 8)
        self.assertEqual(continued, propose(request, json.loads(json.dumps(checkpoint)), feedback, 8))
        self.assertEqual(before, canonical_json({"request": request, "checkpoint": checkpoint, "feedback": feedback}))
        self.assertEqual(continued["checkpoint"]["feedback"][0]["value"], feedback[0])
        self.assertTrue(any(event["kind"] == "tell" for event in continued["checkpoint"]["events"]))
        # Exercise hash-randomized fresh interpreters, not merely a second call.
        script = "import sys,json;sys.path.insert(0,sys.argv[1]);from search import propose;v=json.load(sys.stdin);print(json.dumps(propose(**v),sort_keys=True))"
        payload = json.dumps({"request": request, "checkpoint": checkpoint, "feedback": feedback, "limit": 8})
        for hash_seed in ("11", "9123"):
            process = subprocess.run([sys.executable, "-c", script, str(PACKAGE / "python")], input=payload,
                                     text=True, capture_output=True, check=True, env={**os.environ, "PYTHONHASHSEED": hash_seed}, timeout=30)
            self.assertEqual(json.loads(process.stdout), continued)

    def test_feedback_failed_late_duplicate_unknown_and_conflict(self):
        request = request_fixture()
        first = propose(request, None, [], 8)
        candidate = next(item for item in first["candidates"] if item["origin"]["method"] == "optuna")
        failed = outcome(candidate, None, status="invalid")
        applied = propose(request, first["checkpoint"], [failed], 0)
        self.assertEqual(applied, propose(request, applied["checkpoint"], [failed, failed], 0))
        late = outcome(candidate, 0.99, suffix="_late")
        unknown = {**outcome(candidate), "candidateId": "not-reserved", "evaluationId": "ev-unknown"}
        final = propose(request, applied["checkpoint"], [late, unknown], 0)["checkpoint"]
        self.assertEqual([item["disposition"] for item in final["feedback"]], ["accepted", "late", "unknown"])
        tells = [event for event in final["events"] if event["kind"] == "tell" and event["attempt"] ==
                 next(attempt["sequence"] for attempt in final["attempts"] if attempt["candidateId"] == candidate["id"])]
        self.assertEqual(len(tells), 1)
        self.assertEqual(tells[0]["state"], "FAIL")
        self.assertNotIn(candidate["id"], final["population"])
        with self.assertRaisesRegex(SearchError, "different feedback"):
            propose(request, final, [{**failed, "developmentScore": 0.8}], 0)

    def test_development_scores_change_actual_tpe_proposals(self):
        request = request_fixture(180)
        first = propose(request, None, [], 16)
        positive = [outcome(candidate, candidate["origin"]["parameters"].get("window", 0) / 20)
                    for candidate in first["candidates"]]
        negative = [{**feedback, "developmentScore": -feedback["developmentScore"]} for feedback in positive]
        increasing = propose(request, first["checkpoint"], positive, 16)
        decreasing = propose(request, first["checkpoint"], negative, 16)
        offset = len(first["checkpoint"]["attempts"])
        parameters = lambda result: [attempt["parameters"] for attempt in result["checkpoint"]["attempts"][offset:]
                                     if attempt["method"] == "optuna"]
        self.assertTrue(parameters(increasing))
        self.assertTrue(parameters(decreasing))
        self.assertNotEqual(parameters(increasing), parameters(decreasing))

    def test_feedback_order_and_partial_settlement_are_durable(self):
        request = request_fixture()
        first = propose(request, None, [], 12)
        optimized = [item for item in first["candidates"] if item["origin"]["method"] == "optuna"]
        self.assertGreaterEqual(len(optimized), 2)
        order = [outcome(item, index / 4) for index, item in enumerate(reversed(optimized))]
        checkpoint = propose(request, first["checkpoint"], order[:1], 0)["checkpoint"]
        resumed = propose(request, checkpoint, order[1:], 5)
        self.assertEqual([item["value"] for item in resumed["checkpoint"]["feedback"][:len(order)]], order)
        self.assertEqual(resumed, propose(request, checkpoint, order[1:], 5))

    def test_duplicates_and_invalid_seeds_consume_budget_without_proposal(self):
        request = request_fixture(8)
        request["space"]["seeds"] = [formula(field()), formula(field()),
                                     formula(call("Ref", field(), {"constant": -1})),
                                     formula(call("Ref", field(), {"constant": 0})),
                                     formula({"field": "label"}),
                                     formula(call("Mean", field(), {"constant": 999})),
                                     {"dsl": "qlib-expr/1", "tree": {"call": "__import__", "args": [field()]}},
                                     formula(call("Mean", call("Mean", field(), {"constant": 16}), {"constant": 16}))]
        result = propose(request, None, [], 16)
        self.assertTrue(result["exhausted"])
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["checkpoint"]["budget"], {"used": 8, "proposed": 1, "failed": 6, "duplicates": 1, "remaining": 0})
        self.assertEqual([item["sequence"] for item in result["checkpoint"]["attempts"]], list(range(8)))
        self.assertEqual(propose(request, result["checkpoint"], [], 16)["candidates"], [])

    def test_small_byte_budget_stops_before_any_unrecorded_attempt(self):
        request = request_fixture()
        request["budget"]["maxOutputBytes"] = 1024
        result = propose(request, None, [], 8)
        self.assertTrue(result["exhausted"])
        self.assertEqual(result["checkpoint"]["stopReason"], "checkpoint_bytes")
        self.assertEqual(result["checkpoint"]["attempts"], [])
        self.assertLessEqual(len(canonical_json(result).encode()), 1024)

    def test_checkpoint_byte_stop_reserves_pending_terminal_feedback(self):
        request = request_fixture(1000)
        request["budget"]["maxOutputBytes"] = 200000
        result = propose(request, None, [], 16)
        self.assertTrue(result["exhausted"])
        self.assertEqual(result["checkpoint"]["stopReason"], "checkpoint_bytes")
        self.assertGreater(len(result["candidates"]), 0)
        self.assertEqual(len(result["checkpoint"]["attempts"]), result["checkpoint"]["budget"]["used"])
        feedback = [{**outcome(candidate, None, status="invalid"), "reasons": ["x" * 400] * 30}
                    for candidate in result["candidates"]]
        final = propose(request, result["checkpoint"], feedback, 0)
        self.assertEqual(len(final["checkpoint"]["feedback"]), len(feedback))
        self.assertLessEqual(len(canonical_json(final).encode()), request["budget"]["maxOutputBytes"])
        self.assertEqual(final["checkpoint"]["attempts"], result["checkpoint"]["attempts"])

    def test_rejects_incomplete_or_changed_optuna_event_history(self):
        request = request_fixture()
        result = propose(request, None, [], 8)
        candidate = next(item for item in result["candidates"] if item["origin"]["method"] == "optuna")
        settled = propose(request, result["checkpoint"], [outcome(candidate)], 0)["checkpoint"]
        changed = copy.deepcopy(settled)
        changed["events"] = [event for event in changed["events"] if event["kind"] != "tell"]
        with self.assertRaisesRegex(SearchError, "outcome does not match"):
            propose(request, changed, [], 1)
        changed = copy.deepcopy(result["checkpoint"])
        attempt = next(item for item in changed["attempts"] if item["candidateId"] == candidate["id"])
        attempt["parameters"]["window"] = 999
        with self.assertRaisesRegex(SearchError, "replay diverged"):
            propose(request, changed, [], 1)

    def test_rejects_holdout_files_labels_and_unbound_template_parameters(self):
        base = request_fixture()
        bad_inputs = []
        request = copy.deepcopy(base)
        request["development"]["layout"]["holdout"] = ["2027-01-01", "2028-01-01"]
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["development"]["provider"] = {"path": "should-never-be-read"}
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["profile"]["holdout"] = [0.5, 0.6]
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["space"]["templates"][0]["domains"]["unused"] = [1, 2]
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["space"]["templates"][0]["tree"] = {"parameter": "undeclared"}
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["development"]["layout"]["target"] = {"kind": "provided", "field": "close", "scale": "continuous", "horizonBars": 1}
        bad_inputs.append(request)
        request = copy.deepcopy(base)
        request["space"]["windows"] = [0]
        bad_inputs.append(request)
        for request in bad_inputs:
            with self.subTest(request=request), self.assertRaises(ValueError):
                propose(request, None, [], 8)
        # Metadata is enough; the fixture's source ref does not exist on disk.
        self.assertTrue(propose(base, None, [], 2)["candidates"])

    def test_request_and_engine_versions_are_frozen(self):
        request = request_fixture()
        checkpoint = propose(request, None, [], 4)["checkpoint"]
        changed = copy.deepcopy(request)
        changed["budget"]["maxCandidates"] += 1
        with self.assertRaisesRegex(SearchError, "different frozen request"):
            propose(changed, checkpoint, [], 4)
        checkpoint["engines"]["optuna"] = "unknown"
        with self.assertRaisesRegex(SearchError, "versions changed"):
            propose(request, checkpoint, [], 4)

    def test_canonical_integral_floats_and_global_random_state(self):
        request = request_fixture(3)
        request["space"]["seeds"] = [formula(call("Mean", field(), {"constant": 2})),
                                     formula(call("Mean", field(), {"constant": 2.0})),
                                     formula(call("Add", field(), {"constant": -0.0}))]
        before = random.getstate()
        result = propose(request, None, [], 8)
        self.assertEqual(random.getstate(), before)
        self.assertEqual(result["checkpoint"]["budget"]["duplicates"], 1)
        self.assertEqual(result["candidates"][0]["id"], "c_476722f42e0577f14acd3379e96a23e0ed48e10b853eb85ced633010be10afe8")
        script = "import{canonical,digest}from './plugins/optional-api-v1/packages/auto-factor-mining/contracts.js';let s='';for await(const c of process.stdin)s+=c;const value=JSON.parse(s);console.log(JSON.stringify({canonical:canonical(value),digest:digest(value)}));"
        identity = {"dsl": "qlib-expr/1", "operatorDigest": OPERATOR_DIGEST, "tree": result["candidates"][0]["formula"]["tree"]}
        process = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(identity),
                                 cwd=PACKAGE.parents[3], text=True, capture_output=True, check=True, timeout=30)
        actual = json.loads(process.stdout)
        self.assertEqual(actual["canonical"], canonical_json(identity))
        self.assertEqual("c_" + actual["digest"][7:], result["candidates"][0]["id"])


if __name__ == "__main__":
    unittest.main()
