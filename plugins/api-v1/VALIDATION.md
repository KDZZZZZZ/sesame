# Sesame 0.2.0 compatibility documentation

This documentation-only transition keeps all 31 package implementations, both
locks, the installable catalog, its source selection and every existing release
plan unchanged. Core dev.14 and optional dev.8 remain the exact verified sources;
no plugin is repacked, retagged or given a new version. The application lock does
not change. The installable catalog retains its existing channel and bytes.

The descriptive inventory now says `descriptive-inventory` and records the
minimum application version without asserting whether an application installer
has been released. Installer availability belongs to the application release
page. Users moving from 0.1.4 must install the required API 1 plugin versions;
the historical catalog remains intact.

Validation: all ten profile/catalog tests passed, including reconstruction of the
31 entries from the two fixed archives, published-source identity checks and the
historical-catalog byte checks. A direct Git comparison confirmed no package,
lock, installable catalog, selected release or release-plan changes. These checks
are not new plugin/native/runtime acceptance tests.

---

# Candidate unified API 1 directory and explicit updates — 2026-10-09

This candidate adds no release plan and has not published a new package version.
The 22 directory entries are reconstructed from already published official
`plugins-api-v1-dev.12` and optional `plugins-optional-api-v1-dev.4` at their fixed
publication/source commits. The directory SHA-256 is
`e824ee294edad74d41288f2053ce88957fb159b923dcabd879a5ea919e0b5af5`.
It describes MT5 1.1.9, plugin-manager 2.0.1 and the four MCP packages at 2.0.1.
The new plugin-manager 2.1.0 and three parser 2.0.2 candidates are deliberately
absent from this released-byte directory. After their own reviewed publication,
a separate metadata PR must select that new immutable release; existing assets
and dev.12 pins must not be overwritten. Stable 0.1.4 and the optional-only catalog
remain byte-for-byte unchanged.

The portable suite passed 29 checks. This includes 14 catalog-client cases,
five fixed-source/publication cases and three real Python alias/escape cases.
The separate SDK schema test passed and matched the committed manager tool
schemas to its factories. An actual JSON Schema validator accepted all 22 entries.
The fixed-release check rebuilt all 13 existing release plans successfully; the
catalog publication check also read live GitHub asset metadata for both selected
releases and verified their publication commits and archive/lock/review digests.
These are byte/identity checks, not an approval or behavior certification.

A temporary integration used the actual matching Runtime, Store, HostContext,
HostWorkspace, PluginManager and Pi sessions. The network fixture served the
candidate catalog and the independently verified, already downloaded dev.12
package bytes; it did not claim the new directory was already live. It checked:

- A bundled MT5 1.1.8 package followed formal test/update to 1.1.9 with the
  original expected digest passed unchanged to the host. Main and existing child
  Pi sessions gained `mt5_translation_file` without session recreation; the
  child's workspace file and durable bundled origin were preserved.
- Repeating the exact installed version/digest fetched only the catalog and made
  no second test or package mutation. A disabled package remained disabled.
- All four published 2.0.1 MCP packages passed formal test/install/load from a
  canonical temporary path, including their ten actual Python MCP assertions.

The Runtime integration disabled MT5 and automatic connection before init. It
made zero model requests and performed no terminal, Tester, deployment or trade
actions. All temporary runtime state was removed; the live app, DB and bundle
were not changed. It validates the matching development host's update/refresh
ports, not arbitrary older hosts.

The MCP checks initially reproduced a macOS path-alias bug: resolved sample paths
used `/private/var` while the trusted package root still used `/var`. The minimal
fix canonicalizes that root in web-extract, rss-collect and market-data-parser,
which advance to 2.0.2; quantskills-catalog remains unchanged at 2.0.1. All three
candidate packages then passed six declared assertions through the actual host
with an explicitly aliased temporary runtime root. The separate portable
Python cases accept packaged samples through that alias and reject absolute
external paths, parent escapes, external file symlinks and external directory
symlinks. Windows native alias behavior was not tested. No containment condition,
expected result or host digest check was relaxed.

The candidate official lock changes exactly those three parsers and the manager;
the other 15 complete entries equal dev.12. No private host source is included.
As explained in [CATALOG.md](CATALOG.md), this validator's introducing PR still
runs the old trusted base in CI; the new local checks and independent review must
be assessed explicitly. Subsequent PRs use the merged trusted validator.

