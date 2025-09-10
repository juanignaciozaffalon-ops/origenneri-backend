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
    const { quantity, unit_price, title, first_name, last_name, dni, email, address } = req.body;

    const qty = Math.max(1, Math.min(10, parseInt(quantity, 10) || 1));
    const unit = Number(unit_price) || 0;

    const preference = {
      items: [
// --- NUEVO: aceptar 1 ítem o varios ---
const body = req.body || {};

// 1) Items
let items = [];
if (Array.isArray(body.items) && body.items.length) {
  items = body.items.map(it => ({
    title: String(it.title || "Ítem Origen Neri"),
    quantity: Number(it.quantity || 1),
    currency_id: "ARS",
    unit_price: Number(it.unit_price || 0)
  }));
} else {
  // compatibilidad con formato viejo
  items = [{
    title: String(body.title || "Compra Origen Neri"),
    quantity: Number(body.quantity || 1),
    currency_id: "ARS",
    unit_price: Number(body.unit_price || 0)
  }];
}

// 2) Metadata (datos del comprador)
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

// 3) Preferencia
const preference = {
  items,
  metadata,
  back_urls: {
    success: "https://origenneri1.odoo.com",
    pending: "https://origenneri1.odoo.com",
    failure: "https://origenneri1.odoo.com"
  },
  auto_return: "approved",
  notification_url: process.env.MP_WEBHOOK_URL || undefined
};        {
          title: title || "Producto",
          quantity: qty,
          currency_id: "ARS",
          unit_price: unit
        }
      ],
      payer: {
        name: first_name || "",
        surname: last_name || "",
        email: email || "",
        identification: { type: "DNI", number: dni || "" },
        address: { street_name: address || "" }
      },
      back_urls: {
        success: "https://tu-dominio.com/gracias",
        failure: "https://tu-dominio.com/error",
        pending: "https://tu-dominio.com/pendiente"
      },
      auto_return: "approved",
      statement_descriptor: "ORIGEN NERI",
      external_reference: `torrontes_${Date.now()}`
    };

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("Mercado Pago error:", data);
      return res.status(400).json({ error: "Mercado Pago rechazó la preferencia", detail: data });
    }

    return res.json({
      id: data.id,
      init_point: data.init_point,                // checkout producción
      sandbox_init_point: data.sandbox_init_point // checkout prueba
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor MP escuchando en http://localhost:${PORT}`));

