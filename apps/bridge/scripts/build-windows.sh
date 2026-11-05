#!/usr/bin/env bash
# Builds GlidepathBridge-windows-x64.zip using Node's official Single Executable
# Application (SEA) support. Runs on Linux, macOS or Windows (Git Bash).
#
# Steps:
#   1. Bundle the Bridge into one JS file (esbuild).
#   2. Fetch the Windows Node binary matching the local Node version (npm: node-win-x64),
#      and verify its Authenticode hash against its signature.
#   3. Produce the SEA blob and inject it (postject).
#   4. Zip it with the launchers, the demo flight and the README.
#
# Requirements: node 22 (same version used for the blob), python3 with pefile, zip.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/release"
WORK="$(mktemp -d)"
NODE_VERSION="$(node -p 'process.versions.node')"
echo "Building Glidepath Bridge for Windows x64 with Node $NODE_VERSION"

cd "$HERE"
npx esbuild src/index.ts --bundle --platform=node --format=cjs --target=node22 --outfile="$WORK/glidepath-bridge.cjs" --log-level=warning

mkdir -p "$WORK/node" && (cd "$WORK/node" && npm pack "node-win-x64@$NODE_VERSION" --silent >/dev/null && tar xzf node-win-x64-*.tgz)
python3 -I "$HERE/scripts/verify-authenticode.py" "$WORK/node/package/bin/node.exe"

cat > "$WORK/sea-config.json" <<EOF
{ "main": "$WORK/glidepath-bridge.cjs", "output": "$WORK/sea-prep.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false, "useSnapshot": false }
EOF
node --experimental-sea-config "$WORK/sea-config.json"
python3 -I "$HERE/scripts/strip-signature.py" "$WORK/node/package/bin/node.exe" "$WORK/GlidepathBridge.exe"
(cd "$WORK" && npm i --no-save --silent postject@1.0.0-alpha.6 >/dev/null && npx --no-install postject GlidepathBridge.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2)

PKG="$WORK/Glidepath Bridge"
mkdir -p "$PKG/demo"
cp "$WORK/GlidepathBridge.exe" "$PKG/"
cp "$HERE/fixtures/SYNTHETIC-EGLL-EGCC.ndjson" "$PKG/demo/"
cp "$HERE/packaging/README-FIRST.txt" "$PKG/"
cp "$HERE/packaging/"*.bat "$PKG/"
# Windows wants CRLF in .bat/.txt files.
for f in "$PKG"/*.bat "$PKG"/README-FIRST.txt; do sed -i 's/\r\{0,1\}$/\r/' "$f"; done
mkdir -p "$OUT"
rm -f "$OUT/GlidepathBridge-windows-x64.zip"
(cd "$WORK" && zip -qr -9 "$OUT/GlidepathBridge-windows-x64.zip" "Glidepath Bridge")
sha256sum "$OUT/GlidepathBridge-windows-x64.zip" | tee "$OUT/GlidepathBridge-windows-x64.zip.sha256"
rm -rf "$WORK"
echo "Done: $OUT/GlidepathBridge-windows-x64.zip"
