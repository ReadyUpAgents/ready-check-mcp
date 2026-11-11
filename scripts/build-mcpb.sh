#!/usr/bin/env bash
# Build server.mcpb (for Smithery and desktop clients) from a clean staging copy.
# Installs production dependencies from npm-shrinkwrap.json with install scripts disabled.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT"
npm run build >/dev/null
mkdir -p "$STAGE/dist"
for f in index server api validate key constants; do cp "dist/$f.js" "$STAGE/dist/"; done
cp package.json npm-shrinkwrap.json README.md LICENSE "$STAGE/"
cp mcpb/manifest.json "$STAGE/manifest.json"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
npx --yes @anthropic-ai/mcpb@2.1.2 validate "$STAGE/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "$STAGE" "$ROOT/server.mcpb"
