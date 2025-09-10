// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ====== ENV ======
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_URL  = process.env.MP_WEBHOOK_URL; // https://origenneri-backend.onrender.com/api/mp/webhook
const FRONT_BASE_URL  = process.env.FRONT_BASE_URL || "https://origenneri.com";
const PORT = process.env.PORT || 3001;

if (!MP_ACCESS_TOKEN) {
  console.error("ERROR: Falta MP_ACCESS_TOKEN en variables de entorno");
  process.exit(1);
}

// ====== MAILER (Gmail con password de app) ======
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // origenneri@gmail.com
    pass: process.env.EMAIL_PASS, // app password
  },
});

/**
 * Envía email de compra:
 * - To: comprador (si hay email) / Admin si no hay
 * - CC: admin (EMAIL_TO o EMAIL_USER) cuando se envía al comprador
 * Incluye datos del comprador y detalle de ítems.
 */
async function sendPurchaseEmail({ buyer, items, total, orderId }) {
  const admin = process.env.EMAIL_TO || process.env.EMAIL_USER;

  const toList = buyer?.email ? [buyer.email] : [admin];
  const ccList = buyer?.email ? [admin] : [];

  const itemsHtml = (items || [])
    .map(
      (it) =>
        `<li>${it.title} — x${it.quantity} ($${Number(it.unit_price).toLocaleString(
          "es-AR"
        )})</li>`
    )
    .join("");

  const buyerHtml = `
    <h3 style="margin:16px 0 6px">Comprador</h3>
    <p style="line-height:1.55;margin:0">
      <b>${(buyer?.first_name || "")} ${(buyer?.last_name || "")}</b><br>
      DNI: ${buyer?.dni || "-"}<br>
      Tel: ${buyer?.phone || "-"}<br>
      Email: ${buyer?.email || "-"}<br>
      Dirección: ${buyer?.address || "-"}
    </p>
  `;

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif">
      <h2 style="margin:0 0 10px">✅ Nueva compra aprobada</h2>

      ${buyerHtml}

      <h3 style="margin:16px 0 6px">Detalle</h3>
      <ul style="margin:0 0 8px">${itemsHtml}</ul>
      <p><b>Total cobrado:</b> $${Number(total).toLocaleString("es-AR")}</p>

      <p style="color:#666;font-size:13px;margin-top:14px">Orden MP: ${orderId || "-"}</p>
    </div>
  `;

  const text = [
    "Nueva compra aprobada",
    "",
    `Comprador: ${(buyer?.first_name || "")} ${(buyer?.last_name || "")}`,
    `DNI: ${buyer?.dni || "-"}`,
    `Tel: ${buyer?.phone || "-"}`,
    `Email: ${buyer?.email || "-"}`,
    `Dirección: ${buyer?.address || "-"}`,
    "",
    "Detalle:",
    ...(items || []).map(
      (it) => `- ${it.title} — x${it.quantity} ($${Number(it.unit_price).toLocaleString("es-AR")})`
    ),
    "",
    `Total cobrado: $${Number(total).toLocaleString("es-AR")}`,
    `Orden MP: ${orderId || "-"}`,
  ].join("\n");

  await mailer.sendMail({
    from: `Origen Neri <${process.env.EMAIL_USER}>`,
    to: toList.join(","),
    cc: ccList.join(","),
    subject: "Nueva compra Origen Neri",
    text,
    html,
    replyTo: buyer?.email || admin,
  });

  console.log(
    "Email de compra enviado OK a:",
    toList.join(","),
    ccList.length ? `(CC ${ccList.join(",")})` : ""
  );
}

// ====== HEALTH ======
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/health-urls", (req, res) =>
  res.json({
    FRONT_BASE_URL,
    MP_WEBHOOK_URL,
  })
);

// ====== CREAR PREFERENCIA MP ======
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // 1) Items (multi o formato viejo)
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

    // 2) Metadata (para recuperar en el webhook)
    const buyer = body.buyer || body;
    const metadata = {
      first_name: buyer.first_name || "",
      last_name: buyer.last_name || "",
      dni: buyer.dni || "",
      phone: buyer.phone || "",
      email: buyer.email || "",
      address: buyer.address || "",
      note: body.note || "",
      items, // guardamos el resumen
    };

    // 3) Preferencia
    const preference = {
      items,
      metadata,
      back_urls: {
        success: `${FRONT_BASE_URL}/?compra=aprobada`,
        pending: `${FRONT_BASE_URL}/?compra=pendiente`,
        failure: `${FRONT_BASE_URL}/?compra=falla`,
      },
      auto_return: "approved",
      notification_url: MP_WEBHOOK_URL, // Render env
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await r.json();
    if (!r.ok || !data.init_point) {
      console.error("Mercado Pago error (create_preference):", data);
      return res
        .status(500)
        .json({ error: "No se pudo crear la preferencia" });
    }

    // Devolvemos init_point para redirigir al checkout
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

// ====== WEBHOOK MP ======
app.all("/api/mp/webhook", async (req, res) => {
  try {
    // MP puede llamar con GET (challenge) o POST
    const topic = req.query.topic || req.body?.topic;
    const resource = req.query.resource || req.body?.resource;

    // Confirmamos a MP rápido
    res.sendStatus(200);

    if (topic !== "merchant_order" || !resource) return;

    // 1) Traer merchant_order
    const orderResp = await fetch(resource, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const order = await orderResp.json();

    // Sólo enviamos email cuando la orden está cerrada (pagada)
    if (order?.status !== "closed") {
      console.log("Webhook: orden no cerrada, status =", order?.status);
      return;
    }

    // 2) Con preference_id levantamos la preferencia para leer metadata
    const prefId = order?.preference_id;
    let metadata = {};
    let prefItems = [];
    if (prefId) {
      const prefResp = await fetch(
        `https://api.mercadopago.com/checkout/preferences/${prefId}`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
      );
      const pref = await prefResp.json();
      metadata = pref?.metadata || {};
      prefItems = metadata.items || pref?.items || [];
    }

    // 3) Calcular total
    const total =
      (prefItems || []).reduce(
        (acc, it) => acc + Number(it.unit_price || 0) * Number(it.quantity || 0),
        0
      ) || 0;

    // 4) Enviar email (comprador + CC admin)
    await sendPurchaseEmail({
      buyer: {
        first_name: metadata.first_name,
        last_name: metadata.last_name,
        dni: metadata.dni,
        phone: metadata.phone,
        email: metadata.email,
        address: metadata.address,
      },
      items: prefItems,
      total,
      orderId: order?.id,
    });
  } catch (e) {
    console.error("Error en webhook:", e);
    // (ya mandamos 200 arriba para no reintentos infinitos)
  }
});

// ====== WEBHOOK TEST (opcional para debug rápido) ======
app.all("/api/mp/webhook-test", (req, res) => {
  console.log(">> webhook-test recibido", {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  res.sendStatus(200);
});

// ====== START ======
app.listen(PORT, () => {
  console.log(
    `Servidor MP escuchando en http://localhost:${PORT}\nFRONT_BASE_URL=${FRONT_BASE_URL}\nWEBHOOK=${MP_WEBHOOK_URL}`
  );
});
