"""Synthetic final-mile regression. Executes the production guard, never an SDK or broker."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("positions_native_guard", Path(__file__).parents[1] / "packages/qmt/execution_guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class Tests(unittest.TestCase):
    def fixture(self, change_after=None, wrong_account=False):
        now = 1800000000000
        counters = {"reads": 0, "sends": 0}

        class Trader:
            def query_stock_asset(self, _account):
                return SimpleNamespace(account_id="other" if wrong_account else "00123", cash=100000)

            def query_stock_positions(self, _account):
                counters["reads"] += 1
                volume = 499 if change_after is not None and counters["reads"] > change_after else 500
                return [SimpleNamespace(account_id="00123", stock_code="600000.SH", volume=volume, can_use_volume=300)]

            def query_stock_orders(self, _account):
                return []

        class Data:
            def get_full_tick(self, _symbols):
                return {"600000.SH": {"time": now, "bidPrice": [10.02]}}

        request = {"account_id": "00123", "symbol": "600000.SH", "side": "sell", "shares": "200", "price": "10.02", "execution_guard": {
            "observed_at": now, "expires_at": now + 60000, "max_quote_age_ms": 5000, "max_quote_to_send_ms": 1000, "price_limit": "10.02",
            "expected_positions": [{"account_id": "00123", "stock_code": "600000.SH", "volume": "500", "can_use_volume": "300"}],
        }}

        def send():
            counters["sends"] += 1
            return 9007199254740993

        return lambda: guard.submit(Trader(), object(), Data(), {"PriceTick": "0.01"}, request, send, clock=lambda: now, monotonic=lambda: 0), counters

    def test_actual_guard_rechecks_holdings_after_quote_and_never_sends_changed_position(self):
        action, counters = self.fixture(change_after=2)
        with self.assertRaises(guard.GuardRejected) as failure:
            action()
        self.assertEqual(failure.exception.code, "POSITION_CHANGED")
        self.assertEqual(failure.exception.details, {"submission_attempted": False})
        self.assertEqual(counters["sends"], 0)
        self.assertEqual(counters["reads"], 3)

    def test_actual_guard_verifies_native_account_before_dispatch(self):
        action, counters = self.fixture(wrong_account=True)
        with self.assertRaises(guard.GuardRejected) as failure:
            action()
        self.assertEqual(failure.exception.code, "ACCOUNT_MISMATCH")
        self.assertEqual(counters["sends"], 0)

    def test_valid_synthetic_native_close_returns_submission_only(self):
        action, counters = self.fixture()
        order_id, timing = action()
        self.assertEqual(order_id, 9007199254740993)
        self.assertFalse(timing["fill_price_guaranteed"])
        self.assertEqual(counters["sends"], 1)


if __name__ == "__main__":
    unittest.main()
