// public/products.js
// ─────────────────────────────────────────────────────────────────────────────
// Product catalog for the storefront UI.
//
// IMPORTANT — PRICING SECURITY:
//   Prices listed here are used for DISPLAY ONLY.
//   The backend (api/index.js) keeps its own identical copy and ALWAYS
//   recalculates totals server-side before calling PayStation.
//   Editing prices here has zero effect on what the customer actually pays.
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTS = {
  p1: { name: "Wireless Earbuds",     price: 5,  emoji: "🎧", desc: "Crystal-clear sound with 24hr battery life." },
  p2: { name: "Phone Case",           price: 3,  emoji: "📱", desc: "Military-grade drop protection, slim fit." },
  p3: { name: "USB-C Cable",          price: 18, emoji: "🔌", desc: "Fast-charge 100W, braided nylon, 2m." },
  p4: { name: "Power Bank 10000mAh",  price: 9,  emoji: "🔋", desc: "Dual-port, charges two devices at once." },
  p5: { name: "Screen Protector",     price: 12, emoji: "🛡️", desc: "9H tempered glass, oleophobic coating." },
  p6: { name: "Smart Watch Strap",    price: 28, emoji: "⌚", desc: "Soft silicone, sweat-resistant, fits 20–22mm." },
};