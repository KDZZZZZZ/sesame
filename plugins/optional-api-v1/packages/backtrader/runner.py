"""Actual Cerebro bar simulation with a separate Analyzer; no broker gateway."""

import importlib.metadata
import importlib.util
import json
import math
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import backtrader as bt


def text(value):
    if not math.isfinite(float(value)):
        raise ValueError("Nonfinite engine output")
    return format(Decimal(str(value)), "f")


def engine_time(value):
    if not value:
        return None
    return bt.num2date(value).replace(tzinfo=timezone.utc).isoformat()


class ReceiptAnalyzer(bt.Analyzer):
    """Observe official analyzer callbacks without replacing Strategy hooks."""

    def start(self):
        self.equity = []
        self.orders = []
        self.trades = []

    def next(self):
        self.equity.append(
            {
                "time": engine_time(self.data.datetime[0]),
                "value": text(self.strategy.broker.getvalue()),
                "cash": text(self.strategy.broker.getcash()),
            }
        )

    def prenext(self):
        self.next()

    def nextstart(self):
        self.next()

    def notify_order(self, order):
        self.orders.append(
            {
                "orderId": str(order.ref),
                "status": order.getstatusname(),
                "size": text(order.size),
                "executedSize": text(order.executed.size),
                "executedPrice": text(order.executed.price),
                "commission": text(order.executed.comm),
                "notificationBarTime": engine_time(self.data.datetime[0]),
                "executedTime": engine_time(order.executed.dt),
            }
        )

    def notify_trade(self, trade):
        if trade.isclosed:
            self.trades.append(
                {
                    "tradeId": str(trade.ref),
                    "pnl": text(trade.pnl),
                    "pnlAfterCommission": text(trade.pnlcomm),
                    "commission": text(trade.commission),
                    "openTime": engine_time(trade.dtopen),
                    "closeTime": engine_time(trade.dtclose),
                }
            )

    def get_analysis(self):
        return {"equity": self.equity, "orders": self.orders, "trades": self.trades}


def main(request):
    spec = importlib.util.spec_from_file_location(
        "sesame_authored_strategy", request["strategy_path"]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    strategy = getattr(module, request["class_name"])
    if not isinstance(strategy, type) or not issubclass(strategy, bt.Strategy):
        raise ValueError("Class must derive from backtrader.Strategy")

    rows = request["rows"]
    dates = [
        datetime.fromisoformat(row["datetime"].replace("Z", "+00:00"))
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
        for row in rows
    ]
    if any(dates[i] >= dates[i + 1] for i in range(len(dates) - 1)):
        raise ValueError("Input UTC timestamps must strictly increase")

    class FixedFeed(bt.feed.DataBase):
        def start(self):
            super().start()
            self.index = 0

        def _load(self):
            if self.index >= len(rows):
                return False
            index = self.index
            row = rows[index]
            self.index += 1
            self.lines.datetime[0] = bt.date2num(dates[index])
            for key in ["open", "high", "low", "close", "volume"]:
                getattr(self.lines, key)[0] = float(row[key])
            self.lines.openinterest[0] = 0
            return True

    config = request["config"]
    cerebro = bt.Cerebro(stdstats=False)
    cerebro.adddata(FixedFeed())
    cerebro.addstrategy(strategy, **request.get("parameters", {}))
    cerebro.addanalyzer(ReceiptAnalyzer, _name="receipt")
    cerebro.broker.setcash(float(config["capital"]))
    cerebro.broker.setcommission(
        commission=float(config["commission"]), stocklike=True, percabs=True
    )
    cerebro.broker.set_slippage_perc(float(config["slippage"]))
    strategies = cerebro.run(runonce=False)
    receipt = strategies[0].analyzers.receipt.get_analysis()
    return {
        "status": "completed",
        "engine": {
            "name": "Backtrader Cerebro",
            "version": importlib.metadata.version("backtrader"),
        },
        "statistics": {
            "finalEquity": text(cerebro.broker.getvalue()),
            "finalCash": text(cerebro.broker.getcash()),
            "closedTrades": len(receipt["trades"]),
        },
        **receipt,
        "limitations": [
            "Stocklike cash simulation; no derivative margin or live broker.",
            "Native binary floating-point engine; decimal text is not decimal34 equivalence.",
            "No SVL translation or equivalence is inferred.",
            "Order notificationBarTime is the observation bar; executedTime comes from executed.dt.",
        ],
    }


if __name__ == "__main__":
    output = Path(sys.argv[2])
    exit_code = 0
    try:
        result = main(json.loads(Path(sys.argv[1]).read_text()))
    except Exception as error:
        result = {
            "status": "failed",
            "error": {"type": type(error).__name__, "message": str(error)},
            "equity": [],
            "orders": [],
            "trades": [],
        }
        exit_code = 1
    output.write_text(json.dumps(result, allow_nan=False))
    sys.exit(exit_code)
