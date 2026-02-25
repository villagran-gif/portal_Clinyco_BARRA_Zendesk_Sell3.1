#!/usr/bin/env bash
set -euo pipefail

cat <<'EOT'
# List custom fields
curl -sS -D headers.txt \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: ClinycoPortal/1.0" \
  "https://api.getbase.com/v2/deal/custom_fields" \
  -o body.json

# Search deals by normalized RUT
curl -sS -X POST "https://api.getbase.com/v3/deals/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: ClinycoPortal/1.0" \
  -d @payload.json \
  -o resultados.json
EOT
