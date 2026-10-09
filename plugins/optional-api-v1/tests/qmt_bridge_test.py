import importlib.util
import math
from pathlib import Path
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location("qmt_bridge", Path(__file__).parents[1] / "packages/qmt/bridge.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class Data:
    enable_hello = True
    def __init__(self): self.disconnected = False
    def connect(self, ip, port):
        assert ip == "127.0.0.1" and port == 58610
        return types.SimpleNamespace(is_connected=lambda: True, get_data_dir=lambda: "fixture-data")
    def disconnect(self): self.disconnected = True
    def get_instrument_type(self, symbol): return {"stock": not symbol.startswith("fund")}
    def get_instrument_detail(self, symbol, complete): return {"InstrumentName": "Fixture stock", "PriceTick": 0.01}
    def get_sector_list(self): return ["stocks"]
    def get_stock_list_in_sector(self, name): return ["600000.SH", "000001.SZ"]
    def get_full_tick(self, symbols): return {s: {"time": 1700000000000, "lastPrice": 10.125, "bidVol": [25]} for s in symbols}


class Trader:
    result = []
    def __init__(self, directory, session): self.stopped = False; self.subscribed = None; self.session = session; Trader.last = self
    def start(self): pass
    def connect(self): return 0
    def subscribe(self, account): self.subscribed = account; return 0
    def stop(self): self.stopped = True
    def query_stock_asset(self, account): return Trader.result
    def query_stock_positions(self, account): return Trader.result
    def query_stock_orders(self, account): return Trader.result
    def query_stock_trades(self, account): return Trader.result


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {"account_id": "00123", "userdata_directory": self.temp.name, "market_port": 58610, "sector": "stocks"}
    def request(self, action, **kwargs): return {"action": action, "config": self.config, **kwargs}
    def query(self, request, data=None): return b.query(request, data or Data(), Trader, lambda account, kind: (account, kind))
    def test_decimal_and_int64_source_serialization(self):
        self.assertEqual(b.scalar(9007199254740993), "9007199254740993")
        self.assertEqual(b.scalar(1e-8), "0.00000001")
        with self.assertRaises(b.Failure): b.scalar(math.nan)
    def test_fixed_market_reads_and_connection_cleanup(self):
        data = Data(); result = self.query(self.request("quotes", symbols=["600000.SH"]), data)
        self.assertEqual(result["items"][0]["tick"]["time"], "1700000000000")
        self.assertTrue(data.disconnected)
    def test_search_covers_native_sector_and_failure_is_not_empty(self):
        result = self.query(self.request("search", query="fixture"))
        self.assertEqual(len(result["items"]), 2)
        self.config["sector"] = "absent"
        with self.assertRaises(b.Failure): self.query(self.request("search"))
    def test_no_none_to_empty_list_and_session_stopped(self):
        for action in ["positions", "orders", "fills"]:
            Trader.result = None
            with self.assertRaises(b.Failure) as error: self.query(self.request(action))
            self.assertEqual(error.exception.code, "AMBIGUOUS_SOURCE_RESULT")
            self.assertTrue(Trader.last.stopped)
            Trader.result = []
            self.assertEqual(self.query(self.request(action))["items"], [])
    def test_asset_account_mismatch_rejected_and_threads_stopped(self):
        Trader.result = types.SimpleNamespace(account_id="other", cash=0.0)
        with self.assertRaises(b.Failure) as error: self.query(self.request("asset"))
        self.assertEqual(error.exception.code, "CONNECTION_CHANGED")
        self.assertTrue(Trader.last.stopped)
    def test_current_day_order_ids_and_time_are_not_reinterpreted(self):
        Trader.result = [types.SimpleNamespace(account_id="00123", order_id=9007199254740993, order_time=93001, price_type=999)]
        result = self.query(self.request("orders"))
        self.assertEqual(result["items"][0]["order_id"], "9007199254740993")
        self.assertEqual(result["items"][0]["order_time"], "93001")
        self.assertFalse(result["coverage"]["complete_history"])
        self.assertTrue(Trader.last.stopped)
    def test_trading_actions_and_nonstock_positions_rejected(self):
        with self.assertRaises(b.Failure) as error: self.query(self.request("order_stock"))
        self.assertEqual(error.exception.code, "UNSUPPORTED_CAPABILITY")
        Trader.result = [types.SimpleNamespace(account_id="00123", stock_code="fund.SH", volume=100)]
        with self.assertRaises(b.Failure): self.query(self.request("positions"))
        self.assertTrue(Trader.last.stopped)


if __name__ == "__main__": unittest.main()