---

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

# Development bundle 12 candidate validation

Only MT5 changes, from 1.1.8 to 1.1.9; the other 18 package versions and file
entries remain those of bundle 11. An Agent that already wrote a long native
translation no longer has to repeat its source and mappings in a tool request.
`mt5_translation_file(operation_id, manifest_path)` reads one explicitly named
workspace JSON file containing the inline translation fields except operation_id.
It shares the same strict schema and registration pipeline, including fixed
source/target identity, parameter mapping, node/line bounds and SDK/project-file
checks. The JSON and normalized input are each bounded at 8 MiB; existing native
file/project limits still apply. There is no directory scan or source execution.

The file intake rejects outside/traversing paths, symlinks, non-regular files,
invalid UTF-8/JSON and changes detected across opening/reading. It fixes validated
input in plugin storage before publication. Same operation/path retries explicitly
return the saved digest with manifest.reused=true without rereading the file;
new content needs a new operation ID. Different initial concurrent content or a
different path under that ID conflicts. A project and recovery receipt commit
atomically, allowing recovery after a lost result without republishing or resetting
a later project revision. Compiler availability used in the translation environment
is also fixed for partial-publication retries.

The author passed 18 public checks: 14 file-entry tests and four existing run/tool
schema regressions. They cover exact 800-line bytes, concurrent same and conflicting
requests, deleted/edited files, partial and post-commit failure recovery, strict
schema/semantic rejection, unsafe paths, a symlink replacement during open, size
limits and cancellation. A controlled second-connection commit between the initial
lookup and final transaction retained its newer project revision. Static tool
definitions match the actual factories.

A separate temporary integration used the real Store, HostContext, HostWorkspace,
ContractArtifacts and generated tool execution. Six checks verified valid fixed
source/target/translation/validation artifacts, five concurrent calls producing one
project, an unknown result after project commit, SQLite close/reopen with the whole
workspace deleted, recovery of both the earlier and interrupted operation, retention
of a later project revision, and path-conflict rejection. This exercised public
ports against real host persistence; it was not complete Runtime.init. No real
terminal, compiler, Tester, deployment or trade was started, and no live database
or application cache was changed. Independent review and publication are pending.

# Development bundle 11 validation

Only MT5 changes, from 1.1.7 to 1.1.8; all other 18 package versions and file
trees remain those of bundle 10. The completed Tester configuration held typed
SVL parameters while its native input representation held strings. Reusing the
native representation during mount observation could reject an integer before
native startup. Integer strings are now converted only when they represent safe
integers, and booleans accept explicit true/false or 1/0 values without general
truthiness conversion. Quantity and money wrappers must match their declared
unit or currency. Existing SVL type/constraint validation still applies.

A deployment save writes the record before notifying the observer. If observer
publication then fails, mount recovery now reads the latest persisted state and
saves a failed or unknown outcome before optional stop-file I/O. It retains any
durable native-start intent or chart reference even if the caller had not yet
received the saved object. A restart marks only an unambiguously pre-native
preparing record as failed; records with startup, chart, output, staged expert,
command or native evidence remain unknown. The old request key returns its old
record and cannot silently recreate or resume a mount.

Pre-merge review found that a transient observation append failure could leave
an existing strategy.run record at starting after its deployment had failed.
Deployment saves now atomically retain an observation-pending token. Activation
and the observer refresh retry that record synchronization without invoking any
native action. A completed observation clears only its own token, preserves a
newer pending update, and removes stale observer diagnostics. The observer reads
the host's current record revision before retrying an append that may already
have committed.

The author passed 22 targeted checks. Read-only inspection of existing stored
records confirmed the string-versus-typed parameter representation and the
pre-native orphan; it did not modify the live database. This candidate has not
started a real terminal, mounted an EA or placed a trade. Published-package
native acceptance remains separate from these controlled regressions.

Independent review reran all 22 public checks and passed 32 additional checks
(10 top-level checks and 22 subchecks). These used a real temporary Store,
ContractArtifacts and the SVL path to verify typed parameter publication/reopen,
16 invalid scalar/range/unit/currency cases, six observer-failure stages and
same-key non-replay. The pre-append, post-commit and reopened-pending versions of
the observation mismatch were reproduced and fixed. Successful synchronization
cleared pending/error state; 20 further refreshes added no record versions. One
failed pending item did not block another, a SQLite pending-write failure rolled
back atomically, and a failed stop-file write retained an unknown state with a
redacted error. Native mounting and market ports were controlled substitutes;
this was not complete Runtime.init or actual native preparation/mount/trading.

