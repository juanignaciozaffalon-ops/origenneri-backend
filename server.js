// server.js (ESM)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// === ENV obligatorios
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("ERROR: Falta MP_ACCESS_TOKEN en variables de entorno");
  process.exit(1);
}

// === Mail (Gmail - App Password)
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendMail(subject, html) {
  if (!process.env.EMAIL_TO) return;
  try {
    await mailer.sendMail({
      from: `"Origen Neri" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject,
      html
    });
    console.log("✅ Email enviado OK");
  } catch (err) {
    console.error("❌ Error enviando email:", err);
  }
}

// === Health
app.get("/health", (_, res) => res.json({ ok: true }));

// === Crear preferencia de MP (acepta 1 ítem o varios)
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // 1) Items
    let items = [];
    if (Array.isArray(body.items) && body.items.length) {
      items = body.items.map(it => ({
        title: String(it.title || "Producto Origen Neri"),
        quantity: Number(it.quantity || 1),
        currency_id: "ARS",
        unit_price: Number(it.unit_price || 0)
      }));
    } else {
      items = [{
        title: body.title || "Compra Origen Neri",
        quantity: Number(body.quantity || 1),
        currency_id: "ARS",
        unit_price: Number(body.unit_price || 0)
      }];
    }

    // 2) Metadata con datos del comprador
    const buyer = body.buyer || body;
    const metadata = {
      first_name: buyer.first_name || "",
      last_name:  buyer.last_name  || "",
      dni:        buyer.dni        || "",
      phone:      buyer.phone      || "",
      email:      buyer.email      || "",
      address:    buyer.address    || "",
      note:       body.note        || ""
    };

    // 3) Preferencia
    const preference = {
      items,
      metadata,
      back_urls: {
        success: "https://origenneri.com/?compra=aprobada",
        pending: "https://origenneri.com/?compra=pendiente",
        failure: "https://origenneri.com/?compra=falla"
      },
      auto_return: "approved",
      notification_url: process.env.MP_WEBHOOK_URL || "https://origenneri-backend.onrender.com/api/mp/webhook"
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Mercado Pago error:", data);
      return res.status(400).json({ error: "No se pudo crear la preferencia" });
    }

    // 👉 NO enviamos mail acá (evitamos “Preferencia creada”)
    res.json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// === Webhook: un SOLO mail cuando la order está cerrada (pagada)
app.post("/api/mp/webhook", async (req, res) => {
  try {
    const topic    = req.body?.topic    || req.query?.topic;
    const resource = req.body?.resource || req.query?.resource;

    console.log("Webhook recibido:", { topic, resource });

    // Solo merchant_order trae el status de la orden
    if (topic === "merchant_order" && resource) {
      // 1) Cargar merchant_order completa
      const rOrder = await fetch(resource, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const order = await rOrder.json();

      // 2) Disparamos mail SOLO cuando esté cerrada (pagada)
      if (order?.status === "closed") {
        const prefId = order.preference_id;

        // 3) Traer la preferencia para obtener items + metadata originales
        let meta = {};
        let items = [];
        if (prefId) {
          const rPref = await fetch(`https://api.mercadopago.com/checkout/preferences/${prefId}`, {
            headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
          });
          const pref = await rPref.json();
          meta  = pref?.metadata || {};
          items = pref?.items    || [];
        }

        // 4) Armar mail
        const total = items.reduce((acc, it) =>
          acc + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0);

        const itemsHtml = items.map(it =>
          `<li>${it.title} — x${it.quantity} @ $${Number(it.unit_price).toLocaleString("es-AR")}</li>`
        ).join("");

        const buyerHtml = `
          <ul>
            <li><b>Nombre:</b> ${meta.first_name || ""} ${meta.last_name || ""}</li>
            <li><b>DNI:</b> ${meta.dni || ""}</li>
            <li><b>Tel:</b> ${meta.phone || ""}</li>
            <li><b>Email:</b> ${meta.email || ""}</li>
            <li><b>Dirección:</b> ${meta.address || ""}</li>
            <li><b>Nota:</b> ${meta.note || ""}</li>
          </ul>
        `;

        const html = `
          <h2>Nueva compra recibida</h2>
          <h3>Cliente</h3>
          ${buyerHtml}
          <h3>Pedido</h3>
          <ul>${itemsHtml}</ul>
          <p><b>Total:</b> $${total.toLocaleString("es-AR")}</p>
          <p><b>Preference ID:</b> ${prefId || "-"}</p>
          <p><b>Merchant Order ID:</b> ${order.id || "-"}</p>
        `;

        await sendMail("Nueva compra recibida", html);
      }
    }

    // MP necesita 200 siempre (si no, reintenta)
    res.sendStatus(200);
  } catch (e) {
    console.error("Error en webhook:", e);
    res.sendStatus(200);
  }
});

// === Arranque
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor MP escuchando en http://localhost:${PORT}`);
});
