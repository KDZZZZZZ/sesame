# Native release CI simplification

Keep the full 48-file shared regression suite on Linux. Stop duplicating generic Agent orchestration, queue and report presentation tests on every packaging runner. No product behavior or existing test assertion is removed.

All three platforms retain storage boundaries, source/lock checks, update artifact validation, actual installer build/extraction, native Electron payload import and immutable private staging. Linux retains the existing browser update/restart checks; the update controller, feed and desktop session checks remain on all three platforms. Windows/macOS run the existing native host files (schema worker, configuration including Windows credential behavior, host commands, workspace commit, Windows store, plugin lifecycle/updates, report filesystem) and real model transport/SDK command tests.

The asset preparation gate must require Linux's entire shared suite and every platform's native checks, with all three successful jobs from one source/run/attempt. Missing, failed or skipped required steps remain rejected. Add regression coverage for the platform-specific gate before changing it, then run the helper suite and appropriate workflow checks. Independent review checks coverage preservation and no gate weakening before dispatch.
