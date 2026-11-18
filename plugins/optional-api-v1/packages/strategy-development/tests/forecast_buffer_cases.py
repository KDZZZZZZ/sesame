"""Real Cerebro regressions for the source shipped by strategy-development."""

import importlib.util
import math
import sys
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

import backtrader as bt


PACKAGE = Path(__file__).resolve().parents[1]
SOURCE = PACKAGE / "templates" / "forecast_buffer.py"


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


template = load_file("buffer_template_tests", SOURCE)
runner = load_file("buffer_native_runner_tests", PACKAGE.parent / "backtrader" / "runner.py")
PARAMETERS = dict(fast_span=3, slow_span=12, vol_window=6, forecast_scale=2,
                  daily_risk_target=0.003, daily_risk_limit=0.01, max_exposure=0.8,
                  cash_reserve=0.05, halt_drawdown=0.5, buffer_mode="forecast", trade_to_edge=True)
CONFIG = dict(capital="100000", commission="0.001", slippage="0.0005",
              feed=dict(timeframe="days", compression=1))


def demo_rows(count=160):
    rows = []
    for i in range(count):
        close = 100 + 0.06 * i + 4 * math.sin(i / 9) + 0.8 * math.sin(i * 0.73)
        opening = rows[-1]["close"] if rows else close
        rows.append(dict(datetime=(date(2024, 1, 1) + timedelta(days=i)).isoformat() + "T00:00:00Z",
                         open=opening, high=max(opening, close) + 1, low=min(opening, close) - 1,
                         close=close, volume=100000))
    return rows


class DailyFeed(bt.feed.DataBase):
    params = (("rows", None),)

    def start(self):
        super().start()
        self.rows = iter(self.p.rows)

    def _load(self):
        row = next(self.rows, None)
        if row is None:
            return False
        self.lines.datetime[0] = bt.date2num(datetime.fromisoformat(row["datetime"][:10]))
        for field in ("open", "high", "low", "close", "volume"):
            getattr(self.lines, field)[0] = row[field]
        return True


class LifecycleProbe(template.ForecastBufferStrategy):
    def __init__(self):
        super().__init__()
        self.submissions = []
        self.notifications = []
        self.halted_positions = []

    def order_target_size(self, *args, **kwargs):
        result = super().order_target_size(*args, **kwargs)
        if result is not None:
            self.submissions.append((result.ref, self.data.datetime[0], kwargs["target"]))
        return result

    def notify_order(self, order):
        self.notifications.append((order.ref, order.getstatusname(), order.executed.dt, len(self)))
        super().notify_order(order)

    def next(self):
        super().next()
        if self.halted:
            self.halted_positions.append((len(self), self.position.size))


