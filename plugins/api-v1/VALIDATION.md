# Published release evidence — 2026-10-09

These records describe completed publications, not proposed plans. Each exact PR head received a separate Agent review, recorded by the repository maintainer; **independent human approval was not recorded**. The trusted main-branch semantic gate completed before normal merge. The publisher then checked the same head, review and discussion snapshot and published immutable development assets as `github-actions[bot]`. The stable 0.1.4 catalog remains separate.

All five assets for each release below were downloaded from its published GitHub release and matched GitHub asset sizes and SHA-256 values, the reviewed release plan and application pin. The actual host extractor and package verifier accepted all 19 official packages or three optional packages. The source commit and reviewed head were confirmed as ancestors of the ordinary main-branch merge; no squash/rebase compatibility is inferred. See [the publication protocol](PUBLISHING.md) for the gate boundaries and historical static-only releases.

## [plugins-api-v1-dev.6](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.6)

- PR: [#13](https://github.com/KDZZZZZZ/sesame/pull/13); reviewed head: `ed51d200c1a18489e5d0bf763c6cf573b921d164`.
- Package source: `ccb59e990eed65911fa1a10b029a7aee7ce8115a`; ordinary merge: `6937305ba021bb20a0f0b022fdc18bede3eca383`.
- Independent review: [Codex /root independent review](https://github.com/KDZZZZZZ/sesame/pull/13#issuecomment-6085890403), completed `2026-10-09T17:26:08Z`; maintainer record created `2026-10-09T17:27:11Z`. This is an Agent review record, not a human approval.
- Merge: `2026-10-09T17:28:56Z`; publication: `2026-10-09T17:29:27Z`, [successful publishing workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/37966577997).

| Final check | Completion (UTC) | Result |
| --- | --- | --- |
| [package-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37966127277/job/113940802991) | 2026-10-09T17:25:22Z | success on the reviewed head |
| [catalog-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37966127271/job/113940803809) | 2026-10-09T17:25:19Z | success on the reviewed head |
| [Premerge semantic gate](https://github.com/KDZZZZZZ/sesame/actions/runs/37966373973) | 2026-10-09T17:27:28Z | success before merge |

The gate ran trusted main revision `5164418bf4919967fba92db673382e80ab339645`, checked the open head at `2026-10-09T17:27:24Z`, and retained artifact `11633282396` with SHA-256 `9f4331b24258b0ed30237a2abc7f950376f0e19ff34a05836ceffcf6be3db070`. The authenticated maintainer recorder, the Agent reviewer named in that maintainer's attestation, formal-review state and resolved-discussion set are preserved in the release's [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/review.json).

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [application-official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/application-official-plugins.lock.json) | 3633 | `15df70684960d4bfcf29f2ddab8d01661de90fe7951a7c796e67b43ea102db86` |
| [official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/official-plugins.lock.json) | 54757 | `aa853ebcddf87e9d8ae567ece3d4d70db5b8bec3b8fb1b31c13c83f171bd5c3b` |
| [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/review.json) | 6197 | `80a4e6884dc00b1f5df05d060ae634912c4be84ed0327793b07f96e672b49607` |
| [sesame-official-plugins-api-v1-dev.6.tar.gz](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/sesame-official-plugins-api-v1-dev.6.tar.gz) | 1853603 | `06a82fbc7ee55d9629475a6594f6491b1a5364055c010aaebe38f199f36b7511` |
| [SHA256SUMS](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.6/SHA256SUMS) | 203 | `b31d4b1696779c8f2e5d72087a93b274ad3c7b759deb80fac3208da34624b7ab` |

The prepublication cleanup-error finding was fixed by an independent preservation flag and a complete diagnostic-I/O failure regression; upstream truncated-output evidence was also preserved before this final head was reviewed. Earlier heads are not the released review identity.

## [plugins-api-v1-dev.7](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.7)

- PR: [#14](https://github.com/KDZZZZZZ/sesame/pull/14); reviewed head: `c322f5413cabc3840eb87507d5c0348a41fa624e`.
- Package source: `3eee24417941893335936ec1b166f034a4d5077f`; ordinary merge: `836f450e690cabfbd59e99c836122d7b37076c32`.
- Independent review: [Codex /root/release_dev independent review](https://github.com/KDZZZZZZ/sesame/pull/14#issuecomment-6086182944), completed `2026-10-09T17:44:15Z`; maintainer record created `2026-10-09T17:45:46Z`. This is an Agent review record, not a human approval.
- Merge: `2026-10-09T17:48:09Z`; publication: `2026-10-09T17:48:50Z`, [successful publishing workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/37968830471).

| Final check | Completion (UTC) | Result |
| --- | --- | --- |
| [package-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37968227321/job/113947897330) | 2026-10-09T17:43:17Z | success on the reviewed head |
| [catalog-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37968227272/job/113947897731) | 2026-10-09T17:43:12Z | success on the reviewed head |
| [Premerge semantic gate](https://github.com/KDZZZZZZ/sesame/actions/runs/37968558275) | 2026-10-09T17:46:01Z | success before merge |

The gate ran trusted main revision `6937305ba021bb20a0f0b022fdc18bede3eca383`, checked the open head at `2026-10-09T17:45:58Z`, and retained artifact `11634955163` with SHA-256 `54385145900deb9e8cc90db15035eb66f7ca5f15a95f0456929b93e57e42a129`. The authenticated maintainer recorder, the Agent reviewer named in that maintainer's attestation, formal-review state and resolved-discussion set are preserved in the release's [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/review.json).

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [application-official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/application-official-plugins.lock.json) | 3633 | `f62fd1ae70162f9185d0be3d7af564b4ac4999c5908e460a7b43e1a5918ec04b` |
| [official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/official-plugins.lock.json) | 54928 | `09ca34b35ad4d7ababe198f3655a096078bcef77834c4f954538ba92c76e7b41` |
| [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/review.json) | 6360 | `90a70ce0dc938c234a2d898cd7844b1f5abf181a4f313d0fa105f29a505707c1` |
| [sesame-official-plugins-api-v1-dev.7.tar.gz](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/sesame-official-plugins-api-v1-dev.7.tar.gz) | 1890979 | `ea67af11ec9aa1f99eb2edc0bab3e298e4541c6c5130f4322c52888055d37076` |
| [SHA256SUMS](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.7/SHA256SUMS) | 203 | `96fea888faa113f01486afb41874b78257b0df1610a00d3e2782560dea72af7a` |

The final head includes both time-basis corrections: ambiguous wall-clock folds are explicitly unsupported, and wall requests reject mismatched authority/zone/basis before freezing data. The previously reviewed candidate was replaced, not published or retroactively relabelled.

## [plugins-api-v1-dev.8](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.8)

- PR: [#16](https://github.com/KDZZZZZZ/sesame/pull/16); reviewed head: `618495aba47cc36a59c745ce3599df59f9742149`.
- Package source: `3fe35eb22e47b5ece40f7dfc094c834c8da90d21`; ordinary merge: `b4678e233b9a895e495b0fc7d86d517f9644e728`.
- Independent review: [Codex /root/refactor_plugins independent review](https://github.com/KDZZZZZZ/sesame/pull/16#issuecomment-6086708155), completed `2026-10-09T18:16:39Z`; maintainer record created `2026-10-09T18:17:51Z`. This is an Agent review record, not a human approval.
- Merge: `2026-10-09T18:19:34Z`; publication: `2026-10-09T18:20:15Z`, [successful publishing workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/37972485938).

| Final check | Completion (UTC) | Result |
| --- | --- | --- |
| [package-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37971786228/job/113959966223) | 2026-10-09T18:13:49Z | success on the reviewed head |
| [catalog-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37971785983/job/113959964670) | 2026-10-09T18:13:41Z | success on the reviewed head |
| [Premerge semantic gate](https://github.com/KDZZZZZZ/sesame/actions/runs/37972288237) | 2026-10-09T18:18:12Z | success before merge |

The gate ran trusted main revision `3a4bef2cc8222075791e1c10df8578d6049a2dee`, checked the open head at `2026-10-09T18:18:07Z`, and retained artifact `11636696712` with SHA-256 `b0d48812c5a9f6e99b45993d2b1e6efd7834423f4c051cd4bf1b14dfd9f068c4`. The authenticated maintainer recorder, the Agent reviewer named in that maintainer's attestation, formal-review state and resolved-discussion set are preserved in the release's [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/review.json).

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [application-official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/application-official-plugins.lock.json) | 3633 | `1b72fdc4179f7b823ef6492026a3edfc55940585dae855cbb09baa62125983f0` |
| [official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/official-plugins.lock.json) | 54928 | `91748a44978ed4bf40df3ba8d77ae20c19217391937721df5170babea9eed90e` |
| [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/review.json) | 6249 | `a40f50848e07f8b34ae891f00528c090bcedaffada11ee284f85ee130f798cb9` |
| [sesame-official-plugins-api-v1-dev.8.tar.gz](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/sesame-official-plugins-api-v1-dev.8.tar.gz) | 1892515 | `a1d12ffd5adfa921a22c6f05dc0bc446f5d83195ae946b996201da9b4b0fd797` |
| [SHA256SUMS](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.8/SHA256SUMS) | 203 | `34a0583f65df19ea304057d2cef677a1d640e763275edfbb1314ce2034ebb95d` |

The [negative premerge run](https://github.com/KDZZZZZZ/sesame/actions/runs/37970085217) rejected the unresolved [raw-history cache finding](https://github.com/KDZZZZZZ/sesame/pull/16#discussion_r4233080484). Publication stayed blocked while the author removed history retention and separated consumer cancellation; the independent reviewer then checked those fixes and the new final head. The old `bfe78614` no-blocking conclusion was withdrawn and is not used. The positive gate above includes the resolved discussion. Two interrupted local archive downloads were completed with a ranged public download, followed by full-size, full-digest and actual host extraction verification; no published asset was replaced.

## [plugins-optional-api-v1-dev.4](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.4)

- PR: [#15](https://github.com/KDZZZZZZ/sesame/pull/15); reviewed head: `603e59cd85c43ac0102dd32c9e74185adf43da77`.
- Package source: `1f380819fa4e7a50198ebdf2e596295bf223795b`; ordinary merge: `3a4bef2cc8222075791e1c10df8578d6049a2dee`.
- Independent review: [Codex /root/refactor_plugins independent review](https://github.com/KDZZZZZZ/sesame/pull/15#issuecomment-6086220277), completed `2026-10-09T17:45:29Z`; maintainer record created `2026-10-09T17:47:52Z`. This is an Agent review record, not a human approval.
- Merge: `2026-10-09T17:50:32Z`; publication: `2026-10-09T17:51:32Z`, [successful publishing workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/37969111368).

| Final check | Completion (UTC) | Result |
| --- | --- | --- |
| [package-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37967923546/job/113946866803) | 2026-10-09T17:40:34Z | success on the reviewed head |
| [catalog-static-review](https://github.com/KDZZZZZZ/sesame/actions/runs/37967923695/job/113946867431) | 2026-10-09T17:40:31Z | success on the reviewed head |
| [Premerge semantic gate](https://github.com/KDZZZZZZ/sesame/actions/runs/37968798320) | 2026-10-09T17:48:11Z | success before merge |

The gate ran trusted main revision `6937305ba021bb20a0f0b022fdc18bede3eca383`, checked the open head at `2026-10-09T17:48:07Z`, and retained artifact `11634094201` with SHA-256 `99f2c9ca163f7e7a88921b444c664474cef296c2110fbfe757ad81adbf5f493a`. The authenticated maintainer recorder, the Agent reviewer named in that maintainer's attestation, formal-review state and resolved-discussion set are preserved in the release's [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/review.json).

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [application-official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/application-official-plugins.lock.json) | 936 | `a2287d300b3d92de8bae94a0b768cc30cf8764743b822c6fff1ce4fbb0de1c8c` |
| [official-plugins.lock.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/official-plugins.lock.json) | 8462 | `e9caeb9feadd95b45bc7b59ddf0fbedf9f7e28f3310315aca1baf9dcfeca6e19` |
| [review.json](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/review.json) | 6135 | `6e000b1dcc4978ebe167db257babd44c17cb5eb5b3b574d800dfb1fd032e346b` |
| [sesame-optional-plugins-api-v1-dev.4.tar.gz](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/sesame-optional-plugins-api-v1-dev.4.tar.gz) | 234534 | `068b9b6f8923ad8c5f9fe646d3a95a88d41d11594df688d558436b30c93549b3` |
| [SHA256SUMS](https://github.com/KDZZZZZZ/sesame/releases/download/plugins-optional-api-v1-dev.4/SHA256SUMS) | 203 | `929479ad6d76b65df5aa55b61904c84faa22739ec2889eeb3fd090fadae355d0` |

This release contains AKShare 1.0.2, QMT 1.0.0 and vn.py 1.0.1. A fresh test fixture downloaded the three immutable public catalog packages, verified their files, installed/loaded them and called their environment/status tools in the same Pi session (one integration test, 20.2 seconds). It used an existing compatible vn.py environment; it did not install dependencies or exercise a new model decision, full fresh Qt installation, authorized Windows QMT terminal or brokerage trade. The catalog source remains `373bb390c8903688105a88f51b33960f8665187a`.

# Development bundle 9 validation

Only MT5 changes, from 1.1.5 to 1.1.6; the other 18 package versions and file
trees remain those of bundle 8. Reusing a compiled build after archival could
republish changed storage metadata under the same native-build operation, causing
a real host idempotency conflict before a run was created. The input fingerprint
does not include producer identity; a plugin upgrade is a reuse scenario, not a
separate cause of this conflict. The plugin now persists a fixed build-reference index
and strictly validates existing build evidence before reusing its original ref
and producer. Archive location and cleanup flags are excluded from compiled
content identity. New definitions still use the fixed build operation; the fix
does not randomize operations or weaken the host's idempotency rules.

A pre-merge review also found that each previously unseen build rescanned all
resource history. Legacy build candidates are now indexed in one persistent
migration; the completion marker is written only after the scan and index writes
finish. Later new builds use their direct indexes, including after a restart.
The first migration still enumerates existing resource metadata. Foreign
producer metadata is filtered before reading resource contents. Every legacy candidate is still strictly verified when reused; conflicting references
remain an error.

Fourteen public frozen-build/run-reference checks passed. Independent review also
passed 14 checks using a real temporary Store and ContractArtifacts, including
protect/cleanup removing the transient manifest, closing and reopening the Store,
and two new main-session run definitions/RunRecords across producer
version fixtures 1.1.3, 1.1.6 and 1.1.7. These are compatibility fixtures, not a
claim that a 1.1.7 package has been released. The original fixed ref and producer
remain intact. Changed immutable build/manifest/translation/EX5 data, missing or
damaged blobs, foreign references/dependencies and ambiguous same-build refs are
rejected rather than adopted or republished.

After the migration-cost correction, independent review reran the 14 public
checks and the 14 Store/ContractArtifacts checks and passed eight additional
migration checks (36 total). A temporary real Store with 2,100 foreign resources
required two metadata pages and zero foreign-content reads. After migration,
20 new builds and 20 more after a Store reopen performed zero history list/read
operations; a legacy hit read only its own reference. Interrupted page reads and
partial index writes left no completion marker and retried after reopening.
Duplicate candidates, immutable changes and foreign references remained rejected;
a publication followed by an index-write failure still reused the same host
operation and artifact after restart.

A read-only inspection of the previous application's stored evidence reproduced
the mismatch caused by the two archive-state fields. In a separate temporary
Store, three repeated frozen-build lookups retained the original 1.1.3-produced ref with
zero new publications, and immutable changes were rejected. The independent
review inspected that evidence without rerunning the original database script.
This verifies evidence freezing and persistent lifecycle, not new compilation,
native Tester execution or brokerage trading. No running application cache was
rewritten. The final source, lock and archive still require the exact-head review
and premerge publication gate described in [PUBLISHING.md](PUBLISHING.md).

# Development bundle 8 validation

Only MT5 changes from 1.1.4 to 1.1.5; the other 18 packages, including
data-access 2.2.0, remain byte-identical to bundle 7. Native latest-N history
truncation could omit the actually observed current bar from a small live tail.
The provider now reads the complete bounded time window, checks for source
truncation, and selects the requested tail locally. It does not turn a truncated
source response into evidence of live completeness.

The two focused source regressions passed, covering forming/closed-only tails
and rejection at the source limit. Separate independent review passed 12 targeted
checks and 63 timeframe/tail-size boundary combinations. The largest computed
native request limit was 11,522; the actual native tool schema was inspected.
Real read-only Host ProviderRegistry subscriptions for M1, M2, M15, H1 and MN1
with a tail of two retained the observed forming bar; closed-only requests
returned two closed bars. The largest observed M1 response was 7,261 rows and
802,904 bytes, so small output tails can still require a larger bounded native
history read. Coverage remained explicitly incomplete. The M15 polling check
observed ready/close lifecycle cleanup with no retained binding or subscription.

Before publication, a platform review found that each moving history window
remained in the raw-response cache. Independent review also reproduced one
consumer's cancellation rejecting another consumer's shared pending read.
Neither finding was treated as passing review. History responses now stay only
with their current read. Completed metadata values are limited to 16 entries,
64 KiB each and at most one second of retained lifetime; expiry runs without a
subsequent read. Pending reads have independent consumer cancellation and
binding-owned controllers. Unbinding or disposing clears owned entries and
prevents late responses from refilling them.

The corrected source passed 19 repository regressions and five additional
independent checks. These cover 120 moving windows, metadata capacity/expiry,
large responses, two bindings, request completion ordering, late replies after
unbind/dispose, and actual Host ProviderRegistry subscriptions where closing one
consumer leaves the other updating without a gap. A further native read-only
tail-of-two check retained both the observed closed and forming bars and received
subsequent price/volume updates. This verifies raw-response cache retention and
consumer lifecycle; it is not a claim that the complete application uses no
memory or that every native history read is small.

This verification did not start a terminal, place a trade or change the running
application cache. Native polling is not an exchange tick feed. The matching
fixed bundle still requires the exact-head independent review, trusted premerge
gate and automatic publication process in [PUBLISHING.md](PUBLISHING.md).
Earlier release assets, optional plugins and the stable catalog are unchanged.

# Development bundle 7 validation

Only data-access changes, from 2.1.0 to 2.2.0; the other 18 official package
versions and file trees remain those of bundle 6. The new `market_read` tool
reads provider bar history through public host ports and freezes the request,
source responses, exact numeric strings, unit metadata and resulting DataRef.
A caller-supplied identity resumes the same committed result after restart;
it does not silently fetch new market data or reinterpret an existing record.

Twenty-one targeted contract checks passed, including pagination, byte-identical
duplicate handling, failure cleanup, units and persistent resume. Independent
review found that ambiguous wall-clock folds could be string-sorted incorrectly.
This revision explicitly rejects requested or returned wall-clock fold values
with UNSUPPORTED_CAPABILITY, before accepting a history; it does not guess the
DST chronology. Both forward and reverse fold cases have regressions. A subsequent platform review
found incompatible wall-clock authorities could skip range checks. Wall-clock
requests now require matching bar basis, authority and zone; incompatible replies
are rejected before freezing, while the intended UTC-query to provider-wall
response path remains covered by an explicit regression.

An actual temporary HostContext queried AKShare 1.19.1's explicitly selected
Tencent source for 668 daily bars, in two provider pages from one upstream fetch.
The frozen DataRef, dataset export and vn.py fixed-row adapter matched the source
rows. A same-ID retry and an independent-process resume with no active provider
reopened that same result without a new upstream fetch; temporary bindings and
snapshot cache were released. This validates data delivery and persistence,
not new market freshness, native broker execution or trading permission.

The source and release plan require the exact-head independent semantic review
and trusted pre-merge evidence documented in [PUBLISHING.md](PUBLISHING.md).
The stable catalog, optional packages and earlier release assets stay unchanged.

# Development bundle 6 validation

Only MT5 1.1.4, strategy-authoring 1.0.1 and workspace 1.0.2 differ from bundle 5.
The final combined targeted run passed all 14 checks for the self-contained SVL
reference/examples, surfaced workspace failures, and owned short Tester paths.
The package contributors also passed 12 SDK/reference/workspace checks and 15
MT5 offline checks; these are overlapping targeted runs, not additive totals.

Actual HostWorkspace/Pi execution verified timeout, output-limit and cancellation
failures as errors with the recorded execution ID, captured output tail and
snapshot diagnostics, leaving no owned process. Short retained output also preserves
the host or stored execution truncation flag across success and failure paths,
with explicit regression coverage; a locally short tail cannot imply complete output. The public SDK validated and
replayed both declared SVL examples, and an actual PluginRegistry allowed the
declared language reference only after loading the plugin. Documentation describes
the implemented SVL subset without claiming unavailable language features or
native-target equivalence.

The native Tester regression reproduced an unchanged EX5 failing at a 270-character
path and succeeding at a 137-character path. MT5 now uses an owned short temporary
runner, checks the path budget and EX5 hashes, and copies only the selected
symbol's existing history/ticks. A real macOS native Tester run passed in 58
seconds and produced summary/equity/deals/trace data with one simulated trade;
owned processes were cleaned up. This is Tester evidence, not live brokerage
execution or Windows/Linux acceptance. Unconfirmed cleanup preserves the owned
runner for diagnosis. A complete staging/failure regression injects unconfirmed
native process cleanup followed by a diagnostic ENOSPC error. The original cleanup
error and unknown job state survive, and the EX5 runner remains present; diagnostic
writes cannot downgrade that independent preservation decision.

Publication uses the pre-merge semantic gate described in [PUBLISHING.md](PUBLISHING.md).
Automated review records and behavior tests remain distinct from human approval.
The stable catalog, optional packages, and all previous release assets are unchanged.

# Development bundle 5 validation

The source suite passed 128 checks: 115 passed, 13 explicit gates and zero
failures. Eleven gates require Windows; the native MetaEditor compiler and SDK
example gates were also exercised separately on macOS with real successful
compilations and owned-process cleanup. The new discovery/binding tools passed
seven public contract checks and 20 actual host canvas/data/plugin checks.

Only canvas-control 2.1.0, data-access 2.1.0 and MT5 1.1.3 differ from bundle 4.
Provider/connection/instrument discovery and complete typed bindings are now
plugin tools and skills. An actual MT5 read-only HostContext search found EURUSD,
bound 1h/15m series, and mounted an indicator artifact in a temporary CanvasService;
cleanup left zero bindings. This is service evidence, not a browser-render claim.
MT5 results now expose exact RunRecordRef versions for report links, and a complete
non-trading Product SDK example compiled with zero errors/warnings.

The subsequent MT5 1.1.3 account-field correction passed 14 mapping/provider
checks and the actual current MCP account list, snapshot and subscription
snapshot path. The upstream `type: demo` now maps to demo; account monetary fields
match the actual source, missing leverage/margin fields remain missing, and the
source's EA-permission restriction remains false. These were read-only checks;
cleanup left zero bindings/subscriptions and no trade was issued.

Both new deterministic archives were read by the actual host extractor and
package verifier: 19 official packages and three optional packages. Optional
bundle 2 changes only AKShare to 1.0.1; its independent source and actual host
tests, observed quote/history and CTA execution scope are documented alongside
that package. Existing published archives and the stable catalog remain fixed.

# Development bundle 4 validation

Publication completed through the actual PR-to-release workflow on 2026-10-09:
[package PR #5](https://github.com/KDZZZZZZ/sesame/pull/5) passed the trusted
exact-head checks and the [automatic publishing run](https://github.com/KDZZZZZZ/sesame/actions/runs/37950589014)
published [bundle 4](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.4)
and [optional bundle 1](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.1).
All five downloaded assets per release matched GitHub's digests; the actual host
extractor and package verifier accepted all 19 and 3 packages. Source is fixed at
`90dec0df01ab21aff82e375f5a58e2a78cd89103`; the publishing tag records the main
revision separately. The release author is `github-actions[bot]`, and review
records accurately say human approval was not recorded.

An actual development Sesame host then downloaded AKShare, QMT and vn.py from the
live catalog, verified every immutable source file, tested and installed each
package, and immediately called its environment/status tool in the same Pi
session. This completed in 23.3 seconds. One earlier network socket disconnect
failed explicitly; the subsequent run passed. No terminal, dependency installation
or trade was triggered by this installation acceptance check.

The final native-execution source suite passed 115 JavaScript checks: 103 passed, 12 explicit platform/opt-in gates, zero failed. It includes the new fixed-catalog byte/identity/activation-failure checks, actual readable web-source delivery paths, preserved research input/output bindings, writable MT5 SDK validation and snapshot-error propagation. All ten MCP sample assertions passed at package version 2.0.1. The six Python dependency boundary checks remain passed.

This revision updates MT5 to 1.1.1, workspace to 1.0.1, and research, web-sources, plugin-manager and the four standard MCP adapters to 2.0.1. Real workspace paths replace old mount assumptions. Native execution snapshot failures are returned to the Agent as incomplete evidence. No report assets changed after bundle 2's verified ResizeObserver fix.

The plugin-manager now owns the optional API 1 catalog lookup and installation flow. It binds the exact catalog digest, source commit, byte counts, per-file hashes and package tree hash, then delegates static native checks and actual installation to the public HostContext. The actual application catalog integration used frozen source bytes through a controlled download port, installed the actual AKShare package, retained the same Pi session object and immediately called the newly loaded tool. Loading refreshes the same Pi session. Static native validation does not execute factories or certify behavior. Runtime activation diagnostics are preserved, and dependency preparation remains a separate explicit operation. The independent optional catalog does not alter stable 0.1.4 metadata or the 19-package archive.

Native research and MT5 lifecycle integration passed six checks against the rebuilt source, including successful native execution followed by output mutation: research_register retained the original frozen result, not the later file. Sixteen final application integration checks passed across catalog/current-session loading, optional package activation, native file/workspace tools, the four MCP adapters, fixed reports and SVL. Optional-package actual manager integration separately passed for AKShare, QMT and vn.py; platform and network limitations are recorded in their package documentation.

## Earlier bundle 3 evidence

# Development bundle 3 validation

The current source was checked with Node 24 and the matching public SDK on macOS arm64:

- 107 combined JavaScript checks: 95 passed, 12 platform/opt-in gates, zero failed. Eleven gates require Windows; the remaining native MetaEditor gate was also run separately by the native integration suite.
- Six Python dependency installer boundary checks passed.
- The actual HostContext and official plugin factories passed two new integration tests: all nine host-file methods perform real file operations and native argv execution; workspace read/write/edit/Bash uses the real cwd and retains completed/failed execution records.
- Three actual report-renderer/Pi repair tests passed again on the native-execution host, including repeated chart hide/show/resize and fixed DataRef permissions. No JavaScript errors were ignored.
- Six authored-plugin integration checks passed, including all ten standard MCP sample calls and immutable reports/SVL evidence.
- The MT5 contributor ran actual macOS MetaEditor success and syntax-error compilations in 23.8 seconds; the private process Job ended with zero active processes. The dependency installer downloaded, verified and prepared 850 files in a temporary private directory and reused that installation. Windows/Linux compilation and the macOS application installer were not natively verified.

The frozen 19-package archive uses `sesame/workspace` instead of `sesame/sandbox`; host-files is 2.1.0, MT5 is 1.1.0, and user-guide/orchestration are 2.0.1. MT5 VM resources, transports and retired probes are not included. They remain explicitly historical under development/mt5-runtime-probes/retired-api-v1. New optional integrations are outside this archive and have separate validation.

Dependency discovery does not start programs or download large runtimes automatically. Native execution is current-user host execution with task process cleanup, not an OS sandbox. Report/indicator frontend isolation remains a separate boundary. No current result implies broker authorization, live order execution or SVL/native-engine equivalence.

## Earlier integration evidence (bundles 1 and 2)

The following records describe the earlier integration revisions, including their then-present VM execution paths. Those historical paths are not part of bundle 3.

# Development validation record

Observed on 2026-10-09 during API 1 integration. This is a record of checks, not a
security certification or a claim that a development bundle is a stable release.

## Source repository

`npm test` passes the six repository checks: deterministic archive identity,
path/link/import boundaries, all ten declared calls across four actual isolated
Python MCP servers, template text escaping and reproducible demo generation.
The test environment uses Node's built-in test runner and Python's `-I` mode.
It does not supply application secrets or install third-party runtime libraries.
SDK-dependent plugin suites use `npm run test:sdk` with the matching application's
public loader supplied explicitly as `SESAME_PLUGIN_SDK_LOADER`; they are not
counted as passing merely because the portable source checks pass.
The combined SDK run has 108 checks: 97 pass and 11 Windows-specific
checks retain their existing platform skips on macOS. Coverage includes MT5
decimal values, identity, native process receipts, transport, connection import
and controlled workspace resources. `npm run test:python` passes 30 compiler
channel, snapshot and entry checks with explicit process fixtures.

The deterministic archive was extracted by the matching application's actual
archive reader into a new temporary directory. All 19 package identities and tree
digests matched. Rebuilding produced identical archive bytes. Modified package
bytes and an extra package file were both rejected by the application verifier.

The PR workflow reads candidate plugin files as data using the trusted base
validator. It does not launch candidate MCP servers or native plugin code.

## Reports and strategy authoring

The matching application integration tests use its actual artifact store, public
HostContext, official-package loader and SVL evaluator. Checked behavior includes:

- Fixed report data retains source decimal strings and remains unchanged if a
  transient dataset changes. A forged artifact digest and demo-to-observed
  relabelling are rejected.
- Authored HTML and packaged assets publish with fixed references. Publication
  returns `not_checked`; it does not self-certify successful rendering.
- In an actual Pi reply, `report_check` rendered the authored template, returned
  the JavaScript failure, and the Agent repaired and published a new fixed
  revision before checking again. The new receipt was `rendered` at 1000 and
  390 pixels; the original failing revision and its diagnostics remained readable.
  Duplicate late feedback stored one diagnostic without creating a user message.
- A subagent publishes a report, then its workspace and transient dataset are
  cleaned. The main conversation can still read the same report, data rows, HTML
  bytes and artifact digest.
- The SVL example validates, publishes and produces one intent from its explicit
  fixed-event fixture. The result is evaluator evidence, not a native backtest.
  Unsupported extensions remain errors.

A real Chromium session opened the report through the versioned application
renderer and paged read-only bridge. Initial open and reopen produced `rendered`
receipts with no reported issues. Filtering, empty results, keyboard selection,
linked table rows, theme changes and 390-pixel layout were inspected. The exact
string `9007199254740993.0000000000001` survived the bridge and table unchanged.
Reading an unbound data ID was rejected.

Development bundle 2 updates only the reports package to 2.0.1. A full host test
run exposed a ResizeObserver delivery loop during chart layout. Chart redraws
now run in animation frames only after positive width changes; replacing or
destroying a chart disconnects its observer and cancels pending work. The three
actual report-renderer integration tests passed with the new fixed bundle,
including repeated hiding, reopening and 280/310-pixel resizing at both desktop
and mobile widths, initial rendering in a hidden view, destroying a resized chart,
and reopening the same fixed report. JavaScript-error checks remained strict.

The standalone fictional chart gallery was opened with browser networking offline;
chart switching and row filtering still worked. Line gaps, zero-based signed bars,
missing matrix cells and exact unit counts were inspected. Decimal unit counting
uses exact integer arithmetic: `0.3 / 0.1` creates three dots, while fractional
dots, zero-sized units and incomplete matrix grids fail explicitly. SVG coordinates
remain approximate display values; financial calculations belong in registered
results, and the original text remains available in tooltips and tables.

## Plugin installation and remaining target scope

Eight application lifecycle/MCP checks passed with the verified matching
`0.2.0-dev.0` execution bundle. A real Pi reply created, validated, sandbox-tested,
installed and called an MCP plugin in the same reply while retaining the same
session and history. Version updates, rollback, exports, restart, dependency locks,
disabled policy, readonly package files, persistent plugin data and host-secret
isolation passed. HTTP credentials stayed bound to the exact connection URL;
schema failures and disconnected calls did not trigger automatic call replay.

A separate macOS integration ran three real isolated MetaEditor compilation
cases, including rejection of a host include path. This is compiler evidence;
broker execution, native backtesting and translation equivalence still require
their own target evidence and are not inferred from parser samples or SVL replay.
That run used the verified integration execution bundle. The final guest-resource
extraction and deadline fix passed the Python boundary checks above; a rebuilt
native runtime with those final resources still needs a separate native run.

The actual Electron frame-policy test confirmed that an authored subframe
navigation made zero requests to its target, while the permitted fixed local
document loaded once. The host blocks navigation before sending a request; iframe
CSP and revoking a bridge after navigation are not sufficient by themselves.
Twelve additional Electron renderer checks passed, covering network, file and
WebRTC isolation, desktop/mobile rendering, trusted clicks, concurrent inspection,
loop and memory limits, cancellation and utility-process IPC. These checks apply
to the matching development host, not to an arbitrary HTML viewer.
