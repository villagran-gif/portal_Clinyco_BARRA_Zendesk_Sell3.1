#!/usr/bin/env bash
set -euo pipefail

TOKEN="${1:-${ACCESS_TOKEN:-}}"
RUT_RAW="${2:-}"
RUT_FIELD_ID="${RUT_FIELD_ID:-2759433}"
USER_AGENT="${SELL_USER_AGENT:-ClinycoPortal/1.0}"

if [[ -z "$TOKEN" || -z "$RUT_RAW" ]]; then
  echo "Uso: $0 <ACCESS_TOKEN> <RUT>" >&2
  exit 1
fi

RUT_CLEAN="$(echo "$RUT_RAW" | sed 's/[^0-9]//g')"
if [[ -z "$RUT_CLEAN" ]]; then
  echo "RUT inválido: $RUT_RAW" >&2
  exit 1
fi

BODY="$(jq -n \
  --arg rut "$RUT_CLEAN" \
  --arg field "custom_fields.${RUT_FIELD_ID}" \
  '{
    items: [{
      data: {
        per_page: 10,
        query: {
          projection: [
            {name: "id"},
            {name: "name"},
            {name: "stage_id"},
            {name: $field}
          ],
          filter: {
            and: [
              {
                filter: {
                  attribute: {name: $field},
                  parameter: {eq: $rut}
                }
              }
            ]
          }
        }
      }
    }]
  }')"

curl -sS -X POST "https://api.getbase.com/v3/deals/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  -d "$BODY" \
  -o resultados.json

jq . resultados.json
