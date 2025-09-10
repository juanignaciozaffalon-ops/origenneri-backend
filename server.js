// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config(); // lee las variables de .env

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("ERROR: Falta MP_ACCESS_TOKEN en .env");
  process.exit(1);
}

// Endpoint de prueba
app.get("/health", (req, res) => res.json({ ok: true }));

// Endpoint para crear preferencia en Mercado Pago
app.post("/api/mp/create_preference", async (req, res) => {
try {
  const body = req.body || {};

  // 1) Soportar multi-items o el esquema anterior de un solo item
  let items = [];
  if (Array.isArray(body.items) && body.items.length) {
    items = body.items.map(it => ({
      title: String(it.title || "Producto Origen Neri"),
      quantity: Number(it.quantity || 1),
      currency_id: "ARS",
      unit_price: Number(it.unit_price || 0)
    }));
  } else {
    // fallback a formato viejo
    items = [{
      title: body.title || "Compra Origen Neri",
      quantity: Number(body.quantity || 1),
      currency_id: "ARS",
      unit_price: Number(body.unit_price || 0)
    }];
  }

  // 2) Info comprador (opcional)
  const buyer = body.buyer || body;
  const metadata = {
    first_name: buyer.first_name || "",
    last_name:  buyer.last_name  || "",
    dni:        buyer.dni        || "",
    phone:      buyer.phone      || "",
    email:      buyer.email      || "",
    address:    buyer.address    || "",
    pack:       body.pack        || "",
    note:       body.note        || ""
  };

  // 3) Crear preferencia
  const pref = {
    items,
    metadata,
    back_urls: {
      success: "https://origenneri1.odoo.com",
      pending: "https://origenneri1.odoo.com",
      failure: "https://origenneri1.odoo.com"
    },
    auto_return: "approved",
    notification_url: process.env.MP_WEBHOOK_URL || undefined
  };

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(pref)
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("MP error:", data);
    return res.status(500).json({ error: "No se pudo crear preferencia MP" });
  }

  res.json({
    id: data.id,
    init_point: data.init_point,
    sandbox_init_point: data.sandbox_init_point
  });
}        catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3001;// Webhook de Mercado Pago
app.post("/api/mp/webhook", async (req, res) => {
  try {
    console.log("Webhook recibido:", req.body);

    // Guardá la info de la compra (acá sólo mostramos en consola)
    if (req.body && req.body.data) {
      console.log("Datos de compra:", JSON.stringify(req.body.data, null, 2));
    }

    res.sendStatus(200); // Confirmar a MP que recibimos la notificación
  } catch (e) {
    console.error("Error en webhook:", e);
    res.sendStatus(500);
  }
});
app.listen(PORT, () => console.log(`Servidor MP escuchando en http://localhost:${PORT}`));

