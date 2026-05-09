import axios from "axios";
import { v4 as uuid } from "uuid";
import { getOrders } from "../lib/db.js";
import { calc } from "../lib/products.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, phone, address, items } = req.body || {};

    if (!name || !email || !phone || !address) {
      return res.status(400).json({ error: "Missing customer info" });
    }

    const { total, lines } = calc(items);

    const invoice = uuid();

    const orders = await getOrders();

    await orders.insertOne({
      invoice,
      items: lines,
      amount: total,
      status: "initiated",
      verified: false,
      customer: { name, email, phone, address },
      createdAt: new Date()
    });

    const baseURL = `https://${req.headers.host}`;

    const payload = {
      merchantId: process.env.MERCHANT_ID,
      password: process.env.PAYSTATION_PASSWORD,
      invoice_number: invoice,
      currency: "BDT",
      payment_amount: total,
      cust_name: name,
      cust_phone: phone,
      cust_email: email,
      cust_address: address,
      callback_url: `${baseURL}/api/payment-callback`
    };

    const ps = await axios.post(
      "https://api.paystation.com.bd/initiate-payment",
      payload,
      { timeout: 10000 }
    );

    if (!ps.data?.payment_url) {
      throw new Error("Payment initiation failed");
    }

    return res.json({
      payment_url: ps.data.payment_url,
      invoice
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}