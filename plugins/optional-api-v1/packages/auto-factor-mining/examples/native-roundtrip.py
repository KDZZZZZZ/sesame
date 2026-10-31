"""Explicit software fixture, not a market strategy recommendation."""
import backtrader as bt


class RoundTrip(bt.Strategy):
    params = (("exit_bar", 3),)

    def __init__(self):
        if self.p.exit_bar < 2:
            raise ValueError("exit_bar must leave time for a confirmed entry")

    def next(self):
        if len(self) == 1:
            self.buy(size=1)
        elif len(self) == self.p.exit_bar:
            self.close()
