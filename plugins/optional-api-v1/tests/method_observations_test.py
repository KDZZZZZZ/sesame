"""Finite rule/temporal counterexamples; no provider, account or model calls."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PACKAGES = Path(__file__).resolve().parents[1] / "packages"
sys.path.insert(0, str(PACKAGES / "price-action/scripts"))


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_") + "_observe", PACKAGES / name / "scripts/observe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.observe


PA, ICT = load("price-action"), load("ict")


class Observations(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads((PACKAGES / "ict/examples/bars.json").read_text())
        self.source = json.loads((PACKAGES / "ict/examples/source.json").read_text())

    def test_known_price_action_with_delayed_confirmation(self):
        events = PA(self.rows, self.source)
        self.assertEqual([(x["kind"], x["level"]) for x in events], [
            ("pivot-high", "15"), ("pivot-low", "8"), ("close-break-up", "15"),
            ("pivot-high", "20"), ("close-break-down", "8"), ("pivot-low", "7")])
        self.assertEqual(events[0]["event_time"], self.rows[2]["datetime"])
        self.assertEqual(events[0]["confirmed_at"], self.rows[4]["end_time"])
        self.assertEqual(events[2]["confirmed_at"], self.rows[7]["end_time"])
        self.assertEqual(PA(self.rows[:4], self.source), [])

    def test_ict_five_exact_intervals_are_not_institutional_evidence(self):
        events = ICT(self.rows, self.source)
        self.assertEqual([(e["lower"], e["upper"]) for e in events], [("14", "18"), ("16", "18"), ("14", "16"), ("10", "14"), ("11", "12")])
        self.assertEqual(events[0]["confirmed_at"], self.rows[8]["end_time"])
        self.assertTrue(all(e["institutional_orders"] == "not-observed" and e["calendar_continuity"] == "not-established" for e in events))
        self.assertTrue(all(e["adjacent_intervals"] for e in events))

    def test_every_prefix_preserves_only_available_observations(self):
        for fn in [PA, ICT]:
            full = fn(self.rows, self.source)
            for n in range(len(self.rows) + 1):
                eligible = [e for e in full if n and e["confirmed_at"]["unixMs"] <= self.rows[n - 1]["end_time"]["unixMs"]]
                self.assertEqual(fn(self.rows[:n], self.source), eligible)

    def test_future_extreme_does_not_rewrite_old_observation(self):
        earlier = PA(self.rows[:8], self.source)
        self.rows[14].update(open="1000", high="1002", low="999", close="1001")
        self.assertEqual(PA(self.rows, self.source)[:len(earlier)], earlier)

    def test_equal_pivot_is_unconfirmed_and_wick_is_not_close_break(self):
        self.rows[3]["high"] = "15"
        self.assertFalse(any(e.get("pivot_bar") == "demo-02" for e in PA(self.rows, self.source)))
        self.setUp()
        self.rows[7]["close"] = "14"
        self.assertFalse(any(e["kind"] == "close-break-up" for e in PA(self.rows[:8], self.source)))

    def test_decimal_prices_do_not_round_through_float(self):
        rows = self.rows[:3]
        for i, row in enumerate(rows):
            value = "9007199254740991000000000000000." + str(i + 1)
            row.update(open=value, high=value, low=value, close=value)
        events = ICT(rows, self.source)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["lower"], rows[0]["high"])
        self.assertEqual(events[0]["upper"], rows[2]["low"])

    def test_nonpositive_prices_valid_but_ohlc_and_floats_are_not(self):
        for row in self.rows:
            row.update(open="-2", high="0", low="-3", close="-1")
        self.assertEqual(ICT(self.rows, self.source), [])
        for invalid in [1.1, True, "NaN", "1e10"]:
            rows = copy.deepcopy(self.rows); rows[0]["close"] = invalid
            with self.assertRaises(ValueError): ICT(rows, self.source)
        self.rows[0]["close"] = "1"
        with self.assertRaisesRegex(ValueError, "OHLC"): PA(self.rows, self.source)

    def test_forming_or_unknown_closure_cannot_be_silently_removed(self):
        for patch in [{"is_closed": False}, {"closure": "unknown"}]:
            rows = copy.deepcopy(self.rows); rows[7].update(patch)
            for fn in [ICT, PA]:
                with self.assertRaisesRegex(ValueError, "closure evidence"): fn(rows, self.source)

    def test_clock_identity_fold_order_overlap_are_checked(self):
        for mutation in ["duplicate-id", "duplicate-time", "overlap", "authority", "fold"]:
            rows = copy.deepcopy(self.rows)
            if mutation == "duplicate-id": rows[1]["id"] = rows[0]["id"]
            elif mutation == "duplicate-time": rows[1]["datetime"] = rows[0]["datetime"]
            elif mutation == "overlap": rows[0]["end_time"]["unixMs"] += 1
            else:
                for index, row in enumerate(rows):
                    row["datetime"] = {"basis": "wall", "authority": "a", "zone": "Asia/Shanghai", "value": f"2026-01-01T00:{index:02}:00"}
                    row["end_time"] = {**row["datetime"], "value": f"2026-01-01T00:{index + 1:02}:00"}
                if mutation == "authority": rows[3]["datetime"]["authority"] = "another"
                else: rows[3]["datetime"]["fold"] = 0
            with self.assertRaises(ValueError, msg=mutation): ICT(rows, self.source)

    def test_utc_is_an_integer_source_time_with_string_raw(self):
        for patch in [{"unixMs": True}, {"unixMs": 1.5}, {"raw": {"unexpected": "object"}}]:
            rows = copy.deepcopy(self.rows); rows[0]["datetime"].update(patch)
            with self.assertRaises(ValueError): ICT(rows, self.source)

    def test_wall_fractions_keep_original_source_time_without_utc_conversion(self):
        for i, row in enumerate(self.rows):
            row["datetime"] = {"basis": "wall", "authority": "broker", "value": f"2026-01-01T00:{i:02}:00.100"}
            row["end_time"] = {"basis": "wall", "authority": "broker", "value": f"2026-01-01T00:{i+1:02}:00.1"}
        events = ICT(self.rows, self.source)
        self.assertEqual(events[0]["confirmed_at"], self.rows[8]["end_time"])
        self.assertNotIn("unixMs", events[0]["confirmed_at"])
        self.rows[4]["datetime"]["zone"] = "Asia/Shanghai"
        with self.assertRaises(ValueError): ICT(self.rows, self.source)

    def test_calendar_gap_remains_visible(self):
        for row in self.rows[8:]:
            row["datetime"]["unixMs"] += 60000
            row["end_time"]["unixMs"] += 60000
        self.assertFalse(ICT(self.rows, self.source)[0]["adjacent_intervals"])
        self.assertFalse(self.source["coverage"]["complete"])

    def test_volume_null_units_ticks_and_negative_values(self):
        self.assertTrue(all(r["volume"] is None for r in self.rows))
        for row in self.rows:
            row.update(volume_kind="real", volume_status="value", volume="10", volume_unit="share")
        self.assertEqual(len(ICT(self.rows, self.source)), 5)
        for patch in [{"volume": "-1"}, {"volume_unit": "lot"}, {"volume_status": "unknown"}, {"volume_kind": "none"}, {"volume_kind": "tick", "volume_unit": "tick", "volume": "1.5"}]:
            rows = copy.deepcopy(self.rows); rows[0].update(patch)
            with self.assertRaises(ValueError): ICT(rows, self.source)

    def test_fixed_ref_and_no_credentials_in_descriptor(self):
        source = {**self.source, "provenance_kind": "observed"}
        with self.assertRaisesRegex(ValueError, "DataRef"): ICT(self.rows, source)
        source = {**self.source, "configuration": {"token": "not-a-real-token"}}
        with self.assertRaisesRegex(ValueError, "credentials"): ICT(self.rows, source)

    def test_budget_and_window_rejection(self):
        with self.assertRaisesRegex(ValueError, "10000"): ICT([{}] * 10001, self.source)
        for n in [0, 21, True, 1.5]:
            with self.assertRaises(ValueError): PA(self.rows, self.source, n, 2)

    def test_both_standalone_clis_run_and_invalid_input_does_not_overwrite(self):
        for name in ["ict", "price-action"]:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                (path / "rows.json").write_text(json.dumps(self.rows))
                (path / "source.json").write_text(json.dumps(self.source))
                args = [sys.executable, "-B", str(PACKAGES / name / "scripts/observe.py"), "--input", str(path / "rows.json"), "--source", str(path / "source.json"), "--output", str(path / "result.json")]
                done = subprocess.run(args, capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(json.loads(done.stdout)["observations"], 5 if name == "ict" else 6)
                saved = (path / "result.json").read_bytes()
                rows = copy.deepcopy(self.rows); rows[0]["is_closed"] = False
                (path / "rows.json").write_text(json.dumps(rows))
                failed = subprocess.run(args, capture_output=True, text=True)
                self.assertEqual(failed.returncode, 2)
                self.assertEqual((path / "result.json").read_bytes(), saved)


if __name__ == "__main__":
    unittest.main()
