# Provenance and licensing

The adapter, runner, documentation and fictional example in this directory are original Sesame contributor code, licensed under the adjacent MIT LICENSE. No upstream implementation, Qt binary, wheel, strategy library, or data is vendored in this package.

The integration was checked against the real `vnpy` 4.5.0 and `vnpy_ctastrategy` 1.4.1 packages from PyPI, rather than a substituted engine:

- VeighNa project: https://github.com/vnpy/vnpy — MIT, Copyright (c) 2015-present Xiaoyou Chen.
- CTA strategy extension and engine: https://github.com/vnpy/vnpy_ctastrategy — MIT, Copyright (c) 2015-present Xiaoyou Chen.
- Engine implementation: https://github.com/vnpy/vnpy_ctastrategy/blob/main/vnpy_ctastrategy/backtesting.py (method signatures cross-checked against the installed pinned wheel).
- Official workflow: https://github.com/vnpy/vnpy/blob/master/docs/community/app/cta_backtester.md.
- PyPI: https://pypi.org/project/vnpy/4.5.0/ and https://pypi.org/project/vnpy-ctastrategy/1.4.1/.

The checked top-level universal wheels have SHA-256:

- vnpy 4.5.0: `69d95de6a78812c5617fea1475ac5ce29fdee279c6c44dc4689738aff9bd0fcd`
- vnpy_ctastrategy 1.4.1: `d625ebbff1fcf1a61794bf7c75c13f4bcfea333b3d80d0ada36292a09100288f`

Dependencies are downloaded only during explicit environment preparation, under their own licenses (including Qt/PySide licenses). The venv retains each distribution's license metadata; this plugin's MIT grant does not relicense those dependencies. The install report records all resolved versions, URLs and SHA-256 values, including transitive dependencies. Transitive resolution can differ by platform or preparation date; the saved inventory fixes what actually ran, and a changed configured inventory is rejected until deliberately reconfigured. An existing environment records installed versions, but does not invent wheel hashes that were never observed.