# Development bundle 10 validation

Only MT5 changes, from 1.1.6 to 1.1.7; the other 18 package versions and file
trees remain those of bundle 9. A failed managed preparation reconnected to a
terminal whose algorithm-trading configuration had not taken effect. Read-only
native logs identified another installed Sesame process requesting a competing
connection startup with algorithm trading disabled. That separate application
was exited during diagnosis. This plugin change coordinates operations inside
one MT5 service instance; it does not provide a cross-process lock or stop
another application's connection monitor.

Managed terminal preparation now owns a lifecycle epoch. Automatic connection
checks defer while preparation is active, and a probe from an older epoch cannot
start a terminal or replace the current client. A refused connection is probed
again under the configuration lock before a startup is requested; cancellation
and configuration changes are checked again. If the requested algorithm-trading
configuration is not observed after reconnecting, bounded new native-log bytes
provide a diagnostic classification without exposing the log text or credentials.
The explicit managed-mount instruction now explains preparable checks and the
subsequent native verification; it does not authorize background mounting.

The author passed 16 targeted checks covering preparation ownership, stale and
successful probes, cancellation/configuration changes, native-log diagnosis and
preparation cleanup. This candidate was not used to restart a real terminal,
prepare algorithm trading, mount an EA or place an order. End-to-end native
acceptance remains separate and must use the reviewed published package.

Independent review reran all 16 public checks and passed 16 additional checks
(11 top-level checks and five subchecks). They used a real temporary Store, the
public HostContext and actual Runtime configuration methods to check lock
ownership, persisted connection auditing and reopening without replay. Controlled
native substitutes covered full preparation success/failure/cleanup; delayed
probes crossing the preparation epoch could not start, configure or reset the
terminal. Fresh authentication, connection-reset and timeout responses did not
trigger a second startup. Log offsets, bounded new tails and removal of secrets
from diagnostic output were also checked. This is not a full Runtime.init or
real-terminal acceptance test, and it makes no cross-process locking claim.

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

## Unreleased 0.2 distribution proposal — nine defaults, ten optional

This section describes a source candidate, not an application release or a
published installation catalog. The stable 0.1.4 catalog and the fixed API 1
release plans/catalog pins retain their original bytes. Package-by-package
changes and dependency boundaries are in REORGANIZATION.md.

The public SDK source suite ran 227 tests: 212 passed and 15 platform/native or
host opt-in cases skipped, with no failures. Native opt-ins were not enabled.
The Python dependency-installer fixtures passed six checks. The existing thirteen
fixed release plans reconstructed successfully; new profile metadata does not
change historical archive bytes. Five profile/inventory checks and six release
identity checks passed, including actual nine-package archive membership,
engine/legacy-grant rejection and preview metadata without install authority.

An additional opt-in test used a fresh temporary Store, actual public
HostContext, HostWorkspace, ContractArtifacts and plugin manager. It assembled
only the nine core packages, loaded generic tools without a backend, validated
and replayed both public SVL teaching examples, and froze a demo data/report.
Fresh MT5 and judgment packages passed formal test/install/activation into their
own private storage, without bundled_origin or migration grants. Synthetic old
MT5 rows and an invalid synthetic legacy judgment database were neither read as
state nor copied or modified. Restart preserved the new private records and
fixed artifacts. This test made zero fetch requests and did not start MT5,
MetaEditor, a Tester, a model call or trading. It used a fixture ModelRuntime,
not a live Agent conversation.

The same temporary report path was inspected by the actual host Playwright
renderer at 1000 and 390 pixels: rendered status, no diagnostics. The renderer
receipt recorded zero simulated interactions, so this is render/bridge evidence,
not a claim that every gallery interaction was exercised. The offline editorial
example remains reproducible byte-for-byte from its local assets and explicitly
fictional demo data. No market values or native performance are invented.

The final SVL-reference and QMT targeted command ran 23 tests: 21 passed and two
explicit host/native opt-ins skipped. QMT's separate author's validation and
independent review identify controlled Windows adapter fixtures, not an actual
broker terminal acceptance. Normalized orders/fills are deliberately unsupported
where source time units cannot be established; raw daily records remain marked
as raw. Native Windows/QMT trading and all multi-backend live acceptance remain
outside these source checks. Independent final-head review and publication gates
are still required before releasing this reorganization.

