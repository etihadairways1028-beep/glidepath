#!/usr/bin/env bash
# Bundles each function into one self-contained file you can paste into the Supabase dashboard editor.
set -euo pipefail
cd "$(dirname "$0")"
ESBUILD="${ESBUILD:-$(ls -d ../node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | head -1)}"
for f in monthly-brief download; do
  mkdir -p functions/$f
  "$ESBUILD" src/$f.ts --bundle --format=esm --platform=neutral --target=es2022 \
    --external:'npm:*' --main-fields=module,main --log-level=warning \
    --banner:js="// Built from cloud/src/$f.ts by cloud/build.sh. Paste this whole file into the Supabase editor." \
    --outfile=functions/$f/index.ts
  echo "functions/$f/index.ts: $(wc -c < functions/$f/index.ts) bytes"
done
