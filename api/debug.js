// api/debug.js
// TEMPORARY — delete this file before going to production
// Visit /api/debug after deploying to see what's failing

const { getDb } = require("./_db");

module.exports = async function handler(req, res) {
  const result = {
    env: {
      MONGO_URI:            process.env.MONGO_URI ? "✅ set" : "❌ MISSING",
      MERCHANT_ID:          process.env.MERCHANT_ID ? "✅ set" : "❌ MISSING",
      PAYSTATION_PASSWORD:  process.env.PAYSTATION_PASSWORD ? "✅ set" : "❌ MISSING",
      PAYSTATION_ENV:       process.env.PAYSTATION_ENV || "❌ MISSING",
      APP_URL:              process.env.APP_URL || "❌ MISSING",
    },
    mongo: null,
    error: null,
  };

  try {
    const client = await getDb();
    const db     = client.db("paystation_demo");

    // Ping the database
    await db.command({ ping: 1 });

    // Count orders
    const count = await db.collection("orders").countDocuments({});

    result.mongo = {
      status:      "✅ connected",
      database:    "paystation_demo",
      orderCount:  count,
    };
  } catch (err) {
    result.mongo  = "❌ failed";
    result.error  = err.message;
  }

  return res.status(200).json(result);
};