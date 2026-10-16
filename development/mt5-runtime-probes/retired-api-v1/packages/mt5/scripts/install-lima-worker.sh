#!/usr/bin/env bash
# Explicit setup in an existing, running VM. No VM creation, download or start.
set -euo pipefail
package_dir="$(cd "$(dirname "$0")/.." && pwd)"
instance="${MT5AGENT_LIMA_INSTANCE:?Select an existing running Lima instance}"
limactl="${MT5AGENT_LIMACTL:-limactl}"
node="${SESAME_MT5_GUEST_NODE:-/usr/bin/node}"
[[ "$instance" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] && [[ "$node" = /* ]] || { echo 'Invalid instance/node path' >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/backend/runners"
cp "$package_dir/backend/frozen-compiler.js" "$package_dir/backend/support.js" "$work/backend/"
cp "$package_dir/backend/runners/compiler-process.js" "$work/backend/runners/"
printf '{"type":"module"}\n' > "$work/package.json"
digest=$(cat "$work/backend/frozen-compiler.js" "$work/backend/support.js" "$work/backend/runners/compiler-process.js" | shasum -a 256 | awk '{print $1}')
remote=$("$limactl" shell --workdir=/ "$instance" sh -c 'umask 077; mkdir -p "$HOME/.local/share/sesame/mt5/compiler"; mktemp -d "$HOME/.local/share/sesame/mt5/compiler/worker-XXXXXXXX"')
[[ "$remote" = /*/.local/share/sesame/mt5/compiler/worker-* ]] && [[ "$remote" != *$'\n'* ]] || { echo 'Unexpected VM installation path' >&2; exit 1; }
"$limactl" copy --backend=scp -r "$work/." "$instance:$remote/"
actual=$("$limactl" shell --workdir=/ "$instance" sh -c 'cat "$1/backend/frozen-compiler.js" "$1/backend/support.js" "$1/backend/runners/compiler-process.js" | sha256sum' sh "$remote")
[ "${actual%% *}" = "$digest" ] || { echo 'VM worker digest mismatch' >&2; exit 1; }
"$limactl" shell --workdir=/ "$instance" "$node" "$remote/backend/runners/compiler-process.js" probe
printf 'Configure compiler.backend=lima, instance=%s, node=%s, worker=%s\n' "$instance" "$node" "$remote/backend/runners/compiler-process.js"
