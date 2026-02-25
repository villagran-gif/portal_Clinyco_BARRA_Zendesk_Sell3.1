#!/usr/bin/env bash
set -euo pipefail

TOKEN="${1:-${ACCESS_TOKEN:-}}"
USER_AGENT="${SELL_USER_AGENT:-ClinycoPortal/1.0}"
OUT_HEADERS="${OUT_HEADERS:-/tmp/headers.txt}"
OUT_BODY="${OUT_BODY:-/tmp/body.json}"

if [[ -z "$TOKEN" ]]; then
  echo "Uso: $0 <ACCESS_TOKEN>" >&2
  exit 1
fi

curl -sS -D "$OUT_HEADERS" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://api.getbase.com/v2/deal/custom_fields" \
  -o "$OUT_BODY"

status="$(head -n1 "$OUT_HEADERS" | awk '{print $2}')"
if [[ "$status" == "200" ]]; then
  jq -r '.items[]?.data | "\(.id)\t\(.name)\t\(.type)"' "$OUT_BODY"
else
  echo "Error HTTP $status" >&2
  cat "$OUT_BODY" >&2
  exit 1
fi
