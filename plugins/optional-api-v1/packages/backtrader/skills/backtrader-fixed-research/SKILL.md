---
name: backtrader-fixed-research
description: Run real Backtrader Cerebro on frozen observed or explicitly fictional inputs and authored Python; no broker or SVL equivalence.
---

1. Load `sesame/backtrader`. Inspect existing native Python/Backtrader; explicit prepare reuses compatible pinned 1.9.78.123 first, otherwise installs only a private venv via official PyPI. Does not download Python, change shared environments, or run on plugin load.
2. Acquire real data through a market provider and generic data-access (CCXT/AKShare/MT5/QMT are separate sources). Backtest accepts a fixed json-rows DataRef, not mutable dataset IDs. Preserve provenance; synthetic samples stay demo. Supply columns if names differ. OHLCV must be complete Decimal strings with strictly ordered explicit UTC/offset datetime (SourceTime UTC accepted). Unknown volume or ambiguous wall clocks are rejected; do not fabricate zero or timezone.
3. Write one actual `backtrader.Strategy` file in the task workspace. Use `class_name` and explicit parameters. Python runs with current-user host permissions; plugin provides no OS sandbox and configures only BackBroker cash simulation, never a live store or gateway. Do not read or export credentials.
4. `backtrader_backtest` requires unique operation_id, title, fixed DataRef, strategy_path, class_name and config {capital,commission,slippage} as Decimal strings. Commission/slippage are ratios; model is stocklike cash, not derivative margin. Original code, data, environment, matching assumptions and raw native outputs are frozen.
5. Interrupted reserved operations return unknown and never rerun automatically. Changing frozen inputs under a key conflicts. Use a new explicit research request for a new run. Native failures are failed outcomes, not success.
6. Read `backtrader_result`, then use existing reports/data-access/canvas capabilities with its equity/trades/orders DataRefs. Do not create another report publisher, canvas controller or environment framework. Native Python is not SVL; no automatic translation or equivalence is claimed. Engine uses binary floats despite Decimal input/output text.
