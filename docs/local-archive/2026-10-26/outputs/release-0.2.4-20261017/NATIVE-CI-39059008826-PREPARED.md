# Sesame 0.2.4 installers prepared and verified

All three platform jobs succeeded in the same native workflow run and attempt. Preparation and the independent local asset audit completed successfully. This lane did not upload, publish, install or restart anything.

## Fixed provenance

- Host repository: `KDZZZZZZ/mt5agent`
- Host revision: `f9901ab4d8e3407cc1dda3c7f397b393ea787680`
- Plugin repository: `KDZZZZZZ/sesame`
- Plugin revision: `4e153a4474285e162d88a484d517fa37283a465c`
- Workflow run: `39059008826`, attempt `1`
- Public destination draft: `KDZZZZZZ/sesame`, release `415884110`, tag `v0.2.4`
- Reviewed preparation helper SHA-256: `d3914cb5b593a4866876032a67a6e2d2ba58f19fd4efd08239ad96727cbbde68`

| Platform | Successful job | Private stage release |
| --- | --- | --- |
| Windows x64 | 117473369989 | 416003867 |
| Linux x64 | 117473370066 | 416004093 |
| macOS arm64 | 117473369936 | 415996245 |

The preparation helper required common storage, update, package, extracted-installer and staging checks on all three platforms. Linux also passed all five general regression/lint/layout steps and both browser-update steps. Windows and macOS passed both native host and native model/SDK steps; macOS additionally passed physical temporary-path setup. All checks were checked as successful, not merely present. Exact host/plugin sources, dispatch inputs, run/attempt and all three successful jobs were rechecked.

## Local artifacts

- Manifest: `prepared-installers/prepared.json`
- Upload-ready files: `prepared-installers/assets/`
- Native verification evidence: `prepared-installers/evidence/`
- Independent audit: `prepared-installers-audit.json`
- Preparation log: `prepare-39059008826.log`
- Independent audit log: `prepared-installers-audit.log`
- Source-pinned CI state: `native-ci-39059008826-latest.json`

Every listed file was independently streamed again after preparation to verify its byte count and SHA-256 against the manifest. The exact 12-file inventory matched, and `SHA256SUMS.txt` contained exactly the 11 expected entries for the other assets. Total: **925,109,073 bytes**, **12/12 verified**. The preparation helper additionally verified Windows/Linux update-plan and feed semantics and binary SHA-512 integrity.

| Asset | Bytes |
| --- | ---: |
| INSTALL.md | 6,716 |
| Sesame-0.2.4-linux-x64.AppImage | 236,903,152 |
| Sesame-0.2.4-linux-x64.deb | 205,470,496 |
| Sesame-0.2.4-linux-x64.deb.blockmap | 214,408 |
| Sesame-0.2.4-mac-arm64.dmg | 256,902,067 |
| Sesame-0.2.4-win-x64.exe | 225,379,638 |
| Sesame-0.2.4-win-x64.exe.blockmap | 228,948 |
| SHA256SUMS.txt | 1,024 |
| update-feed-linux-x64.yml | 539 |
| update-feed-win32-x64.yml | 321 |
| update-plan-linux-x64.json | 1,014 |
| update-plan-win32-x64.json | 750 |

The updated platform-gate helper regression passed **174/174**, with zero skipped/failed/cancelled tests. The new platform cases first produced the expected red result before implementation. Logs: `prepare-platform-matrix-red.tap`, `prepare-platform-matrix-full.tap`.

## Verification limits recorded by the native jobs

The jobs did not exercise a clean desktop installation, actual installed-version replacement, or broker operations. macOS automatic updates remain disabled; Apple notarization and Gatekeeper approval were not verified. These are the jobs' explicit limitations and are preserved in `prepared.json` and native verification evidence.

No assets from prior failed or cancelled workflow runs were used.
