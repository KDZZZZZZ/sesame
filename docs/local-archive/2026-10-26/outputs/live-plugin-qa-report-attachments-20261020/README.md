# Report attachment links — bounded bug fix

Status: source fix and isolated regression verified; the running desktop has **not** been updated by this task.

## Confirmed contract and reproduction

`sesame/plugins/api-v1/packages/reports/prompt.md` already directs multi-file reports with evidence attachments to retain package-relative paths. `mt5agent/docs/report-library.md` also states that resources added to a flat report stay in its immutable package, which published rendering uses. No new publication or download API is needed.

The root observer's [fixed bundle metadata](../live-plugin-qa-20261020/report-evidence-v3-bundle-metadata.json) proves that evidence report revision 3 declares `index.html` and all three JSON files in `manifest.blobs`:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `evidence/evidence-ledger.json` | 34572 | `ba7b4536ce63c39be6b0e599f340bec54a15a58c3f4e14151b50d3c7dc3ad560` |
| `evidence/calculation-ledger.json` | 407581 | `ca6c747116a71b7f40f0800a8937e237b33cf9d13b0df67ab04a4a42ed38407b` |
| `evidence/methods-ledger.json` | 92879 | `f14e82c70ed7e8fdd1fb5eda5fcb90de28dbc1c2163289c4b45d0009aa84d042` |

[Before evidence](../live-plugin-qa-20261020/report-attachment-links-before.json) records all three real UI links resolving from `about:srcdoc` to the host's `/evidence/...` and returning HTTP 404. The published HTML was present; the attachments were registered. `artifact-host.js` inlined script, stylesheet and image references but omitted anchors.

## Minimal implementation

Only production file changed: `mt5agent/modules/frontend/report-runtime/artifact-host.js`.

- Verify each bundle asset's metadata against the already digest-verified manifest as well as its byte digest/size. Reject undeclared or duplicate bytes.
- Resolve package links relative to the immutable entry, including nested entries and URL-encoded names. Only registered package resources get the attachment marker. Same-document fragments remain fragments; other links retain the existing navigation policy.
- Rewrite those attachment anchors to `href="#"`, retain a fixed resource-path marker, and handle trusted clicks through the existing per-view MessagePort. The parent requires an active user gesture and an initialized view, looks up only the already verified bytes, and initiates a download named from the registered path.
- Parent Blob URLs use `application/octet-stream`, so a packaged active document is not opened at the application origin. URLs are revoked after a bounded lifetime or view disposal.
- Keep `sandbox="allow-scripts"`, opaque origin, CSP, external navigation policy, view/nonce checks, resource limits and public SDK methods unchanged. No new dependency, HTTP route, model request, data read, report edit or plugin interface.

The React entry points already dynamically load this runtime for artifact reports. Standalone draft/live previews do not have an artifact package and are unchanged.

## Verification

The regression was added before implementation. On the original runtime, `node --test --test-name-pattern=Chromium tests/report-attachment-links.test.js` failed to receive downloads; actual requests reached `/evidence/evidence-ledger.json` and navigation removed the report. This red result is recorded in the task tool output; no fabricated original log is included here.

Final command:

```text
node --test --test-concurrency=1 tests/report-attachment-links.test.js tests/frame-policy.test.js tests/report-bundle-wiring.test.js tests/report-export-renderer.test.js
```

[Recorded result](regression-green.log): **30/30 passed**, no skipped tests. Both real Chromium and a separate hidden Electron test application exercised three JSON downloads and checked byte hashes and registered filenames. The tests also cover nested paths, encoded names, forged out-of-package requests, synthetic clicks, opaque sandboxing, static printing without download side effects, unchanged outside-link attributes, corrupt bundle rejection and existing report export/rendering/navigation behavior.

Electron's Playwright adapter did not emit `page.download` in this fixture. The final test uses Electron's actual `DownloadItem` completion and files in its temporary test profile; all were `completed` with matching byte hashes. This test-adapter correction required no product change.

Targeted oxlint, `node --check` and `git diff --check` passed. No frontend build is needed because this runtime is served directly; no existing build output was modified.

## Static PDF boundary

Printing remains side-effect free. The new runtime no longer puts the broken host `/evidence/...` URLs in attachment annotations. A standalone PDF/PNG **does not embed or download the JSON attachments** under the existing exporter contract. The report's attachment text remains visible, but retrieving those files requires the published report in Sesame. This task does not claim standalone-PDF attachment delivery; no public file-serving API or uncontrolled external link was added.

## Deployment and smallest UI recheck

Deploy the one source file to:

```text
E:/brief2great/sesame/mt5agent/release/win32-x64-agent-messages-20261020/win-unpacked/resources/app/modules/frontend/report-runtime/artifact-host.js
```

No React dist or plugin package update is required. Use the root task's idle maintenance/restart procedure: the page caches imported modules, and the report inspection service caches runtime asset text when its process starts.

After the root performs that maintenance, open the existing evidence report revision 3 and click its three ledger links. Observe real downloads, compare the three filenames/byte lengths/SHA-256 values with the fixed metadata above, confirm the report remains open, and confirm no host-root `/evidence/...` request or new page error. Test clicks, not raw `GET` of rewritten `href="#"`. This task did not touch the root's UI helpers or the running desktop.
