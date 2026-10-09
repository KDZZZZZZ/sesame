#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Darwin || { echo 'This installer requires macOS.' >&2; exit 1; }
bundle="${MT5AGENT_MT5_APP:-/Applications/MetaTrader 5.app}"
if [ ! -d "$bundle" ]; then
  cache="$HOME/Library/Caches/mt5agent"
  mkdir -p "$cache"
  archive="$cache/MetaTrader5.pkg.zip"
  if [ ! -f "$archive" ]; then
    curl -fL --retry 3 -o "$archive.part" 'https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/MetaTrader5.pkg.zip'
    mv "$archive.part" "$archive"
  fi
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  unzip -q "$archive" 'MetaTrader 5.pkg' -d "$work"
  signature=$(pkgutil --check-signature "$work/MetaTrader 5.pkg")
  case "$signature" in
    *'Developer ID Installer: MetaQuotes Software Corp. (4LK8F7J843)'*) ;;
    *) echo 'Unexpected MT5 installer signature.' >&2; exit 1 ;;
  esac
  pkgutil --expand-full "$work/MetaTrader 5.pkg" "$work/expanded"
  # The vendor postinstall only initializes the prefix and launches the app.
  # Copy the signed bundle without requiring a system-wide package receipt.
  ditto "$work/expanded/MetaTrader5.pkg/Payload/MetaTrader 5.app" "$bundle"
fi
if [ "$(uname -m)" = arm64 ] && ! /usr/bin/arch -x86_64 /usr/bin/true 2>/dev/null; then
  /usr/sbin/softwareupdate --install-rosetta --agree-to-license
fi
if [ ! -d "$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c" ]; then
  open -a "$bundle" -W --args --install
fi
echo "MT5 installed: $bundle"
