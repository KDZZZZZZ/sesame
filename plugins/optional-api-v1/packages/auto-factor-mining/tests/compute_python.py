import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from compute import compute, prepare
from data import read_json, Writer
from formula import OPERATOR_DIGEST, canonical_json, digest_json, validate_and_compile, FormulaError

LIMITS = {"maxInputBytes": 8 * 1024 * 1024, "maxOutputBytes": 16 * 1024 * 1024, "timeoutMs": 60000, "maxDiagnosticWork": 64}
BUDGET = {"maxCandidates": 64, "batchSize": 16, "maxWorkers": 1, "maxSeconds": 120, "maxInputBytes": LIMITS["maxInputBytes"], "maxOutputBytes": LIMITS["maxOutputBytes"], "seed": 7}
SOURCE = {"id": "source", "revision": "1", "digest": "sha256:" + "a" * 64, "kind": "data", "schemaVersion": "1.0.0"}


def formula(tree):
    return {"dsl": "qlib-expr/1", "tree": tree}


def field(name="close"):
    return {"field": name}


def call(op, *args):
    return {"call": op, "args": [arg if isinstance(arg, dict) else {"constant": arg} for arg in args]}


def candidate(name, tree):
    return {"id": name, "formula": formula(tree), "hypothesis": "synthetic numerical golden", "origin": {"method": "seed", "parents": [], "parameters": {}}}


