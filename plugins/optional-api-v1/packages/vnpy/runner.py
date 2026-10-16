"""Run the real pinned VeighNa CTA engine against one immutable input file.

This is current-user host execution, not an OS sandbox. It does not create a
MainEngine, connect gateways, query a database or expose an order-sending tool.
Agent-authored Python still has normal host Python permissions.
"""
import importlib.metadata
import importlib.util
import json
import math
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from dataclasses import asdict, is_dataclass
from decimal import Decimal
from enum import Enum
from pathlib import Path


def json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (float, Decimal)):
        return format(Decimal(str(value)), "f") if math.isfinite(float(value)) else None
    if hasattr(value, "item"):
        return json_value(value.item())
    if is_dataclass(value):
        return json_value(asdict(value))
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    raise TypeError(f"Unsupported result type: {type(value).__name__}")


def number(value, label, nonnegative=False, positive=False):
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{label} needs an explicit finite value")
    if not isinstance(value, (int, float, str)):
        raise ValueError(f"{label} needs a number or exact decimal text")
    value = float(value)
    if not math.isfinite(value) or nonnegative and value < 0 or positive and value <= 0:
        raise ValueError(f"Invalid {label}")
    return value


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("datetime needs ISO text with a consistent UTC offset or declared wall time")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def execute(request):
    if importlib.metadata.version("vnpy") != "4.5.0" or importlib.metadata.version("vnpy_ctastrategy") != "1.4.1":
        raise ValueError("Engine versions do not match the pinned plugin requirements")
    # Prevent VeighNa's normal fallback to the user's ~/.vntrader directory.
    Path(".vntrader").mkdir(exist_ok=True)
    from vnpy.trader.constant import Exchange, Interval
    from vnpy.trader.object import BarData
    from vnpy_ctastrategy.backtesting import BacktestingEngine
    from vnpy_ctastrategy.template import CtaTemplate

    config, rows = request["config"], request["rows"]
    if not 2 <= len(rows) <= 100000:
        raise ValueError("Backtesting requires 2–100000 fixed bars")
    symbol, exchange = config["vt_symbol"].rsplit(".", 1)
    if not symbol or config["interval"] not in ["1m", "1h", "d", "w"]:
        raise ValueError("Use one VeighNa symbol.exchange and a supported bar interval")
    exchange, interval = Exchange(exchange), Interval(config["interval"])
    bars = []
    for i, row in enumerate(rows):
        moment = timestamp(row["datetime"])
        if i and not moment > bars[-1].datetime:
            raise ValueError("Fixed bars must be unique and strictly increasing, with one consistent time basis")
        values = {key: number(row[key], f"row {i} {key}") for key in ["open", "high", "low", "close"]}
        if values["low"] > min(values["open"], values["close"]) or values["high"] < max(values["open"], values["close"]) or values["low"] > values["high"]:
            raise ValueError(f"Inconsistent OHLC at row {i}")
        bars.append(BarData(symbol=symbol, exchange=exchange, datetime=moment,
                            interval=interval, open_price=values["open"], high_price=values["high"],
                            low_price=values["low"], close_price=values["close"],
                            volume=number(row["volume"], f"row {i} volume", nonnegative=True),
                            gateway_name="SESAME_FIXED_INPUT"))
    start = timestamp(config["start"]) if config.get("start") else bars[0].datetime
    end = timestamp(config["end"]) if config.get("end") else bars[-1].datetime
    selected = [bar for bar in bars if start <= bar.datetime <= end]
    if len(selected) < 2:
        raise ValueError("Requested range needs at least two supplied bars")

    class FixedInputEngine(BacktestingEngine):
        processed = 0

        def load_data(self):
            raise ValueError("Database loading is unavailable; use the fixed input bars")

        def load_bar(self, vt_symbol, days, requested_interval, callback, use_database):
            if use_database or vt_symbol != self.vt_symbol or requested_interval != self.interval:
                raise ValueError("Warmup must use the same frozen symbol/interval without a database")
            first = self.start - timedelta(days=days)
            warmup = [bar for bar in bars if first <= bar.datetime < self.start]
            if not warmup or bars[0].datetime > first:
                raise ValueError("Fixed input does not cover requested warmup; include preceding bars and an explicit start")
            return warmup

        def load_tick(self, *_args, **_kwargs):
            raise ValueError("This plugin version accepts bar inputs; tick warmup is unsupported")

        def new_bar(self, bar):
            super().new_bar(bar)
            self.processed += 1

    entry = Path(request["strategy_path"]).resolve()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", request["class_name"]):
        raise ValueError("Invalid Python class name")
    spec = importlib.util.spec_from_file_location("sesame_authored_strategy", entry)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    strategy = getattr(module, request["class_name"])
    if not isinstance(strategy, type) or not issubclass(strategy, CtaTemplate):
        raise ValueError("The authored class must inherit the actual CtaTemplate")
    parameters = request.get("parameters", {})
    if not isinstance(parameters, dict) or set(parameters) - set(strategy.parameters):
        raise ValueError("Every supplied parameter must be declared by the authored strategy")
    engine = FixedInputEngine()
    messages = []
    engine.output = lambda message: messages.append(str(message)) if len(messages) < 500 else None
    engine.set_parameters(vt_symbol=config["vt_symbol"], interval=interval, start=start, end=end,
                          rate=number(config["rate"], "rate", nonnegative=True),
                          slippage=number(config["slippage"], "slippage", nonnegative=True),
                          size=number(config["size"], "size", positive=True),
                          pricetick=number(config["pricetick"], "pricetick", positive=True),
                          capital=number(config["capital"], "capital", positive=True))
    engine.add_strategy(strategy, parameters)
    engine.history_data = selected
    engine.run_backtesting()
    if engine.processed != len(selected):
        raise RuntimeError("The real engine stopped before processing all bars: " + "\n".join(messages[-12:]))
    daily = engine.calculate_result()
    statistics = engine.calculate_statistics(output=False)
    daily_rows = [] if daily is None or daily.empty else [dict(date=index.isoformat(), **row.to_dict()) for index, row in daily.iterrows()]
    trades = [vars(trade) for trade in engine.get_all_trades()]
    orders = [vars(order) for order in engine.get_all_orders()]
    for item in trades + orders:
        for key in ["price", "volume", "traded"]:
            if key in item:
                item[key] = format(Decimal(str(item[key])), "f")
    return json_value({"status": "completed", "engine": {"name": "VeighNa CTA BacktestingEngine", "vnpy": "4.5.0", "vnpy_ctastrategy": "1.4.1"},
                       "execution": "host", "processedBars": engine.processed, "statistics": statistics,
                       "effectiveParameters": engine.strategy.get_parameters(),
                       "daily": daily_rows, "trades": trades, "orders": orders, "logs": messages,
                       "limitations": ["The engine uses native Python/NumPy binary floating-point arithmetic; decimal strings in outputs describe those values, not decimal34 equivalence.",
                                       "Bar matching, costs and end-of-test open positions follow the pinned VeighNa engine. No live broker or gateway was connected.",
                                       "Missing warmup data and unsupported tick inputs fail explicitly; no external database or online history is silently substituted."]})


if __name__ == "__main__":
    target = Path(sys.argv[2])
    try:
        result = execute(json.loads(Path(sys.argv[1]).read_text(encoding="utf8")))
        code = 0
    except Exception as cause:
        result = {"status": "failed", "execution": "host", "error": {"type": type(cause).__name__, "message": str(cause), "traceback": traceback.format_exc(limit=12)}}
        code = 1
    target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf8")
    raise SystemExit(code)
