# VeighNa CTA backtests

`sesame/vnpy` is an optional API 1 plugin. It runs the real VeighNa CTA `BacktestingEngine` on a fixed `DataRef` and one Agent-authored `CtaTemplate` Python file. It preserves the exact Python source, parameters, bar input, environment inventory, process receipt, daily results, simulated orders and fills as immutable artifacts. It does not connect a live gateway, publish account state, or place broker orders.

This development package requires Sesame API 1 native plugin support. It is not in the stable 0.1.4 catalog or the 19-package application lock. Publication alone does not mean a released application supports installing it.

## Use

1. Call `vnpy_environment` with `action: "inspect"` and an existing `python_path` when needed. Inspection performs a real import and engine construction; it does not download anything.
2. Call `action: "prepare"` only when preparing dependencies is part of the user's task. A compatible existing environment is reused without installing into it. Otherwise the plugin creates its own persistent venv and installs fixed `vnpy==4.5.0` and `vnpy_ctastrategy==1.4.1` from official PyPI wheels, records every resolved dependency URL/version/SHA-256, and runs `pip check`. It never downloads Python or modifies a system environment.
3. Freeze data as `json-rows` using `report_data` or another data-producing plugin. Each row must have time, OHLC and volume. Explicit column mapping is supported. Inputs are 2–100,000 bars, at most 16 MiB. Missing prices or volume are errors. Offset-free timestamps require their original `wall_time_authority`; no guessed UTC conversion occurs.
4. Write one Python strategy in the workspace, then call `vnpy_backtest`. Declare symbol/exchange, interval, commission rate, slippage, contract size, tick size, capital and parameters. `operation_id` is idempotent for the exact source, data, mapping and settings. The result includes fixed references suitable for the reports plugin.
5. Call `vnpy_result` to reopen a fixed result. It does not rerun Python. Publish reports using the returned daily/trades/orders references, explicitly retain demo labels, then use `report_check` to validate real rendering.

Existing environments require native 64-bit Python 3.10–3.13 and the two exact engine versions; the pinned Qt dependency does not support Python 3.14. Only official binary wheels are installed. If the selected platform lacks a wheel or a dependency cannot be downloaded, preparation fails with its real diagnostic. Dependency downloads are large; no runtime or Qt assets are embedded in this plugin. Reusing an existing environment is usually faster.

## Execution and interpretation

Python runs as a task-managed process with the current system user's permissions. It is **not an OS sandbox**. The strategy can access ordinary host Python capabilities; inspect its source and keep execution within the user's requested scope. Task cancellation stops managed processes. The plugin does not rewrite code paths; use the actual workspace cwd or relative paths. Its temporary job directory is removed after execution; source and result artifacts survive that cleanup. It avoids VeighNa's default `~/.vntrader` fallback by creating a local `.vntrader` in the temporary job.

Only bar replay is supported (`1m`, `1h`, `d`, `w`). Tick input, automatic database loading, online history, multi-file strategy projects, gateway/account bridges and SVL translation are not provided. Strategy warmup must be covered by preceding fixed bars and an explicit start. Early engine termination or Python exceptions produce a failed result rather than success with partial bars. No trades is a valid outcome and remains distinct from failure.

The pinned engine uses Python/NumPy binary floating point. Output decimal strings preserve its actual values; they do not imply decimal34 precision or equivalence to SVL. Matching, costs, short positions, mark-to-market and open positions at test end follow this engine's behavior. Read the pinned source and result assumptions before comparing engines. The bundled four-bar example is deliberately fictional, tests two simulated fills, and is not investment evidence.

AKShare supplies research market data; this plugin supplies native CTA backtesting; a separately configured and authorized broker plugin is needed for broker connectivity. Those responsibilities are not interchangeable.

## Bounded dependency preparation (1.0.1)

Existing compatible configured Python is reused read-only first. A new private venv and preparation receipt survive interrupted/failed installs. Official PyPI wheel metadata selects native platform wheels; large pinned Qt and engine wheels use durable Range partials, limited to 64 MiB or 420 seconds per call. Full SHA256 validation occurs before a wheel is renamed as complete. A server that refuses the resume range produces an explicit error and preserves bytes; it does not silently redownload. Completed archives and pip HTTP cache are private and persistent.

`vnpy_environment prepare` can return `ready:false`, a phase, downloaded byte/source/hash receipts, `retryable`, and the precise next action. Repeat with the same original base path to finish downloads and installation. After three unchanged failures or source/hash/resume integrity errors, stop automatic retries and diagnose/use existing dependencies. This is not a global install or a download on load. The complete pinned engine import and pip consistency checks still determine readiness.
