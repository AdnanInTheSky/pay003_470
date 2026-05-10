// api/initiate.js
// 1. Validates request
// 2. Saves a pending order to MongoDB
// 3. Calls PayStation /initiate-payment
// 4. Updates order with payment_url (or marks failed)
// Returns { payment_url, invoice_number } to the browser.

const { getDb } = require("./_db");

const BASE =
  process.env.PAYSTATION_ENV === "live"
    ? "https://api.paystation.com.bd"
    : "https://sandbox.paystation.com.bd";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    invoice_number,
    payment_amount,
    cust_name,
    cust_phone,
    cust_email,
    cust_address,
    checkout_items,
    callback_url,
    items,
  } = req.body || {};

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!invoice_number || !payment_amount || !cust_name || !cust_phone || !cust_email || !cust_address) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const amount = Number(payment_amount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid payment amount" });
  }

  // ── Connect to MongoDB ───────────────────────────────────────────────────────
  let ordersCol = null;
  try {
    const client = await getDb();
    ordersCol = client.db("dhaka_market").collection("orders");

    // Ensure unique index exists (idempotent — safe to call repeatedly)
    await ordersCol.createIndex({ invoice_number: 1 }, { unique: true, background: true });
  } catch (err) {
    console.error("MongoDB connect error:", err);
    // Non-fatal: continue without DB persistence
  }

  // ── Insert pending order ─────────────────────────────────────────────────────
  const orderDoc = {
    invoice_number,
    payment_amount: amount,
    currency:       "BDT",
    status:         "initiated",
    verified:       false,
    customer: { name: cust_name, phone: cust_phone, email: cust_email, address: cust_address },
    items:          items || [],
    checkout_items: checkout_items || "",
    callback_url,
    payment_url:    null,
    trx_id:         null,
    trx_status:     null,
    created_at:     new Date(),
    updated_at:     new Date(),
  };

  if (ordersCol) {
    try {
      await ordersCol.insertOne(orderDoc);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ error: "Duplicate invoice. Please refresh and try again." });
      }
      console.error("MongoDB insert error:", err);
      // Non-fatal — proceed anyway
    }
  }

  // ── Call PayStation ──────────────────────────────────────────────────────────
  const form = new URLSearchParams();
  form.append("merchantId",     process.env.MERCHANT_ID);
  form.append("password",       process.env.PAYSTATION_PASSWORD);
  form.append("invoice_number", invoice_number);
  form.append("currency",       "BDT");
  form.append("payment_amount", String(amount));
  form.append("reference",      invoice_number);
  form.append("cust_name",      cust_name);
  form.append("cust_phone",     cust_phone);
  form.append("cust_email",     cust_email);
  form.append("cust_address",   cust_address);
  form.append("callback_url",   callback_url);
  form.append("checkout_items", checkout_items || "");

  try {
    const psRes = await fetch(`${BASE}/initiate-payment`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    form.toString(),
    });

    const data = await psRes.json();

    if (data.status === "success" && data.payment_url) {
      if (ordersCol) {
        ordersCol.updateOne(
          { invoice_number },
          { $set: { payment_url: data.payment_url, status: "pending", updated_at: new Date() } }
        ).catch((e) => console.error("MongoDB update:", e));
      }
      return res.status(200).json({
        payment_url:    data.payment_url,
        invoice_number: data.invoice_number || invoice_number,
      });
    } else {
      if (ordersCol) {
        ordersCol.updateOne(
          { invoice_number },
          { $set: { status: "failed", updated_at: new Date() } }
        ).catch((e) => console.error("MongoDB update:", e));
      }
      return res.status(400).json({ error: data.message || "Payment initiation failed" });
    }
  } catch (err) {
    console.error("PayStation initiate error:", err);
    if (ordersCol) {
      ordersCol.updateOne(
        { invoice_number },
        { $set: { status: "failed", updated_at: new Date() } }
      ).catch(() => {});
    }
    return res.status(500).json({ error: "Gateway error — please try again" });
  }
};