Final optional source tests after QMT review fixes: 38 JavaScript tests, 36 passed
and two explicit opt-ins skipped. Python adapters passed 17 checks, with six
actual-engine opt-ins skipped in this run. Independent reviewer Codex
refactor_plugins completed the QMT source review at 2026-10-10T00:14:14Z on
d25ad293945bc0f5fd11725c97c91fc5dbefc863: 16 independent, 18 public, one
actual temporary HostContext/reopen and nine Python checks passed (44 total),
with one Windows native gate skipped. This candidate imports those package bytes
unchanged. Final bundle/profile/head review is still separate and pending.


Independent review fixes in this candidate retain their separate evidence scopes.
AKShare 1.0.4 now implements source-qualified daily closure, precise UTC range
bounds, requested paging direction and forming policy, complete instrument and
bar/page/snapshot fields, and exact OHLC/quantity checks. Codex refactor_plugins
reviewed source 763f4a0e6bbeea4b4b6cc430713bb7eb5c696c6a at
2026-10-10T00:32:18Z: ten independent, eleven public provider and four environment
checks passed (25 total). These were controlled responses, not a fresh upstream
network acceptance.

MT5 retains its native history source price rather than substituting a position
close price: the mapping accepts price, price_open, then open_price, and the
actual order done_time alias. Codex refactor_plugins reviewed source
78dd9fc3f57c0fd441963414e9e41b9af3102ddc at 2026-10-10T00:34:18Z;
twelve public and three independent mapping checks passed. This change does not
run a terminal, backtest or order. It is integrated into the optional 1.2.0
candidate without restoring old migration grants or changing live state.

The distribution infrastructure was independently reviewed at exact head
e06f56e8152adaa1d9df37f72ae88de4c3465b4e: 17 focused tests and all thirteen
historical reconstructions passed. Only exact allowlisted historical plans may
omit a profile; new releases cannot remove metadata to evade the minimum engine
range, package membership or optional activation policy. These source-stage
checks do not replace final-head review of the merged candidate and its archives.


After importing the reviewed AKShare/MT5 source fixes and merged distribution
infrastructure, the integrated candidate passed 27 provider/mapping checks and
22 profile/release/archive/inventory checks. These short checks ran on the
integrated source, with no network/native or live application mutations. The
nine-core lock and archive are unchanged from the earlier candidate; the optional
lock was regenerated for exactly those reviewed source changes. The existing
22-entry install catalog still validates against the two already published
releases, independently of this 19-entry preview.


## Published nine-core and ten-optional development distribution

