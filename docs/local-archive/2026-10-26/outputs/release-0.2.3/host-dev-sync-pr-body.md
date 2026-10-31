Sync the verified Sesame 0.2.3 release candidate and its native release evidence into dev. This includes API 2 plugin pins, physical storage and account window fixes, native installer staging, the cancellation/GC regression fix, and the six-asset provenance record.

All three platform jobs in build run 38998445449 passed against host source 0e01b39ed6d167ef7619753ba2638584c93199b2 and plugin source 635b367105b4b824fcb92e176c14818ac6976e0b. There were 1,131 test executions: 1,123 passed, 8 skipped and 0 failed. The only commit after that binary source updates docs/distribution/RELEASE-ASSETS.json; it does not alter executable code or the installer payload.

Host lifecycle regressions passed 60/60 and report regressions passed 55/55 locally. The release record preserves the limits of package checks and does not claim live broker or full desktop acceptance.
