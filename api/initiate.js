// api/initiate.js
// SECURITY RULES enforced here (never trust the client):
//   1. Invoice generated server-side (crypto random — not predictable)
//   2. Total price calculated server-side from product IDs (client amount ignored)
//   3. Callback URL hardcoded server-side (client cannot redirect to attacker)
//   4. Every DB write is awaited before returning (Vercel lambda safety)

const { getDb }  = require("./_db");
const { randomBytes } = require("crypto");

// ── Product catalog (single source of truth — lives only on the server) ──────
const PRODUCTS = {
  p1: { name: "Wireless Earbuds Pro",    price: 1490 },
  p2: { name: "Premium Phone Case",      price:  490 },
  p3: { name: "USB-C Braided Cable",     price:  390 },
  p4: { name: "Power Bank 10000 mAh",    price: 1290 },
  p5: { name: "Tempered Glass Set",      price:  350 },
  p6: { name: "Smart Watch Strap",       price:  590 },
  p7: { name: "Portable LED Lamp",       price:  890 },
  p8: { name: "Bamboo Desk Organiser",   price:  990 },
};

const BASE = process.env.PAYSTATION_ENV === "live"
  ? "https://api.paystation.com.bd"
  : "https://sandbox.paystation.com.bd";

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateInvoice() {
  // e.g. INV-a3f9c2-1718200000000  — unpredictable, non-replayable
  return "INV-" + randomBytes(4).toString("hex") + "-" + Date.now();
}

function calcTotal(items) {
  // items = [{ id: "p1", qty: 2 }, ...]
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cart is empty");
  }

  let total = 0;
  const lineItems = [];

  for (const item of items) {
    const product = PRODUCTS[item.id];
    if (!product) throw new Error(`Unknown product: ${item.id}`);

    const qty = parseInt(item.qty, 10);
    if (!qty || qty < 1 || qty > 10) throw new Error(`Invalid quantity for ${item.id}`);

    const subtotal = product.price * qty;
    total += subtotal;
    lineItems.push({ id: item.id, name: product.name, price: product.price, qty, subtotal });
  }

  if (total <= 0) throw new Error("Cart total must be greater than zero");
  return { total, lineItems };
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Client sends ONLY: items, customer fields — no invoice, no amount, no callback
  const { items, cust_name, cust_phone, cust_email, cust_address } = req.body || {};

  // ── Validate customer fields ─────────────────────────────────────────────────
  if (!cust_name || !cust_phone || !cust_email || !cust_address) {
    return res.status(400).json({ error: "All customer fields are required" });
  }

  // ── Server-side price calculation ────────────────────────────────────────────
  let total, lineItems;
  try {
    ({ total, lineItems } = calcTotal(items));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // ── Generate invoice server-side ─────────────────────────────────────────────
  const invoice_number = generateInvoice();

  // ── Hardcoded callback URL (client cannot tamper) ────────────────────────────
  const APP_URL = process.env.APP_URL || "https://your-project.vercel.app";
  const callback_url = `${APP_URL}/success?invoice_number=${invoice_number}`;

  const checkout_items = lineItems.map(i => `${i.name} x${i.qty}`).join(", ");

  // ── Connect MongoDB ──────────────────────────────────────────────────────────
  let ordersCol = null;
  try {
    const client = await getDb();
    ordersCol = client.db("paystation_demo").collection("orders");
  } catch (err) {
    console.error("MongoDB connect error:", err);
  }

  // ── Insert order (status: initiated) ────────────────────────────────────────
  const orderDoc = {
    invoice_number,
    payment_amount: total,
    currency:       "BDT",
    status:         "initiated",
    verified:       false,
    customer:       { name: cust_name, phone: cust_phone, email: cust_email, address: cust_address },
    items:          lineItems,
    checkout_items,
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
        // Extremely unlikely with crypto invoice, but handle it
        return res.status(500).json({ error: "Invoice collision — please try again" });
      }
      console.error("MongoDB insertOne error:", err);
      // Non-fatal: continue to PayStation
    }
  }

  // ── Call PayStation ──────────────────────────────────────────────────────────
  const form = new URLSearchParams();
  form.append("merchantId",     process.env.MERCHANT_ID);
  form.append("password",       process.env.PAYSTATION_PASSWORD);
  form.append("invoice_number", invoice_number);
  form.append("currency",       "BDT");
  form.append("payment_amount", String(total));
  form.append("reference",      invoice_number);
  form.append("cust_name",      cust_name);
  form.append("cust_phone",     cust_phone);
  form.append("cust_email",     cust_email);
  form.append("cust_address",   cust_address);
  form.append("callback_url",   callback_url);
  form.append("checkout_items", checkout_items);

  let psData;
  try {
    const psRes = await fetch(`${BASE}/initiate-payment`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    form.toString(),
    });
    psData = await psRes.json();
  } catch (err) {
    console.error("PayStation network error:", err);
    if (ordersCol) {
      await ordersCol.updateOne(
        { invoice_number },
        { $set: { status: "failed", updated_at: new Date() } }
      );
    }
    return res.status(500).json({ error: "Gateway error — please try again" });
  }

  // ── PayStation responded ─────────────────────────────────────────────────────
  if (psData.status === "success" && psData.payment_url) {
    if (ordersCol) {
      // AWAITED — lambda must not return before this write completes
      await ordersCol.updateOne(
        { invoice_number },
        { $set: { status: "pending", payment_url: psData.payment_url, updated_at: new Date() } }
      );
    }
    return res.status(200).json({
      payment_url:    psData.payment_url,
      invoice_number,       // send back so frontend can store it for the success page
    });
  } else {
    if (ordersCol) {
      // AWAITED
      await ordersCol.updateOne(
        { invoice_number },
        { $set: { status: "failed", updated_at: new Date() } }
      );
    }
    return res.status(400).json({ error: psData.message || "Payment initiation failed" });
  }
};