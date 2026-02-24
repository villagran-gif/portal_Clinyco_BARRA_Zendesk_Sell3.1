
async function resolvePipelineName(pipelineId) {
  try {
    const pipelines = await getPipelines();
    const p = (pipelines || []).find(x => Number(x.id) === Number(pipelineId));
    return p ? p.name : null;
  } catch (_e) {
    return null;
  }
}

const path = require('path');
const express = require('express');

const { normalizeRut } = require('./lib/rut');
const {
  resolveSearchApiId,
  searchContactsByCustomField,
  searchDealsByCustomField,
  getDealsByIds,
  getStagesByIds,
  getPipelinesByIds,
  getPipelines,
  getFirstStageIdForPipeline,
  getContactCustomFields,
  getDealCustomFields,
  createContact,
  createDeal,
} = require('./lib/sell');

const { canonicalComuna, ERROR_COMUNA } = require('./lib/comunas');

const app = express();
app.use(express.json({ limit: '1mb' }));
// Be tolerant to accidental double slashes like "//api/search-rut"
app.use((req, _res, next) => {
  if (req.url && req.url.includes('//')) req.url = req.url.replace(/\/{2,}/g, '/');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.status(200).send('ok'));

// Build URLs
function deskContactUrl(id) {
  const base = (process.env.SELL_DESKTOP_BASE_URL || 'https://clinyco.zendesk.com/sales').replace(/\/$/, '');
  return `${base}/contacts/${id}`;
}
function deskDealUrl(id) {
  const base = (process.env.SELL_DESKTOP_BASE_URL || 'https://clinyco.zendesk.com/sales').replace(/\/$/, '');
  return `${base}/deals/${id}`;
}
function mobileContactUrl(id) {
  const base = (process.env.SELL_MOBILE_CONTACT_BASE_URL || 'https://app.futuresimple.com/crm').replace(/\/$/, '');
  return `${base}/contacts/${id}`;
}
function mobileDealUrl(id) {
  const base = (process.env.SELL_MOBILE_DEAL_BASE_URL || 'https://app.futuresimple.com/sales').replace(/\/$/, '');
  return `${base}/deals/${id}`;
}

// --- Field catalog cache (Contact) ---
let CONTACT_CATALOG = null;
let CONTACT_CATALOG_AT = 0;
const CATALOG_TTL_MS = 15 * 60 * 1000; // 15 min

function normKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function getContactCatalog(force = false) {
  const now = Date.now();
  if (!force && CONTACT_CATALOG && (now - CONTACT_CATALOG_AT) < CATALOG_TTL_MS) return CONTACT_CATALOG;

  const fields = await getContactCustomFields();
  const byId = new Map();
  const byName = new Map();
  const listChoicesByFieldId = new Map(); // fieldId -> Map(normChoiceName -> {id,name})

  for (const f of fields) {
    byId.set(f.id, f);
    byName.set(f.name, f);
    if (f.type === 'list' && Array.isArray(f.choices)) {
      const cm = new Map();
      for (const ch of f.choices) cm.set(normKey(ch.name), { id: ch.id, name: ch.name });
      listChoicesByFieldId.set(f.id, cm);
    }
  }

  CONTACT_CATALOG = { fields, byId, byName, listChoicesByFieldId };
  CONTACT_CATALOG_AT = now;
  return CONTACT_CATALOG;
}


// --- Field catalog cache (Deal) ---
let DEAL_CATALOG = null;
let DEAL_CATALOG_AT = 0;

async function getDealCatalog(force = false) {
  const now = Date.now();
  if (!force && DEAL_CATALOG && (now - DEAL_CATALOG_AT) < CATALOG_TTL_MS) return DEAL_CATALOG;

  const fields = await getDealCustomFields();
  const byId = new Map();
  const byName = new Map();
  const listChoicesByFieldId = new Map(); // fieldId -> Map(normChoiceName -> {id,name})

  for (const f of fields) {
    byId.set(f.id, f);
    byName.set(f.name, f);
    if (f.type === 'list' && Array.isArray(f.choices)) {
      const cm = new Map();
      for (const ch of f.choices) cm.set(normKey(ch.name), { id: ch.id, name: ch.name });
      listChoicesByFieldId.set(f.id, cm);
    }
  }

  DEAL_CATALOG = { fields, byId, byName, listChoicesByFieldId };
  DEAL_CATALOG_AT = now;
  return DEAL_CATALOG;
}

function findDealFieldNameByNorm(cat, normNames /* array of normalized candidates */) {
  for (const f of cat.fields) {
    const n = normKey(f.name);
    if (normNames.includes(n)) return f.name;
  }
  return null;
}

function mustFieldNameById(cat, id) {
  const f = cat.byId.get(id);
  if (!f || !f.name) {
    const err = new Error(`No existe custom field contact id=${id}`);
    err.code = 'FIELD_NOT_FOUND';
    err.field_id = id;
    throw err;
  }
  return f.name;
}

function formatRutHumanFromNoDashLower(noDashLower) {
  // input: "16927228k" or "123456789"
  const raw = String(noDashLower || '').toUpperCase().replace(/[^0-9K]/g, '');
  if (raw.length < 2) return '';
  const dv = raw.slice(-1);
  let num = raw.slice(0, -1);
  let out = '';
  while (num.length > 3) { out = '.' + num.slice(-3) + out; num = num.slice(0, -3); }
  out = num + out;
  return `${out}-${dv}`;
}

function cleanValue(v) {
  return String(v ?? '')
    .replace(/\*/g, '')
    .replace(/=/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidDobDDMMYYYY(s) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
  const [dd, mm, yyyy] = s.split('/').map((x) => parseInt(x, 10));
  if (yyyy < 1900 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  return true;
}

function calcAgeFromDobDDMMYYYY(s) {
  if (!isValidDobDDMMYYYY(s)) return null;
  const [dd, mm, yyyy] = s.split('/').map((x) => parseInt(x, 10));
  const dob = new Date(Date.UTC(yyyy, mm - 1, dd));
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}


app.get('/api/pipelines', async (_req, res) => {
  try {
    const items = await getPipelines();
    // Only return active ones (if property exists)
    const pipelines = (items || []).map(p => ({
      id: p.id,
      name: p.name,
      disabled: p.disabled === true
    })).filter(p => !p.disabled);
    return out(200, { ok: true, pipelines });
  } catch (err) {
    return out(500, { ok: false, error: 'No se pudieron cargar pipelines', details: err.message || String(err) });
  }
});

app.post('/api/search-rut', async (req, res) => {
  // IMPORTANT: Always respond with the same JSON shape.
  const rutInput = (req.body && req.body.rut) || '';
  const pipelineIdRaw = (req.body && req.body.pipelineId) ?? null;
  const pipelineId =
    pipelineIdRaw === null || pipelineIdRaw === undefined || pipelineIdRaw === ''
      ? null
      : Number(pipelineIdRaw);

  // Response state (filled progressively)
  let normalized = null;
  let normalizedNoDash = null;
  let valuesToMatch = [];
  let contactSearchApiId = null;
  let dealSearchApiId = null;
  let contactsOut = [];
  let dealsFoundTotal = 0;
  let dealsOut = [];
  let dealsInSamePipeline = [];
  let dealsByPipeline = [];
  let duplicateDealsByPipeline = [];

  const rules = {
    rut_unique_in_contacts: null,
    rut_unique_in_pipeline: null,
    rut_unique_in_any_pipeline: null,
  };

  const send = (status, error = null, message = null) => {
    const payload = {
      ok: status < 400,
      status,
      error,
      message,
      rut_input: rutInput,
      rut_normalized: normalized,
      rut_normalized_no_dash: normalizedNoDash,
      used_match_values: valuesToMatch,
      contact_custom_field_search_api_id: contactSearchApiId,
      deal_custom_field_search_api_id: dealSearchApiId,
      contacts: contactsOut,
      contacts_found: contactsOut.length,
      contact: contactsOut.length ? contactsOut[0] : null,      deals_found_total: dealsFoundTotal,
      deals: dealsOut,
      deals_found: dealsOut.length,
      deal: dealsOut.length ? dealsOut[0] : null,
      pipeline_id_checked: Number.isFinite(pipelineId) ? pipelineId : null,
      deals_in_same_pipeline: dealsInSamePipeline,
      deals_by_pipeline: dealsByPipeline,
      duplicate_deals_by_pipeline: duplicateDealsByPipeline,
      rules,
    };
    return res.status(status).json(payload);
  };

  try {
    // Validate pipeline id if provided
    if (pipelineIdRaw !== null && pipelineIdRaw !== undefined && pipelineIdRaw !== '' && !Number.isFinite(pipelineId)) {
      return send(400, 'INVALID_PIPELINE_ID', 'Pipeline ID inválido (debe ser numérico).');
    }

    // Normalize and validate DV
    const norm = normalizeRut(rutInput);
    normalized = norm.normalized;
    normalizedNoDash = norm.normalizedNoDash;

    if (!normalized) {
      return send(400, 'MISSING_RUT', 'Debes ingresar un RUT.');
    }

    const contactField = process.env.CONTACT_RUT_NORMALIZED_FIELD || 'RUT_normalizado';
    const dealField = process.env.DEAL_RUT_NORMALIZED_FIELD || 'RUT_normalizado';

    // Resolve Search API attribute ids
    contactSearchApiId = await resolveSearchApiId('contacts', contactField);
    dealSearchApiId = await resolveSearchApiId('deals', dealField);

    // Match mode: "both" (default) searches both 13580388-K and 13580388K to survive legacy data.
    // Set RUT_MATCH_MODE=canonical to search only the canonical format with dash.
    const matchMode = String(process.env.RUT_MATCH_MODE || 'both').toLowerCase();
    valuesToMatch =
      matchMode === 'canonical'
        ? [normalized]
        : Array.from(new Set([normalized, normalizedNoDash]));

    const contacts = await searchContactsByCustomField(contactSearchApiId, valuesToMatch, 10);
    const deals = await searchDealsByCustomField(dealSearchApiId, valuesToMatch, 100);

    contactsOut = contacts.map((c) => ({
      id: c.id,
      display_name: c.display_name,
      desktop_url: deskContactUrl(c.id),
      mobile_url: mobileContactUrl(c.id),
    }));

    dealsFoundTotal = deals.length;

    // Build deal results (even if pipelineId is not provided) so the UI can display them.
    dealsOut = [];
    if (dealsFoundTotal > 0) {
      const dealIdsAll = deals.map((d) => d.id).filter(Boolean);
      // Cap to avoid overly heavy calls if there are many matches.
      const dealIds = dealIdsAll.slice(0, 50);
      const dealDetails = await getDealsByIds(dealIds);

      // Resolve stage -> pipeline and stage names for all deals (useful for UI and pipeline duplicate checks).
      const stageIds = dealDetails.map((d) => d.stage_id).filter(Boolean);
      const stages = await getStagesByIds(stageIds);
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const pipelineIds = Array.from(new Set(stages.map((s) => s.pipeline_id).filter(Boolean)));
      const pipelines = await getPipelinesByIds(pipelineIds);
      const pipelineNameById = new Map(pipelines.map((p) => [p.id, p.name]));

      dealsOut = dealDetails.map((d) => {
        const st = stageById.get(d.stage_id);
        const pid = st ? st.pipeline_id : null;
        return {
          id: d.id,
          name: d.name,
          stage_id: d.stage_id,
          stage_name: st ? st.name : null,
          pipeline_id: pid,
          pipeline_name: pid ? (pipelineNameById.get(pid) || null) : null,
          desktop_url: deskDealUrl(d.id),
          mobile_url: mobileDealUrl(d.id),
        };
      });
    }

    // Group deals by pipeline so the UI can show: "deals encontrados por pipeline"
    // and we can detect violations: 2+ deals with same RUT within the same pipeline.
    dealsByPipeline = [];
    duplicateDealsByPipeline = [];
    if (dealsOut.length > 0) {
      const map = new Map();
      for (const d of dealsOut) {
        const pid = Number.isFinite(d.pipeline_id) ? d.pipeline_id : null;
        const key = pid === null ? 'null' : String(pid);
        if (!map.has(key)) {
          map.set(key, {
            pipeline_id: pid,
            pipeline_name: d.pipeline_name ?? null,
            deals: [],
            deal_ids: [],
            count: 0,
          });
        }
        const g = map.get(key);
        g.deals.push(d);
        g.deal_ids.push(d.id);
        g.count = g.deal_ids.length;
      }
      dealsByPipeline = Array.from(map.values()).sort((a, b) => {
        const an = (a.pipeline_name || '').toLowerCase();
        const bn = (b.pipeline_name || '').toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        const ai = a.pipeline_id || 0;
        const bi = b.pipeline_id || 0;
        return ai - bi;
      });
      // Only count duplicates where pipeline_id is known.
      duplicateDealsByPipeline = dealsByPipeline.filter((g) => Number.isFinite(g.pipeline_id) && g.count > 1);
      rules.rut_unique_in_any_pipeline = duplicateDealsByPipeline.length === 0;
    } else {
      rules.rut_unique_in_any_pipeline = true;
    }



    // Contact uniqueness
    const contactDuplicate = contacts.length > 1;
    rules.rut_unique_in_contacts = !contactDuplicate;
    // Deals in pipeline uniqueness (derive pipeline_id via stage_id)
    dealsInSamePipeline = [];
    if (Number.isFinite(pipelineId) && pipelineId > 0) {
      // dealsOut already includes pipeline_id when pipelineId is provided.
      dealsInSamePipeline = dealsOut
        .filter((d) => d.pipeline_id === pipelineId)
        .map((d) => ({
          id: d.id,
          name: d.name,
          stage_id: d.stage_id,
          stage_name: d.stage_name ?? null,
          pipeline_id: d.pipeline_id,
          pipeline_name: d.pipeline_name ?? null,
          desktop_url: d.desktop_url,
          mobile_url: d.mobile_url,
        }));

      rules.rut_unique_in_pipeline = dealsInSamePipeline.length === 0;
    } else {
      rules.rut_unique_in_pipeline = null;
    }

    // Hard-fail on duplicates
    if (contactDuplicate) {
      return send(409, 'DUPLICATE_CONTACT_RUT', 'Ya existen 2 o más contactos con el mismo RUT_normalizado.');
    }
    if (Number.isFinite(pipelineId) && pipelineId > 0 && dealsInSamePipeline.length > 0) {
      return send(
        409,
        'DUPLICATE_DEAL_RUT_IN_PIPELINE',
        'Ya existe al menos 1 deal en el mismo pipeline con este RUT_normalizado.'
      );
    }

    // Global rule (general): There must not be 2+ deals with the same RUT inside the same pipeline (any pipeline).
    if (duplicateDealsByPipeline.length > 0) {
      return send(
        409,
        'DUPLICATE_DEAL_RUT_IN_PIPELINE',
        'Ya existen 2 o más deals con este RUT dentro del mismo pipeline.'
      );
    }

    return send(200, null, null);
  } catch (err) {
    const status =
      err && (err.code === 'INVALID_RUT_DV' || err.code === 'MISSING_RUT_DV')
        ? 400
        : err && err.http_status
          ? err.http_status
          : 500;
    return send(status, err.code || 'ERROR', err.message || String(err));
  }
});


app.post('/api/create-contact', async (req, res) => {
  const dryRun = String(req.query.dry_run || '').toLowerCase() === '1' || String(req.query.dry_run || '').toLowerCase() === 'true';
  const debug = String(req.query.debug || '').toLowerCase() === '1' || String(req.query.debug || '').toLowerCase() === 'true';

  // Safety switch (unless dry-run)
  if (!dryRun && String(process.env.ALLOW_WRITE || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({
      ok: false,
      status: 403,
      error: 'WRITE_DISABLED',
      message: 'Creación deshabilitada en este entorno (ALLOW_WRITE != true).',
    });
  }

  // Always reply with stable shape
  const out = (status, error = null, message = null, extra = {}) => {
    return res.status(status).json({
      ok: status < 400,
      status,
      error,
      message,
      ...extra,
    });
  };

  try {
    const body = req.body || {};

    const rutInput = cleanValue(body.rut || body.run || body.RUN);
    const nombres = cleanValue(body.nombres || body.Nombres);
    const apellidos = cleanValue(body.apellidos || body.Apellidos);
    const fechaNacimiento = cleanValue(body.fecha_nacimiento || body.fechaNacimiento || body['Fecha de Nacimiento'] || body['Fecha Nacimiento']);
    const telefono1 = cleanValue(body.telefono1 || body.telefono_1 || body['Teléfono 1'] || body['Telefono 1'] || body.phone1);
    const telefono2 = cleanValue(body.telefono2 || body.telefono_2 || body['Teléfono 2'] || body['Telefono 2'] || body.phone2) || telefono1;
    const email = cleanValue(body.email || body.correo || body['Correo electrónico'] || body['Correo electronico']);
    const aseguradoraRaw = cleanValue(body.aseguradora || body.prevision || body['Aseguradora'] || body['Previsión'] || body['Prevision']);
    const modalidad = cleanValue(body.modalidad || body['Modalidad']);
    const direccion = cleanValue(body.direccion || body['Dirección'] || body['Direccion']);
    const comunaInput = cleanValue(body.comuna || body['Comuna']);
    const comuna = canonicalComuna(comunaInput);

    // mínimos
    if (!rutInput) return out(400, 'MISSING_RUT', 'Debes ingresar un RUN/RUT.');
    if (!nombres) return out(400, 'MISSING_FIRST_NAME', 'Faltan Nombres.');
    if (!apellidos) return out(400, 'MISSING_LAST_NAME', 'Faltan Apellidos.');
    if (!fechaNacimiento) return out(400, 'MISSING_DOB', 'Falta Fecha de Nacimiento.');
    if (!isValidDobDDMMYYYY(fechaNacimiento)) return out(400, 'INVALID_DOB_FORMAT', 'Fecha de Nacimiento inválida. Debe ser DD/MM/YYYY.');
    if (!telefono1) return out(400, 'MISSING_PHONE1', 'Falta Teléfono 1.');
    if (!email) return out(400, 'MISSING_EMAIL', 'Falta Correo electrónico.');
    if (!aseguradoraRaw) return out(400, 'MISSING_ASEGURADORA', 'Falta Aseguradora/Previsión.');
    if (!modalidad) return out(400, 'MISSING_MODALIDAD', 'Falta Modalidad.');
    if (!direccion) return out(400, 'MISSING_ADDRESS', 'Falta Dirección.');

    // Normaliza RUT
    const norm = normalizeRut(rutInput);
    const rutNoDashUpper = norm.normalizedNoDash;               // 16927228K
    const rutNoDashLower = String(rutNoDashUpper).toLowerCase(); // 16927228k  <-- CANON write
    const rutHuman = formatRutHumanFromNoDashLower(rutNoDashLower); // 16.927.228-K

    // Catálogo
    const cat = await getContactCatalog();
    const FN_RUT_NORM = mustFieldNameById(cat, 6265931); // RUT_normalizado
    const FN_RUT_HUMAN = mustFieldNameById(cat, 5883525); // RUT o ID
    const FN_DOB = mustFieldNameById(cat, 5863844); // Fecha Nacimiento
    const FN_DOB_1 = mustFieldNameById(cat, 6236073); // Fecha Nacimiento#1
    const FN_PREV_LIST = mustFieldNameById(cat, 6373567); // Previsión (list)
    const FN_PREV_STR = mustFieldNameById(cat, 5853892); // Previsión##
    const FN_PREV_1 = mustFieldNameById(cat, 6235294); // Previsión#1
    const FN_EMAIL_MIRROR = mustFieldNameById(cat, 5862966); // Correo electrónico (custom)
    const FN_PHONE_MIRROR = mustFieldNameById(cat, 5862996); // Teléfono (custom)
    const FN_CITY_MIRROR = mustFieldNameById(cat, 5862997); // Ciudad (custom)
    const FN_AGE = mustFieldNameById(cat, 6244742); // Edad

    // Previsión (canon list): match choice
    const prevKey = normKey(aseguradoraRaw);
    const choices = cat.listChoicesByFieldId.get(6373567) || new Map();
    const choice = choices.get(prevKey);
    if (!choice) {
      return out(400, 'INVALID_ASEGURADORA', `Aseguradora/Previsión inválida: "${aseguradoraRaw}". Debe ser una de las opciones del campo Previsión (list).`, {
        allowed: Array.from(choices.values()).map((c) => c.name),
      });
    }

    // Dirección compuesta (DIRECCION + COMUNA)
    const addressLine1 = comuna ? `${direccion}, ${comuna}` : direccion;

    const age = calcAgeFromDobDDMMYYYY(fechaNacimiento);

// Vista previa (para humanos): qué se intentaría guardar
const vista_previa = {
  rut_normalizado: rutNoDashLower,
  rut_o_id: rutHuman,
  nombres,
  apellidos,
  fecha_nacimiento: fechaNacimiento,
  telefono1: telefono1,
  telefono2: telefono2,
  email: email,
  aseguradora: choice.name,
  modalidad: modalidad,
  direccion: addressLine1,
  comuna: comuna || ERROR_COMUNA,
};

const detalle_tecnico = debug ? { payload: null } : undefined;

    // Anti-duplicados por RUT_normalizado
    const contactSearchApiId = await resolveSearchApiId('contacts', FN_RUT_NORM);
    const valuesToMatch = Array.from(new Set([
      rutNoDashLower,
      rutNoDashUpper,
      norm.normalized,      // legacy with dash
      norm.normalizedNoDash // legacy without dash (upper)
    ]));

    const existing = await searchContactsByCustomField(contactSearchApiId, valuesToMatch, 10);

    if (existing.length > 1) {
      return out(409, 'DUPLICATE_CONTACT_RUT', 'Este RUT ya está duplicado en Sell (hay 2 o más contactos). No se puede crear otro hasta resolverlo.', {
        rut_input: rutInput,
        rut_normalizado: rutNoDashLower,
        rut_humano: rutHuman,
            vista_previa,
            detalle_tecnico,
        contacts: existing.map((c) => ({
          id: c.id,
          display_name: c.display_name,
          desktop_url: deskContactUrl(c.id),
          mobile_url: mobileContactUrl(c.id),
        })),
      });
    }
    if (existing.length === 1) {
      const c = existing[0];
      return out(409, 'CONTACT_EXISTS', 'Ya existe un contacto con este RUT. No se creará otro.', {
        rut_input: rutInput,
        rut_normalizado: rutNoDashLower,
        rut_humano: rutHuman,
            vista_previa,
            detalle_tecnico,
        contact: {
          id: c.id,
          display_name: c.display_name,
          desktop_url: deskContactUrl(c.id),
          mobile_url: mobileContactUrl(c.id),
        },
      });
    }

    // Construir custom_fields (por NOMBRE, no por ID)
    const custom_fields = {};
    custom_fields[FN_RUT_NORM] = rutNoDashLower;  // CANON
    custom_fields[FN_RUT_HUMAN] = rutHuman;       // ESPEJO humano

    // Fecha de nacimiento (DD/MM/YYYY según tu verificación)
    custom_fields[FN_DOB] = fechaNacimiento;
    custom_fields[FN_DOB_1] = fechaNacimiento;

    // Previsión list (en v2 suele leerse como string; intentamos string y si falla, retry con objeto)
    custom_fields[FN_PREV_LIST] = choice.name;
    custom_fields[FN_PREV_STR] = choice.name;
    custom_fields[FN_PREV_1] = choice.name;

    // Espejos
    custom_fields[FN_EMAIL_MIRROR] = email;
    custom_fields[FN_PHONE_MIRROR] = telefono1;
    custom_fields[FN_CITY_MIRROR] = comuna || ERROR_COMUNA;
    if (age !== null) custom_fields[FN_AGE] = String(age);



    const payload = {
      data: {
        is_organization: false,
        first_name: nombres,
        last_name: apellidos,
        email: email,
        phone: telefono1,
        mobile: telefono2,
        address: {
          line1: addressLine1,
          city: comuna || ERROR_COMUNA,
          country: 'CL',
        },
        custom_fields,
      },
    };
    if (debug) { detalle_tecnico.payload = payload; }


    if (dryRun) {
      return out(200, null, 'DRY_RUN: payload construido (no se creó contacto).', {
        rut_input: rutInput,
        rut_normalizado: rutNoDashLower,
        rut_humano: rutHuman,
        comuna,
        payload,
      });
    }

    // Create
    try {
      const created = await createContact(payload);
      return out(201, null, 'Contacto creado.', {
        contact: {
          id: created.id,
          display_name: created.name || `${created.first_name || ''} ${created.last_name || ''}`.trim(),
          desktop_url: deskContactUrl(created.id),
          mobile_url: mobileContactUrl(created.id),
        },
        rut_normalizado: rutNoDashLower,
        rut_humano: rutHuman,
      });
    } catch (e) {
      // Retry list format as object {id,name} if Sell rejects string for list (rare, but safe)
      const msg = String(e.message || '');
      if (msg.includes('422') || msg.includes('schema_validation_failed') || msg.includes('unprocessable')) {
        payload.data.custom_fields[FN_PREV_LIST] = { id: choice.id, name: choice.name };
        const created = await createContact(payload);
        return out(201, null, 'Contacto creado.', {
          contact: {
            id: created.id,
            display_name: created.name || `${created.first_name || ''} ${created.last_name || ''}`.trim(),
            desktop_url: deskContactUrl(created.id),
            mobile_url: mobileContactUrl(created.id),
          },
          rut_normalizado: rutNoDashLower,
          rut_humano: rutHuman,
        });
      }
      throw e;
    }
  } catch (err) {
    const status =
      err && (err.code === 'INVALID_RUT_DV' || err.code === 'MISSING_RUT_DV')
        ? 400
        : err && err.http_status
          ? err.http_status
          : 500;

    return out(status, err.code || 'ERROR', err.message || String(err), {
      details: err.field_id ? { field_id: err.field_id } : undefined,
    });
  }
});


app.post('/api/create-deal', async (req, res) => {
  const dryRun = String(req.query.dry_run || '').toLowerCase() === '1' || String(req.query.dry_run || '').toLowerCase() === 'true';
  const debug = String(req.query.debug || '').toLowerCase() === '1' || String(req.query.debug || '').toLowerCase() === 'true';

  // Safety switch (unless dry-run)
  if (!dryRun && String(process.env.ALLOW_WRITE || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({
      ok: false,
      status: 403,
      error: 'WRITE_DISABLED',
      message: 'Creación deshabilitada en este entorno (ALLOW_WRITE != true).',
    });
  }

  const out = (status, error = null, message = null, extra = {}) => {
    return res.status(status).json({
      ok: status < 400,
      status,
      error,
      message,
      ...extra,
    });
  };

  try {
    const body = req.body || {};

    const contactId = Number(body.contact_id || body.contactId || body.contact?.id);
    const pipelineIdRaw = body.pipeline_id ?? body.pipelineId ?? body.pipeline_id_checked ?? body.pipelineIdChecked ?? null;
    const pipelineId = (pipelineIdRaw === null || pipelineIdRaw === undefined || pipelineIdRaw === '') ? null : Number(pipelineIdRaw);
    if (pipelineIdRaw !== null && pipelineIdRaw !== undefined && pipelineIdRaw !== '' && !Number.isFinite(pipelineId)) {
      return out(400, 'INVALID_PIPELINE_ID', 'Pipeline ID inválido (debe ser numérico).');
    }
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return out(400, 'MISSING_PIPELINE_ID', 'Debes seleccionar un pipeline_id para crear el Deal.');

    const rutInput = cleanValue(body.rut || body.run || body.RUN || body.rut_o_id || body.rut_humano);
    const nombres = cleanValue(body.nombres || body.Nombres);
    const apellidos = cleanValue(body.apellidos || body.Apellidos);
    const aseguradoraRaw = cleanValue(body.aseguradora || body.prevision || body['Aseguradora'] || body['Previsión'] || body['Prevision']);
    const modalidadRaw = cleanValue(body.modalidad || body['Modalidad'] || body['Tramo/Modalidad'] || body.tramo_modalidad);
    const comunaInput = cleanValue(body.comuna || body['Comuna']);
    const comuna = canonicalComuna(comunaInput);

    if (!Number.isFinite(contactId) || contactId <= 0) return out(400, 'MISSING_CONTACT_ID', 'Falta contact_id para asociar el Deal.');
    if (!rutInput) return out(400, 'MISSING_RUT', 'Debes ingresar un RUN/RUT.');
    if (!aseguradoraRaw) return out(400, 'MISSING_ASEGURADORA', 'Falta Aseguradora/Previsión.');

    const norm = normalizeRut(rutInput);
    const rutNoDashUpper = norm.normalizedNoDash;
    const rutNoDashLower = String(rutNoDashUpper).toLowerCase();
    const rutHuman = formatRutHumanFromNoDashLower(rutNoDashLower);

    // Deal catalog
    const dcat = await getDealCatalog();

    // Canonical required fields (by ID)
    const DF_RUT_NORM = mustFieldNameById(dcat, 2759433); // RUT_normalizado (deal)
    const DF_PREV_LIST = mustFieldNameById(dcat, 2761582); // Previsión (deal, list)

    // Optional: modalidad / comuna (by name match)
    const DF_MODALIDAD = findDealFieldNameByNorm(dcat, [
      normKey('Modalidad'),
      normKey('Tramo/Modalidad'),
      normKey('Tramo Modalidad'),
    ]);
    const DF_COMUNA = findDealFieldNameByNorm(dcat, [
      normKey('Comuna'),
      normKey('Ciudad'),
    ]);

    // Match previsión choice
    const prevKey = normKey(aseguradoraRaw);
    const dChoices = dcat.listChoicesByFieldId.get(2761582) || new Map();
    const dChoice = dChoices.get(prevKey);
    if (!dChoice) {
      return out(400, 'INVALID_ASEGURADORA', `Aseguradora/Previsión inválida para Deal: "${aseguradoraRaw}".`, {
        allowed: Array.from(dChoices.values()).map((c) => c.name),
      });
    }

    const custom_fields = {};
    custom_fields[DF_RUT_NORM] = rutNoDashLower;
    custom_fields[DF_PREV_LIST] = dChoice.name;
    if (DF_MODALIDAD && modalidadRaw) custom_fields[DF_MODALIDAD] = modalidadRaw;
    if (DF_COMUNA && comuna) custom_fields[DF_COMUNA] = comuna;

    const dealName = cleanValue(body.deal_name) || `BOX - ${[nombres, apellidos].filter(Boolean).join(' ')}`.trim() || `BOX - ${rutHuman}`;

    const vista_previa = {
      deal_name: dealName,
      contact_id: contactId,
      rut_normalizado: rutNoDashLower,
      rut_humano: rutHuman,
      aseguradora: dChoice.name,
      modalidad: modalidadRaw || null,
      comuna: comuna || ERROR_COMUNA,
      custom_fields,
    };

    const detalle_tecnico = debug ? { payload: null } : undefined;

    // Anti-duplicados por RUT_normalizado en deals (por pipeline)
    // Regla: no puede existir 2 deals con el mismo RUT_normalizado dentro del mismo pipeline.
    const dealSearchApiId = await resolveSearchApiId('deals', DF_RUT_NORM);
    const valuesToMatch = Array.from(new Set([
      rutNoDashLower,
      rutNoDashUpper,
      norm.normalized,
      norm.normalizedNoDash
    ]));
    const existingDeals = await searchDealsByCustomField(dealSearchApiId, valuesToMatch, 100);

    let dealsSamePipeline = [];
    if (existingDeals.length > 0 && Number.isFinite(pipelineId) && pipelineId > 0) {
      // Derivar pipeline por stage_id
      const dealIds = existingDeals.map((d) => d.id).filter(Boolean).slice(0, 50);
      const dealDetails = await getDealsByIds(dealIds);
      const stageIds = dealDetails.map((d) => d.stage_id).filter(Boolean);
      const stages = await getStagesByIds(stageIds);
      const stageById = new Map(stages.map((s) => [s.id, s]));
      dealsSamePipeline = dealDetails
        .filter((d) => {
          const st = stageById.get(d.stage_id);
          return st && st.pipeline_id === pipelineId;
        })
        .map((d) => ({
          id: d.id,
          name: d.name,
          contact_id: d.contact_id,
          stage_id: d.stage_id,
          desktop_url: deskDealUrl(d.id),
          mobile_url: mobileDealUrl(d.id),
        }));
    } else if (existingDeals.length > 0 && !Number.isFinite(pipelineId)) {
      // Sin pipeline no podemos aplicar la regla por pipeline => avisamos
      // (pero NO bloqueamos aquí, solo dejamos warning y dejamos que se cree según el stage seleccionado)
    }

    if (dealsSamePipeline.length > 0) {
      return out(409, 'DEAL_EXISTS_IN_PIPELINE',
        '🚨 Revisar y Trabajar Zendesk Sell 🚨 Ya existe al menos 1 deal en el mismo pipeline con este RUT_normalizado. No se creará otro.',
        {
          rut_input: rutInput,
          pipeline_id: pipelineId,
          rut_normalizado: rutNoDashLower,
          rut_humano: rutHuman,
          vista_previa,
          detalle_tecnico,
          warning_banner: '🚨 Revisar y Trabajar Zendesk Sell 🚨',
          deals: dealsSamePipeline,
        }
      );
    }

    // Determinar stage_id para creación (stage define el pipeline)
    let stageId = null;
    if (Number.isFinite(pipelineId) && pipelineId > 0) {
      if (pipelineId === 1290779) {
        stageId = 10693252; // Bariátrica - CANDIDATO
      } else {
        // Mapping opcional por env: STAGE_BY_PIPELINE="4823817:12345,4959507:67890"
        const mapStr = String(process.env.STAGE_BY_PIPELINE || '');
        const pairs = mapStr.split(',').map((s) => s.trim()).filter(Boolean);
        for (const pair of pairs) {
          const [pid, sid] = pair.split(':').map((x) => String(x).trim());
          if (Number(pid) === pipelineId && sid) stageId = Number(sid);
        }
        if (!stageId) {
          stageId = await getFirstStageIdForPipeline(pipelineId);
        }
      }
    }

    const payload = { data: { name: dealName, contact_id: contactId, custom_fields, ...(stageId ? { stage_id: stageId } : {}) } };
    if (debug) detalle_tecnico.payload = payload;

    if (dryRun) {
      return out(200, null, 'Vista previa de Deal (dry_run).', { vista_previa, detalle_tecnico });
    }

    try {

      // --- DRY RUN (vista previa) ---
      if (dryRun) {
        const preview = {
          contact_id: contactId,
          pipeline_id: pipelineId,
          pipeline_name: pipelineName || null,
          stage_id: stageId,
          name: dealName,
          currency: currency || null,
          value: value || null,
          rut_normalizado,
          custom_fields: dealCustomFields
        };

        return out(200, {
          ok: true,
          message: "Vista previa de Deal (dry_run).",
          preview
        });
      }

      const created = await createDeal(payload);
      return out(201, null, 'Deal creado.', {
        deal: {
          id: created.id,
          name: created.name || dealName,
          desktop_url: deskDealUrl(created.id),
          mobile_url: mobileDealUrl(created.id),
        },
        contact_id: contactId,
        rut_normalizado: rutNoDashLower,
        rut_humano: rutHuman,
      });
    } catch (e) {
      // If list format rejected, retry with {id,name}
      const msg = String(e.message || '');
      if (msg.includes('422') || msg.includes('schema_validation_failed') || msg.includes('unprocessable')) {
        payload.data.custom_fields[DF_PREV_LIST] = { id: dChoice.id, name: dChoice.name };
        const created = await createDeal(payload);
        return out(201, null, 'Deal creado.', {
          deal: {
            id: created.id,
            name: created.name || dealName,
            desktop_url: deskDealUrl(created.id),
            mobile_url: mobileDealUrl(created.id),
          },
          contact_id: contactId,
          rut_normalizado: rutNoDashLower,
          rut_humano: rutHuman,
        });
      }
      throw e;
    }
  } catch (err) {
    const status =
      err && (err.code === 'INVALID_RUT_DV' || err.code === 'MISSING_RUT_DV')
        ? 400
        : err && err.http_status
          ? err.http_status
          : 500;

    return res.status(status).json({
      ok: false,
      status,
      error: err.code || 'ERROR',
      message: err.message || String(err),
      details: err.field_id ? { field_id: err.field_id } : undefined,
    });
  }
});



const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portal listo en :${port}`));
