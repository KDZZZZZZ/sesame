"""Fictional engine fixture, not a trading recommendation or profitable strategy."""
from vnpy_ctastrategy import CtaTemplate


class ExampleStrategy(CtaTemplate):
    author = "Sesame"
    parameters = []
    variables = []

    def on_init(self):
        self.seen = 0

    def on_bar(self, bar):
        self.cancel_all()
        self.seen += 1
        if self.seen == 1:
            self.buy(bar.close_price + 1, 1)
        elif self.seen == 3 and self.pos > 0:
            self.sell(bar.close_price - 1, 1)
