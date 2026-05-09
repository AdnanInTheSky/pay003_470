import axios from "axios";
import { getOrders } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const invoice = req.query.invoice_number;

    if (!invoice) {
      return res.status(400).send("Invalid request");
    }

    const orders = await getOrders();
    const order = await orders.findOne({ invoice });

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const r = await axios.post(
      "https://api.paystation.com.bd/transaction-status",
      { invoice_number: invoice },
      {
        headers: {
          merchantId: process.env.MERCHANT_ID
        },
        timeout: 10000
      }
    );

    const status = r.data?.data?.trx_status || "failed";

    await orders.updateOne(
      { invoice },
      {
        $set: {
          status,
          verified: true,
          verifiedAt: new Date()
        }
      }
    );

    const redirectBase = `/result.html`;

    return res.redirect(
      `${redirectBase}?invoice=${invoice}&status=${status}`
    );

  } catch (err) {
    return res.status(500).send("Callback error");
  }
}