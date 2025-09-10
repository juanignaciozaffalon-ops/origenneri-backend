// server.js (ESM)
import express from "express";
import cors from "cors";
import "dotenv/config";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());

// ======= MP token
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("ERROR: falta MP_ACCESS_TOKEN");
  process.exit(1);
}

// ======= Mailer (Gmail app password)
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
async function notify(to, subject, html) {
  if (!to) return;
  try {
    await mailer.sendMail({
      from: `Origen Neri <${process.env.EMAIL_USER}>`,
      to,
      cc: process.env.EMAIL_TO, // copia al admin siempre
      subject,
      html,
    });
    console.log("Email enviado OK ->", to);
  } catch (e) {
    console.error("Error enviando email:", e?.message || e);
  }
}

// ======= Util
const ORIGIN = "https://originneri.com";
const BACKEND_URL = "https://origenn eri-backend.onrender.com".replace(" ", "");

// ======= Pref de prueba
app.get("/health", (req, res) => res.json({ ok: true }));

// ======= Crear preferencia
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // Items (solo los que tengan cantidad)
    let items = [];
    if (Array.isArray(body.items)) {
      items = body.items
        .filter(it => Number(it?.quantity) > 0)
        .map(it => ({
          title: String(it.title || "Producto Origen Neri"),
          quantity: Number(it.quantity || 1),
          currency_id: "ARS",
          unit_price: Number(it.unit_price || 0),
        }));
    }
    if (!items.length) {
      return res.status(400).json({ error: "Sin items" });
    }

    // Buyer metadata (para el email)
    const buyer = body.buyer || {};
    const metadata = {
      first_name: buyer.first_name || "",
      last_name: buyer.last_name || "",
      dni: buyer.dni || "",
      phone: buyer.phone || "",
      email: buyer.email || "",
      address: buyer.address || "",
      note: body.note || "",
    };

    const preference = {
      items,
      metadata,
      back_urls: {
        success: `${ORIGIN}/?compra=aprobada`,
        pending: `${ORIGIN}/?compra=pendiente`,
        failure: `${ORIGIN}/?compra=falla`,
      },
      auto_return: "approved",
      notification_url: `${BACKEND_URL}/api/mp/webhook`,
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preference),
    });
    const data = await r.json();
    if (!r.ok || !data?.init_point) {
      console.error("Error MP pref:", data);
      return res.status(400).json({ error: "Mercado Pago rechazó la preferencia" });
    }

    res.json({
      id: data.id,
      init_point: data.init_point,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// ======= Webhook: enviamos UN email cuando la orden está cerrada (pagada)
const alreadyNotified = new Set();

app.post("/api/mp/webhook", async (req, res) => {
  try {
    // Mercado Pago envía {action, resource, topic, ...}
    const { resource, topic, id } = req.body || {};

    // Aceptamos tanto resource como id
    let moUrl = resource;
    if (!moUrl && topic === "merchant_order" && id) {
      moUrl = `https://api.mercadopago.com/merchant_orders/${id}`;
    }
    if (!moUrl) {
      res.sendStatus(200);
      return;
    }

    // Buscamos la merchant_order
    const mor = await fetch(moUrl, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const order = await mor.json();

    // Evitamos duplicados
    const key = String(order.id || id || moUrl);
    if (alreadyNotified.has(key)) {
      res.sendStatus(200);
      return;
    }

    // Sólo cuando está "closed" (pagada)
    if (order.status !== "closed") {
      res.sendStatus(200);
      return;
    }

    // Intentamos encontrar email del comprador desde el pago aprobado
    let buyerEmail = "";
    try {
      const approved = Array.isArray(order.payments)
        ? order.payments.find(p => p.status === "approved")
        : null;
      if (approved?.id) {
        const pr = await fetch(`https://api.mercadopago.com/v1/payments/${approved.id}`, {
          headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        });
        const pay = await pr.json();
        buyerEmail = pay?.payer?.email || "";
      }
    } catch {}

    // Armamos HTML de resumen
    const itemsHtml = (order.items || [])
      .map(it => `<li>${it.title} — x${it.quantity} ($${it.unit_price})</li>`)
      .join("");

    const totalStr = typeof order.total_amount === "number"
      ? order.total_amount.toLocaleString("es-AR")
      : "-";

    const buyerBlock = `
      <p><strong>Comprador</strong><br>
      ${order?.payer?.first_name || ""} ${order?.payer?.last_name || ""}<br>
      ${buyerEmail || "sin email"}</p>`;

    const html = `
      <h2>✅ Nueva compra aprobada</h2>
      ${buyerBlock}
      <p><strong>Orden:</strong> ${order.id}</p>
      <ul>${itemsHtml}</ul>
      <p><strong>Total cobrado:</strong> $${totalStr}</p>
    `;

    // Enviamos: al admin (EMAIL_TO) y, si tenemos, al comprador
    await notify(process.env.EMAIL_TO, "Nueva compra Origen Neri", html);
    if (buyerEmail) {
      await notify(buyerEmail, "Gracias por tu compra — Origen Neri", `
        <h2>¡Gracias por tu compra!</h2>
        <p>Tu pago fue aprobado. En breve alguien del equipo se contactará para coordinar el envío.</p>
        ${html}
      `);
    }

    alreadyNotified.add(key);
    res.sendStatus(200);
  } catch (e) {
    console.error("Error webhook:", e?.message || e);
    res.sendStatus(200); // siempre 200 para que MP no reintente infinito
  }
});

// ======= Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor MP escuchando en http://localhost:${PORT}`);
});
