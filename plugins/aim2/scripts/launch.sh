#!/bin/sh
set -eu
plugin_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if command -v node >/dev/null 2>&1; then
  exec node --use-system-ca "$plugin_root/server/index.cjs"
fi
for node_bin in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
  if [ -x "$node_bin" ]; then exec "$node_bin" --use-system-ca "$plugin_root/server/index.cjs"; fi
done
echo 'AIM2 requires Node.js 22.19 or newer. Install Node.js and restart Codex.' >&2
exit 1
