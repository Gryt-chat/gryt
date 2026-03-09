#!/usr/bin/env bash
#
# Scans subdirectories for addon.json manifests and produces an addons.json
# index file. Used for web/Docker deployments where the client fetches
# /addons/addons.json to discover available addons.
#
# Usage:
#   cd /path/to/addons
#   bash generate-index.sh
#
# Output: addons.json in the current directory.

set -euo pipefail

output="["
first=true

for dir in */; do
  manifest="${dir}addon.json"
  if [ -f "$manifest" ]; then
    if [ "$first" = true ]; then
      first=false
    else
      output="${output},"
    fi
    output="${output}$(cat "$manifest")"
  fi
done

output="${output}]"
echo "$output" | python3 -m json.tool > addons.json 2>/dev/null \
  || echo "$output" > addons.json

echo "Generated addons.json with $(echo "$output" | grep -o '"id"' | wc -l) addon(s)"
