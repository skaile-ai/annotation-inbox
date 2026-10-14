#!/usr/bin/env bash
# Install the omp extension user-wide: copy the bundled dist/omp.mjs into omp's
# extensions directory. Native discovery scans .ts/.js only, so the copy is named .js
# (the bundle is ESM; Bun evaluates ESM .js regardless of a package "type").
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bundle="$root/dist/omp.mjs"

if [ ! -f "$bundle" ]; then
  echo "run npm run build first" >&2
  exit 1
fi

dest="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}/extensions"
mkdir -p "$dest"
cp "$bundle" "$dest/annotation-inbox.js"

echo "installed $dest/annotation-inbox.js"
echo "restart omp to load it"
