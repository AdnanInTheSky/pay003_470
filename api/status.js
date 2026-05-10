// api/status.js
// 1. Calls PayStation /transaction-status server-side (credentials stay hidden)
// 2. Updates the order in MongoDB with the verified status
// 3. Returns the full PayStation response to the browser

const { getDb } = require("./_db");

const BASE =
  process.env.PAYSTATION_ENV === "live"
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
  let psData = null;
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

  // ── Update order in MongoDB ──────────────────────────────────────────────────
  const trxStatus = psData?.data?.trx_status || null;
  const trxId     = psData?.data?.trx_id     || null;
  const isSuccess = trxStatus && ["successful", "success"].includes(trxStatus.toLowerCase());

  try {
    const client = await getDb();
    const ordersCol = client.db("dhaka_market").collection("orders");

    await ordersCol.updateOne(
      { invoice_number },
      {
        $set: {
          trx_status:   trxStatus,
          trx_id:       trxId,
          status:       isSuccess ? "success" : (trxStatus ? trxStatus.toLowerCase() : "unknown"),
          verified:     true,
          updated_at:   new Date(),
        },
      }
    );
  } catch (err) {
    // DB update failure is non-fatal — we still return the PayStation response
    console.error("MongoDB update error (status):", err);
  }

  return res.status(200).json(psData);
};