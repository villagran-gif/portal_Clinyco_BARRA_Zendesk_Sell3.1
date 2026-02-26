# Instrucciones para agentes (Copilot) — portal_Clinyco_BARRA_Zendesk_Sell3.1

Breve: este repo es una pequeña app Node/Express que expone APIs para buscar/crear contactos y deals contra Zendesk Sell ("Sell"). Aquí están las decisiones y patrones clave que te permiten ser productivo rápidamente.

- **Arquitectura principal**: servidor Node (`server.js`) monolítico + helpers en `lib/` y UI estática en `public/`.
  - `server.js`: todas las rutas REST (ej.: `/api/search-rut`, `/api/create-contact`, `/api/create-deal`, `/api/pipelines`, `/api/owners`).
  - `lib/sell.js`: integraciones con la API de Sell (resolución de ids de búsqueda, get/create, list custom fields, stages, pipelines).
  - `lib/rut.js`, `lib/comunas.js`: utilidades de normalización y mapeo de comuna.

- **Flujo de datos**: las rutas normalizan entrada (RUT, campos), consultan catálogos de custom fields (cache local con TTL), resuelven ids de búsqueda y llaman a `lib/sell` para buscar/crear recursos en Sell. Respuestas JSON siguen una forma estable (campo `ok`, `status`, `error`, `message`, y payloads `contact`, `deal`, `vista_previa`, etc.).

- **Puntos críticos y convenciones del proyecto**:
  - Catálogos de campos: `getContactCatalog()` y `getDealCatalog()` retornan estructura `{ fields, byId, byName, listChoicesByFieldId }` y se cachean por 15 minutos (`CATALOG_TTL_MS`). Prefiere usar `byId`/`byName` cuando esté disponible.
  - Custom fields se asignan por NOMBRE (no sólo ID) en los payloads. Si Sell rechaza listas (422), se reintenta con `{id,name}` (patrón repetido en `createContact`/`createDeal`).
  - RUT: usar `normalizeRut` en `lib/rut.js`. Modo de búsqueda controlado por `RUT_MATCH_MODE` (`both` por defecto o `canonical`). Valores buscados suelen incluir la variante con guión y sin guión.
  - Safety switch para escrituras: `ALLOW_WRITE` debe ser `true` para permitir creación real; de lo contrario usar `?dry_run=1` (o pasar `dry_run=true`).
  - Mapeo de `stage_id` por `pipeline_id`: el mapeo puede venir por env `STAGE_BY_PIPELINE="pid:sid,..."` o caer en `getFirstStageIdForPipeline()`. Hay un caso especial en código para `pipelineId === 1290779`.
  - URLs para UI/editores: base URLs configurables por `SELL_DESKTOP_BASE_URL`, `SELL_MOBILE_CONTACT_BASE_URL`, `SELL_MOBILE_DEAL_BASE_URL`.

- **Endpoints y comportamientos observables (ejemplos)**:
  - `/api/search-rut` — normaliza RUT, busca `contacts` y `deals` por custom fields, agrupa deals por pipeline, y aplica reglas anti-duplicados. Respuesta incluye `rules` y `deals_by_pipeline`.
  - `/api/create-contact` — construye `payload.data` con `custom_fields` mapeados por nombre; soporta `dry_run` y `debug` query params.
  - `/api/create-deal` — similar a create-contact, calcula IMC/edad/whatsapp, valida duplicados por pipeline, y determina `stage_id`.

- **Variables de entorno importantes** (revisar `server.js`):
  - `SELL_ACCESS_TOKEN` (obligatorio para llamadas a Sell)
  - `ALLOW_WRITE` (must be `true` to create resources)
  - `CONTACT_RUT_NORMALIZED_FIELD`, `DEAL_RUT_NORMALIZED_FIELD` (nombres usados para búsquedas)
  - `RUT_MATCH_MODE` (`both` or `canonical`)
  - `STAGE_BY_PIPELINE` (ej: `4823817:12345,4959507:67890`)
  - `SELL_DESKTOP_BASE_URL`, `SELL_MOBILE_CONTACT_BASE_URL`, `SELL_MOBILE_DEAL_BASE_URL`

- **Comandos de desarrollo / ejecución**:
  - Requerimiento: Node 22.x (ver `package.json` `engines`).
  - Ejecutar local: `npm start` o `node server.js` (ambos ejecutan `server.js`).
  - Para pruebas rápidas de creación sin tocar Sell: añadir `?dry_run=1` y opcional `?debug=1` a las peticiones POST.

- **Patrones de errores y códigos**:
  - El servidor usa códigos de error específicos (`DUPLICATE_CONTACT_RUT`, `INVALID_ASEGURADORA`, `WRITE_DISABLED`, `DEAL_EXISTS_IN_PIPELINE`, etc.). Mantén estos códigos cuando generes/transformes respuestas.
  - Cuando reintentes cambios en custom_fields para listas, detecta 422/schema_validation_failed y reintenta con `{id,name}`.

- **Archivos clave a revisar si necesitas cambios**:
  - `server.js` — comportamiento de las APIs y reglas de negocio.
  - `lib/sell.js` — abstracción de llamadas HTTP a Sell y resolución de ids (leer antes de cambiar integraciones).
  - `lib/rut.js` — normalización y validación de RUT/DV.
  - `lib/comunas.js` — canonicalización de comuna (usada para address/city mirrors).
  - `public/` — UI estática que consume estas APIs (útil para verificar shapes esperadas).

- **Qué evitar / respetar**:
  - No elimines el modo `dry_run` ni las comprobaciones `ALLOW_WRITE` sin migración segura.
  - Respeta los formatos de `custom_fields` tal como el código intenta (string, luego objeto `{id,name}`) para evitar regresiones con Sell.

Si algo clave falta en estas notas (p. ej. otros scripts de despliegue o valores env privados), dime qué sección quieres que expanda y lo actualizo.
