#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./scripts/common.sh
source "$SCRIPT_DIR/scripts/common.sh"

require_cmd curl
require_cmd jq
require_cmd sed
require_cmd awk

# Canonical field IDs (project rules)
RUT_FIELD_ID="${RUT_FIELD_ID:-2759433}" # DEAL custom field: RUT_normalizado

# Optional: comma-separated list of "open" stage IDs to restrict duplicates within a pipeline.
# Example:
#   export OPEN_STAGE_IDS="10693252,10693253,10693255"
OPEN_STAGE_IDS="${OPEN_STAGE_IDS:-}"

usage() {
  cat <<'EOF'
Usage:
  ./search_deals.sh [TOKEN] "RUT"
Environment:
  SELL_ACCESS_TOKEN  - access token (if not provided as first arg)
  SELL_BASE_URL      - default: https://api.getbase.com
  SELL_USER_AGENT    - default: clinyco-formularios/1.0
  RUT_FIELD_ID       - default: 2759433
  OPEN_STAGE_IDS     - optional comma-separated stage IDs to restrict duplicates
Examples:
  export SELL_ACCESS_TOKEN="..."
  export OPEN_STAGE_IDS="10693252,10693253,10693255"
  ./search_deals.sh "$SELL_ACCESS_TOKEN" "6.469.664-6"
EOF
}

TOKEN="$(get_token "${1:-}")"
RUT_RAW="${2:-}"
if [[ -z "$RUT_RAW" ]]; then
  usage
  die "Missing RUT argument."
fi

RUT_NORM="$(normalize_rut_digits "$RUT_RAW")"
if [[ -z "$RUT_NORM" ]]; then
  die "RUT normalized to empty. Input: $RUT_RAW"
fi

SEARCH_URL="${SELL_BASE_URL}/v3/deals/search"

# Build stage OR filter if OPEN_STAGE_IDS provided
stage_or_json=""
if [[ -n "$OPEN_STAGE_IDS" ]]; then
  IFS=',' read -r -a stage_ids <<< "$OPEN_STAGE_IDS"
  # Build: {"or":[{"filter":{...}}, ...]}
  or_items=()
  for sid in "${stage_ids[@]}"; do
    sid_trim="$(echo "$sid" | sed 's/[^0-9]//g')"
    [[ -z "$sid_trim" ]] && continue
    or_items+=("{\"filter\":{\"attribute\":{\"name\":\"stage_id\"},\"parameter\":{\"eq\":${sid_trim}}}}")
  done
  if [[ "${#or_items[@]}" -gt 0 ]]; then
    or_joined="$(IFS=,; echo "${or_items[*]}")"
    stage_or_json="{\"or\":[${or_joined}]}"
  fi
fi

# Core filter by custom_fields.<ID> == RUT_NORM
rut_filter="{\"filter\":{\"attribute\":{\"name\":\"custom_fields.${RUT_FIELD_ID}\"},\"parameter\":{\"eq\":\"${RUT_NORM}\"}}}"

# Combine filters
if [[ -n "$stage_or_json" ]]; then
  filter_json="{\"and\":[${rut_filter},${stage_or_json}]}"
else
  filter_json="${rut_filter}"
fi

# Projection: avoid any nulls; use explicit objects.
body="$(cat <<JSON
{
  "items": [{
    "data": {
      "per_page": 10,
      "query": {
        "projection": [
          {"name":"id"},
          {"name":"name"},
          {"name":"stage_id"},
          {"name":"pipeline_id"},
          {"name":"contact_id"},
          {"name":"custom_fields.${RUT_FIELD_ID}"}
        ],
        "filter": ${filter_json}
      }
    }
  }]
}
JSON
)"

status="$(http_json "POST" "$SEARCH_URL" "$TOKEN" "$body")"
if [[ "$status" != "200" ]]; then
  print_http_error "$status"
  echo "--- Sent body ---" >&2
  echo "$body" >&2
  die "Deal search failed."
fi

# Print a compact list of results.
# Search API response uses items[].data.items[]? depending on schema;
# We'll try to print gracefully.
jq -r '
  def rows:
    if (.items // [] | length) == 0 then
      []
    else
      # Take first search batch in items[0]
      (.items[0].data.items // [])
    end;

  rows[]
  | [
      (.data.id|tostring),
      (.data.name // ""),
      (.data.stage_id|tostring),
      (.data.pipeline_id|tostring),
      (.data.contact_id|tostring),
      (.data.custom_fields["'"${RUT_FIELD_ID}"'"] // "")
    ]
  | @tsv
' "$HTTP_BODY_FILE"
