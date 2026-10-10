"""Optional final-mile checks for the fixed official order_send bridge.

No transport, configuration discovery, retries, or arbitrary code execution.
Times are local UTC epoch milliseconds and MT5's documented UTC tick.time_msc.
"""
import decimal
import math
import time


class GuardRejected(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def need(condition, code, message):
    if not condition:
        raise GuardRejected(code, message)


def number(value):
    try:
        result = decimal.Decimal(str(value))
        need(result.is_finite() and result > 0, "INVALID_ARGUMENT", "Expected a positive finite amount")
        return result
    except (decimal.InvalidOperation, TypeError, ValueError):
        raise GuardRejected("INVALID_ARGUMENT", "Expected a positive finite amount")


def guarded_cancel(mt5, request, guard, clock=lambda: int(time.time() * 1000)):
    """Verify the configured account and unique live pending order in this worker."""
    need(isinstance(guard, dict) and set(guard) == {"expected_account", "expected_server", "symbol", "remark", "order", "side"}, "INVALID_ARGUMENT", "Invalid cancellation guard")
    need(all(isinstance(guard[k], str) and guard[k] for k in guard) and guard["side"] in ("buy", "sell") and guard["order"].isdigit() and 0 < int(guard["order"]) < 2**64, "INVALID_ARGUMENT", "Explicit cancellation ownership required")
    need(set(request) == {"action", "order"} and request["action"] == mt5.TRADE_ACTION_REMOVE and str(request["order"]) == guard["order"], "INVALID_ARGUMENT", "Guard only supports the exact pending order removal")
    def account_matches():
        account, terminal = mt5.account_info(), mt5.terminal_info()
        need(account is not None and terminal is not None and str(account.login) == guard["expected_account"] and account.server == guard["expected_server"], "ACCOUNT_MISMATCH", "Cancellation account changed")
        need(getattr(account, "trade_allowed", None) is True and getattr(account, "trade_expert", None) is True and getattr(terminal, "connected", None) is True and getattr(terminal, "trade_allowed", None) is True and getattr(terminal, "tradeapi_disabled", True) is False, "FORBIDDEN", "Cancellation channel is not permitted")
    account_matches()
    rows = mt5.orders_get(symbol=guard["symbol"])
    need(isinstance(rows, (list, tuple)), "SOURCE_UNAVAILABLE", "Cannot verify current pending orders")
    matched = [row for row in rows if row.symbol == guard["symbol"] and row.comment == guard["remark"]]
    need(len(matched) == 1, "ORDER_CHANGED", "Cancellation requires one exact native order")
    row = matched[0]
    expected_type = mt5.ORDER_TYPE_BUY_LIMIT if guard["side"] == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    need(str(row.ticket) == guard["order"] and row.type == expected_type and row.state in (mt5.ORDER_STATE_PLACED, mt5.ORDER_STATE_PARTIAL) and number(row.volume_current) > 0, "ORDER_CHANGED", "Pending order changed or is no longer active")
    account_matches()  # A slow native order query cannot bypass a changed account.
    sent = clock()
    result = mt5.order_send(request)
    completed = clock()
    return result, {"cancellation_verified_at":sent,"send_started_at":sent,"receipt_at":completed,"send_to_receipt_ms":completed-sent}


def guarded_send(mt5, request, guard, clock=lambda: int(time.time() * 1000), monotonic=time.monotonic):
    """All checks and the single send run in this same serialized native worker."""
    start, mono_start = clock(), monotonic()
    def deadline():
        now = clock()
        need(now >= start and now >= guard["observed_at"], "CLOCK_CHANGED", "Clock moved backwards")
        need(now < guard["expires_at"], "SIGNAL_EXPIRED", "Trading decision expired before native submission")
        need((monotonic() - mono_start) * 1000 < guard["expires_at"] - start, "SIGNAL_EXPIRED", "Native preparation exceeded decision lifetime")
        return now
    need(isinstance(guard, dict) and set(guard) == {"observed_at", "expires_at", "max_quote_age_ms", "max_quote_to_send_ms", "price_limit", "side", "expected_account", "expected_server"}, "INVALID_ARGUMENT", "Invalid execution guard")
    need(all(type(guard[k]) is int for k in ("observed_at", "expires_at", "max_quote_age_ms", "max_quote_to_send_ms")), "INVALID_ARGUMENT", "Guard times must be integer milliseconds")
    need(0 < guard["expires_at"] - guard["observed_at"] <= 60000 and 0 < guard["max_quote_age_ms"] <= 5000 and 0 < guard["max_quote_to_send_ms"] <= 1000, "INVALID_ARGUMENT", "Guard exceeds supported latency budgets")
    deadline()
    account, terminal = mt5.account_info(), mt5.terminal_info()
    need(account is not None and terminal is not None, "SOURCE_UNAVAILABLE", "Cannot verify account and terminal")
    need(str(account.login) == guard["expected_account"] and account.server == guard["expected_server"], "ACCOUNT_MISMATCH", "Connected account changed")
    need(getattr(account, "trade_allowed", None) is True and getattr(account, "trade_expert", None) is True and getattr(terminal, "connected", None) is True and getattr(terminal, "trade_allowed", None) is True and getattr(terminal, "tradeapi_disabled", True) is False, "FORBIDDEN", "Account or terminal does not permit this trading channel")
    symbol, side = request.get("symbol"), guard["side"]
    need(isinstance(symbol, str) and symbol and side in ("buy", "sell"), "INVALID_ARGUMENT", "Explicit symbol and side required")
    deal, pending = request.get("action") == mt5.TRADE_ACTION_DEAL, request.get("action") == mt5.TRADE_ACTION_PENDING
    expected_type = (mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL) if deal else (mt5.ORDER_TYPE_BUY_LIMIT if side == "buy" else mt5.ORDER_TYPE_SELL_LIMIT)
    need((deal or pending) and request.get("type") == expected_type, "UNSUPPORTED_CAPABILITY", "Guard supports market, limit, and position reduction only")
    spec = mt5.symbol_info(symbol)
    need(spec is not None, "SOURCE_UNAVAILABLE", "Symbol specifications unavailable")
    volume = number(request.get("volume"))
    step = number(spec.volume_step)
    need(number(spec.volume_min) <= volume <= number(spec.volume_max) and volume % step == 0, "INVALID_ARGUMENT", "Volume violates native minimum, maximum or step")
    if request.get("position"):
        positions = mt5.positions_get(ticket=request["position"])
        need(positions is not None and len(positions) == 1, "POSITION_CHANGED", "Target position is no longer unique")
        p = positions[0]
        need(p.symbol == symbol and volume <= number(p.volume) and p.type == (mt5.POSITION_TYPE_SELL if side == "buy" else mt5.POSITION_TYPE_BUY), "POSITION_CHANGED", "Close request no longer matches position")
    limit = number(guard["price_limit"])
    def fresh_quote():
        before = clock()
        tick = mt5.symbol_info_tick(symbol)
        received = deadline()
        need(tick is not None and type(tick.time_msc) is int, "SOURCE_DATA_INVALID", "Tick lacks documented UTC milliseconds")
        need(0 <= received - tick.time_msc <= guard["max_quote_age_ms"], "STALE_QUOTE", "Latest native quote is stale or future-dated")
        price = number(tick.ask if side == "buy" else tick.bid)
        need(price <= limit if side == "buy" else price >= limit, "PRICE_MOVED", "Executable quote crossed the authorized price boundary")
        return tick, received, received - before, price
    tick, received, quote_ms, price = fresh_quote()
    request = dict(request)
    if deal:
        request["price"] = float(price)
    else:
        order_price = number(request.get("price"))
        need(order_price <= limit if side == "buy" else order_price >= limit, "INVALID_ARGUMENT", "Limit order exceeds authorized boundary")
    checked = mt5.order_check(request)
    need(checked is not None and checked.retcode == 0, "ORDER_CHECK_REJECTED", "Native order_check rejected the request")
    # order_check may be slow; refresh after it without another model turn.
    tick, received, quote_ms, fresh_price = fresh_quote()
    # Keep the checked request unchanged; a moved quote is safe only inside both
    # the absolute limit and the explicit broker deviation. The broker is final.
    send_at = deadline()
    need(send_at - received <= guard["max_quote_to_send_ms"], "LATENCY_BUDGET_EXCEEDED", "Quote-to-send budget exceeded")
    result = mt5.order_send(request)
    completed = clock()
    return result, {"source_time_ms": tick.time_msc, "quote_received_at": received, "quote_request_ms": quote_ms, "send_started_at": send_at, "quote_to_send_ms": send_at-received, "decision_age_at_send_ms": send_at-guard["observed_at"], "native_preflight_ms": send_at-start, "receipt_at": completed, "send_to_receipt_ms": completed-send_at, "latest_executable_price": str(fresh_price), "checked_request_price": str(request.get("price")), "fill_price_guaranteed": False}
