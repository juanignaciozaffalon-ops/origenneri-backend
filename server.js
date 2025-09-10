// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config(); // lee .env

const app = express();
app.use(cors());
app.use(express.json());

// ====== Mailer (Gmail) ======
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // origenneri@gmail.com
    pass: process.env.EMAIL_PASS, // contraseña de app
  },
});

// Helper para enviar mail (si EMAIL_TO no está, no hace nada)
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

// ====== Verificación de token MP ======
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("ERROR: Falta MP_ACCESS_TOKEN en .env");
  process.exit(1);
}

// ====== Health ======
app.get("/health", (req, res) => res.json({ ok: true }));

// ====== Crear preferencia (soporta 1 o varios ítems) ======
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // 1) Armar items (multi o viejo formato)
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

    // 2) Metadata útil (para que llegue al webhook)
    const buyer = body.buyer || body;
    const metadata = {
      first_name: buyer.first_name || "",
      last_name: buyer.last_name || "",
      dni: buyer.dni || "",
      phone: buyer.phone || "",
      email: buyer.email || "",
      address: buyer.address || "",
      pack: body.pack || "",
      note: body.note || "",
      items, // guardo también el detalle elegido
    };

    // 3) Crear preferencia en MP
    const pref = {
      items,
      metadata,
      back_urls: {
        success: "https://origenneri1.odoo.com",
        pending: "https://origenneri1.odoo.com",
        failure: "https://origenneri1.odoo.com",
      },
      auto_return: "approved",
      notification_url:
        process.env.MP_WEBHOOK_URL ||
        "https://origenneri-backend.onrender.com/api/mp/webhook",
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pref),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Mercado Pago error:", data);
      return res
        .status(400)
        .json({ error: data?.message || "No se pudo crear preferencia" });
    }

    // (Opcional) avisar por mail que se creó la preferencia
    await notify(
      "Preferencia creada",
      `<h2>Preferencia creada</h2>
       <p>Detalle:</p>
       <pre>${JSON.stringify({ items, metadata }, null, 2)}</pre>`
    );

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

// ====== Webhook de Mercado Pago ======
app.post("/api/mp/webhook", async (req, res) => {
  try {
    // Log breve para que sepas que llegó (sin spam de JSON gigante)
    const topic = req.body?.topic || req.body?.type;
    const id = req.body?.data?.id || req.body?.id || "";
    console.log("Webhook:", topic || "?", id || "");

    // No enviamos correo desde el webhook
    res.sendStatus(200);
  } catch (e) {
    console.error("Error en webhook:", e);
    // Igual devolvemos 200 para que MP no reintente
    res.sendStatus(200);
  }
});
