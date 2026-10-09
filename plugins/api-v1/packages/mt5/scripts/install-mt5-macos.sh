#!/usr/bin/env bash
# Fetch and verify the vendor installer; never initialize or replace a terminal.
set -euo pipefail
test "$(uname -s)" = Darwin || { echo 'This downloader requires macOS.' >&2; exit 1; }
[ "$#" = 2 ] && [ "$1" = --directory ] && [[ "$2" = /* ]] || { echo 'Usage: install-mt5-macos.sh --directory /absolute/plugin-private/downloads' >&2; exit 1; }
parent="$2"
mkdir -p "$parent"
[ "$(cd "$parent" && pwd -P)" = "$parent" ] || { echo 'Refusing a redirected directory.' >&2; exit 1; }
work=$(mktemp -d "$parent/mt5-installer-XXXXXXXX")
trap 'rm -f "$work/MetaTrader5.pkg.zip.part"' EXIT
curl --proto '=https' --tlsv1.2 -fL --retry 3 --max-time 600 --max-filesize 2147483648 -o "$work/MetaTrader5.pkg.zip.part" 'https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/MetaTrader5.pkg.zip'
unzip -p "$work/MetaTrader5.pkg.zip.part" 'MetaTrader 5.pkg' > "$work/MetaTrader 5.pkg"
signature=$(pkgutil --check-signature "$work/MetaTrader 5.pkg")
case "$signature" in
  *'Developer ID Installer: MetaQuotes Software Corp. (4LK8F7J843)'*) ;;
  *) echo 'Unexpected MT5 installer signature; retained for diagnosis, not executed.' >&2; exit 1 ;;
esac
spctl --assess --type install --verbose=2 "$work/MetaTrader 5.pkg"
shasum -a 256 "$work/MetaTrader 5.pkg" > "$work/SHA256.txt"
printf 'Verified vendor installer: %s\n' "$work/MetaTrader 5.pkg"
printf 'No terminal was installed, launched, replaced or stopped. Use the vendor wizard only after existing-installation discovery.\n'
