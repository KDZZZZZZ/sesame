# MT5 developer commands

Run these commands from the MT5 package directory with Node 24 and the matching public SDK loader supplied by the installed Sesame host. For example, `node --import "$SESAME_PLUGIN_SDK_LOADER" scripts/mt5.mjs doctor`. The loader must implement the documented `@sesame/plugin-sdk/*` modules; no application source directory is assumed.

`doctor` reads installation paths, Wine version and the configured development compiler availability. It does not install software, start a terminal or verify a production bundle. `terminal` and `editor` explicitly launch the discovered native program. Production plugin tools obtain verified runtime paths from `HostContext.environment.runtime`.

`install-mt5-macos.sh`, `install-mt5-python.py` and `install-lima-worker.sh` are explicit development installation commands. The Lima command installs a standalone compiler worker in an existing VM and prints its configuration path.

The `probes/` scripts preserve the controlled compiler comparison and streaming experiments. They require separately prepared frozen MetaEditor/header/source fixtures with their embedded digests, a matching experimental guest image, an explicit launcher and QEMU executable, and a new output directory. Binaries and fixtures are not included in this source package. The scripts refuse a different fixture rather than silently replacing its identity. They launch private compiler processes and temporary guests only when invoked; unit tests never invoke them. Their historical timing and image assumptions are not current platform or release acceptance evidence.

To prepare the historical comparison input without compiling, run `node --import "$SESAME_PLUGIN_SDK_LOADER" scripts/probes/benchmark-compiler-compare.mjs --input /absolute/frozen-fixture --output /absolute/new-build --prepare-only`. Actual compilation requires `--preflight-only` or `--compare`; comparison additionally requires `--launcher`, `--qemu` and `--guest`. The streaming probe requires `--input`, `--output`, `--launcher`, `--qemu` and `--guest`. Current platform acceptance must also exercise the packaged compiler runner and confirm its process cleanup receipt.
