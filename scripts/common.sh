#!/usr/bin/env bash
set -euo pipefail

# Common helpers for Zendesk Sell API scripts.

SELL_BASE_URL="${SELL_BASE_URL:-https://api.getbase.com}"
SELL_USER_AGENT="${SELL_USER_AGENT:-clinyco-formularios/1.0}"

die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

# Usage: get_token "$1"
# Reads token from:
#  1) first argument
#  2) env SELL_ACCESS_TOKEN
get_token() {
  local arg="${1:-}"
  if [[ -n "$arg" ]]; then
    echo "$arg"
    return
  fi
  if [[ -n "${SELL_ACCESS_TOKEN:-}" ]]; then
    echo "$SELL_ACCESS_TOKEN"
    return
  fi
  die "Missing access token. Provide as first arg or set SELL_ACCESS_TOKEN env var."
}

# Normalize Chilean RUT by keeping digits only (project rule uses "RUT_normalizado").
# NOTE: This keeps only digits; if you store verifier digit (K) you must adapt.
normalize_rut_digits() {
  local rut="${1:-}"
  # Keep only digits
  echo "$rut" | sed 's/[^0-9]//g'
}

# curl wrapper that:
# - always sends User-Agent
# - captures headers + body to temp files
# - prints status code to stdout
# Usage:
#   http_json METHOD URL TOKEN [DATA_JSON]
#   -> sets global variables: HTTP_HEADERS_FILE, HTTP_BODY_FILE
HTTP_HEADERS_FILE=""
HTTP_BODY_FILE=""
http_json() {
  local method="$1"
  local url="$2"
  local token="$3"
  local data="${4:-}"

  local ts
  ts="$(date +%s%N)"
  HTTP_HEADERS_FILE="/tmp/sell_headers_${ts}.txt"
  HTTP_BODY_FILE="/tmp/sell_body_${ts}.json"

  if [[ -n "$data" ]]; then
    curl -sS -D "$HTTP_HEADERS_FILE" -o "$HTTP_BODY_FILE" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $token" \
      -H "User-Agent: $SELL_USER_AGENT" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      --data-binary "$data" || true
  else
    curl -sS -D "$HTTP_HEADERS_FILE" -o "$HTTP_BODY_FILE" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $token" \
      -H "User-Agent: $SELL_USER_AGENT" \
      -H "Accept: application/json" \
      || true
  fi

  # Extract status code (works with HTTP/1.1 and HTTP/2)
  # Example first line: HTTP/2 200
  awk 'NR==1{print $2}' "$HTTP_HEADERS_FILE" 2>/dev/null || echo ""
}

print_http_error() {
  local status="$1"
  echo "HTTP status: $status" >&2
  echo "--- Response headers ---" >&2
  sed -n '1,40p' "$HTTP_HEADERS_FILE" >&2 || true
  echo "--- Response body (first 200 lines) ---" >&2
  sed -n '1,200p' "$HTTP_BODY_FILE" >&2 || true
}
