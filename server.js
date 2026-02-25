const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SELL_ACCESS_TOKEN = process.env.SELL_ACCESS_TOKEN;
const SELL_USER_AGENT = process.env.SELL_USER_AGENT || "ClinycoPortal/1.0";
const ALLOW_WRITE = process.env.ALLOW_WRITE === "true";

async function sellRequest(method, path, body = null) {
  const response = await fetch(`https://api.getbase.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SELL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": SELL_USER_AGENT,
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let parsed;

  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from Zendesk (HTTP ${response.status}): ${text}`);
  }

  if (!response.ok) {
    const errorMessage = parsed?.error || parsed?.errors?.[0]?.message || "Zendesk request failed";
    throw new Error(`Zendesk HTTP ${response.status}: ${errorMessage}`);
  }

  return parsed;
}

function normalizeRutDigits(rut) {
  return String(rut || "").replace(/[^0-9]/g, "");
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "BOX.AI_Clinyco" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/create-deal", async (req, res) => {
  try {
    const dryRun = req.query.dry_run === "1";

    const pipelineId = Number(req.body.pipeline_id);
    const ownerId = Number(req.body.owner_id);
    const contactId = Number(req.body.contact_id);

    if (!pipelineId) {
      return res.status(400).json({ ok: false, error: "MISSING_PIPELINE" });
    }

    if (!ownerId) {
      return res.status(400).json({ ok: false, error: "MISSING_OWNER_ID" });
    }

    if (!contactId) {
      return res.status(400).json({ ok: false, error: "MISSING_CONTACT_ID" });
    }

    let imcStr = null;
    let edadStr = null;
    let whatsappLink = null;

    const peso = parseFloat((req.body.peso || "").replace(",", "."));
    const estatura = parseFloat((req.body.estatura || "").replace(",", "."));

    if (!Number.isNaN(peso) && !Number.isNaN(estatura) && estatura > 0) {
      const imc = peso / (estatura * estatura);
      imcStr = imc.toFixed(2);
    }

    if (req.body.fecha_nacimiento) {
      const parts = String(req.body.fecha_nacimiento).split("/");
      if (parts.length === 3) {
        const birth = new Date(parts[2], parts[1] - 1, parts[0]);
        const today = new Date();

        let edad = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) edad -= 1;

        edadStr = String(edad);
      }
    }

    if (req.body.telefono) {
      const clean = String(req.body.telefono).replace(/\D/g, "");
      if (clean) whatsappLink = `https://wa.me/${clean}`;
    }

    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        preview: {
          imc: imcStr,
          edad: edadStr,
          whatsapp: whatsappLink
        }
      });
    }

    if (!ALLOW_WRITE) {
      return res.json({ ok: false, message: "ALLOW_WRITE disabled" });
    }

    const dealPayload = {
      name: `Trato ${normalizeRutDigits(req.body.rut_normalizado) || ""}`,
      contact_id: contactId,
      owner_id: ownerId,
      pipeline_id: pipelineId,
      custom_fields: {
        IMC: imcStr,
        Edad: edadStr,
        WhatsApp_Contactar_LINK: whatsappLink
      }
    };

    const response = await sellRequest("POST", "/v2/deals", dealPayload);

    return res.json({
      ok: true,
      deal: response
    });
  } catch (err) {
    console.error("CREATE DEAL ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
