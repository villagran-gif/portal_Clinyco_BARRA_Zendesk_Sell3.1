# Integración Zendesk Sell (corregida)

Este proyecto incluye servidor Node y scripts Bash para depurar integración con Zendesk Sell API.

## Cambios aplicados

- Header `User-Agent` agregado en todas las llamadas HTTP a Sell.
- Uso consistente del dominio oficial: `https://api.getbase.com`.
- Manejo de errores HTTP (4xx/5xx) con mensaje útil.
- Búsqueda Search API v3 con `projection` válida (sin `null`).
- Normalización de RUT (`solo dígitos`) para evitar falsos duplicados.
- Parseo seguro en `jq` para respuestas sin `items` (`.items[]?`).

## Variables de entorno

Obligatoria:

- `SELL_ACCESS_TOKEN`

Opcionales:

- `SELL_USER_AGENT` (default: `ClinycoPortal/1.0`)
- `ALLOW_WRITE` (`true` para permitir crear deals desde `/api/create-deal`)
- `RUT_FIELD_ID` (default script: `2759433`)

## Scripts Bash

```bash
chmod +x list_custom_fields.sh search_deals.sh test_scripts.sh
./list_custom_fields.sh "$SELL_ACCESS_TOKEN"
./search_deals.sh "$SELL_ACCESS_TOKEN" "12.345.678-9"
./test_scripts.sh
```

## Servidor

```bash
npm install
SELL_ACCESS_TOKEN=... npm start
```

### Endpoints

- `GET /` → health básico
- `GET /health` → `{ ok: true }`
- `POST /api/create-deal` → crea deal (si `ALLOW_WRITE=true`)
- `POST /api/create-deal?dry_run=1` → preview sin escritura

## Notas Search API v3

- Campo custom en filtros/projection: `custom_fields.<ID>` (ejemplo: `custom_fields.2759433`).
- Proyección válida: arreglo de objetos `{ "name": "campo" }`.
