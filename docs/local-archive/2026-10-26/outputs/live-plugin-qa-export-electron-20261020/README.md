# Electron PDF export diagnosis — 2026-10-20

The real desktop repeatedly returned `Failed to generate PDF: Printing failed`
for the published QA cross-market report v3, while its PNG export succeeded.
The isolated reproduction loads only the frozen report and its four fixed data
dependencies from `fixture.json`; it does not run Sesame, an Agent, or a business
capability.

## Finding

- The source and installed Electron adapter were identical; both used Electron
  44.5.1 / Chromium 152.0.7977.130.
- `concurrent-peak/events.json` records the original 384 MiB watchdog failure
  before native printing rejects with the generic `Printing failed` message.
- The watchdog counted the working sets of the report host and its iframe.
  Those PID sets were distinct between concurrent jobs. Shared/mapped resident
  pages made that measure exceed 384 MiB even while private memory stayed below
  the limit. This is not evidence of a particular font or mapped file.
- Shrinking the export viewport or using frame-level printing did not reliably
  reduce the measured working set. Those diagnostic variants were not adopted.

Electron documents Windows `privateBytes` as memory not shared with other
processes, with both memory fields expressed in KiB:
https://www.electronjs.org/docs/latest/api/structures/memory-info

## Minimal source fix

`mt5agent/modules/frontend/electron/report-renderer.js` now:

1. Uses valid, nonnegative Windows `privateBytes` for the same relevant PIDs.
   Other platforms or unavailable private metrics retain `workingSetSize`.
   Invalid fallback metrics fail explicitly.
2. Keeps the 384 MiB limit, deadline, rendering isolation and output limits.
3. Races PDF and PNG operations against the existing renderer-failure promise
   so the originating resource error survives native-operation teardown.

No report content, export CSS, public interface, installed application, live
configuration, or business state was changed by this fix.

## Verification

- A regression first failed with `Printing failed` instead of the expected
  memory-budget error, then passed after the adapter change.
- `node --test tests/electron-report.test.js`: all 15 real Electron checks pass.
  Added coverage includes valid private accounting, missing/NaN/infinite/negative
  private-metric fallback, invalid fallback rejection, original error
  propagation, and two concurrent expanded Chinese PDFs. The existing real
  oversized-heap test still reaches the budget and confirms subsequent recovery.
- `node --test --test-concurrency=1 tests/report-export-renderer.test.js
  tests/report-export-http.test.js`: 15/15 pass.
- Syntax checks and diff whitespace checks pass. Targeted oxlint reports only
  two pre-existing fixture callback expression warnings.
- `concurrent-fixed/a.pdf` and `b.pdf`: each 9 pages, 1,041,714 bytes, identical
  SHA-256; all three disclosures open, 127 table rows, zero hidden rows, height
  12096. The main gold table contributes 114 rows.
- `concurrent-fixed/pdf-proof.json`: all 114 gold timestamps, final close,
  method/source text, A-share section, and actual Unicode report title verified
  from both PDFs. Unicode NFKC is used when comparing extracted CJK text.
- `concurrent-fixed/page-5.png` and `page-9.png`: independently rendered with
  Poppler. Page 5 visibly includes the last gold row and expanded method/code;
  page 9 contains the report's final source/boundary information.

In this successful concurrent run, the sampled working-set sums were 476260
and 487668 KiB, while corresponding private-byte sums were 250652 and 254288
KiB. The unchanged private budget is 393216 KiB.

The desktop has not yet loaded this adapter fix. Its next UI export remains the
integration acceptance check after the parent performs an idle-safe deployment.

## Optional isolated repeat

Run from the workspace using a new attempt name, for example:

```powershell
node outputs/live-plugin-qa-export-electron-20261020/run.mjs concurrent-repeat-fixed
```

The harness refuses an existing attempt directory, starts only an isolated
hidden Electron fixture, and kills only that fixture on its 65-second deadline.
The snapshot collector must not be rerun during normal regression testing.
