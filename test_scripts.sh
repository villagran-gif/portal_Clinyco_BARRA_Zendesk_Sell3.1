#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
This script prints example commands (it does NOT call the API).

1) List deal custom fields:
   export SELL_ACCESS_TOKEN="..."
   export SELL_USER_AGENT="clinyco-formularios/1.0"
   ./list_custom_fields.sh "$SELL_ACCESS_TOKEN" deal

2) List contact custom fields:
   ./list_custom_fields.sh "$SELL_ACCESS_TOKEN" contact

3) Search deals by RUT_normalizado (custom field ID 2759433):
   export OPEN_STAGE_IDS="10693252,10693253,10693255"
   ./search_deals.sh "$SELL_ACCESS_TOKEN" "6.469.664-6"

Notes:
- Zendesk Sell API requires a User-Agent header.
- Use https://api.getbase.com as the base domain.
- Search API v3 projection must be an array of objects like {"name":"..."} (no nulls).
EOF
