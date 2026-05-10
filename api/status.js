// api/status.js
// Verifies payment status server-side with PayStation.
// Updates MongoDB order with verified result.
// All DB writes are awaited before returning — required for Vercel serverless.

const { getDb } = require("./_db");

const BASE = process.env.PAYSTATION_ENV === "live"
  ? "https://api.paystation.com.bd"
  : "https://sandbox.paystation.com.bd";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { invoice_number } = req.body || {};
  if (!invoice_number) {
    return res.status(400).json({ error: "invoice_number required" });
  }

  // ── Call PayStation transaction-status ───────────────────────────────────────
  let psData;
  try {
    const psRes = await fetch(`${BASE}/transaction-status`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "merchantId":   process.env.MERCHANT_ID,
      },
      body: JSON.stringify({ invoice_number }),
    });
    psData = await psRes.json();
  } catch (err) {
    console.error("PayStation status error:", err);
    return res.status(500).json({ error: "Gateway error — could not verify payment" });
  }

  // ── Update MongoDB — AWAITED before return ───────────────────────────────────
  const trxStatus = psData?.data?.trx_status || null;
  const trxId     = psData?.data?.trx_id     || null;
  const isSuccess = trxStatus && ["successful", "success"].includes(trxStatus.toLowerCase());

  try {
    const client = await getDb();
    const ordersCol = client.db("paystation_demo").collection("orders");

    await ordersCol.updateOne(
      { invoice_number },
      {
        $set: {
          trx_status:  trxStatus,
          trx_id:      trxId,
          status:      isSuccess ? "success" : (trxStatus?.toLowerCase() || "unknown"),
          verified:    true,
          updated_at:  new Date(),
        },
      }
    );
  } catch (err) {
    // Non-fatal: still return PayStation's response to the browser
    console.error("MongoDB updateOne error (status):", err);
  }

  return res.status(200).json(psData);
};