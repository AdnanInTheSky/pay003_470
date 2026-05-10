// api/_db.js
// Shared MongoDB client with connection caching.
// Vercel serverless functions reuse the same process across warm invocations,
// so we cache the client on the global object to avoid opening a new connection
// on every request (the standard recommended pattern for serverless + MongoDB).

const { MongoClient } = require("mongodb");

const URI = process.env.MONGO_URI;

if (!URI) {
  throw new Error("Missing MONGO_URI environment variable");
}

// Cache on global so it survives across hot reloads in dev and warm lambdas in prod
let cached = global._mongoClient;

async function getDb() {
  if (cached) return cached;

  const client = new MongoClient(URI, {
    maxPoolSize: 10,          // keep ≤10 connections open
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  await client.connect();
  cached = client;
  global._mongoClient = client;

  return client;
}

module.exports = { getDb };