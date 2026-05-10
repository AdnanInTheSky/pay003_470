// api/_db.js
// Shared MongoDB client with connection caching.
// Always read from global — never use a module-level variable.
// Module-level vars reset on every cold start, but global persists
// across warm invocations within the same lambda instance.

const { MongoClient } = require("mongodb");

const URI = process.env.MONGO_URI;

if (!URI) {
  throw new Error("Missing MONGO_URI environment variable");
}

async function getDb() {
  if (global._mongoClient) return global._mongoClient;

  const client = new MongoClient(URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  await client.connect();
  global._mongoClient = client;

  return client;
}

module.exports = { getDb };