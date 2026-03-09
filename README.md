# clinyco_sell_tools

Herramientas CLI (bash) para depurar y validar integración con **Zendesk Sell API**.

Incluye fixes clave del proyecto:

- Header obligatorio `User-Agent` en todas las requests.
- Dominio correcto: `https://api.getbase.com`
- Search API v3: `projection` sin `null` y con objetos `{ "name": "..." }`
- Búsqueda anti-duplicados por `RUT_normalizado` usando `custom_fields.<ID>` (por defecto: **2759433**)
- Manejo de errores HTTP (headers + body guardados en `/tmp/`)

## Requisitos

- bash
- curl
- jq
- sed, awk

## Configuración rápida

```bash
export SELL_ACCESS_TOKEN="TU_TOKEN"
export SELL_USER_AGENT="clinyco-formularios/1.0"   # opcional, default ya definido
export SELL_BASE_URL="https://api.getbase.com"      # opcional
```

### Opcional: restringir duplicados a stages “abiertos”

```bash
export OPEN_STAGE_IDS="10693252,10693253,10693255"
```

## Uso

### 1) Listar custom fields (deal o contact)

```bash
./list_custom_fields.sh "$SELL_ACCESS_TOKEN" deal
./list_custom_fields.sh "$SELL_ACCESS_TOKEN" contact
```

Salida (TSV):

```
<ID>   <Nombre>   <Tipo>   <Nº de opciones (si aplica)>
```

### 2) Buscar deals por RUT_normalizado (anti-duplicados)

Por defecto busca en `custom_fields.2759433` (RUT_normalizado).

```bash
./search_deals.sh "$SELL_ACCESS_TOKEN" "6.469.664-6"
```

Salida (TSV):

```
<deal_id> <name> <stage_id> <pipeline_id> <contact_id> <rut_normalizado>
```

## Archivos temporales

Cada request guarda headers y body en:

- `/tmp/sell_headers_<ts>.txt`
- `/tmp/sell_body_<ts>.json`

Si hay error, el script imprime los primeros 200 lines del body para depuración.

## Seguridad

No incluyas tokens dentro de scripts. Usa variables de entorno o argumentos.

## Licencia

MIT
