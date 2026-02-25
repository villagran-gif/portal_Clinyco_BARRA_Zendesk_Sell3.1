#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./scripts/common.sh
source "$SCRIPT_DIR/scripts/common.sh"

require_cmd curl
require_cmd jq
require_cmd sed
require_cmd awk

# Usage:
#   ./list_custom_fields.sh [TOKEN] [deal|contact]
# Defaults:
#   resource_type=deal
TOKEN="$(get_token "${1:-}")"
RESOURCE_TYPE="${2:-deal}"

if [[ "$RESOURCE_TYPE" != "deal" && "$RESOURCE_TYPE" != "contact" ]]; then
  die "resource_type must be 'deal' or 'contact' (got: $RESOURCE_TYPE)"
fi

URL="${SELL_BASE_URL}/v2/${RESOURCE_TYPE}/custom_fields"

status="$(http_json "GET" "$URL" "$TOKEN")"
if [[ "$status" != "200" ]]; then
  print_http_error "$status"
  die "Failed to list ${RESOURCE_TYPE} custom fields."
fi

# Safe jq: items may be missing or empty.
# Output: id, name, type, (optional) options size
jq -r '
  (.items // [])[]?.data
  | [
      (.id|tostring),
      (.name // ""),
      (.type // ""),
      (if .options then (.options|length|tostring) else "" end)
    ]
  | @tsv
' "$HTTP_BODY_FILE"
