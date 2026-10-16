# API 2 publication plans

Each `dev.N.json` pins a public source commit, the exact package selection,
reproducible archive/lock digests, and its publishing dev-to-main pull request.
Only JSON plans authorize publication; this directory alone does not publish.

The first publication after the history reset is `dev.5`: nine core and 45
optional plugins for Sesame 0.2.3, excluding Kurumi. Its source is
`635b367105b4b824fcb92e176c14818ac6976e0b`; package bytes and versions match
the previously verified API 2 payloads.

See [publication and independent review requirements](../../plugins/api-v1/PUBLISHING.md).