class ForecastBufferCases(unittest.TestCase):
    def test_inclusive_edges_share_rounding_and_width_methods(self):
        target = template.buffered_target
        for position in (95, 96, 100, 105):
            self.assertEqual(target(position, 100, 200, 200, .05, "position", True), position)
        for position, edge, centre in ((94, 95, 100), (106, 105, 100)):
            self.assertEqual(target(position, 100, 200, 200, .05, "position", True), edge)
            self.assertEqual(target(position, 100, 200, 200, .05, "position", False), centre)
        self.assertEqual(target(81, 100, 200, 300, .10, "forecast", True), 81)
        self.assertEqual(target(81, 100, 200, 300, .10, "position", True), 90)
        self.assertEqual(target(0, 10.9, 2, 300, .10, "forecast", True), 10)
        self.assertEqual(target(175, 100, 200, 300, 0, "forecast", True), 100)

    def test_risk_and_flat_override_even_inside_a_wide_band(self):
        target = template.buffered_target
        self.assertEqual(target(90, 85, 800, 80, .8, "forecast", True), 80)
        self.assertEqual(target(90, 50, 800, 80, .8, "forecast", True), 50)
        self.assertEqual(target(70, 79, 800, 80, .8, "forecast", True), 70)
        for optimal in (-10, 0, .5):
            self.assertEqual(target(70, optimal, 800, 80, .8, "forecast", True), 0)
        self.assertEqual(target(70, 79, 800, 80, .8, "forecast", True, force_flat=True), 0)

    def test_native_optimization_observes_distinct_reproducible_costed_orders(self):
        request = dict(strategy_path=str(SOURCE), class_name="ForecastBufferStrategy",
                       parameters=PARAMETERS, config=CONFIG, rows=demo_rows(),
                       optimization=dict(parameter_space=dict(buffer_fraction=[0, .1])))
        result = runner.main(request)
        self.assertEqual(result["status"], "completed", result.get("error"))
        self.assertEqual(result["optimizer"]["method"], "Cerebro.optstrategy")
        baseline, buffered = result["passes"]
        self.assertEqual(baseline["parameters"]["buffer_fraction"], 0)
        self.assertEqual(buffered["parameters"]["buffer_fraction"], .1)
        fills = [[order for order in arm["orders"] if order["status"] == "Completed"] for arm in (baseline, buffered)]
        turnover = [sum(abs(float(o["executedSize"]) * float(o["executedPrice"])) for o in arm) for arm in fills]
        fees = [sum(float(o["commission"]) for o in arm) for arm in fills]
        self.assertGreater(len(fills[1]), 0)
        self.assertLess(len(fills[1]), len(fills[0]))
        self.assertLess(turnover[1], turnover[0])
        for traded, fee in zip(turnover, fees):
            self.assertAlmostEqual(fee, traded * .001, places=6)
        self.assertTrue(all(len(arm["equity"]) == len(request["rows"]) for arm in result["passes"]))
        self.assertTrue(all(int(arm["statistics"]["closedTrades"]) > 0 for arm in result["passes"]))
        shorter = runner.main({**request, "rows": request["rows"][:80]})["passes"][1]
        self.assertEqual(shorter["equity"], buffered["equity"][:80])
        cutoff = shorter["equity"][-1]["time"]
        observed = [o for o in buffered["orders"] if o["notificationBarTime"] <= cutoff]
        fields = ("status", "size", "executedSize", "executedPrice", "commission", "notificationBarTime", "executedTime")
        self.assertEqual([tuple(o[k] for k in fields) for o in shorter["orders"]],
                         [tuple(o[k] for k in fields) for o in observed])

    def test_partial_orders_and_drawdown_exit_use_confirmed_holdings(self):
        rows = demo_rows(100)
        # Small partial fills leave a buy outstanding when an adverse gap trips the halt.
        for i in range(18, len(rows)):
            for field in ("open", "high", "low", "close"):
                rows[i][field] *= .55
        cerebro = bt.Cerebro(stdstats=False)
        cerebro.adddata(DailyFeed(rows=rows, timeframe=bt.TimeFrame.Days, compression=1))
        cerebro.addstrategy(LifecycleProbe, **{**PARAMETERS, "halt_drawdown": .006})
        cerebro.broker.setcash(100000)
        cerebro.broker.set_filler(lambda order, price, ago: min(8, abs(order.executed.remsize)))
        strategy = cerebro.run(runonce=False)[0]
        self.assertTrue(strategy.halted)
        self.assertTrue(any(size > 0 for _, size in strategy.halted_positions))
        self.assertEqual(strategy.position.size, 0)
        first_halt = strategy.halted_positions[0][0]
        self.assertEqual(first_halt, 19)
        submitted = {ref: decision for ref, decision, _ in strategy.submissions}
        lifecycle = {}
        outstanding = set()
        for ref, status, executed, bar in strategy.notifications:
            lifecycle.setdefault(ref, []).append(status)
            if status in ("Submitted", "Accepted", "Partial"):
                outstanding.add(ref)
                self.assertEqual(len(outstanding), 1)
            else:
                outstanding.discard(ref)
            if status in ("Partial", "Completed"):
                self.assertGreater(executed, submitted[ref])
            if status == "Submitted" and bar >= first_halt + 2:
                self.assertEqual(next(size for ident, _, size in strategy.submissions if ident == ref), 0)
        self.assertTrue(any("Partial" in statuses and statuses.count("Canceled") == 1 for statuses in lifecycle.values()))
        self.assertTrue(any("Completed" in statuses for statuses in lifecycle.values()))
        self.assertFalse(outstanding)

    def test_gap_rejection_recalculates_quantity_from_actual_cash_and_holdings(self):
        rows = demo_rows(65)
        for row in rows[12:]:
            for field in ("open", "high", "low", "close"):
                row[field] *= 1.8
        parameters = {**PARAMETERS, "cash_reserve": 0, "max_exposure": 1,
                      "daily_risk_target": .02, "daily_risk_limit": .1}
        receipt = runner.main(dict(strategy_path=str(SOURCE), class_name="ForecastBufferStrategy",
                                   parameters=parameters, config={**CONFIG, "commission": "0", "slippage": "0"}, rows=rows))
        first, second = [o for o in receipt["orders"] if o["status"] not in ("Submitted", "Accepted")][:2]
        self.assertEqual((first["status"], float(first["executedSize"])), ("Margin", 0))
        self.assertEqual(second["status"], "Completed")
        self.assertGreater(second["executedTime"], first["notificationBarTime"])
        self.assertTrue(0 < float(second["executedSize"]) < float(first["size"]))

    def test_unsupported_feed_parameters_and_no_volatility(self):
        request = dict(strategy_path=str(SOURCE), class_name="ForecastBufferStrategy",
                       parameters=PARAMETERS, config=CONFIG, rows=demo_rows(40))
        for timeframe, compression in (("minutes", 1), ("days", 5)):
            with self.assertRaisesRegex(ValueError, "daily"):
                runner.main({**request, "config": {**CONFIG, "feed": dict(timeframe=timeframe, compression=compression)}})
        with self.assertRaisesRegex(ValueError, "daily_risk"):
            runner.main({**request, "parameters": {**PARAMETERS, "daily_risk_limit": .001}})
        with self.assertRaisesRegex(ValueError, "buffer_mode"):
            runner.main({**request, "parameters": {**PARAMETERS, "buffer_mode": "unknown"}})
        for row in request["rows"]:
            row.update(open=100, close=100, high=101, low=99)
        self.assertEqual(runner.main(request)["orders"], [])


if __name__ == "__main__":
    unittest.main()
