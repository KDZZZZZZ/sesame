# API 2 publication plans

Each `dev.N.json` pins a public source commit, the exact package selection,
reproducible archive/lock digests, and its publishing dev-to-main pull request.
Only JSON plans authorize publication; this directory alone does not publish.

The first publication after the history reset is `dev.5`: nine core and 45
optional plugins for Sesame 0.2.3, excluding Kurumi. Its source is
`635b367105b4b824fcb92e176c14818ac6976e0b`; package bytes and versions match
the previously verified API 2 payloads.

`dev.7` selects eleven core and 45 optional plugins for Sesame 0.3.0 from
`e601157a9f55bd453c597856b776d62ef6e343d9`, excluding Kurumi. Its fixed package
selection and archive/lock digests also supply the host's bundled plugin pins.
The `dev.N` sequence identifies plugin publication; it does not select the
application's stable or preview update channel.

See [publication and independent review requirements](../../plugins/api-v1/PUBLISHING.md).
