# CCXT backend provenance

Original adapter author: Sesame contributors, https://github.com/KDZZZZZZ/sesame.

The JavaScript provider, fixed public Python bridge/worker, dependency discovery/preparation tools and package Skill are original Sesame integration files, licensed MIT (see `LICENSE`). No CCXT library implementation is copied or vendored in this package. The separately downloaded Python dependency is CCXT **4.5.85**, upstream authors CCXT contributors, licensed MIT. Import/version and resolved PyPI download SHA256 receipts identify the actual dependency environment; they are not security-audit claims.

Official references used for API behavior:

- [CCXT manual](https://docs.ccxt.com/docs/manual): public fetchOHLCV, precision modes, rate limiting, and incomplete latest candles.
- [CCXT upstream source](https://github.com/ccxt/ccxt) and [MIT license](https://github.com/ccxt/ccxt/blob/master/LICENSE.txt).
- [Pinned PyPI distribution 4.5.85](https://pypi.org/project/ccxt/4.5.85/). Explicit prepare obtains dependencies only from official PyPI; no Python engine is bundled or installed at activation.

Actual scope: explicit Kraken/Coinbase/OKX public spot sources, generic market instruments and OHLCV/polling subscriptions; no account credentials, order submission or live broker capability. Exchange data rights/terms are separate from the adapter and library software licenses. Time/source/coverage/closure and precision limitations remain in provider metadata and the Skill.

Adapter 1.0.1 adds strict public configuration fields and plugin-private durable connection-ID/revision lookup, so a dashboard or restarted host preserves the explicitly selected public route. The underlying CCXT dependency remains 4.5.85. These storage records contain only exchange and credential-free publicProxy, never exchange credentials or discovered system proxy settings.
