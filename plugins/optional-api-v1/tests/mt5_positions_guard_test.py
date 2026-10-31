"""Executes the production MT5 final-mile guard with a synthetic SDK; never connects or trades."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("positions_mt5_guard", Path(__file__).parents[1] / "packages/mt5/backend/execution_guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class Tests(unittest.TestCase):
    def fixture(self, change=None, short=False):
        now = 1792575200000  # Fixed 2026 synthetic UTC.
        counters = {"sends": 0, "checks": 0, "account_reads": 0, "position_reads": 0}
        position = SimpleNamespace(ticket=9007199254740995, symbol="EURUSD", type=1 if short else 0, volume=1.5)

        class MT5:
            TRADE_ACTION_DEAL, TRADE_ACTION_PENDING = 1, 5
            ORDER_TYPE_BUY, ORDER_TYPE_SELL, ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT = 0, 1, 2, 3
            POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1

            def account_info(self):
                counters["account_reads"] += 1
                login = 111 if change == "account" and counters["checks"] else 9007199254740993
                return SimpleNamespace(login=login, server="FTMO-Demo", trade_allowed=True, trade_expert=True)

            def terminal_info(self):
                return SimpleNamespace(connected=True, trade_allowed=True, tradeapi_disabled=False)

            def symbol_info(self, _symbol):
                return SimpleNamespace(volume_min=0.01, volume_max=100, volume_step=0.01)

            def positions_get(self, **kwargs):
                counters["position_reads"] += 1
                if "ticket" in kwargs:
                    self.asserted_ticket = kwargs["ticket"]
                return [position]

            def orders_get(self, **_kwargs):
                return [SimpleNamespace(ticket=123)] if change == "working_order" else []

            def symbol_info_tick(self, _symbol):
                return SimpleNamespace(time_msc=now + 10800000 - (6000 if change == "quote" else 0), bid=1.1, ask=1.1002)

            def order_check(self, _request):
                counters["checks"] += 1
                if change == "position":
                    position.volume = 1.4
                return SimpleNamespace(retcode=0)

            def order_send(self, request):
                counters["sends"] += 1
                counters["request"] = request
                return SimpleNamespace(retcode=10008, order=9007199254741001, deal=0)

        sdk = MT5()
        request = {"action": 1, "symbol": "EURUSD", "position": position.ticket, "volume": 0.5, "type": 0 if short else 1}
        bound = {"observed_at": now, "expires_at": now + 60000, "max_quote_age_ms": 5000, "max_quote_to_send_ms": 1000,
                 "price_limit": "1.1002" if short else "1.1", "side": "buy" if short else "sell", "expected_account": "9007199254740993", "expected_server": "FTMO-Demo", "quote_clock_revision": "ftmo-demo-current-tick-2026-v1",
                 "expected_positions": [{"ticket": str(position.ticket), "type": position.type, "volume": "1.5"}]}
        return lambda: guard.guarded_send(sdk, request, bound, clock=lambda: now, monotonic=lambda: 0), counters

    def test_long_and_short_close_send_one_exact_native_ticket_after_final_checks(self):
        for short in (False, True):
            with self.subTest(short=short):
                action, counters = self.fixture(short=short)
                receipt, timing = action()
                self.assertEqual(receipt.retcode, 10008)
                self.assertEqual(counters["sends"], 1)
                self.assertEqual(counters["request"]["position"], 9007199254740995)
                self.assertEqual(counters["request"]["type"], 0 if short else 1)
                self.assertGreaterEqual(counters["position_reads"], 4)
                self.assertFalse(timing["fill_price_guaranteed"])

    def test_native_changes_after_order_check_cannot_reach_send(self):
        for changed, code in (("account", "ACCOUNT_MISMATCH"), ("position", "POSITION_CHANGED"), ("working_order", "WORKING_ORDERS"), ("quote", "STALE_QUOTE")):
            with self.subTest(changed=changed):
                action, counters = self.fixture(change=changed)
                with self.assertRaises(guard.GuardRejected) as failure:
                    action()
                self.assertEqual(failure.exception.code, code)
                self.assertEqual(counters["sends"], 0)


if __name__ == "__main__":
    unittest.main()
