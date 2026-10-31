Sesame 0.2.3 upgrades the host and plugin contract to API 2, unifies Agent and workflow runs, adds trading memory and manual position closing, and fixes native lifecycle and report-path regressions. This change updates the download links, installation guide, provenance record and six-asset publication plan.

The binaries were built from private host revision `0e01b39ed6d167ef7619753ba2638584c93199b2` with plugin source `635b367105b4b824fcb92e176c14818ac6976e0b`. The plugin catalog is already published on R2: 9 core and 45 optional API 2 plugins, excluding Kurumi.

Validation: all three native platform jobs passed (1,131 test executions: 1,123 passed, 8 skipped, 0 failed), including installer extraction, fixed plugin source checks and packaged server import. All four downloaded installer bodies, the installation guide and the checksum file match the recorded byte sizes and SHA-256 values. The 29 application publication and catalog unit tests passed locally.

The complete public draft asset set will be verified before merging dev into main; the trusted main workflow publishes the draft and mirrors it to R2. This PR does not claim full desktop interaction or broker integration testing. Existing application releases, installation assets, licenses and attribution are retained.
