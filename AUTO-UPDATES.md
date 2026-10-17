# Desktop updates

Windows x64 (NSIS) and Linux x64 (AppImage/DEB) support update notifications, background downloads and an explicit **Restart to update** action. macOS continues to use manual installation. This implementation does not itself publish a release or notify installed clients about an unpublished build.

A channel manifest returning HTTP 404 is reported as **update channel not ready**, not as an installation failure or an up-to-date result. Connection/check failures, incompatible metadata and installer download failures have separate messages. Checks remain retryable, so publishing a valid channel later requires no client reconfiguration.

The already published 0.2.3 application has no updater. Its users need one ordinary installation over the existing application to acquire this feature. Keep the application identity and existing data directory when making that first upgrade; do not uninstall or delete user data as an upgrade step.

## User experience and data

Packaged Windows/Linux applications check the fixed official channel after startup and every four hours. A ready update appears in the workbench and in user settings. Users choose when to restart. Ordinary conversation work does not trigger an automatic restart. Browser-only and development sessions do not download desktop updates.

Installation waits until current responses, queued work, running Agents/workflows, admitted mutations and other host work have settled. A short reservation prevents new work from starting while the installer is prepared. The worker closes its stores before replacement. A paused API 2 Run is saved and remains paused across restart; restarting does not mean permission to resume it or to repeat an external operation.

Application binaries and user data live separately. The installer replaces the application while retaining `%APPDATA%\Sesame` on Windows and `~/.config/Sesame` on Linux, or the existing legacy/custom user-data directory already selected by the application. Conversations, reports, installed plugin data, configuration and credentials remain there. NSIS retains `deleteAppDataOnUninstall: false`; upgrading does not invoke a data reset. An AppImage update preserves the current AppImage filename and replaces only that file. DEB installation uses the system package manager and may request OS authentication.

This is not a database rollback system. Future incompatible schema changes still need a deliberate migration and backup policy. Development-era API 1 workflows/plans are not automatically made compatible with API 2; see [INSTALL.md](INSTALL.md). External trading terminals, deployed strategies and broker orders are independent of the desktop updater.

## Download contract

| Distribution | Download | Replacement |
| --- | --- | --- |
| Windows NSIS | `electron-updater` external blockmap and cached installer | NSIS installer |
| Linux AppImage | Embedded blockmap and current AppImage baseline | Verified staging beside the current file, then atomic replacement |
| Linux DEB | Sesame blockmap adapter and cached `update.deb` baseline | DEB package manager |

`electron-updater` is pinned to **6.8.9**. Review the DEB/AppImage adapters when upgrading it. Delta reconstruction falls back to a complete download when the baseline is unavailable or unsuitable. SHA-512 verification is required after download and again before installation. Delta savings depend on actual package changes; no percentage is promised. Download/staging can require space for an additional complete installer.

The application accepts only newer versions from the fixed `https://dl.sesame.bot` origin. Channels are `stable` (default, no semantic prereleases) and explicitly selected `preview`. Feeds declare `sesame.runtimeProtocol: 2`, platform and architecture. Each feed contains the exact platform installers; external blockmaps are published alongside Windows EXE and Linux DEB files. AppImage blockmaps are embedded. The feed has no arbitrary update URL or executable command interface.

## Build and stage

The commands in this section and the channel-promotion section run in the private application repository on the maintainer's release host. This public repository contains the release plans and publication workflows, not the application build scripts.

1. Choose a **new, higher version** in `package.json` and the reviewed Plugin API 2 source lock. Build on each native platform with `node scripts/package-desktop.mjs <platform> <arch> --plugins-source <reviewed-packages>`. Set `SESAME_UPDATE_CHANNEL=preview` only for preview builds; the default is stable. Packaging always passes `--publish never`.
2. Windows/Linux builds prepare these files in `release/<platform>-<arch>/`: installers, external `.blockmap` files, `update-feed-<platform>-<arch>.yml`, and `update-plan-<platform>-<arch>.json`. Plans use local filenames, so downloading a private draft to another release host does not retain CI paths. Raw builder `latest*.yml` files are not promoted.
3. Run `scripts/verify-installers.mjs` on the matching native platform with the reviewed plugin lock. It extracts each installer, checks the packaged server, updater configuration and plugin lock, validates the complete feed, then hashes installers **and** update artifacts into `verification.json`.
4. The manually dispatched desktop workflow stages that exact inventory in a private per-run draft. Source revision, plugin repository/commit/lock, asset hashes and draft state are mandatory. Retries may add missing identical assets; they cannot overwrite changed assets or modify a published release.

The public repository's installer uploader accepts the same verified Windows/Linux artifacts and leaves release publication as a separate action. Its stable-release workflow rejects a preview plan. The existing stable R2 mirror copies versioned release assets, including blockmaps; an explicit preview release/mirror path must be supplied separately before promoting a preview feed. Choosing a preview build alone does not expose it to users.

## Explicit channel promotion

Publish the immutable installers and blockmaps at `v<version>/<filename>` first. Never replace bytes under an already released version. Deploy the download Worker cache policy before activating channels: versioned assets remain immutable; `/updates/<channel>/<platform>-<arch>/latest*.yml` and missing manifests use `no-store`.

Download the verified plan, feed, installers and blockmaps into one directory on the release host, then check the mirror without writing:

```sh
node scripts/promote-update-feed.mjs release/win32-x64/update-plan-win32-x64.json
node scripts/promote-update-feed.mjs release/linux-x64/update-plan-linux-x64.json
```

The command validates local plan/artifact hashes, reads the current channel, and downloads every mirrored installer/blockmap to compare byte counts and SHA-512. Missing/corrupt artifacts, changed plans, wrong channels and equal/newer published feed versions block promotion.

After those checks, an authorized release operator adds **`--publish`** to the same command to upload the small manifest last. That action uses pinned Wrangler 4.147.0 and the release host's normal Cloudflare credentials; Node's bundled npm is needed on Windows. Run one promotion per channel/platform at a time. Ordinary packaging, private staging and stable asset mirroring do not activate an update notification by themselves. Retain old blockmaps needed for clients that skip versions.

## Verification boundaries

Automated coverage checks fixed-origin/channel/runtime contracts, download integrity and fallback, busy deferral, graceful shutdown, UI notification controls, portable plans, mirror verification and immutable draft uploads. Native package verification proves extraction, payload configuration and server import; it does **not** prove a clean desktop install or a real version-to-version NSIS/DEB/AppImage replacement. Record those platform acceptance results separately before claiming they were exercised. No broker operation is part of updater tests.
