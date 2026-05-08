const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const https = require("https");
const querystring = require("querystring");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MONGO_URI      = process.env.MONGO_URI || "mongodb://localhost:27017";
const MERCHANT_ID    = process.env.MERCHANT_ID;
const PASSWORD       = process.env.PAYSTATION_PASSWORD;
const BASE_URL       = process.env.BASE_URL || "http://localhost:3000";
const PAY_URL        = "https://api.paystation.com.bd/initiate-payment";
const STATUS_URL     = "https://api.paystation.com.bd/transaction-status";

// ─── PRODUCTS (backend price authority — never trust client prices) ──────────
// The UI catalog lives in public/products.js. This copy is used ONLY for
// server-side price verification. Any price sent by the client is ignored;
// totals are always recalculated here before calling PayStation.
// Keep both files in sync when updating prices.
const PRODUCTS = {
  p1: { name: "Wireless Earbuds",     price: 5  },
  p2: { name: "Phone Case",           price: 3  },
  p3: { name: "USB-C Cable",          price: 18 },
  p4: { name: "Power Bank 10000mAh",  price: 9  },
  p5: { name: "Screen Protector",     price: 12 },
  p6: { name: "Smart Watch Strap",    price: 28 },
};

// ─── DB (connection cached across warm invocations) ─────────────────────────
let cachedClient = null;
async function getDB() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await cachedClient.connect();
  }
  return cachedClient.db("paystation_demo").collection("orders");
}

// ─── PRICE ENGINE ──────────────────────────────────────────────────────────
function calc(items) {
  let total = 0;
  const lineItems = [];
  for (const i of items) {
    const pid = i.id;
    const qty = parseInt(i.qty, 10);
    if (!PRODUCTS[pid] || isNaN(qty) || qty < 1 || qty > 10)
      throw new Error(`Invalid product or quantity: ${pid}`);
    const product = PRODUCTS[pid];
    const subtotal = product.price * qty;
    total += subtotal;
    lineItems.push({ id: pid, name: product.name, price: product.price, qty, subtotal });
  }
  if (total <= 0) throw new Error("Cart is empty");
  return { total, lineItems };
}

// ─── HTTP HELPER ───────────────────────────────────────────────────────────
function postForm(url, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// ─── CORS HEADERS ──────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

// ─── MAIN HANDLER (Vercel serverless) ──────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  const url = req.url.split("?")[0];

  // ── POST /api/create-order ─────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/create-order") {
    try {
      const { name = "", email = "", phone = "", address = "", items = [] } = req.body || {};

      if (![name, email, phone, address].every((v) => String(v).trim()))
        return json(res, 400, { error: "All customer fields are required" });

      if (!items.length)
        return json(res, 400, { error: "Cart is empty" });

      const { total: amount, lineItems } = calc(items);
      const invoice = uuidv4();

      const orders = await getDB();
      await orders.insertOne({
        invoice, items: lineItems, amount, status: "initiated", verified: false,
        customer: { name, email, phone, address },
        createdAt: new Date(),
      });

      const ps = await postForm(PAY_URL, {
        merchantId: MERCHANT_ID,
        password: PASSWORD,
        invoice_number: invoice,
        currency: "BDT",
        payment_amount: amount,
        cust_name: name,
        cust_phone: phone,
        cust_email: email,
        cust_address: address,
        callback_url: `${BASE_URL}/api/payment-callback`,
        checkout_items: JSON.stringify(lineItems.map((i) => i.name)),
      });

      if (ps.status === "success" && ps.payment_url) {
        return json(res, 200, { payment_url: ps.payment_url, invoice });
      }

      await orders.updateOne({ invoice }, { $set: { status: "failed" } });
      return json(res, 400, { error: ps.message || "Payment initiation failed" });

    } catch (e) {
      console.error(e);
      return json(res, e.message?.includes("Invalid") ? 400 : 500, {
        error: e.message || "Server error",
      });
    }
  }

  // ── GET /api/payment-callback ──────────────────────────────────────────
  if (req.method === "GET" && url === "/api/payment-callback") {
    const { invoice_number: invoice = "" } = req.query || {};
    if (!invoice) return res.status(400).send("Bad request");

    const orders = await getDB();
    await orders.updateOne({ invoice }, { $set: { status: "verifying" } });

    let trxStatus = "failed";
    try {
      const r = await postForm(
        STATUS_URL,
        { invoice_number: invoice },
        { merchantId: MERCHANT_ID }
      );
      trxStatus = r?.data?.trx_status || "failed";
    } catch { /* keep failed */ }

    const success = ["success", "successful"].includes(trxStatus.toLowerCase());
    await orders.updateOne({ invoice }, {
      $set: { status: success ? "success" : trxStatus, verified: true },
    });

    const qs = success
      ? `invoice_number=${invoice}&status=Success`
      : `invoice_number=${invoice}`;

    return res.redirect(302, success ? `/?success=1&${qs}` : `/?failed=1&${qs}`);
  }

  // ── GET /api/order-status/:invoice ────────────────────────────────────
  const statusMatch = url.match(/^\/api\/order-status\/([^/]+)$/);
  if (req.method === "GET" && statusMatch) {
    const invoice = statusMatch[1];
    const orders = await getDB();
    const order = await orders.findOne({ invoice }, { projection: { _id: 0 } });
    if (!order) return json(res, 404, { error: "Not found" });
    return json(res, 200, {
      status: order.status,
      verified: order.verified,
      amount: order.amount,
      customer: order.customer?.name,
    });
  }

  return json(res, 404, { error: "Not found" });
};