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
        {
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

