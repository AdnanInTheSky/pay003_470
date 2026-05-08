import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { MongoClient } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

// -------------------- PATH FIX --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------- CONFIG --------------------
const MONGO_URI = process.env.MONGO_URI;
const MERCHANT_ID = process.env.MERCHANT_ID;
const PASSWORD = process.env.PAYSTATION_PASSWORD;
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

const PAY_URL = "https://api.paystation.com.bd/initiate-payment";
const STATUS_URL = "https://api.paystation.com.bd/transaction-status";

// -------------------- DB --------------------
const client = new MongoClient(MONGO_URI);
await client.connect();

const db = client.db("paystation_demo");
const orders = db.collection("orders");

// -------------------- PRODUCTS (TRUTH SOURCE) --------------------
const PRODUCTS = {
  p1: { name: "Wireless Earbuds", price: 5, emoji: "🎧" },
  p2: { name: "Phone Case", price: 3, emoji: "📱" },
  p3: { name: "USB-C Cable", price: 18, emoji: "🔌" },
  p4: { name: "Power Bank 10000mAh", price: 9, emoji: "🔋" },
  p5: { name: "Screen Protector", price: 12, emoji: "🛡️" },
  p6: { name: "Smart Watch Strap", price: 28, emoji: "⌚" }
};

// -------------------- PRICE ENGINE --------------------
function calc(items) {
  let total = 0;
  const lineItems = [];

  for (const i of items) {
    const pid = i.id;
    const qty = Number(i.qty || 1);

    if (!PRODUCTS[pid] || qty < 1 || qty > 10) {
      throw new Error(`Invalid product or quantity: ${pid}`);
    }

    const product = PRODUCTS[pid];
    const subtotal = product.price * qty;

    total += subtotal;

    lineItems.push({
      id: pid,
      name: product.name,
      price: product.price,
      qty,
      subtotal
    });
  }

  if (total <= 0) throw new Error("Cart is empty");

  return { total, lineItems };
}

// -------------------- STATIC --------------------
app.use(express.static(path.join(__dirname, "public")));

// -------------------- PAGES --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public/result.html"));
});

app.get("/failed", (req, res) => {
  res.sendFile(path.join(__dirname, "public/result.html"));
});

// -------------------- CREATE ORDER --------------------
app.post("/api/create-order", async (req, res) => {
  try {
    const { name, email, phone, address, items } = req.body;

    if (!name || !email || !phone || !address) {
      return res.status(400).json({ error: "All fields required" });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Cart empty" });
    }

    const { total, lineItems } = calc(items);
    const invoice = uuidv4();

    const orderDoc = {
      invoice,
      items: lineItems,
      amount: total,
      status: "initiated",
      verified: false,
      customer: { name, email, phone, address }
    };

    await orders.insertOne(orderDoc);

    const payload = {
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
      checkout_items: JSON.stringify(lineItems.map(i => i.name))
    };

    const psRes = await axios.post(PAY_URL, payload);
    const data = psRes.data;

    if (data.status === "success" && data.payment_url) {
      return res.json({
        payment_url: data.payment_url,
        invoice
      });
    }

    await orders.updateOne(
      { invoice },
      { $set: { status: "failed" } }
    );

    return res.status(400).json({ error: data.message || "Payment failed" });

  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// -------------------- VERIFY PAYMENT --------------------
async function verifyWithPaystation(invoice) {
  try {
    const headers = { merchantId: MERCHANT_ID };

    const res = await axios.post(STATUS_URL, {
      invoice_number: invoice
    }, { headers });

    return res.data?.data?.trx_status || "failed";
  } catch {
    return "failed";
  }
}

// -------------------- CALLBACK --------------------
app.get("/api/payment-callback", async (req, res) => {
  const invoice = req.query.invoice_number;

  if (!invoice) return res.status(400).send("bad request");

  await orders.updateOne(
    { invoice },
    { $set: { status: "verifying" } }
  );

  const status = await verifyWithPaystation(invoice);

  if (status === "success" || status === "successful") {
    await orders.updateOne(
      { invoice },
      { $set: { status: "success", verified: true } }
    );

    return res.redirect(`/success?invoice=${invoice}`);
  }

  await orders.updateOne(
    { invoice },
    { $set: { status, verified: true } }
  );

  return res.redirect(`/failed?invoice=${invoice}`);
});

// -------------------- ORDER STATUS --------------------
app.get("/api/order-status/:invoice", async (req, res) => {
  const order = await orders.findOne(
    { invoice: req.params.invoice },
    { projection: { _id: 0 } }
  );

  if (!order) return res.status(404).json({ error: "Not found" });

  res.json({
    status: order.status,
    verified: order.verified,
    amount: order.amount,
    customer: order.customer?.name
  });
});

// -------------------- START --------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});