def write(path, value, binary=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = value if binary else canonical_json(value).encode()
    path.write_bytes(payload)
    return {"path": str(path.resolve()), "digest": "sha256:" + hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}


def matrix(local):
    manifest = read_json(local)
    keys, columns = [], {name: [] for name in manifest["columns"]}
    for local in manifest["shards"]:
        shard = read_json(local)
        keys.extend(shard["keys"])
        for name in columns:
            columns[name].extend(shard["columns"][name])
    assert digest_json(keys) == manifest["rowOrderDigest"]
    return keys, columns


class FormulaTests(unittest.TestCase):
    def test_typed_validation_and_identity(self):
        tree = call("Ref", call("Mean", call("Mean", field(), 3), 2), 2)
        result = validate_and_compile(formula(tree), {"fields": ["close"]})
        self.assertEqual(result["lookback"], 5)
        self.assertEqual(result["expression"], "Ref(Mean(Mean($close,3),2),2)")
        self.assertEqual(validate_and_compile(formula(call("Mean", field(), 2)), {"fields": ["close"]})["digest"], validate_and_compile(formula(call("Mean", field(), 2.0)), {"fields": ["close"]})["digest"])
        self.assertEqual(canonical_json([-0.0, 1.0, 0.000001, 0.0000001]), "[0,1,0.000001,1e-7]")
        for tree in [call("Ref", field(), 0), call("Ref", field(), -1), call("Mean", field(), 0), call("Mean", field(), 10001), call("Mean", field(), 1.5), {"field": "close);__import__('os')"}, {"constant": 3}, {"call": "__import__", "args": []}, call("Abs", {"constant": 1})]:
            with self.subTest(tree=tree), self.assertRaises(FormulaError):
                validate_and_compile(formula(tree), {"fields": ["close"]})

    def test_provider_index_recursively_bounds_dependency_fanout(self):
        with tempfile.TemporaryDirectory() as directory:
            writer = Writer(directory, {"maxOutputBytes": 16 * 1024 * 1024})
            # More than 128 leaf groups exercises a second index level without
            # generating thousands of redundant binary feature files.
            features = [{"symbol": f"s{index:06}", "field": "close", "file": {"path": f"{directory}/feature-{index}.bin", "digest": "sha256:" + "a" * 64, "bytes": 8}} for index in range(128 * 128 + 1)]
            index = writer.feature_index(features)
            self.assertEqual(len(index["featureGroups"]), 2)

            def inspect(local):
                value = read_json(local)
                self.assertEqual(value["schema"], "factor-provider-features/1")
                children = value.get("groups", value.get("features"))
                self.assertLessEqual(len(children), 128)
                return sum(inspect(child) for child in children) if "groups" in value else len(children)

            self.assertEqual(sum(inspect(group) for group in index["featureGroups"]), len(features))


class ComputeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".compute-test-", dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.sequence = 0

    def tearDown(self):
        self.temp.cleanup()

    def rows(self, close, symbol="A"):
        return [{"time": f"2026-01-01T{index:02}:00:00Z", "symbol": symbol, "availableAt": f"2026-01-01T{index:02}:00:00Z", "fields": {"close": value, "regime": index % 2, "known": 1 if index % 2 else 0}} for index, value in enumerate(close) if value != "missing"]

    def snapshot(self, rows, dev=(0, 5), hold=(6, 7), target=None):
        self.sequence += 1
        layout = {"universe": sorted({row["symbol"] for row in rows}), "frequency": "60min", "timezone": "UTC", "availableAt": "bar_close", "development": [f"2026-01-01T{index:02}:00:00Z" for index in dev], "holdout": [f"2026-01-01T{index:02}:00:00Z" for index in hold], "target": target or {"kind": "forward_return", "field": "close", "horizonBars": 1}}
        output = prepare({"sourceRef": SOURCE, "rows": [write(self.root / f"source-{self.sequence}.json", rows)], "layout": layout, "budget": BUDGET, "outputDir": str(self.root / f"prepare-{self.sequence}")}, LIMITS)
        value = {**output["snapshot"], "source": SOURCE, "provider": output["provider"], "usageLedgerRef": output["usageLedger"]}
        for name in ("development", "holdout"):
            manifest = read_json(output[name])
            value[name] = {"manifest": output[name], "digest": output[name]["digest"], "rows": manifest["rows"], "bytes": output[name]["bytes"] + sum(local["bytes"] for local in manifest["shards"])}
        return write(self.root / f"snapshot-{self.sequence}.json", value), output

    def run_compute(self, snapshot, candidates, partition="development", diagnostics=None):
        self.sequence += 1
        request = {"snapshot": snapshot, "candidates": candidates, "partition": partition, "outputDir": str(self.root / f"compute-{self.sequence}")}
        if diagnostics is not None:
            request["diagnostics"] = diagnostics
        return compute(request, LIMITS)

    def assert_vector(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for got, wanted in zip(actual, expected):
            if wanted is None:
                self.assertIsNone(got)
            else:
                self.assertAlmostEqual(got, wanted, places=5)

    def test_nested_windows_ref_ties_zero_and_missing_grid(self):
        snapshot, _ = self.snapshot(self.rows([1, 2, 2, "missing", 4, 0, 8, 16, 32]))
        result = self.run_compute(snapshot, [candidate("mean", call("Mean", field(), 3)), candidate("nested", call("Mean", call("Mean", field(), 2), 2)), candidate("lag", call("Ref", field(), 1)), candidate("rank", call("Rank", field(), 3)), candidate("zero", call("Div", field(), 0)), candidate("bad", call("Ref", field(), -1))])
        keys, columns = matrix(result["matrix"])
        self.assertEqual([key["barIndex"] for key in keys], list(range(6)))
        self.assert_vector(columns["mean"], [None, None, 5 / 3, 2, 3, 2])
        self.assert_vector(columns["nested"], [None, None, 1.75, 2, 3, 3])
        self.assert_vector(columns["lag"], [None, 1, 2, 2, None, 4])
        self.assert_vector(columns["rank"], [None, None, 5 / 6, None, 1, 0.5])
        self.assert_vector(columns["zero"], [None] * 6)
        self.assertEqual(result["values"]["candidates"][-1]["status"], "failed")
        self.assertEqual(sum(item["status"] == "ok" for item in result["values"]["candidates"]), 5)
        self.assertEqual(result["values"]["engine"]["name"], "qlib")
        self.assertEqual(result["values"]["engine"]["version"], "0.9.7")
        self.assertEqual(result["values"]["engine"]["operatorDigest"], OPERATOR_DIGEST)
        self.assert_vector(matrix(result["labels"])[1]["target"], [1, 0, None, None, -1, None])

    def test_warmup_future_perturbation_covariates_and_neighbors(self):
        original = self.rows([1, 2, 4, 8, 16, 32, 64, 128, 256])
        changed = copy.deepcopy(original)
        for row in changed[6:]:
            row["fields"]["close"] = 99999
        before, _ = self.snapshot(original, dev=(2, 5))
        after, _ = self.snapshot(changed, dev=(2, 5))
        item = candidate("mean2", call("Mean", field(), 2))
        diagnostics = {"covariateFields": ["regime", "absent"], "sensitivity": [{"candidateId": "mean2", "argumentPath": [1], "neighbors": [{"value": 1, "column": "n1", "formula": formula(call("Mean", field(), 1))}, {"value": 3, "column": "n3", "formula": formula(call("Mean", field(), 3))}]}]}
        left = self.run_compute(before, [item], diagnostics=diagnostics)
        right = self.run_compute(after, [item])
        self.assertEqual(matrix(left["matrix"]), matrix(right["matrix"]))
        self.assertEqual(matrix(left["labels"]), matrix(right["labels"]))
        self.assert_vector(matrix(left["matrix"])[1]["mean2"], [3, 6, 12, 24])
        self.assertEqual(matrix(left["diagnosticValues"]["covariates"]["manifest"])[1]["regime"], [0, 1, 0, 1])
        self.assert_vector(matrix(left["diagnosticValues"]["sensitivityMatrix"]["manifest"])[1]["n3"], [7 / 3, 14 / 3, 28 / 3, 56 / 3])
        self.assert_vector(matrix(left["labels"])[1]["target"], [1, 1, 1, None])
        holdout = self.run_compute(before, [item], partition="holdout")
        self.assert_vector(matrix(holdout["labels"])[1]["target"], [1, 1])

    def test_more_than_256_provider_features_compute_through_grouped_index(self):
        rows = []
        for symbol_index in range(4):
            for row in self.rows([1, 2, 4, 8, 16, 32, 64, 128, 256], symbol=f"S{symbol_index}"):
                row["fields"] = {"close": row["fields"]["close"], **{f"feature_{index}": symbol_index * 100 + index for index in range(64)}}
                rows.append(row)
        snapshot, prepared = self.snapshot(rows)
        provider = read_json(prepared["provider"])
        self.assertNotIn("features", provider)
        self.assertEqual(len(provider["featureGroups"]), 3)
        groups = [read_json(group) for group in provider["featureGroups"]]
        self.assertEqual(sum(len(group["features"]) for group in groups), 260)
        self.assertTrue(all(len(group["features"]) <= 128 for group in groups))
        result = self.run_compute(snapshot, [candidate("large", call("Add", field("feature_63"), field()))])
        keys, columns = matrix(result["matrix"])
        self.assert_vector(columns["large"], [int(key["symbol"][1:]) * 100 + 63 + 2 ** key["barIndex"] for key in keys])
        self.assertTrue(all(item["status"] == "ok" for item in result["values"]["candidates"]))
        branch = write(self.root / "feature-branch.json", {"schema": "factor-provider-features/1", "groups": provider["featureGroups"]})
        nested_provider = write(self.root / "nested-provider.json", {**provider, "featureGroups": [branch]})
        nested_snapshot = write(self.root / "nested-snapshot.json", {**read_json(snapshot), "provider": nested_provider})
        nested = self.run_compute(nested_snapshot, [candidate("large", call("Add", field("feature_63"), field()))])
        self.assertEqual(matrix(result["matrix"]), matrix(nested["matrix"]))

    def test_availability_provided_target_and_provider_rehydration(self):
        rows = self.rows([1, 2, 4, 8, 16, 32, 64, 128, 256])
        rows[2]["availableAt"] = "2026-01-01T03:00:00Z"
        snapshot, prepared = self.snapshot(rows, target={"kind": "provided", "field": "known", "scale": "categorical", "horizonBars": 1})
        self.assertNotIn("known", read_json(snapshot)["fields"])
        left = self.run_compute(snapshot, [candidate("raw", field()), candidate("forbidden", field("known"))])
        self.assertIsNone(matrix(left["matrix"])[1]["raw"][2])
        self.assertEqual(left["values"]["candidates"][1]["status"], "failed")
        counter = [0]

        def relocate(value):
            if isinstance(value, dict) and set(value) == {"path", "digest", "bytes"}:
                counter[0] += 1
                raw = Path(value["path"]).read_bytes()
                destination = self.root / "resumed-inputs" / str(counter[0])
                try:
                    content = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    return write(destination.with_suffix(".bin"), raw, True)
                return write(destination.with_suffix(".json"), relocate(content))
            if isinstance(value, dict):
                return {key: relocate(item) for key, item in value.items()}
            if isinstance(value, list):
                return [relocate(item) for item in value]
            return value

        resumed = relocate(snapshot)
        old = Path(prepared["provider"]["path"]).parent.resolve()
        self.assertTrue(old.is_relative_to(self.root.resolve()))
        old.rename(self.root / "expired-attempt")
        right = self.run_compute(resumed, [candidate("raw", field()), candidate("forbidden", field("known"))])
        self.assertEqual(matrix(left["matrix"]), matrix(right["matrix"]))
        self.assertEqual(left["values"]["candidates"][0]["value"]["computeKey"], right["values"]["candidates"][0]["value"]["computeKey"])
        with self.assertRaisesRegex(ValueError, "digest"):
            damaged = dict(resumed, digest="sha256:" + "0" * 64)
            self.run_compute(damaged, [candidate("raw", field())])

    def test_forward_volatility_and_input_budgets(self):
        snapshot, _ = self.snapshot(self.rows([1, 2, 6, 12, 12, 24, 48, 96, 192]), target={"kind": "forward_volatility", "field": "close", "horizonBars": 2})
        result = self.run_compute(snapshot, [candidate("raw", field())])
        self.assert_vector(matrix(result["labels"])[1]["target"], [math.sqrt(0.5), math.sqrt(0.5), math.sqrt(0.5), math.sqrt(0.5), None, None])
        invalid = self.rows([1, 2, 4, 8, 16, 32, 64, 128])
        invalid[1]["time"] = "2026-01-01T01:30:00Z"
        with self.assertRaisesRegex(ValueError, "grid"):
            self.snapshot(invalid)

    def test_frozen_contract_fixture(self):
        fixture = json.loads((Path(__file__).resolve().parent / "fixtures" / "contracts.json").read_text(encoding="utf-8"))
        artifacts = {item["ref"]["id"]: item for item in fixture["artifacts"].values()}
        materialized = {}

        def materialize(value):
            if isinstance(value, dict) and set(value) == {"id", "revision", "digest", "kind", "schemaVersion"} and value["id"] in artifacts:
                if value["id"] not in materialized:
                    item = artifacts[value["id"]]
                    if item["payloadEncoding"] == "base64":
                        import base64
                        materialized[value["id"]] = write(self.root / "fixture" / f"{value['id']}.bin", base64.b64decode(item["payload"]), True)
                    else:
                        materialized[value["id"]] = write(self.root / "fixture" / f"{value['id']}.json", materialize(item["payload"]))
                return materialized[value["id"]]
            if isinstance(value, dict):
                return {key: materialize(item) for key, item in value.items()}
            if isinstance(value, list):
                return [materialize(item) for item in value]
            return value

        snapshot = materialize(fixture["artifacts"]["snapshot"]["ref"])
        result = self.run_compute(snapshot, [candidate("c-mean2", fixture["formula"]["tree"])])
        keys, columns = matrix(result["matrix"])
        self.assertEqual(digest_json(keys), fixture["expected"]["rowOrderDigest"])
        self.assert_vector(columns["c-mean2"], [None, 1.5, None, 3])
        self.assertEqual(matrix(result["labels"])[1]["target"], fixture["expected"]["developmentBoundaryLabels"])


if __name__ == "__main__":
    unittest.main()