PR25 was merged normally at 2026-10-10T00:47:04Z as `fbfe1478cd7c5258f1b6057ae04df844b62a1302`, preserving reviewed head `2b22848ebe31d2e90674ad60f63d5cfb4e5ce2fb` and source `1af5e03b8f142d269e1d9c0c51d27f28d79b6d3b`. The [trusted pre-merge gate](https://github.com/KDZZZZZZ/sesame/actions/runs/38010413630) succeeded before that merge; the [publication workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/38010528632) then published both prereleases.

The [review record](https://github.com/KDZZZZZZ/sesame/pull/25#issuecomment-6091777907) is a repository-maintainer attestation naming the independent Agent reviewer, not human approval or cryptographic authentication of the Agent identity. Review completion was 00:43:27Z, recording 00:45:27Z and gate check 00:45:40Z on 2026-10-10; each downloaded `review.json` preserves the actual completed-gate and static-check times. Human approval is `not-recorded`.

All ten assets were actually downloaded and checked against GitHub sizes/digests and their local SHA-256 values. The actual host extractor and package verifier accepted exactly nine core and ten optional packages. Every packaged engine range is `>=0.2.0-0`; no manifest grants legacy storage. MT5 1.2.0 and `mt5_translation_file` were confirmed in the optional archive. These verification steps did not activate plugins, install dependencies, change live state or operate any terminal/account.

### [Core dev.13 — nine defaults](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.13)

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `SHA256SUMS` | 204 | `d42819a57036d030defef0ee341046dd0799d493072c630908235c7ac676c124` |
| `application-official-plugins.lock.json` | 1956 | `7fa7aa0426e784f2267795a9423e10f555836a725e1ce2bbaaf521d08dc1a98c` |
| `official-plugins.lock.json` | 20555 | `b612ee5ea170f8bc426a60e22f4773b45a0d3d26abc2695aea3c5e99be81e6bf` |
| `review.json` | 5861 | `5a8bcfcc7a444b954b6fcf1910d20406295b73a67b9c6a580564c8b19dfc9436` |
| `sesame-official-plugins-api-v1-dev.13.tar.gz` | 564287 | `f04416fde2d86bfca52008292d72f107e22fe9b065bb20f9b938799578749337` |

### [Optional dev.5 — ten integrations](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.5)

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `SHA256SUMS` | 203 | `89ece579f9362535f4f258c4e8c74403d95fbc199bade786250fa72addc0616f` |
| `application-official-plugins.lock.json` | 2119 | `eeba4001bacff9ec4966d0eb85035f721080b93dec607848d2234860ca5127e9` |
| `official-plugins.lock.json` | 40150 | `17d27f002d47729dec7bb33ceed81f3ceae1ed81b29c37ba1197f8964ab5ae9e` |
| `review.json` | 5869 | `833ca1c34bd5b3778d5155e5f2c72753f0a05398f034e60c9ccbfdba7b4fec2d` |
| `sesame-optional-plugins-api-v1-dev.5.tar.gz` | 1616015 | `3c9907193bc24926474bc20f7fea85ed68ad49e180ee5b81001a6be2db22c57c` |

The subsequent catalog metadata selects only these published fixed releases and exposes 19 entries. The stable 26-entry 0.1.4 catalog and the original three-entry optional catalog remain byte-identical. Published development plugins do not mean an application 0.2.0 installer is available.

## AKShare clock consistency and current generic guides — candidate dev.14 / optional dev.6

AKShare 1.0.5 makes its declared Asia/Shanghai clock consistent across instrument
descriptions, bindings, bars and subscriptions. Canonical bars retain the known
IANA zone. A wall range that omits the optional zone receives a separate legacy
representation after canonical revision calculation; it cannot mutate shared
bars or manufacture an update. Source metadata preserves the full clock. UTC
bounds use the declared IANA rules, including historical daylight saving and
millisecond boundaries, rather than a fixed eight-hour offset. The strict
data-access market_read validator is unchanged.

The source command passed 23 tests, including real temporary Store, HostContext,
ProviderRegistry and ContractArtifacts integration with controlled provider rows.
Independent reviewer Codex refactor_plugins reran those 23 checks and nine
additional checks on source 86cd7f7947d3dd7ad1088bc6bc3bf4ff145d6ff5: 32 passed.
The independent cases cover 503 source rows over two pages, zoned wall, unzoned
wall and UTC ranges, concurrent representations, fixed snapshot retries, a real
subscription polling callback without false revisions, and the 1991 Shanghai
daylight-saving boundary. The historical fixed-offset finding was reproduced
before the repair and passed afterward.

At 2026-10-10T01:49:37Z the same independent reviewer also completed a fresh
read-only Tencent check using a new temporary Store and the actual public host
ports. It reused an existing AKShare 1.19.1 environment without preparation or
downloads. Each of three upstream queries returned 23 rows; market_read froze
22 closed rows for each clock representation with equal price, volume, bar IDs
and revisions. The original query and canonical source clock were preserved.
Retries made no additional upstream request, and bindings and snapshots were
empty after cleanup. This is source/host-port acceptance, not a complete
Runtime.init, Agent/UI, Windows broker or trading test. No running application's
cache, database, terminal or account was changed.

A subsequent PR review found that UTC endpoints spanning the September 1991
rollback could have equal or reversed wall representations. The pre-fix fixture
reproduced the false ascending-range rejection. The candidate now retains UTC
ordering and duration and compares uniquely resolved source-bar instants. Mixed
wall boundaries with an ambiguous or nonexistent instant are rejected rather
than assigned a fold. The new regression also covers spring-forward and exact
inclusive/exclusive daily-open boundaries. The updated public command passed
24 checks; this does not replace the earlier independent review or claim it
already reviewed these later bytes.

Three core packages receive documentation-only patch releases. Orchestration
2.1.1 describes the current five settings panels, generic connection action,
account positions/orders and fixed indicator parameter editing; it reads actual
website release status instead of making a permanent unreleased assertion.
Reports 2.0.3 starts from the selected backend's fixed data/result and presents
MT5 tools only as an installed-backend example. Data-access 2.3.1 explicitly
limits MT5 paging advice to that source. Package/inventory checks passed eight
tests, and the unchanged market_read implementation passed its 14 tests. The
guides were checked against the actual frontend, without changing that frontend.

The source candidate changes exactly these four packages. The other fifteen
package lock entries, both historical installation catalogs and all published
assets remain unchanged. Final-head semantic review, trusted pre-merge gate and
publication evidence are separate steps; this section does not claim those
steps have already run.


## Published clock fix and guide patches — core dev.14 / optional dev.6

[PR27](https://github.com/KDZZZZZZ/sesame/pull/27) was normally merged at 2026-10-10T02:13:05Z as `270118d5b054690188856591c8adc57483200777`, preserving final reviewed head `40a4cabbba8e83e9065b1ba358f9da05c79a4bd5` and source `f50d88ae9607bc1e4018aafe3adb424a42e5f67a`. The [trusted pre-merge gate](https://github.com/KDZZZZZZ/sesame/actions/runs/38016088263) completed at 2026-10-10T02:12:26Z, after the 2026-10-10T02:08:51Z independent Agent review and its [2026-10-10T02:12:07Z maintainer record](https://github.com/KDZZZZZZ/sesame/pull/27#issuecomment-6092576030). The recorder is authenticated; the Agent name is part of that attestation. Human approval remains not-recorded. The first record had a noncanonical prefix and was rejected; its failed gate was not used to merge.

The [main-branch publication workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/38016147662) published both prereleases. All ten actual downloaded assets matched GitHub sizes/digests and local SHA-256 values. The actual host extractor and verifier accepted exactly nine core and ten optional packages. Four versions changed: AKShare 1.0.5, data-access 2.3.1, orchestration 2.1.1 and reports 2.0.3. The other fifteen complete lock entries match dev.13/dev.5. No plugin was activated and no running app, dependency environment, terminal or account was modified by this download verification.

### [plugins-api-v1-dev.14](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-api-v1-dev.14)

Published at 2026-10-10T02:13:48Z.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `application-official-plugins.lock.json` | 1956 | `9a8925bbca0431d80a18b175a5f95e977dd9d6f6619d3c209c1a40f5d1a23a61` |
| `official-plugins.lock.json` | 20555 | `6b4754e8b69a850f1ce3878d45c244a5e7a10c7e041f0f4fe8c9d799349937b0` |
| `review.json` | 5589 | `0384e4bbfdb9e6e428a6586824f8aab7a0c1b232be9ae5f89acfd3a1d5640664` |
| `sesame-official-plugins-api-v1-dev.14.tar.gz` | 565311 | `5a999fa700acf46b08cb5caded9d8693b3350c910eebaa1eb724d6ad8d9cea85` |
| `SHA256SUMS` | 204 | `05f64074d0e93a00b87bfd9431d024587f97c56f477949a0bb263deb053119de` |

### [plugins-optional-api-v1-dev.6](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.6)

Published at 2026-10-10T02:14:31Z.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `application-official-plugins.lock.json` | 2119 | `1e46a41083880669d91c1c22361758e6e55eafac0f0a0578755469722940b0ad` |
| `official-plugins.lock.json` | 40150 | `54ff0612e3a85f64f9d9d40f5446579e2521791b69dbce6766e0ffba21af3fc7` |
| `review.json` | 5597 | `8b7ffa55858c50df26923c234039c788a89de301564b21d6385943463fb4c381` |
| `sesame-optional-plugins-api-v1-dev.6.tar.gz` | 1623183 | `2cee0eeeb914f4cc13162e96023d72dd134fc4f4abd2c0c7b988d1593b33a9a3` |
| `SHA256SUMS` | 203 | `4212083dac5a3cbed3136977bb7220df53c2df14606e9985905490407a9c94e4` |

The catalog selects only these actual published releases. Historical stable 0.1.4 and optional three-entry catalogs retain their original bytes. The website preview remains descriptive; the Agent resolves the separate installation catalog and preserves formal expected-digest/version checks. Development plugin publication does not announce a 0.2.0 application installer.


## Published independent methods and research workflows — optional dev.7

[PR29](https://github.com/KDZZZZZZ/sesame/pull/29) was normally merged at
2026-10-10T03:41:09Z as `bcb234f575841e7f77f093c77df2fd0cb7f6595a`, preserving
final reviewed head `0983633643b366b9e7b626f4c7addb45601360f7` and fixed source
`1033980403590600b04e7cbb3ab7d4bbcc3d5ce8`. The
[trusted pre-merge gate](https://github.com/KDZZZZZZ/sesame/actions/runs/38021361807)
checked that head at 03:40:09Z and completed at 03:40:12Z, after the final scoped
Agent review at 03:35:54Z and its
[maintainer record](https://github.com/KDZZZZZZ/sesame/pull/29#issuecomment-6093391644)
at 03:39:58Z. The
[automatic publication workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/38021432446)
then published the prerelease at 03:42:54Z. All times are UTC on 2026-10-10.

The authenticated maintainer attests to named Agent reviews; this is not human
approval or cryptographic authentication of an Agent identity. Implementation
review was partitioned by authorship: the root Agent reviewed backend and method
implementations; a different Agent reviewed root-authored routing/metadata;
and another reviewed the two research workflows. The final identity/byte reviewer
did not claim independent review of its own Backtrader implementation. The actual
`review.json` preserves these scopes, exact head, check identities and timestamps.
Human approval remains not-recorded.

The unchanged integrated source suite passed 79 JavaScript and 39 Python checks,
with two explicit network/platform skips. The independent research-package review
passed 42 checks, including actual temporary Host installation, isolated skill
loading, immutable selection before holdout export and reopen. These staged
counts are not one final-head aggregate. After a PR finding, Backtrader's controlled
`SystemExit` was repaired and independently tested with real processes; six exit
cases produced failed receipts, while KeyboardInterrupt and abrupt termination
produced no fabricated completion. The formal backend suite then passed six checks
with one explicit network skip, including successful native simulations and
same-operation reuse. Cancellation and unknown executions remain non-replayable.
No Windows brokerage acceptance or real trading result is claimed by this release.

All five assets were actually downloaded and compared byte-for-byte with GitHub
size/digest metadata; the four reproducible assets also match the independently
rebuilt final candidate. The actual host safe extractor and package verifier
accepted exactly 22 optional packages without activation. The existing nine-core
dev.14 archive and application pin are unchanged. No running app/cache, dependency
environment, terminal, account or application release was modified.

### [plugins-optional-api-v1-dev.7](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.7)

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `application-official-plugins.lock.json` | 4139 | `020e7a2d220478cfb86918cd5e16d54e4326875eea5c93f1a52c55f339a227ce` |
| `official-plugins.lock.json` | 71813 | `2e831901e986e81d359d99bea254ec640c4f33c286d15e5377755cfe50830a0d` |
| `review.json` | 6665 | `cedc5e0cf6cdf0f98f741bd1fafa1a8d96ac2efefbefeedacb2f9930bb809790` |
| `sesame-optional-plugins-api-v1-dev.7.tar.gz` | 2222268 | `f83bcfe48310f91ac5c277bd4ccfa3a9b10a246ee63af80b96b34762303a03f4` |
| `SHA256SUMS` | 203 | `bc2135663a3c8c4963d1f9259b383ebdc83f87d2e39f6fa0405f89165833ef33` |

The next catalog selection combines unchanged core dev.14 with optional dev.7:
31 exact names, nine core and 22 optional, with 493 fixed file records. Each of the
eight methods and two research workflows remains an independent optional package.
Backtrader retains GPL-3.0-or-later; the catalog does not relabel it MIT. The
stable 26-entry 0.1.4 and original three-entry optional directories remain byte-identical.
The 31-entry catalog reconstruction/name-resolution/publication-boundary suite
passed five tests, and actual published-release validation passed. The application
0.2.0 is not formally released; these plugin prereleases require a compatible
`>=0.2.0-0` host. Website previews remain descriptive and do not authorize code installation.


## CCXT exact-route restoration — optional dev.8 candidate

CCXT 1.0.1 fixes a real 1.0.0 chart-rebind failure: an exchange route was only
held in transient bindings, and unrecognized configuration could silently use
direct access. The plugin now accepts only its documented exchange and optional
credential-free publicProxy fields, persists explicitly selected routes in its
private storage and restores a connection only when its ID/revision matches.
Unknown fields, wrong types, credential-bearing URLs and unknown references fail
before a worker request. Route revision calculation remains unchanged; an older
reference needs explicit registration of the same authorized configuration, not
an inferred route or automatic system-proxy discovery. README is a declared
resource, and the skill gives the exact public configuration fields.

The root Agent independently reviewed all nine files at author source
`b53b446baacf01d7e75885b2177a726358da3ab3` at 2026-10-10T04:16:56Z.
It reran five formal temporary Host checks and independently exercised thirteen
invalid configurations plus four restoration/cross-reference/old-reference
boundaries. Those checks passed without public network requests, live caches or
account/terminal operations. Controlled OHLCV responses prove route persistence
and failure behavior, not fresh market retrieval or production chart rendering.

The publisher's integrated profile checks passed seven tests. The new optional
lock contains the same 22 identities and changes only CCXT 1.0.0 to 1.0.1; the
other 21 complete entries and the core dev.14 lock are byte-identical. Inventory
remains 31 entries and changes only the CCXT version. The installation catalog
continues to pin published optional dev.7 until dev.8 is actually released and a
separate metadata PR is reviewed. Final-head review, pre-merge gate, publication
and actual-download evidence are subsequent steps, not claimed by this section.


## Published CCXT route restoration — optional dev.8

[PR31](https://github.com/KDZZZZZZ/sesame/pull/31) was normally merged at
2026-10-10T04:25:21Z as `e27ec7f38bf7a7c633adb99f945035224f300f37`, preserving reviewed
head `03049a534311cc57d5367973d6195093b1aa14e3` and source `04261febd94d483b7d87d8564116099d394e3246`.
The independent Agent review completed at 04:22:58Z and its authenticated
[maintainer attestation](https://github.com/KDZZZZZZ/sesame/pull/31#issuecomment-6093732753)
was recorded at 04:23:58Z. The [trusted pre-merge gate](https://github.com/KDZZZZZZ/sesame/actions/runs/38023923305)
checked at 04:24:10Z and completed at 04:24:15Z, before merge. The
[automatic publication workflow](https://github.com/KDZZZZZZ/sesame/actions/runs/38024008400)
then published optional dev.8 at 04:27:04Z. All times are UTC on 2026-10-10.

The final reviewer read all thirteen changed files, verified the nine author
files against the previously reviewed source, reran five controlled provider and
actual temporary Host/canvas/reopen checks, and rebuilt all four reproducible
assets from fixed Git source. It did not claim to rerun the root's separate
thirteen invalid-configuration and four restoration cases. The named Agent
review is attested by the authenticated maintainer; human approval remains
not-recorded. There was no fresh public-market or production-dashboard acceptance
in this release review.

All five actual release assets were downloaded and checked against GitHub
sizes/SHA-256; the four reproducible files also equal the reviewed candidate.
The actual host safe extractor/verifier accepted 22 optional packages. Only
CCXT changes to 1.0.1, tree `sha256:547cfc07e72dd6ee7bcdfe1ce860dc7a8797272126eb25cda109bfa86d046301`;
the other 21 complete optional lock entries and core dev.14 remain unchanged.
This verification did not activate plugins or modify any running application's
cache, terminal, account, dependency environment or private source.

### [plugins-optional-api-v1-dev.8](https://github.com/KDZZZZZZ/sesame/releases/tag/plugins-optional-api-v1-dev.8)

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `application-official-plugins.lock.json` | 4139 | `b1d1004acdefaffeab79a097b217eb67b742ae141c567ed0cbe760173d0e6e55` |
| `official-plugins.lock.json` | 71981 | `64b4ac35b1e38591b31ce4d647fa7fdd5ffcb3375458b3a2b8ecde7244437c01` |
| `review.json` | 4868 | `5880e695d96ba2a07ffee69d33a19a33259130c6ab0296c409f51e8f63b76c7d` |
| `sesame-optional-plugins-api-v1-dev.8.tar.gz` | 2229953 | `f20be226f06f995464504023e9d0f88d19b9afbc83ad5f9d54fc86ef9711e6b0` |
| `SHA256SUMS` | 203 | `6190b9fc595d3de3685a00d8e8b923caed5c872737a55b01f6644e055bde762e` |

The catalog update retains 31 exact identities (9 core and 22 optional), now
with 494 file records, and selects only published core dev.14 / optional dev.8.
Its five reconstruction/resolution/publication checks and actual published
metadata validation passed. Historical stable and optional catalogs retain
their bytes. Application 0.2.0 is still not formally released.
