// ==============================
// IMPORTS
// ==============================

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

// ==============================
// APP INIT (ANTES DE ROUTES)
// ==============================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================
// ENV
// ==============================

const SELL_ACCESS_TOKEN = process.env.SELL_ACCESS_TOKEN;
const ALLOW_WRITE = process.env.ALLOW_WRITE === "true";

// ==============================
// HELPER SELL REQUEST
// ==============================

async function sellRequest(method, path, body = null) {
  const response = await fetch(`https://api.getbase.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${SELL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from Zendesk: " + text);
  }
}

// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.json({ ok: true, service: "BOX.AI_Clinyco" });
});

// ==============================
// CREATE DEAL (FIXED VERSION)
// ==============================

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

    // ======================
    // SAFE CALCULATIONS
    // ======================

    let imcStr = null;
    let edadStr = null;
    let whatsappLink = null;

    const peso = parseFloat((req.body.peso || "").replace(",", "."));
    const estatura = parseFloat((req.body.estatura || "").replace(",", "."));

    if (!isNaN(peso) && !isNaN(estatura) && estatura > 0) {
      const imc = peso / (estatura * estatura);
      imcStr = imc.toFixed(2);
    }

    if (req.body.fecha_nacimiento) {
      const parts = req.body.fecha_nacimiento.split("/");
      if (parts.length === 3) {
        const birth = new Date(parts[2], parts[1] - 1, parts[0]);
        const today = new Date();

        let edad = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) edad--;

        edadStr = edad.toString();
      }
    }

    if (req.body.telefono) {
      const clean = req.body.telefono.replace(/\D/g, "");
      whatsappLink = `https://wa.me/${clean}`;
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
      name: `Trato ${req.body.rut_normalizado || ""}`,
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

// ==============================
// START SERVER (AL FINAL)
// ==============================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
