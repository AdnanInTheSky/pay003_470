const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const https = require("https");
const querystring = require("querystring");

// ─── ENV CHECK (fail fast, no silent 500s) ───────────────────────────────
const {
  MONGO_URI,
  MERCHANT_ID,
  PAYSTATION_PASSWORD,
  BASE_URL,
} = process.env;

if (!MONGO_URI) throw new Error("Missing MONGO_URI");
if (!MERCHANT_ID) throw new Error("Missing MERCHANT_ID");
if (!PAYSTATION_PASSWORD) throw new Error("Missing PAYSTATION_PASSWORD");
if (!BASE_URL) throw new Error("Missing BASE_URL");

// ─── CONSTANTS ───────────────────────────────────────────────────────────
const PAY_URL = "https://sandbox.paystation.com.bd/initiate-payment";
const STATUS_URL = "https://sandbox.paystation.com.bd/transaction-status";

// ─── PRODUCT DB (server authoritative pricing) ───────────────────────────
const PRODUCTS = {
  p1: { name: "Wireless Earbuds", price: 5 },
  p2: { name: "Phone Case", price: 3 },
  p3: { name: "USB-C Cable", price: 18 },
  p4: { name: "Power Bank 10000mAh", price: 9 },
  p5: { name: "Screen Protector", price: 12 },
  p6: { name: "Smart Watch Strap", price: 28 },
};

// ─── MONGO CACHE (safe for serverless) ───────────────────────────────────
let cachedClient;

async function getOrders() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("paystation_demo").collection("orders");
}

// ─── SAFE BODY PARSER ────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// ─── PRICE ENGINE ────────────────────────────────────────────────────────
function calc(items) {
  let total = 0;
  const lineItems = [];

  for (const i of items) {
    const pid = i.id;
    const qty = Number(i.qty);

    if (!PRODUCTS[pid] || !Number.isFinite(qty) || qty < 1 || qty > 10) {
      throw new Error(`Invalid item: ${pid}`);
    }

    const p = PRODUCTS[pid];
    const sub = p.price * qty;

    total += sub;

    lineItems.push({
      id: pid,
      name: p.name,
      price: p.price,
      qty,
      subtotal: sub,
    });
  }

  if (total <= 0) throw new Error("Empty cart");

  return { total, lineItems };
}

// ─── HTTP POST HELPER ────────────────────────────────────────────────────
function postForm(url, data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const u = new URL(url);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (d) => (raw += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({ raw });
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(body);
    req.end();
  });
}

// ─── CORS + RESPONSE ─────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, code, data) {
  cors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// ─── HANDLER ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  const path = req.url.split("?")[0];

  try {
    // ── CREATE ORDER ────────────────────────────────────────────────
    if (req.method === "POST" && path === "/api/create-order") {
      const body = await parseBody(req);
      const { name, email, phone, address, items } = body;

      if (!name || !email || !phone || !address) {
        return json(res, 400, { error: "Missing customer info" });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return json(res, 400, { error: "Empty cart" });
      }

      const { total, lineItems } = calc(items);
      const invoice = uuidv4();

      const orders = await getOrders();

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
        password: PAYSTATION_PASSWORD,
        invoice_number: invoice,
        currency: "BDT",
        payment_amount: total,
        cust_name: name,
        cust_phone: phone,
        cust_email: email,
        cust_address: address,
        callback_url: `${BASE_URL}/api/payment-callback`,
        checkout_items: JSON.stringify(lineItems.map((i) => i.name)),
      });

      if (ps.status === "success" && ps.payment_url) {
        return json(res, 200, { payment_url: ps.payment_url });
      }

      return json(res, 400, {
        error: ps.message || "Payment initiation failed",
      });
    }

    // ── CALLBACK ─────────────────────────────────────────────────────
    if (req.method === "GET" && path === "/api/payment-callback") {
      const invoice = new URL(req.url, `http://${req.headers.host}`)
        .searchParams.get("invoice_number");

      const orders = await getOrders();

      const r = await postForm(STATUS_URL, {
        invoice_number: invoice,
        merchantId: MERCHANT_ID,
      });

      const status = r?.data?.trx_status || "failed";
      const success = ["success", "successful"].includes(status.toLowerCase());

      await orders.updateOne(
        { invoice },
        { $set: { status: success ? "success" : "failed", verified: true } }
      );

      res.statusCode = 302;
      res.setHeader(
        "Location",
        success ? "/?success=1" : "/?failed=1"
      );
      return res.end();
    }

    // ── STATUS API ───────────────────────────────────────────────────
    if (req.method === "GET" && path.startsWith("/api/order-status/")) {
      const invoice = path.split("/").pop();
      const orders = await getOrders();

      const order = await orders.findOne(
        { invoice },
        { projection: { _id: 0 } }
      );

      if (!order) return json(res, 404, { error: "Not found" });

      return json(res, 200, order);
    }

    return json(res, 404, { error: "Route not found" });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return json(res, 500, {
      error: err.message || "Internal server error",
    });
  }
};