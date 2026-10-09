#!/usr/bin/env bash
# Explicit developer setup for an existing VM. Production uses verified bundles.
set -euo pipefail
package_dir="$(cd "$(dirname "$0")/.." && pwd)"
instance="${MT5AGENT_LIMA_INSTANCE:-mt5agent}"
limactl="${MT5AGENT_LIMACTL:-limactl}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/backend/runners"
cp "$package_dir/backend/frozen-compiler.js" "$package_dir/backend/support.js" "$work/backend/"
cp "$package_dir/backend/runners/compiler-process.js" "$work/backend/runners/"
printf '{"type":"module"}\n' > "$work/package.json"
digest=$(cat "$work/backend/frozen-compiler.js" "$work/backend/support.js" "$work/backend/runners/compiler-process.js" | shasum -a 256 | awk '{print $1}')
remote=$("$limactl" shell --workdir=/ "$instance" mktemp -d "/tmp/sesame-compiler-${digest:0:16}-XXXXXXXX")
[[ "$remote" =~ ^/tmp/sesame-compiler-[a-f0-9]{16}-[A-Za-z0-9]+$ ]] || { echo "Unexpected VM temporary path" >&2; exit 1; }
"$limactl" copy --backend=scp -r "$work/." "$instance:$remote/"
"$limactl" shell --workdir=/ "$instance" /usr/local/bin/node "$remote/backend/runners/compiler-process.js" probe
printf 'export SESAME_MT5_LIMA_WORKER=%q\n' "$remote/backend/runners/compiler-process.js"
