const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const https = require("https");
const querystring = require("querystring");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MONGO_URI   = process.env.MONGO_URI;
const MERCHANT_ID = process.env.MERCHANT_ID;
const PASSWORD    = process.env.PAYSTATION_PASSWORD;
const BASE_URL    = process.env.BASE_URL;
const PAY_URL     = "https://sandbox.paystation.com.bd/initiate-payment";
const STATUS_URL  = "https://sandbox.paystation.com.bd/transaction-status";

// ─── PRODUCTS (server is price authority) ─────────────────────────────────
const PRODUCTS = {
  p1: { name: "Wireless Earbuds",     price: 5  },
  p2: { name: "Phone Case",           price: 3  },
  p3: { name: "USB-C Cable",          price: 18 },
  p4: { name: "Power Bank 10000mAh",  price: 9  },
  p5: { name: "Screen Protector",     price: 12 },
  p6: { name: "Smart Watch Strap",    price: 28 },
};

// ─── MONGODB CACHE (critical for serverless) ─────────────────────────────
let cachedClient = null;
async function getOrdersCollection() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("paystation_demo").collection("orders");
}

// ─── SAFE JSON BODY PARSER (Vercel raw Node) ─────────────────────────────
function parseJSON(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

// ─── PRICE ENGINE ─────────────────────────────────────────────────────────
function calculateCart(items) {
  let total = 0;
  const lineItems = [];

  for (const i of items) {
    const pid = i.id;
    const qty = parseInt(i.qty, 10);

    if (!PRODUCTS[pid] || isNaN(qty) || qty < 1 || qty > 10) {
      throw new Error(`Invalid product/qty: ${pid}`);
    }

    const p = PRODUCTS[pid];
    const subtotal = p.price * qty;

    total += subtotal;
    lineItems.push({
      id: pid,
      name: p.name,
      price: p.price,
      qty,
      subtotal,
    });
  }

  if (total <= 0) throw new Error("Empty cart");
  return { total, lineItems };
}

// ─── HTTP POST HELPER ─────────────────────────────────────────────────────
function postForm(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const u = new URL(url);

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({}); }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── CORS ─────────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJSON(res, code, data) {
  setCORS(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  const url = req.url.split("?")[0];

  try {
    // ── CREATE ORDER ────────────────────────────────────────────────────
    if (req.method === "POST" && url === "/api/create-order") {
      const body = await parseJSON(req);

      const { name, email, phone, address, items } = body;

      if (![name, email, phone, address].every(Boolean)) {
        return sendJSON(res, 400, { error: "Missing customer info" });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: "Cart empty" });
      }

      const { total, lineItems } = calculateCart(items);
      const invoice = uuidv4();

      const orders = await getOrdersCollection();
      await orders.insertOne({
        invoice,
        items: lineItems,
        amount: total,
        status: "initiated",
        verified: false,
        createdAt: new Date(),
      });

      const ps = await postForm(PAY_URL, {
        merchantId: MERCHANT_ID,
        password: PASSWORD,
        invoice_number: invoice,
        currency: "BDT",
        payment_amount: total,
        cust_name: name,
        cust_phone: phone,
        cust_email: email,
        cust_address: address,
        callback_url: `${BASE_URL}/api/payment-callback`,
        checkout_items: JSON.stringify(lineItems.map(i => i.name)),
      });

      if (ps.status === "success" && ps.payment_url) {
        return sendJSON(res, 200, { payment_url: ps.payment_url });
      }

      await orders.updateOne({ invoice }, { $set: { status: "failed" } });
      return sendJSON(res, 400, { error: ps.message || "PayStation error" });
    }

    // ── PAYMENT CALLBACK ────────────────────────────────────────────────
    if (req.method === "GET" && url === "/api/payment-callback") {
      const invoice = new URL(req.url, `http://${req.headers.host}`)
        .searchParams.get("invoice_number");

      const orders = await getOrdersCollection();

      const r = await postForm(
        STATUS_URL,
        { invoice_number: invoice },
        { merchantId: MERCHANT_ID }
      );

      const trx = r?.data?.trx_status || "failed";
      const success = ["success", "successful"].includes(trx.toLowerCase());

      await orders.updateOne({ invoice }, {
        $set: { status: success ? "success" : "failed", verified: true }
      });

      res.statusCode = 302;
      res.setHeader("Location", success ? "/?success=1" : "/?failed=1");
      return res.end();
    }

    // ── ORDER STATUS ────────────────────────────────────────────────────
    if (req.method === "GET" && url.startsWith("/api/order-status/")) {
      const invoice = url.split("/").pop();
      const orders = await getOrdersCollection();
      const order = await orders.findOne({ invoice }, { projection: { _id: 0 } });

      if (!order) return sendJSON(res, 404, { error: "Not found" });

      return sendJSON(res, 200, order);
    }

    return sendJSON(res, 404, { error: "Route not found" });

  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: err.message });
  }
};