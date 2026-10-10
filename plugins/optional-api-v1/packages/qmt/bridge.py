"""Fixed XtQuant adapter. Reads plus explicit limit stock order/owned cancellation; no arbitrary code or methods."""
import contextlib
import datetime as dt
import decimal
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import secrets
import struct
import subprocess
import sys
import time

_guard_spec = importlib.util.spec_from_file_location("sesame_qmt_execution_guard", Path(__file__).with_name("execution_guard.py"))
_guard = importlib.util.module_from_spec(_guard_spec)
_guard_spec.loader.exec_module(_guard)


class Failure(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details


def need(condition, message, code="SOURCE_UNAVAILABLE"):
    if not condition:
        raise Failure(code, message)


def scalar(value):
    """Keep native integer IDs and the SDK's binary-float representation as text."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        need(math.isfinite(value), "Native SDK returned a non-finite financial value", "SOURCE_DATA_INVALID")
        return format(decimal.Decimal(str(value)), "f")
    if isinstance(value, dict):
        return {str(k): scalar(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scalar(v) for v in value]
    raise Failure("SOURCE_DATA_INVALID", "Unexpected SDK value type: " + type(value).__name__)


FIELDS = {
    "asset": "account_id account_type cash frozen_cash market_value total_asset current_balance fetch_balance",
    "positions": "account_id account_type stock_code volume can_use_volume open_price avg_price market_value last_price float_profit position_profit",
    "orders": "account_id account_type stock_code order_id order_sysid order_time order_type order_volume price_type price traded_volume traded_price order_status status_msg strategy_name order_remark direction offset_flag",
    "fills": "account_id account_type stock_code order_type traded_id traded_time traded_price traded_volume traded_amount order_id order_sysid strategy_name order_remark direction offset_flag",
}


def fields(value, kind, account_id):
    need(str(getattr(value, "account_id", "")) == account_id, "Query returned a different account", "CONNECTION_CHANGED")
    return {name: scalar(getattr(value, name)) for name in FIELDS[kind].split() if hasattr(value, name)}


def sdk_info():
    need(sys.platform == "win32" and struct.calcsize("P") == 8, "XtQuant requires native Windows x64 Python and an authorized running MiniQMT", "PREREQUISITE_REQUIRED")
    try:
        from xtquant import xtdata
        from xtquant.xttrader import XtQuantTrader
        from xtquant.xttype import StockAccount
        try:
            version = importlib.metadata.version("xtquant")
        except importlib.metadata.PackageNotFoundError:
            version = "vendor_distribution_without_package_metadata"
        need(all(callable(getattr(xtdata, name, None)) for name in ("connect", "disconnect", "get_full_tick", "get_instrument_detail", "get_instrument_type")), "Existing SDK lacks required read APIs", "PREREQUISITE_REQUIRED")
    except Exception as error:
        raise Failure("PREREQUISITE_REQUIRED", "Existing Python cannot load xtquant: " + str(error)) from error
    return xtdata, XtQuantTrader, StockAccount, {"python": sys.executable, "python_version": sys.version.split()[0], "platform": sys.platform, "bits": 64, "xtquant": version}


def connect_market(data, config):
    # A fixed localhost endpoint avoids switching among multiple running terminals.
    need(isinstance(config.get("market_port"), int) and 1 <= config["market_port"] <= 65535, "Configure MiniQMT's actual market_port", "PREREQUISITE_REQUIRED")
    data.enable_hello = False
    client = data.connect("127.0.0.1", config["market_port"])
    need(client is not None and client.is_connected(), "MiniQMT market connection failed")
    return {"endpoint": "127.0.0.1:" + str(config["market_port"]), "data_directory": str(client.get_data_dir())}


def stock(data, symbol):
    kind = data.get_instrument_type(symbol)
    need(isinstance(kind, dict) and kind.get("stock") is True and symbol.endswith((".SH", ".SZ", ".BJ")), "Only mainland stock instruments are mapped: " + symbol, "UNSUPPORTED_CAPABILITY")
    detail = data.get_instrument_detail(symbol, True)
    need(isinstance(detail, dict) and detail, "Instrument details unavailable: " + symbol)
    return {"symbol": symbol, "detail": scalar(detail), "types": kind}


def query(request, data, trader_type, account_type):
    action, config = request["action"], request["config"]
    if action in ("search", "describe", "quotes", "bars", "download_history"):
        try:
            source = connect_market(data, config)
            if action == "search":
                names = data.get_sector_list()
                need(isinstance(names, list) and config["sector"] in names, "Configured stock sector is absent from MiniQMT's local catalog; reuse/update terminal data explicitly")
                symbols = data.get_stock_list_in_sector(config["sector"])
                need(isinstance(symbols, list) and len(symbols) <= 20000, "Stock catalog failed or exceeded 20000 symbols")
                result = []
                term = request.get("query", "").casefold()
                for symbol in sorted(set(symbols)):
                    item = stock(data, symbol)
                    name = item["detail"].get("InstrumentName", symbol)
                    if not term or term in symbol.casefold() or term in name.casefold():
                        result.append({"symbol": symbol, "name": name})
                return {"items": result, "source": source}
            symbols = request.get("symbols")
            need(isinstance(symbols, list) and 1 <= len(symbols) <= 50, "Provide 1–50 stock symbols", "INVALID_ARGUMENT")
            details = [stock(data, symbol) for symbol in symbols]
            if action == "describe":
                return {"items": details, "source": source}
            if action in ("bars", "download_history"):
                need(len(symbols) == 1, "Daily bars require exactly one stock", "INVALID_ARGUMENT")
                start, end = request.get("start", ""), request.get("end", "")
                need(all(isinstance(x, str) and len(x) == 8 and x.isdigit() for x in (start, end)) and start <= end, "Provide ordered YYYYMMDD bounds", "INVALID_ARGUMENT")
                try:
                    first, last = [dt.datetime.strptime(x, "%Y%m%d").date() for x in (start, end)]
                except ValueError:
                    raise Failure("INVALID_ARGUMENT", "Invalid calendar date")
                need(0 <= (last-first).days <= 3660, "Daily range exceeds ten years", "INVALID_ARGUMENT")
                for name in (["get_market_data_ex"] + (["download_history_data"] if action == "download_history" else [])):
                    need(callable(getattr(data, name, None)), "Installed XtQuant is missing " + name, "PREREQUISITE_REQUIRED")
                if action == "download_history":
                    data.download_history_data(symbols[0], period="1d", start_time=start, end_time=end)
                frames = data.get_market_data_ex(["time", "open", "high", "low", "close", "volume"], symbols, period="1d", start_time=start, end_time=end, count=-1, dividend_type="none", fill_data=False)
                need(isinstance(frames, dict) and symbols[0] in frames, "Native daily history is unavailable; explicitly download the required range first")
                frame = frames[symbols[0]]
                need(hasattr(frame, "to_dict"), "Native daily history has no supported table")
                rows = frame.to_dict("records")
                need(len(rows) <= 20000, "Daily history exceeds budget", "RESOURCE_EXHAUSTED")
                # Latest native full-tick carries current-day OHLC; do not synthesize minute bars.
                ticks = data.get_full_tick(symbols) if request.get("forming") else {}
                tick = ticks.get(symbols[0]) if isinstance(ticks, dict) else None
                return {"items": scalar(rows), "tick": scalar(tick), "source": source, "coverage": {"scope": "local_cached_daily_history", "complete_history": False, "download_requested": action == "download_history"}}
            ticks = data.get_full_tick(symbols)
            need(isinstance(ticks, dict), "Native quote query failed")
            missing = [s for s in symbols if not isinstance(ticks.get(s), dict) or not ticks[s]]
            need(not missing, "Quotes unavailable for: " + ", ".join(missing))
            return {"items": [{"symbol": s, "tick": scalar(ticks[s])} for s in symbols], "source": source}
        finally:
            data.disconnect()
    need(action in ("asset", "positions", "orders", "fills", "order", "cancel"), "Action is not supported", "UNSUPPORTED_CAPABILITY")
    need(config.get("account_id") and Path(config.get("userdata_directory", "")).is_dir(), "Configure the actual account and existing userdata_mini directory", "PREREQUISITE_REQUIRED")
    trader = trader_type(config["userdata_directory"], secrets.randbelow(2**30 - 1) + 1)
    try:
        trader.start()
        need(trader.connect() == 0, "MiniQMT trading connection failed; use the authorized running terminal")
        account = account_type(config["account_id"], "STOCK")
        need(trader.subscribe(account) == 0, "MiniQMT did not authorize subscription to the configured STOCK account", "PREREQUISITE_REQUIRED")
        if action in ("order", "cancel"):
            need(request.get("account_id") == config["account_id"], "Explicit account does not match configured account", "INVALID_ARGUMENT")
            from xtquant import xtconstant
            if action == "order":
                symbol, side = request.get("symbol"), request.get("side")
                shares, price = request.get("shares"), request.get("price")
                need(isinstance(shares, str) and shares.isdigit() and 0 < int(shares) <= 2147483647 and str(int(shares)) == shares, "Shares must be a positive canonical integer <= 2147483647", "INVALID_ARGUMENT")
                need(side in ("buy", "sell"), "Side must be buy or sell", "INVALID_ARGUMENT")
                try:
                    number = decimal.Decimal(price)
                    need(number.is_finite() and number > 0 and math.isfinite(float(number)) and float(number) > 0, "Invalid limit price", "INVALID_ARGUMENT")
                except (decimal.InvalidOperation, TypeError):
                    raise Failure("INVALID_ARGUMENT", "Invalid limit price")
                try:
                    connect_market(data, config)
                    spec = stock(data, symbol)
                    send = lambda: trader.order_stock(account, symbol, xtconstant.STOCK_BUY if side == "buy" else xtconstant.STOCK_SELL, int(shares), xtconstant.FIX_PRICE, float(number), "Sesame", request["remark"])
                    if request.get("execution_guard") is not None:
                        order_id, timing = _guard.submit(trader, account, data, spec["detail"], request, send)
                    else:
                        order_id, timing = send(), None
                finally:
                    data.disconnect()
                need(type(order_id) is int and order_id > 0, "Broker rejected the submission; no accepted order ID was returned", "BROKER_REJECTED")
                return {"order_id": str(order_id), "status": "submitted", "execution_confirmed": False, **({"execution_timing":timing} if timing is not None else {})}
            order_id = request.get("order_id")
            need(isinstance(order_id, str) and order_id.isdigit() and 0 < int(order_id) <= 9223372036854775807, "Invalid native order ID", "INVALID_ARGUMENT")
            rows = trader.query_stock_orders(account)
            need(rows is not None, "Cannot verify order ownership", "AMBIGUOUS_SOURCE_RESULT")
            matched = [r for r in rows if str(getattr(r, "order_id", "")) == order_id]
            need(len(matched) == 1 and str(getattr(matched[0], "account_id", "")) == config["account_id"] and getattr(matched[0], "order_remark", None) == request.get("remark"), "Order ownership does not match the original Sesame submission", "INVALID_ARGUMENT")
            result = trader.cancel_order_stock(account, int(order_id))
            need(result == 0, "Broker rejected cancel submission", "BROKER_REJECTED")
            return {"order_id": order_id, "status": "cancel_requested", "cancellation_confirmed": False}
        if action == "asset":
            value = trader.query_stock_asset(account)
            need(value is not None, "Asset query failed")
            return {"asset": fields(value, action, config["account_id"])}
        call = {"positions": trader.query_stock_positions, "orders": trader.query_stock_orders, "fills": trader.query_stock_trades}[action]
        values = call(account)
        need(values is not None, "XtQuant returned None; this can mean failure or an empty list, so no empty snapshot can be confirmed", "AMBIGUOUS_SOURCE_RESULT")
        need(isinstance(values, (list, tuple)) and len(values) <= 20000, "Native list failed or exceeded 20000 records")
        result = [fields(v, action, config["account_id"]) for v in values]
        # Positions use share units only after the actual instrument type was checked.
        if action in ("positions", "orders", "fills") and result:
            try:
                connect_market(data, config)
                for symbol in sorted(set(v["stock_code"] for v in result)):
                    stock(data, symbol)
            finally:
                data.disconnect()
        return {"items": result, "coverage": {"scope": "current_positions" if action == "positions" else "current_trading_day", "complete_history": False, "raw_time_unit": "source_native_uninterpreted"}}
    finally:
        # Stops this API session's threads only, never the MiniQMT application.
        trader.stop()


def prepare(request):
    need(sys.platform == "win32" and struct.calcsize("P") == 8 and sys.version_info[:2] == (3, 12), "Managed preparation requires an existing native Windows x64 CPython 3.12 executable", "PREREQUISITE_REQUIRED")
    target = Path(request["target"])
    need(target.is_absolute() and not target.exists(), "Private environment target must be new", "INVALID_ARGUMENT")
    subprocess.run([sys.executable, "-I", "-m", "venv", str(target)], check=True)
    python = target / "Scripts" / "python.exe"
    lock = Path(__file__).with_name("requirements.txt")
    subprocess.run([str(python), "-I", "-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--no-deps", "--require-hashes", "--only-binary=:all:", "--index-url", "https://pypi.org/simple", "-r", str(lock)], check=True, stdout=sys.stderr)
    subprocess.run([str(python), "-I", "-B", str(Path(__file__).resolve()), "--verify"], check=True, stdout=sys.stderr)
    (target / "sesame-qmt-install.json").write_text(json.dumps({"python": str(python), "xtquant": "250807.1.2", "created_at": int(time.time() * 1000)}), encoding="utf8")
    return {"python": str(python), "installed": True, "directory": str(target)}


def main():
    try:
        request = {"action": "verify"} if sys.argv[1:] == ["--verify"] else json.loads(sys.stdin.read(65537))
        begin = int(time.time() * 1000)
        with contextlib.redirect_stdout(sys.stderr):
            if request["action"] == "prepare":
                result = prepare(request)
            else:
                data, trader, account, info = sdk_info()
                result = {"environment": info} if request["action"] == "verify" else query(request, data, trader, account)
        response = {"ok": True, "result": result, "sample": {"from": begin, "to": int(time.time() * 1000)}}
    except Exception as error:
        response = {"ok": False, "error": {"code": getattr(error, "code", "SOURCE_UNAVAILABLE"), "message": str(error), "details": getattr(error, "details", None)}}
    sys.stdout.write("\nSESAME_QMT_RESULT:" + json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
