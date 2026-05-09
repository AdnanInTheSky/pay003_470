export const PRODUCTS = {
  p1: { name: "Wireless Earbuds", price: 5 },
  p2: { name: "Phone Case", price: 3 },
  p3: { name: "USB-C Cable", price: 18 },
  p4: { name: "Power Bank 10000mAh", price: 9 },
  p5: { name: "Screen Protector", price: 12 },
  p6: { name: "Smart Watch Strap", price: 28 }
};

export function calc(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Invalid cart");
  }

  let total = 0;
  const lines = [];

  for (const i of items) {
    const p = PRODUCTS[i.id];
    if (!p) throw new Error("Invalid product: " + i.id);

    const qty = Math.min(Math.max(Number(i.qty || 1), 1), 10);
    const subtotal = p.price * qty;

    total += subtotal;
    lines.push({
      id: i.id,
      name: p.name,
      price: p.price,
      qty,
      subtotal
    });
  }

  return { total, lines };
}