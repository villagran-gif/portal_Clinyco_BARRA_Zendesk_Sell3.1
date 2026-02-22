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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portal listo en :${port}`));
