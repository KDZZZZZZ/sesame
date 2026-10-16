# Independent optional research methods

These eight API 1 packages target Sesame `>=0.2.0-0`. Each is installed as
`discoverable` and loaded separately. None depends on another theory package,
adds tools/providers, downloads dependencies, connects an account or extends SVL.
An ICT-only session receives the ICT skill and prompt; other methods can remain
catalog/discovery metadata, but their skill text and resources are not activated.

| Package | Method scope | Executable aid | Main source family |
| --- | --- | --- | --- |
| `sesame/ict` | Explicit reference levels, three-bar interval observations, candidate/invalidation records | Exact closed-bar interval separation only | ICT author's 2022 public video metadata/description; full transcript not obtained |
| `sesame/price-action` | Trend/range context, delayed swing confirmation and close breaks | Strict L/R pivots and first close beyond latest confirmed pivot | Brooks publisher/author material; MIT community skill comparison |
| `sesame/elliott-wave` | Structure/degree, standard impulse constraints, alternate counts and first-known times | Manual candidate and counterexample fixture | Frost/Prechter publication metadata and EWI public explanations |
| `sesame/wyckoff` | Price/volume evidence, phase candidates and falsifiers | Manual candidate and tick-volume counterexample | Wyckoff publication metadata and Wyckoff Analytics teaching |
| `sesame/dow-theory` | Declared secondary reactions and separate index closing confirmations | Manual two-index and future-data counterexample | Hamilton bibliography, named CMT authors |
| `sesame/behavioral-finance` | Testable behavioral mechanisms and observable proxies | Evidence/unknown-reference-point counterexample | Kahneman primary publication/lecture metadata |
| `sesame/institutional-analysis` | Rules, implementation, funding constraints and economic-history comparison | Effective-date and mismatched-institutions counterexample | North lecture; Adrian/Shin primary research |
| `sesame/narrative-analysis` | Claims, propagation clusters, counterclaims and conditional scenarios | Duplicate-news and future-revision counterexample | Shiller primary journal material |

Each package has its own prompt, substantial SKILL, method reference, provenance,
license and original teaching case. Research controls shared in purpose (time,
fixed evidence, units, coverage) do not require another theory. The two script
packages each ship the same small generic bar-input validator, avoiding a hidden
installation dependency. Their actual observation algorithms are separate.
The unshipped umbrella candidates `technical-analysis` and
`market-interpretation` are not package IDs or installation targets.

## Existing capability ownership

Data discovery and frozen prices use `data-access` with an explicitly selected
provider; scripts use workspace `write`/`bash`, and `research_register` freezes
successful execution outputs. Reports and chart rendering remain owned by
`reports` and `canvas-control`. Persistent forecasting uses the optional judgment
plugin only when requested. Executable rules use core strategy-authoring and a
separately selected target profile. These methods do not create a parallel
retrieval, report, order or strategy interface.

Author terminology is kept separate from the finite implemented rules. Neither
the ICT observer nor the Price Action observer is a complete trading system.
An interval separation does not observe institutional orders or guarantee a
fill. A historical pivot cannot be available before its right-side confirmation;
source close time is only an earliest structural bound, not guaranteed receipt
or tradability time. Subjective wave/phase counts retain alternatives, first-known
timestamps, explicit failure conditions and revisions.

## Sources and licensing

Every package's `PROVENANCE.md` fixes the actual access scope, original source URLs
and publication information. No paid book chapters, diagrams, video transcripts
or third-party code were copied. Source marketing/performance claims were not
adopted. QuantSkills GPL skills were read as workflow comparisons at fixed Git
commits; their text, templates, interfaces and code were not transplanted or
relicensed. The Price Action package also records an actual MIT community skill
review. Package text, tests, fixtures and scripts are original MIT work; linked
materials retain their own copyrights.

## Reproducible checks

Run from this repository root:

```sh
node --test plugins/optional-api-v1/tests/method-packages.test.mjs
python3 -B plugins/optional-api-v1/tests/method_observations_test.py -v
SESAME_HOST_ROOT=/path/to/matching-host node --test plugins/optional-api-v1/tests/method-host.test.mjs
```

The first checks the eight packages as an isolated package set, declared resource
closure, licenses and the six manual counterexamples. The Python suite checks
independent known results, all historical prefixes, late confirmation, decimal
precision, ties, wick-only moves, invalid/unclosed bars, clocks, units, budgets and
both actual standalone commands. The opt-in test uses the matching real Store,
Runtime, Pi SDK session and plugin manager, with temporary state and a never-called
model. It installs all eight through `plugin_test`/`plugin_install`, loads each in
an independent conversation through `plugin_load`, reads every declared resource,
rejects reads from unmounted methods and confirms ICT-only state after reopening.

It also performs the real `data_read` → `bash` → `research_register` → `report_data`
→ `report_publish` chain for both scripts, checking five ICT observations and six
Price Action observations against the deliberately fictional sample. Actual
execution IDs, fixed DataRefs and report references are emitted in TAP diagnostics;
the temporary state is then deleted. Demo origin stays demo. This proves local
package/workflow behavior, not model judgment quality, real market accuracy,
rendered report UI, financial efficacy, native backtesting or trading.

On 2026-10-10 UTC these checks passed: **2 Node package/case tests, 16 Python
tests, and 1 real-host integration test** (eight installation/loadout cases and
two execution/publication chains inside it). The host test made zero network or
model calls and zero native/account calls. Without `SESAME_HOST_ROOT`, the host
test is explicitly skipped, not counted as passed. Core and optional inventory,
locks, catalog and release plans are intentionally left to the integration owner.
