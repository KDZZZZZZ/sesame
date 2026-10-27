Closing a trading event stream could leave its account binding active, and closed or evicted collaboration panels retained view IDs inside the workflow plugin. Always attempt account unbinding when stream closure fails, and release panel references with their subscriptions in both manual trading and factor mining.

Versions advance to `manual-trading` 3.0.1 and `auto-factor-mining` 1.0.1-dev.1, with matching package locks and the existing Sesame >=0.2.3-dev.8 requirement. The PR also archives the earlier composition and collaboration design records. Kurumi and published catalog/archive identities are unchanged.

Validation: 34 targeted tests pass, including the three regressions reproduced before the fix, shared viewer assets, host-version requirements, and installation through the real host with local model and broker fixtures. The optional lock validates all 46 packages. No live trading was performed.
