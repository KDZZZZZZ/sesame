"""Final-mile MiniQMT order checks, using an existing connected native session."""
import decimal
import re
import time


class GuardRejected(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.details = {"submission_attempted": False}


def need(condition, code, message):
    if not condition:
        raise GuardRejected(code, message)


def positive(value):
    try:
        n = decimal.Decimal(str(value))
        need(n.is_finite() and n > 0, "SOURCE_DATA_INVALID", "Expected positive native amount")
        return n
    except decimal.InvalidOperation:
        raise GuardRejected("SOURCE_DATA_INVALID", "Invalid native decimal")


def submit(trader, account, data, detail, request, send, clock=lambda: int(time.time()*1000), monotonic=time.monotonic):
    guard, start, mono = request["execution_guard"], clock(), monotonic()
    required = {"observed_at", "expires_at", "max_quote_age_ms", "max_quote_to_send_ms", "price_limit"}
    need(isinstance(guard, dict) and required <= set(guard) <= required | {"expected_positions"}, "INVALID_ARGUMENT", "Invalid execution guard")
    need(all(type(guard[k]) is int for k in ("observed_at", "expires_at", "max_quote_age_ms", "max_quote_to_send_ms")), "INVALID_ARGUMENT", "Guard times must be integer milliseconds")
    need(0 < guard["expires_at"]-guard["observed_at"] <= 60000 and 0 < guard["max_quote_age_ms"] <= 5000 and 0 < guard["max_quote_to_send_ms"] <= 1000, "INVALID_ARGUMENT", "Guard exceeds latency budgets")
    def deadline():
        now = clock()
        need(now >= start and now >= guard["observed_at"], "CLOCK_CHANGED", "Clock moved backwards")
        need(now < guard["expires_at"] and (monotonic()-mono)*1000 < guard["expires_at"]-start, "SIGNAL_EXPIRED", "Trading decision expired before native submission")
        return now
    deadline()
    symbol, side, shares = request["symbol"], request["side"], int(request["shares"])
    expected_positions = None
    def whole(value, code):
        need(isinstance(value, (str, int)) and type(value) is not bool and re.fullmatch(r"(0|[1-9]\d*)", str(value)) is not None, code, "Native shares must be nonnegative integers")
        return int(value)
    if "expected_positions" in guard:
        expected = guard["expected_positions"]
        need(isinstance(expected, list) and len(expected) <= 20000, "INVALID_ARGUMENT", "Expected positions must be a bounded array")
        expected_positions = []
        for row in expected:
            need(isinstance(row, dict) and set(row) == {"account_id", "stock_code", "volume", "can_use_volume"}
                 and row["account_id"] == request["account_id"] and row["stock_code"] == symbol
                 and isinstance(row["volume"], str) and isinstance(row["can_use_volume"], str), "INVALID_ARGUMENT", "Malformed expected native position")
            expected_positions.append((row["account_id"], row["stock_code"], whole(row["volume"], "INVALID_ARGUMENT"), whole(row["can_use_volume"], "INVALID_ARGUMENT")))
        expected_positions.sort()
    def verify_portfolio():
        if expected_positions is None:
            return
        positions = trader.query_stock_positions(account)
        need(isinstance(positions, (list, tuple)), "SOURCE_UNAVAILABLE", "Cannot verify full symbol positions")
        actual = []
        for row in positions:
            if getattr(row, "stock_code", None) == symbol:
                need(str(getattr(row, "account_id", "")) == request["account_id"], "ACCOUNT_MISMATCH", "Native position belongs to another account")
                actual.append((str(row.account_id), row.stock_code, whole(getattr(row, "volume", None), "SOURCE_DATA_INVALID"), whole(getattr(row, "can_use_volume", None), "SOURCE_DATA_INVALID")))
        need(sorted(actual) == expected_positions, "POSITION_CHANGED", "Full symbol positions changed after observation")
        orders = trader.query_stock_orders(account)
        need(isinstance(orders, (list, tuple)), "SOURCE_UNAVAILABLE", "Cannot verify symbol working orders")
        for row in orders:
            if getattr(row, "stock_code", None) == symbol:
                need(str(getattr(row, "account_id", "")) == request["account_id"], "ACCOUNT_MISMATCH", "Native order belongs to another account")
                status = str(getattr(row, "order_status", ""))
                need(status in {"53", "54", "56", "57"}, "WORKING_ORDERS", "Symbol order is not confirmed terminal; reconcile before target execution")
    price, boundary = positive(request["price"]), positive(guard["price_limit"])
    need(price <= boundary if side == "buy" else price >= boundary, "INVALID_ARGUMENT", "Order price exceeds authorized boundary")
    tick_size = positive(detail.get("PriceTick"))
    need(price % tick_size == 0, "INVALID_ARGUMENT", "Price violates native tick size")
    for key, compare in (("MinLimitOrderVolume", lambda x: shares >= x), ("MaxLimitOrderVolume", lambda x: shares <= x)):
        if detail.get(key) is not None:
            need(compare(positive(detail[key])), "INVALID_ARGUMENT", "Quantity violates native order limits")
    asset = trader.query_stock_asset(account)
    need(asset is not None and str(getattr(asset, "account_id", "")) == request["account_id"], "ACCOUNT_MISMATCH", "Cannot verify configured account")
    if side == "buy":
        need(decimal.Decimal(str(getattr(asset, "cash", "NaN"))).is_finite(), "SOURCE_DATA_INVALID", "Account cash unavailable")
        need(decimal.Decimal(str(asset.cash)) >= price*shares, "INSUFFICIENT_FUNDS", "Cash cannot cover limit notional; broker additionally checks fees")
    else:
        positions = trader.query_stock_positions(account)
        need(isinstance(positions, (list, tuple)), "SOURCE_UNAVAILABLE", "Cannot verify sellable shares")
        rows = [p for p in positions if getattr(p, "stock_code", None) == symbol]
        need(len(rows) == 1 and str(getattr(rows[0], "account_id", "")) == request["account_id"] and int(getattr(rows[0], "can_use_volume", -1)) >= shares, "POSITION_CHANGED", "Insufficient available shares; T+1 applies")
    verify_portfolio()
    before = clock()
    ticks = data.get_full_tick([symbol])
    received = deadline()
    tick = ticks.get(symbol) if isinstance(ticks, dict) else None
    raw_time = tick.get("time") if isinstance(tick, dict) else None
    need(type(raw_time) is int and 1000000000000 <= raw_time < 10000000000000, "SOURCE_DATA_INVALID", "Quote lacks verified UTC epoch milliseconds")
    need(0 <= received-raw_time <= guard["max_quote_age_ms"], "STALE_QUOTE", "Native quote is stale or future-dated")
    values = tick.get("askPrice" if side == "buy" else "bidPrice")
    quote = positive(values[0]) if isinstance(values, (list, tuple)) and values else None
    need(quote is not None, "SOURCE_DATA_INVALID", "Executable quote level unavailable")
    need(quote <= boundary if side == "buy" else quote >= boundary, "PRICE_MOVED", "Latest quote crossed authorized boundary")
    verify_portfolio()
    send_at = deadline()
    need(send_at-received <= guard["max_quote_to_send_ms"], "LATENCY_BUDGET_EXCEEDED", "Quote-to-send budget exceeded")
    order_id = send()
    completed = clock()
    return order_id, {"source_time_ms":raw_time,"quote_received_at":received,"quote_request_ms":received-before,"send_started_at":send_at,"quote_to_send_ms":send_at-received,"decision_age_at_send_ms":send_at-guard["observed_at"],"native_preflight_ms":send_at-start,"receipt_at":completed,"send_to_receipt_ms":completed-send_at,"latest_executable_price":str(quote),"fill_price_guaranteed":False}
