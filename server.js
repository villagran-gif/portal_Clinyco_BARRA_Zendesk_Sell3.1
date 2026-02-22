const path = require('path');
const express = require('express');

const { normalizeRut } = require('./lib/rut');
const {
  resolveSearchApiId,
  searchContactsByCustomField,
  searchDealsByCustomField,
  getDealsByIds,
  getStagesByIds,
} = require('./lib/sell');

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
  let dealsInSamePipeline = [];

  const rules = {
    rut_unique_in_contacts: null,
    rut_unique_in_pipeline: null,
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
      contact: contactsOut.length ? contactsOut[0] : null,
      deals_found_total: dealsFoundTotal,
      pipeline_id_checked: Number.isFinite(pipelineId) ? pipelineId : null,
      deals_in_same_pipeline: dealsInSamePipeline,
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

    // Contact uniqueness
    const contactDuplicate = contacts.length > 1;
    rules.rut_unique_in_contacts = !contactDuplicate;

    // Deals in pipeline uniqueness (derive pipeline_id via stage_id)
    dealsInSamePipeline = [];
    if (Number.isFinite(pipelineId) && pipelineId > 0) {
      const dealIds = deals.map((d) => d.id).filter(Boolean);
      const dealDetails = await getDealsByIds(dealIds);
      const stageIds = dealDetails.map((d) => d.stage_id).filter(Boolean);
      const stages = await getStagesByIds(stageIds);
      const stageToPipeline = new Map(stages.map((s) => [s.id, s.pipeline_id]));

      dealsInSamePipeline = dealDetails
        .filter((d) => stageToPipeline.get(d.stage_id) === pipelineId)
        .map((d) => ({
          id: d.id,
          name: d.name,
          stage_id: d.stage_id,
          desktop_url: deskDealUrl(d.id),
          mobile_url: mobileDealUrl(d.id),
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portal listo en :${port}`));
