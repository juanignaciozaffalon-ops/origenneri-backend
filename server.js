// server.js — Origen Neri backend con email interno + email al cliente con CC

import express from "express";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ---------- Crear preferencia ----------
app.post("/api/mp/create_preference", async (req, res) => {
  try {
    const body = req.body || {};

    // Multi-items o item único (fallback)
    let items = [];
    if (Array.isArray(body.items) && body.items.length) {
      items = body.items.map(it => ({
        title: it.title,
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

    // Info comprador (via metadata)
    const buyer = body.buyer || {};
    const metadata = {
      first_name: buyer.first_name || "",
      last_name:  buyer.last_name  || "",
      dni:        buyer.dni        || "",
      phone:      buyer.phone      || "",
      email:      buyer.email      || "",
      address:    buyer.address    || ""
    };

    const pref = {
      items,
      metadata,
      back_urls: {
        success: "https://origenneri.com",
        pending: "https://origenneri.com",
        failure: "https://origenneri.com"
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// ---------- Webhook MP (un solo correo interno + correo al cliente con CC a vos) ----------
const processedPayments = new Set();

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const topic = body.topic || body.type || "";
    const paymentId = body.data?.id || body.data?.resource || body.id || null;

    // Solo pagos
    if (!topic.toLowerCase().includes("payment") || !paymentId) {
      return res.status(200).json({ ok: true, skip: "no es evento de pago" });
    }
    // Evitar duplicados
    if (processedPayments.has(String(paymentId))) {
      return res.status(200).json({ ok: true, skip: "duplicado" });
    }

    // Traer el pago
    const pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const p = await pr.json();
    if (!pr.ok) {
      console.error("No se pudo leer payment:", p);
      return res.status(200).json({ ok: true, skip: "payment fetch error" });
    }

    // Solo aprobados
    if ((p.status || "").toLowerCase() !== "approved") {
      return res.status(200).json({ ok: true, skip: "pago no aprobado" });
    }

    processedPayments.add(String(paymentId));

    // Ítems e info comprador
    const items = Array.isArray(p.additional_info?.items) ? p.additional_info.items : [];
    const meta = p.metadata || {};
    const buyer = {
      first_name: meta.first_name || p.payer?.first_name || "",
      last_name:  meta.last_name  || p.payer?.last_name  || "",
      dni:        meta.dni        || (p.payer?.identification?.number || ""),
      phone:      meta.phone      || p.payer?.phone?.number || "",
      email:      meta.email      || p.payer?.email || "",
      address:    meta.address    || ""
    };

    // Totales
    const totalBotellas = items.reduce((acc, it) => acc + Number(it.quantity || 0), 0);
    const subtotal = items.reduce((acc, it) => acc + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);

    let tramo = "Precio regular";
    if (totalBotellas >= 6) tramo = "$13.500 c/u (6 o más)";
    else if (totalBotellas >= 4) tramo = "$15.500 c/u (4 o 5)";

    // Tabla ítems (para ambos mails)
    const filas = items.map(it => `
      <tr>
        <td style="padding:6px 8px;border:1px solid #eee;">${it.title || "-"}</td>
        <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${Number(it.quantity || 0)}</td>
        <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">$${Number(it.unit_price||0).toLocaleString("es-AR")}</td>
        <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">$${(Number(it.unit_price||0)*Number(it.quantity||0)).toLocaleString("es-AR")}</td>
      </tr>
    `).join("");

    // ----- Mail interno (a vos) -----
    const emailAdminHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">
        <h2>🧾 Compra aprobada — Origen Neri</h2>
        <p>ID de pago: <strong>${paymentId}</strong></p>

        <h3>Detalle del pedido</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Variedad</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Cant.</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Precio u.</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div style="margin-top:14px;padding:10px;border:1px dashed #ddd;background:#fbfbfb;">
          <p><strong>Total de botellas:</strong> ${totalBotellas}</p>
          <p><strong>Precio aplicado:</strong> ${tramo}</p>
          <p><strong>Total abonado:</strong> $${subtotal.toLocaleString("es-AR")}</p>
        </div>

        <h3>Datos del comprador</h3>
        <ul>
          <li><strong>Nombre:</strong> ${buyer.first_name} ${buyer.last_name}</li>
          <li><strong>DNI:</strong> ${buyer.dni}</li>
          <li><strong>Celular:</strong> ${buyer.phone}</li>
          <li><strong>Email:</strong> ${buyer.email}</li>
          <li><strong>Dirección:</strong> ${buyer.address}</li>
        </ul>
      </div>
    `;

    // ----- Mail para el cliente (con CC a vos) -----
    const emailClienteHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">
        <h2>¡Gracias por tu compra, ${buyer.first_name || ""}!</h2>
        <p>Tu pago fue <strong>aprobado</strong>. En breve alguien del equipo de <strong>Origen Neri</strong> te contactará para coordinar el envío.</p>
        <p><strong>ID de pago:</strong> ${paymentId}</p>

        <h3>Resumen del pedido</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Variedad</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Cant.</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Precio u.</th>
              <th style="padding:8px;border:1px solid #eee;background:#fafafa;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div style="margin-top:14px;padding:10px;border:1px dashed #ddd;background:#fbfbfb;">
          <p><strong>Total de botellas:</strong> ${totalBotellas}</p>
          <p><strong>Precio aplicado:</strong> ${tramo}</p>
          <p><strong>Total abonado:</strong> $${subtotal.toLocaleString("es-AR")}</p>
        </div>

        <p style="margin-top:16px;">Cualquier consulta, respondé este email o escribinos por WhatsApp.</p>
        <p>— Equipo Origen Neri</p>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    // 1) Envío interno (a vos)
    await transporter.sendMail({
      from: `"Origen Neri" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: `Compra aprobada — ${totalBotellas} botellas — $${subtotal.toLocaleString("es-AR")}`,
      html: emailAdminHtml
    });

    // 2) Envío al cliente (si tenemos email), con CC a vos para comprobar recepción
    if ((buyer.email || "").includes("@")) {
      await transporter.sendMail({
        from: `"Origen Neri" <${process.env.EMAIL_USER}>`,
        to: buyer.email,
        cc: process.env.EMAIL_TO, // copia a vos
        replyTo: process.env.EMAIL_TO, // si responde, te llega a vos
        subject: `¡Gracias por tu compra! — Origen Neri`,
        html: emailClienteHtml
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ ok: true, skip: "catch error" });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
