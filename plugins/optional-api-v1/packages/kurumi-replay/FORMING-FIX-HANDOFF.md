# Fixed-data forming SDK contract correction (dev.3.3)

The actual SDK rejected dev.3.2 display/refresh with `Fixed data has no forming bars`.
Fixed annotation input `overlay` now uses `forming: closed_only`. Dynamic chart `price` stays `forming: include`; no consumed tick, price, fills, account, rules, budget, model or timing changes.
Presentation publication and ownership memo now pin exact definition/code bundle digest, so a corrected source cannot silently reuse an earlier indicator revision. Existing foreign user indicators remain protected.
Existing official source, first-round history, both archive chains and current second-run engine are untouched during development. Native page reload/current initial account AX evidence is accepted separately; dynamic account, actual consumed forming/SMA20, comparison pixels and automatic UTC weekly report still require real testing.
The standalone fixed-input SDK publication probe succeeded via indicator_publish (l01); this is publication-contract evidence only, not rendering. No new developer task, user settings change or paid full replay.
