import { getOrders } from "../lib/db.js";

export default async function handler(req, res) {
  const invoice = req.query.invoice;

  if (!invoice) {
    return res.status(400).json({ error: "Missing invoice" });
  }

  const orders = await getOrders();

  const order = await orders.findOne(
    { invoice },
    {
      projection: {
        _id: 0,
        invoice: 1,
        amount: 1,
        status: 1,
        verified: 1,
        createdAt: 1
      }
    }
  );

  if (!order) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json(order);
}