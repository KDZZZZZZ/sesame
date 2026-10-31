# Native CI 39051008871 diagnosis

- Host: `b9c5bef39e18c44bb3048fd8ddb3854c4117d430`.
- Plugins: `4e153a4474285e162d88a484d517fa37283a465c`.
- Attempt: 1. macOS and Linux completed successfully, including extracted-installer verification and private staging. Root cancelled the remaining Windows job; the workflow is cancelled and is not eligible for installer preparation.
- No installer preparation, upload, publication, installation, or code edits were performed in this monitoring lane.

## Windows evidence

Full official job log: `native-ci-windows-39051008871.log`, job 117449413728.

The first backend step ran from 16:50:35Z until cancellation at 17:13:31Z. It emitted seven test failures before the hang:

| Case | File | Observed failure |
| --- | --- | --- |
| 24 | bundled-plugin-updates.test.js:216 | Manifest validation reported 17 `MCP schema 校验超时` errors, beginning with configSchema. Stack ends at line 225. |
| 25 | bundled-plugin-updates.test.js:228 | plugin_disabled at line 230. |
| 26 | bundled-plugin-updates.test.js:251 | plugin_load_failed at line 253. |
| 27 | bundled-plugin-updates.test.js:266 | plugin_disabled at line 268. |
| 53 | configuration.test.js:61 | eventually timed out during ask at line 76. |
| 55 | configuration.test.js:93 | INVALID_INPUT because the schema validation Worker timed out. |
| 56 | configuration.test.js:109 | configurationFixture line 16 expected discoverable, got disabled. |

Cases 57 and 58 then passed. The last test output was at 16:59:35Z. On cancellation, Node explicitly reported `tests\\configuration.test.js` still running. The bundled-plugin-updates file had already finished emitting all its cases; the earlier proposed fixture_wait release path is not supported as the cause of this particular hang.

## Concrete leak path

`configurationFixture()` obtains a live app from `fixture()` and immediately asserts plugin availability before returning it. Every caller awaits this helper before entering its own try/finally. The availability assertion in case 56 threw, so no caller received the app and no `dispose()` was registered or invoked. The fixture had already opened both the application HTTP server and local model server. These live handles kept the test file process alive even after its later tests finished.

## Trigger and limits of the diagnosis

`modules/agent/plugin-system/mcp-client.js:29–30` creates a new schema Worker and immediately starts a 3000ms timer. That budget includes Worker startup and module/AJV initialization as well as schema execution. The official Windows log directly establishes repeated schema timeouts on ordinary fixture manifests and inputs. Resource contention during the four-way CI batch is the supported explanation for the timing sensitivity; the log does not include Worker CPU/startup measurements, so their exact share cannot be reconstructed.

The test fixture cleanup defect is independently established by the failure location and control flow. Fixing it will allow CI to terminate with the actual test failures instead of hanging. Keeping startup and hostile schema execution budgets distinct would address the false invalid-schema classification; serializing resource-heavy CI files can reduce contention but does not itself repair that product behavior.

## Live diagnostic limits

While Windows was running, the official job log endpoint returned HTTP 404. The corresponding check-run was in_progress with annotations_count 0 and no summary. Files `native-ci-windows-39051008871-live.err` and `native-ci-windows-39051008871-check.json` preserve that evidence. No browser UI was used.
