# Provenance

Sesame contributors authored this MIT-licensed workflow, implementation and examples. The package uses the public Sesame Plugin API 2 and composes existing SVL, factor-library and Backtrader capabilities. The original engines and their licenses belong to their own packages.

Native parameter experiments use the Backtrader adapter's local Python process and an explicitly authored Python file. The strategy-development manifest declares the process.execute scope for that call chain and lists its callable functions individually.

The module interfaces and classic/hybrid choice draw on QuantConnect's Algorithm Framework. Component gap reporting, immutable project records and the factor handoff are Sesame features. The method references link to the original authors of the research techniques. [Algorithm Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview) · [Hybrid algorithms](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/hybrid-algorithms)

Version 1.1 adds original research method guides and implementation. The executable forecast_buffer teaching example implements position buffering on a daily stock-like Backtrader feed. The trade-path checks adapt Peterson’s trade-excursion analysis to the observable portion of a bar-level execution record. The timing checks replay Sesame SVL event fixtures. The discrete two-sided neighborhood and its coverage rules are specific to this package. [Peterson](https://www.braverock.com/brian/CapeR_2016_backtest.html) · [pysystemtrade](https://github.com/pst-group/pysystemtrade/blob/develop/systems/buffering.py) · [Freqtrade recursive analysis](https://www.freqtrade.io/en/stable/recursive-analysis/)

The breakout opportunity study and matching long-breakout SVL signal are original Sesame examples. The study separates movement before the next open from subsequent continuation on a frozen development partition. It illustrates falsifiable strategy design and can precede an execution backtest. [QuantConnect Research Guide](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide)
