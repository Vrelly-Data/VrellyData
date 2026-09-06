#!/usr/bin/env bash
# Reconstruct soft-HD source PNGs from chunked base64 parts.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
for stem in bird-mark-soft.png wordmark-soft.png; do
  out_b64="${stem}.b64"
  rm -f "$out_b64"
  for part in $(ls -1 "${stem}.b64.part"* 2>/dev/null | sort); do
    cat "$part" >> "$out_b64"
  done
  base64 -d "$out_b64" > "$stem"
  echo "Wrote $stem ($(wc -c < "$stem") bytes) from $out_b64"
done
