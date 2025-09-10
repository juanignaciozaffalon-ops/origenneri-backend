// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config(); // lee variables de .env

const app = express();
app.use(cors());
app.use(express.json());

// Token MP
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("❌ ERROR: Falta MP_ACCESS_TOKEN en .env");
  process.exit(1);
}

// Configuración del mailer
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Función para enviar correo
async function notify(subject, html) {
  if (!process.env.EMAIL_TO) return;
  try {
    await mailer.sendMail({
      from: `"Origen Neri" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject,
      html,
    });
    console.log("📧 Email enviado OK");
  } catch (err) {
    console.error("❌ Error enviando email:", err);
  }
}

// Endpoint de prueba
app.get("/health", (req, res) => res.json({ ok: true }));

// Crear preferencia
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // Soportar multi-items o un solo item
    let items = [];
    if (Array.isArray(body.items) && body.items.length) {
      items = body.items.map((it) => ({
        title: String(it.title || "Producto Origen Neri"),
        quantity: Number(it.quantity || 1),
        currency_id: "ARS",
        unit_price: Number(it.unit_price || 0),
      }));
    } else {
      items = [
        {
          title: body.title || "Compra Origen Neri",
          quantity: Number(body.quantity || 1),
          currency_id: "ARS",
          unit_price: Number(body.unit_price || 0),
        },
      ];
    }

    const metadata = {
      first_name: body.first_name || "",
      last_name: body.last_name || "",
      dni: body.dni || "",
      phone: body.phone || "",
      email: body.email || "",
      address: body.address || "",
      note: body.note || "",
    };

    const pref = {
      items,
      metadata,
      back_urls: {
        success: "https://origenneri1.odoo.com",
        pending: "https://origenneri1.odoo.com",
        failure: "https://origenneri1.odoo.com",
      },
      auto_return: "approved",
      notification_url: process.env.MP_WEBHOOK_URL, // tu webhook en Render
    };

    const r = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pref),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      console.error("❌ MP error:", data);
      return res.status(500).json({ error: "No se pudo crear preferencia MP" });
    }

    // Aviso de creación de preferencia (opcional, podés sacarlo si querés menos mails)
    await notify("Preferencia creada", `<pre>${JSON.stringify(pref, null, 2)}</pre>`);

    res.json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// Webhook de Mercado Pago (solo manda email de la venta)
app.post("/api/mp/webhook", async (req, res) => {
  try {
    console.log("🔔 Webhook recibido:", JSON.stringify(req.body, null, 2));

    // Mandar email solo cuando llega la data de la orden
    if (req.body && req.body.data) {
      await notify(
        "Nueva compra recibida",
        `<h2>Nueva compra</h2><pre>${JSON.stringify(req.body.data, null, 2)}</pre>`
      );
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Error en webhook:", e);
    res.sendStatus(500);
  }
});

// Levantar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor MP escuchando en http://localhost:${PORT}`);
});
