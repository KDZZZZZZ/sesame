# Backtrader backend provenance

Original adapter author: Sesame contributors, https://github.com/KDZZZZZZ/sesame.

The dependency tools, fixed DataRef validation/artifact publication, Python runner/Analyzer and package Skill are original Sesame integration files, licensed GPL-3.0-or-later (see `LICENSE`). No Backtrader engine implementation is copied or vendored in this package. The separately downloaded Python engine is Backtrader **1.9.78.123**, upstream project by Daniel Rodriguez and contributors, licensed GPL-3.0-or-later. The retained `LICENSE` is the GPLv3 license text obtained from the upstream project; it records the component license, not a legal conclusion about other software.

Official references used for API behavior:

- [Backtrader quickstart](https://www.backtrader.com/docu/quickstart/quickstart/).
- [Cerebro](https://www.backtrader.com/docu/cerebro/) and [data feeds](https://www.backtrader.com/docu/datafeed/).
- [Analyzers](https://www.backtrader.com/docu/analyzers/analyzers/): observation callbacks are kept separate from authored Strategy lifecycle hooks.
- [Upstream source](https://github.com/mementum/backtrader) and [GPL license](https://github.com/mementum/backtrader/blob/master/LICENSE).
- [Pinned PyPI distribution 1.9.78.123](https://pypi.org/project/backtrader/1.9.78.123/).

The engine is installed on explicit demand into a private environment or a verified compatible existing environment is selected. It runs as an independent Python host process; no engine is included in the adapter/default bundle. Actual capability is fixed-data Cerebro/BackBroker cash simulation with immutable source, inputs and output DataRefs. It does not provide a live broker, account/order API, SVL translation or equivalence guarantee. Authored Python runs with current-user host permissions; native float execution and modeled transaction assumptions remain explicit limitations.
