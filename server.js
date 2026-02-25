app.post('/api/create-deal', async (req, res) => {
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

    // =========================
    // CALCULOS SEGUROS (SIN TDZ)
    // =========================

    let imcStr = null;
    let edadStr = null;
    let imcClasificacion = null;
    let whatsappLink = null;
    let fechaIngresaFormulario = new Date().toISOString().slice(0, 10);

    // IMC
    const peso = parseFloat((req.body.peso || "").replace(",", "."));
    const estatura = parseFloat((req.body.estatura || "").replace(",", "."));

    if (!isNaN(peso) && !isNaN(estatura) && estatura > 0) {
      const imc = peso / (estatura * estatura);
      imcStr = imc.toFixed(2);

      if (imc < 18.5) imcClasificacion = "Bajo peso";
      else if (imc < 25) imcClasificacion = "Normal";
      else if (imc < 30) imcClasificacion = "Sobrepeso";
      else imcClasificacion = "Obesidad";
    }

    // EDAD
    if (req.body.fecha_nacimiento) {
      const parts = req.body.fecha_nacimiento.split("/");
      if (parts.length === 3) {
        const birthDate = new Date(parts[2], parts[1] - 1, parts[0]);
        const today = new Date();

        let edad = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();

        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          edad--;
        }

        edadStr = edad.toString();
      }
    }

    // WhatsApp
    if (req.body.telefono) {
      const phoneClean = req.body.telefono.replace(/\D/g, "");
      whatsappLink = `https://wa.me/${phoneClean}`;
    }

    // =========================
    // DRY RUN
    // =========================

    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        preview: {
          peso,
          estatura,
          imc: imcStr,
          imc_clasificacion: imcClasificacion,
          edad: edadStr,
          whatsapp: whatsappLink,
          fecha_ingresa_formulario: fechaIngresaFormulario
        }
      });
    }

    // =========================
    // STAGE CANDIDATO BARIATRICA
    // =========================

    let stageId = null;

    if (pipelineId === 1290779 || pipelineId === 290779) {
      stageId = 10693252;
    }

    // =========================
    // PAYLOAD LIMPIO SELL v2
    // =========================

    const dealPayload = {
      name: `Trato ${req.body.rut_normalizado || ""}`,
      contact_id: contactId,
      owner_id: ownerId,
      pipeline_id: pipelineId,
      ...(stageId ? { stage_id: stageId } : {}),
      custom_fields: {
        Peso: peso ? peso.toString() : null,
        Estatura: estatura ? estatura.toString() : null,
        IMC: imcStr,
        Edad: edadStr,
        WhatsApp_Contactar_LINK: whatsappLink,
        "Fecha Ingresa Formulario": fechaIngresaFormulario,
        "Validacion PAD": req.body.validacion_pad || null,
        "Numero familia paciente": req.body.numero_familia_paciente || null,
        SUCURSAL: req.body.sucursal || null,
        "Cirugías Previas": req.body.cirugias_previas || null,
        Colaborador1: req.body.colaborador1 || null,
        Colaborador2: req.body.colaborador2 || null,
        Colaborador3: req.body.colaborador3 || null
      }
    };

    const response = await sellRequest("POST", "/v2/deals", dealPayload);

    return res.json({
      ok: true,
      deal: response.data
    });

  } catch (err) {
    console.error("CREATE DEAL ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "ERROR",
      message: err.message
    });
  }
});
