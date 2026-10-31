"""Offline clock-domain regressions. No SDK, account, database, or network access."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as N
import unittest

BACKEND = Path(__file__).resolve().parents[1] / "packages/mt5/backend"
REVISION = "ftmo-demo-current-tick-2026-v1"


def wall_ms(value):
    # Test oracle: UTC-labelled calendar arithmetic encodes the server wall fields.
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    value = datetime.datetime.fromisoformat(value).replace(tzinfo=datetime.timezone.utc)
    return (value - epoch) // datetime.timedelta(milliseconds=1)


class QuoteClockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("fixture_quote_clock", BACKEND / "quote_clock.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def resolve(self, timestamp, account=None, after=None):
        account = account if account is not None else N(login=9007199254740993, server="FTMO-Demo")
        after = after if after is not None else account
        return self.module.resolve_quote_clock(N(time_msc=timestamp), account, after)

    def test_exact_annual_boundaries_are_half_open_and_offset_is_not_fitted_to_now(self):
        for value, offset in [
            ("2026-01-01T00:00:00", 120),
            ("2026-03-08T08:59:59.999", 120),
            ("2026-03-08T10:00:00", 180),
            ("2026-10-25T03:00:00", 180),  # European change must not shift FTMO.
            ("2026-10-31T23:59:59.999", 180),
            ("2026-11-02T00:00:00", 120),
            ("2026-12-31T23:59:59.999", 120),
        ]:
            with self.subTest(value=value):
                raw = wall_ms(value); proof = self.resolve(raw)
                self.assertEqual(proof, {
                    "status": "verified", "source": "mt5/python/symbol_info_tick", "server": "FTMO-Demo",
                    "accountId": "9007199254740993", "rawTimeMs": raw,
                    "sourceTimeMs": raw - offset * 60000, "basis": "server-wall",
                    "offsetMinutes": offset, "ruleId": "ftmo-demo-current-tick-2026", "ruleRevision": REVISION,
                })

    def test_spring_gap_entire_unknown_autumn_day_and_uncovered_years_are_rejected(self):
        for value in ("2025-12-31T23:59:59.999", "2026-03-08T09:00:00", "2026-03-08T09:59:59.999",
                      "2026-11-01T00:00:00", "2026-11-01T08:30:00", "2026-11-01T23:59:59.999", "2027-01-01T00:00:00"):
            with self.subTest(value=value):
                proof = self.resolve(wall_ms(value))
                self.assertEqual(proof["status"], "unverified")
                self.assertIsNone(proof["sourceTimeMs"])
                self.assertIsNone(proof["offsetMinutes"])
                self.assertEqual(proof["basis"], "unknown")
                self.assertTrue(proof["reason"])

    def test_exact_server_identity_is_required_without_fixture_or_substring_fallback(self):
        for server in ("Fixture-Demo", "ftmo-demo", "FTMO-Demo-2", "Other", ""):
            with self.subTest(server=server):
                proof = self.resolve(1792585999508, N(login=42, server=server))
                self.assertEqual(proof["status"], "unverified")
                self.assertIsNone(proof["sourceTimeMs"])

    def test_account_change_missing_account_and_invalid_source_never_verify(self):
        account = N(login=42, server="FTMO-Demo")
        for after in (None, N(login=43, server="FTMO-Demo"), N(login=42, server="Other")):
            proof = self.module.resolve_quote_clock(N(time_msc=1792585999508), account, after)
            self.assertEqual(proof["status"], "unverified")
            self.assertIsNone(proof["sourceTimeMs"])
        for raw in (True, None, "1792585999508", 1792585999508.0, -1, 2**53):
            proof = self.resolve(raw)
            self.assertEqual(proof["status"], "unverified")
            self.assertIsNone(proof["sourceTimeMs"])

    def test_raw_tick_is_not_mutated_and_milliseconds_are_preserved(self):
        tick = {"time": 1792585999, "time_msc": 1792585999508, "bid": 1.1, "ask": 1.2}
        before = dict(tick); account = {"login": 42, "server": "FTMO-Demo"}
        proof = self.module.resolve_quote_clock(tick, account, account)
        self.assertEqual(tick, before)
        self.assertEqual(proof["rawTimeMs"], 1792585999508)
        self.assertEqual(proof["sourceTimeMs"], 1792575199508)


class OrdinaryWorkerTests(unittest.TestCase):
    def run_worker(self, scenario="normal", tool="symbol_info_tick", arguments=None):
        with tempfile.TemporaryDirectory(prefix="sesame-quote-clock-") as tmp:
            directory = Path(tmp); audit = directory / "calls.jsonl"
            (directory / "numpy.py").write_text("class ndarray: pass\nclass generic: pass\n", encoding="utf-8")
            (directory / "MetaTrader5.py").write_text('''
import json, os
class R:
 def __init__(self, **values): self.__dict__.update(values)
 def _asdict(self): return self.__dict__
__version__='isolated-fixture'
error=(1,'initial')
reads=0
def record(name, **fields):
 with open(os.environ['CLOCK_AUDIT'],'a') as f: f.write(json.dumps({'name':name,**fields})+'\\n')
def account_info():
 global reads,error
 reads+=1; record('account_info'); error=(99,'account-side-read')
 scenario=os.environ['CLOCK_SCENARIO']
 if scenario=='account-error': raise RuntimeError('synthetic account failure')
 if scenario=='missing-account': return None
 return R(login=43 if scenario=='switch-account' and reads==2 else 42, server='Other' if scenario=='switch-server' and reads==2 else 'FTMO-Demo')
def symbol_info_tick(symbol):
 global error
 record('symbol_info_tick',symbol=symbol); error=(4,'tick-specific-status')
 if os.environ['CLOCK_SCENARIO']=='missing-tick': return None
 return R(time=1792585999,time_msc=1792585999508,bid=1.1,ask=1.2)
def copy_ticks_range(symbol, date_from, date_to, flags):
 global error
 record('copy_ticks_range',date_from=date_from.isoformat(),date_to=date_to.isoformat()); error=(5,'history-specific-status')
 return [R(time=1792575199,time_msc=1792575199508)]
def last_error(): return error
def shutdown(): pass
''', encoding="utf-8")
            request = {"tool": tool, "arguments": arguments or {"symbol": "SYNTHETIC"}}
            result = subprocess.run([sys.executable, "-B", str(BACKEND / "python-worker.py")],
                                    input=json.dumps(request)+"\n", text=True, capture_output=True, check=True,
                                    env={**os.environ, "PYTHONPATH": tmp, "CLOCK_AUDIT": str(audit), "CLOCK_SCENARIO": scenario}, timeout=5)
            return json.loads(result.stdout), [json.loads(line) for line in audit.read_text().splitlines()]

    def test_normal_tick_has_separate_clock_proof_preserves_raw_fields_and_native_last_error(self):
        output, calls = self.run_worker()
        self.assertEqual(output["result"], {"time": 1792585999, "time_msc": 1792585999508, "bid": 1.1, "ask": 1.2})
        self.assertEqual(output["last_error"], [4, "tick-specific-status"])
        self.assertEqual(output["quote_clock"]["status"], "verified")
        self.assertEqual(output["quote_clock"]["sourceTimeMs"], 1792575199508)
        self.assertEqual([call["name"] for call in calls], ["account_info", "symbol_info_tick", "account_info"])
        self.assertNotIn("execution_timing", output)

    def test_changed_or_unavailable_account_preserves_read_and_marks_clock_unverified(self):
        for scenario in ("switch-account", "switch-server", "missing-account", "account-error"):
            with self.subTest(scenario=scenario):
                output, calls = self.run_worker(scenario)
                self.assertEqual(output["result"]["time_msc"], 1792585999508)
                self.assertEqual(output["last_error"], [4, "tick-specific-status"])
                self.assertEqual(output["quote_clock"]["status"], "unverified")
                self.assertIsNone(output["quote_clock"]["sourceTimeMs"])
                self.assertEqual(sum(call["name"] == "symbol_info_tick" for call in calls), 1)

    def test_missing_tick_keeps_none_result_and_actual_tick_error(self):
        output, _ = self.run_worker("missing-tick")
        self.assertIsNone(output["result"])
        self.assertEqual(output["last_error"], [4, "tick-specific-status"])
        self.assertEqual(output["quote_clock"]["status"], "unverified")

    def test_copy_ticks_history_keeps_utc_arguments_and_original_result_without_side_reads(self):
        output, calls = self.run_worker(tool="copy_ticks_range", arguments={"symbol": "SYNTHETIC", "date_from": "2026-10-21T09:00:00Z", "date_to": "2026-10-21T10:00:00Z", "flags": 0})
        self.assertEqual(output["result"], [{"time": 1792575199, "time_msc": 1792575199508}])
        self.assertEqual(output["last_error"], [5, "history-specific-status"])
        self.assertNotIn("quote_clock", output)
        self.assertEqual(calls, [{"name": "copy_ticks_range", "date_from": "2026-10-21T09:00:00+00:00", "date_to": "2026-10-21T10:00:00+00:00"}])


if __name__ == "__main__":
    unittest.main()
