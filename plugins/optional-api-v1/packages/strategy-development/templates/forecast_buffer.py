"""Editable single-instrument, long-only daily cash-equity research strategy."""

import math

import backtrader as bt


def buffered_target(current, target, average_position, hard_cap, buffer_fraction,
                    buffer_mode, trade_to_edge, force_flat=False):
    """Return a whole-share order target given confirmed holdings and today's limits."""
    if force_flat or target <= 0 or current < 0 or hard_cap <= 0:
        return 0
    centre = min(math.floor(target), math.floor(hard_cap))
    if centre == 0 or current > hard_cap or buffer_fraction == 0:
        return centre
    if buffer_mode not in ("position", "forecast"):
        raise ValueError("buffer_mode must be position or forecast")
    width_base = centre if buffer_mode == "position" else average_position
    width = buffer_fraction * width_base
    lower = math.ceil(max(0, centre - width))
    upper = math.floor(min(hard_cap, centre + width))
    if current < lower:
        return lower if trade_to_edge else centre
    if current > upper:
        return upper if trade_to_edge else centre
    return current


class ForecastBufferStrategy(bt.Strategy):
    """A forecast with typical absolute value 10 uses one daily volatility budget."""

    params = (
        ("fast_span", 8), ("slow_span", 32), ("vol_window", 20),
        ("forecast_scale", 4.0), ("forecast_cap", 20.0),
        ("daily_risk_target", 0.005), ("daily_risk_limit", 0.02),
        ("max_exposure", 0.80), ("cash_reserve", 0.02), ("halt_drawdown", 0.20),
        ("buffer_fraction", 0.0), ("buffer_mode", "forecast"), ("trade_to_edge", True),
    )

    def __init__(self):
        if len(self.datas) != 1 or self.data._timeframe != bt.TimeFrame.Days or self.data._compression != 1:
            raise ValueError("forecast_buffer requires one daily cash-equity feed with compression 1")
        p = self.p
        if any(type(v) is not int for v in (p.fast_span, p.slow_span, p.vol_window)):
            raise ValueError("Moving-average spans and volatility window must be integers")
        if not 1 <= p.fast_span < p.slow_span or p.vol_window < 2:
            raise ValueError("Require 1 <= fast_span < slow_span and vol_window >= 2")
        numbers = (p.forecast_scale, p.forecast_cap, p.daily_risk_target, p.daily_risk_limit,
                   p.max_exposure, p.cash_reserve, p.halt_drawdown, p.buffer_fraction)
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in numbers):
            raise ValueError("Risk, forecast and buffer parameters must be finite numbers")
        if p.forecast_scale <= 0 or p.forecast_cap <= 0 or not 0 < p.daily_risk_target <= p.daily_risk_limit <= 1:
            raise ValueError("Forecast scale and cap must be positive and 0 < daily_risk_target <= daily_risk_limit <= 1")
        if not 0 < p.max_exposure <= 1 or not 0 <= p.cash_reserve < 1 or not 0 < p.halt_drawdown <= 1:
            raise ValueError("max_exposure and halt_drawdown must be in (0,1], cash_reserve in [0,1)")
        if p.buffer_fraction < 0 or p.buffer_mode not in ("position", "forecast") or type(p.trade_to_edge) is not bool:
            raise ValueError("Use nonnegative buffer_fraction, forecast or position buffer_mode and boolean trade_to_edge")
        self.fast = bt.ind.EMA(self.data.close, period=p.fast_span)
        self.slow = bt.ind.EMA(self.data.close, period=p.slow_span)
        self.price_vol = bt.ind.StdDev(self.data.close - self.data.close(-1), period=p.vol_window)
        self.peak_equity = None
        self.halted = False
        self.pending_order = None
        self.cancel_requested = False

    def start(self):
        self.peak_equity = float(self.broker.getvalue())

    def prenext(self):
        self.next()

    def notify_order(self, order):
        if self.pending_order is not None and self.pending_order.ref == order.ref and not order.alive():
            self.pending_order = None
            self.cancel_requested = False

    def _risk_and_forecast(self, equity, price):
        """Return desired shares, average absolute forecast shares and hard risk ceiling."""
        vol = self.price_vol[0]
        if self.halted or not all(math.isfinite(v) for v in (equity, price, vol, self.fast[0], self.slow[0])):
            return 0, 0, 0
        if min(equity, price, vol) <= 0:
            return 0, 0, 0
        p = self.p
        typical_position = equity * p.daily_risk_target / vol
        forecast = max(-p.forecast_cap, min(p.forecast_cap, p.forecast_scale * (self.fast[0] - self.slow[0]) / vol))
        raw_target = typical_position * max(0.0, forecast) / 10.0
        hard_cap = math.floor(min(equity * min(p.max_exposure, 1 - p.cash_reserve) / price,
                                  equity * p.daily_risk_limit / vol))
        return raw_target, typical_position, hard_cap

    def next(self):
        equity = float(self.broker.getvalue())
        self.peak_equity = max(self.peak_equity, equity)
        if equity <= self.peak_equity * (1 - self.p.halt_drawdown):
            self.halted = True
        price = self.data.close[0]
        current = self.getposition(self.data).size
        raw_target, typical, hard_cap = self._risk_and_forecast(equity, price)
        desired = buffered_target(current, raw_target, typical, hard_cap, self.p.buffer_fraction,
                                  self.p.buffer_mode, self.p.trade_to_edge, self.halted)
        if self.pending_order is not None:
            # remsize includes partial fills. Wait for cancellation before replacing an order.
            projected = current + self.pending_order.executed.remsize
            must_flatten = raw_target < 1 or self.halted
            if not self.cancel_requested and (projected > hard_cap or projected < 0 or (must_flatten and projected != 0)):
                self.cancel(self.pending_order)
                self.cancel_requested = True
            return
        if desired > current:
            # Estimate buying power at the known close. The broker charges actual fill costs once.
            available = max(0, self.broker.getcash() - equity * self.p.cash_reserve)
            unit_cost = price + self.broker.getcommissioninfo(self.data).getcommission(1, price)
            desired = min(desired, current + math.floor(available / unit_cost))
        if desired != current:
            self.pending_order = self.order_target_size(data=self.data, target=desired, exectype=bt.Order.Market)
