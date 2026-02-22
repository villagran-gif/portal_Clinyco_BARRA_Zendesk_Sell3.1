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
  try {
    const rutInput = (req.body && req.body.rut) || '';
    const pipelineIdRaw = (req.body && req.body.pipelineId) ?? null;
    const pipelineId = pipelineIdRaw === null || pipelineIdRaw === undefined || pipelineIdRaw === '' ? null : Number(pipelineIdRaw);

    const { normalized, normalizedNoDash } = normalizeRut(rutInput);

    const contactField = process.env.CONTACT_RUT_NORMALIZED_FIELD || 'RUT_normalizado';
    const dealField = process.env.DEAL_RUT_NORMALIZED_FIELD || 'RUT_normalizado';

    // Resolve Search API attribute ids
    const contactSearchApiId = await resolveSearchApiId('contacts', contactField);
    const dealSearchApiId = await resolveSearchApiId('deals', dealField);

    // Search (only by normalized rut variants)
    const valuesToMatch = Array.from(new Set([normalized, normalizedNoDash]));

    const contacts = await searchContactsByCustomField(contactSearchApiId, valuesToMatch, 10);
    const deals = await searchDealsByCustomField(dealSearchApiId, valuesToMatch, 100);

    // Contact uniqueness
    const contactDuplicate = contacts.length > 1;

    // Deals in pipeline uniqueness (derive pipeline_id via stage_id)
    let dealsInSamePipeline = [];
    if (pipelineId && Number.isFinite(pipelineId)) {
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
    }

    const out = {
      rut_input: rutInput,
      rut_normalized: normalized,
      rut_normalized_no_dash: normalizedNoDash,
      used_match_values: valuesToMatch,
      contact_custom_field_search_api_id: contactSearchApiId,
      deal_custom_field_search_api_id: dealSearchApiId,
      contacts: contacts.map((c) => ({
        id: c.id,
        display_name: c.display_name,
        desktop_url: deskContactUrl(c.id),
        mobile_url: mobileContactUrl(c.id),
      })),
      deals_found_total: deals.length,
      pipeline_id_checked: pipelineId,
      deals_in_same_pipeline: dealsInSamePipeline,
      rules: {
        rut_unique_in_contacts: !contactDuplicate,
        rut_unique_in_pipeline: pipelineId ? dealsInSamePipeline.length === 0 : null,
      },
    };

    // If you want the API to hard-fail on duplicates, return 409.
    if (contactDuplicate) {
      return res.status(409).json({
        error: 'DUPLICATE_CONTACT_RUT',
        message: 'Ya existen 2 o más contactos con el mismo RUT_normalizado.',
        ...out,
      });
    }
    if (pipelineId && dealsInSamePipeline.length > 0) {
      return res.status(409).json({
        error: 'DUPLICATE_DEAL_RUT_IN_PIPELINE',
        message: 'Ya existe al menos 1 deal en el mismo pipeline con este RUT_normalizado.',
        ...out,
      });
    }

    return res.json(out);
  } catch (err) {
    const status = err && err.code === 'INVALID_RUT_DV' ? 400 : (err && err.http_status) ? err.http_status : 500;
    return res.status(status).json({
      error: err.code || 'ERROR',
      message: err.message || String(err),
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portal listo en :${port}`));
