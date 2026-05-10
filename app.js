const products = {
    p1: { name: "Wireless Earbuds Pro",  price: 1490, cat: "Audio",       desc: "Noise cancelling, 30hr battery" },
    p2: { name: "Premium Phone Case",    price:  490, cat: "Accessories", desc: "Shockproof, leather finish" },
    p3: { name: "USB-C Braided Cable",   price:  390, cat: "Cables",      desc: "2m length, fast charging" },
    p4: { name: "Power Bank 10000 mAh",  price: 1290, cat: "Power",       desc: "Dual output, fast charge" },
    p5: { name: "Tempered Glass Set",    price:  350, cat: "Protection",  desc: "9H hardness, 3 pack" },
    p6: { name: "Smart Watch Strap",     price:  590, cat: "Wearables",   desc: "Silicone, sweat resistant" },
    p7: { name: "Portable LED Lamp",     price:  890, cat: "Lighting",    desc: "Touch control, rechargeable" },
    p8: { name: "Bamboo Desk Organiser", price:  990, cat: "Office",      desc: "Eco-friendly, 5 compartments" },
};

const rupee = (n) => '₹' + n.toLocaleString('en-IN');

function send() {
    const input = document.getElementById('input');
    const text = input.value.trim();
    if (!text) return;
    
    add(text, true);
    input.value = '';
    
    document.getElementById('typing').classList.remove('hidden');
    scroll();
    
    setTimeout(() => {
        document.getElementById('typing').classList.add('hidden');
        add(reply(text), false);
    }, 600);
}

function add(text, user) {
    const chat = document.getElementById('chat');
    const div = document.createElement('div');
    div.className = 'msg flex gap-2 ' + (user ? 'justify-end' : '');
    div.innerHTML = user 
        ? `<div class="bg-indigo-600 text-white rounded-xl rounded-tr-sm px-3 py-2 text-sm max-w-[80%]">${esc(text)}</div>`
        : `<div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-sm shrink-0">🤖</div><div class="bg-white border border-slate-200 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-slate-700 max-w-[80%]">${text}</div>`;
    chat.appendChild(div);
    scroll();
}

function scroll() {
    document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;
}

function esc(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

// ---- BOT BRAIN ----

function reply(input) {
    const q = input.toLowerCase();
    
    // find product by id or name
    let id = null, p = null;
    const idMatch = q.match(/\b(p[1-8])\b/);
    if (idMatch) { id = idMatch[1]; p = products[id]; }
    else {
        for (const [pid, prod] of Object.entries(products)) {
            if (q.includes(prod.name.toLowerCase().split(' ')[0]) || q.includes(prod.name.toLowerCase().split(' ')[1])) {
                id = pid; p = prod; break;
            }
        }
    }
    
    // greetings
    if (/hi|hello|hey|yo/.test(q)) {
        return "Hey! 👋 Ask me about any product. Try <b>price of p1</b> or <b>what do you have?</b>";
    }
    
    // all products
    if (/all|list|catalog|everything|what do you have/.test(q)) {
        let h = "<b>📋 All Products:</b><br><br>";
        for (const [pid, prod] of Object.entries(products)) {
            h += `<b>${pid}</b> — ${prod.name}<br><span class="text-indigo-600 font-bold">${rupee(prod.price)}</span><br><span class="text-xs text-slate-500">${prod.desc}</span><br><br>`;
        }
        return h;
    }
    
    // specific product (price or details)
    if (p) {
        if (/price|cost|how much/.test(q)) {
            return `<b>${p.name}</b><br><span class="text-2xl font-bold text-indigo-600">${rupee(p.price)}</span><br><span class="text-xs text-slate-500">${p.cat} • ${p.desc}</span>`;
        }
        return `<b>${p.name}</b> (${id})<br>${p.desc}<br><b class="text-indigo-600">${rupee(p.price)}</b><br><span class="text-xs text-slate-500">${p.cat}</span>`;
    }
    
    // cheapest
    if (/cheapest|lowest|affordable/.test(q)) {
        const sorted = Object.entries(products).sort((a,b) => a[1].price - b[1].price);
        let h = "<b>🏷️ Cheapest First:</b><br><br>";
        for (const [pid, prod] of sorted) {
            h += `• ${prod.name} — <b class="text-indigo-600">${rupee(prod.price)}</b><br>`;
        }
        return h;
    }
    
    // expensive
    if (/expensive|premium|highest/.test(q)) {
        const sorted = Object.entries(products).sort((a,b) => b[1].price - a[1].price);
        let h = "<b>💎 Premium First:</b><br><br>";
        for (const [pid, prod] of sorted) {
            h += `• ${prod.name} — <b class="text-indigo-600">${rupee(prod.price)}</b><br>`;
        }
        return h;
    }
    
    // under budget
    const budget = q.match(/\d+/)?.[0];
    if (budget && /under|below|less|cheaper/.test(q)) {
        const found = Object.entries(products).filter(([_,prod]) => prod.price <= budget);
        if (!found.length) return `Nothing under ${rupee(budget)}. Cheapest is ${products.p5.name} at ${rupee(products.p5.price)}.`;
        let h = `<b>Under ${rupee(budget)}:</b><br><br>`;
        for (const [pid, prod] of found.sort((a,b) => a[1].price - b[1].price)) {
            h += `• ${prod.name} — <b>${rupee(prod.price)}</b><br>`;
        }
        return h;
    }
    
    // category
    const cats = [...new Set(Object.values(products).map(x => x.cat.toLowerCase()))];
    for (const cat of cats) {
        if (q.includes(cat)) {
            const found = Object.entries(products).filter(([_,prod]) => prod.cat.toLowerCase() === cat);
            let h = `<b>🏷️ ${cat.charAt(0).toUpperCase() + cat.slice(1)}:</b><br><br>`;
            for (const [pid, prod] of found) {
                h += `• ${prod.name} — <b>${rupee(prod.price)}</b><br>`;
            }
            return h;
        }
    }
    
    // compare two
    const two = q.match(/\b(p[1-8])\b/g);
    if (two && two.length >= 2) {
        const [a, b] = two;
        const pa = products[a], pb = products[b];
        return `<b>⚖️ Compare:</b><br><br><b>${pa.name}</b> — ${rupee(pa.price)}<br>${pa.desc}<br><br><b>${pb.name}</b> — ${rupee(pb.price)}<br>${pb.desc}<br><br>Difference: <b>${rupee(Math.abs(pa.price - pb.price))}</b>`;
    }
    
    // total value of all
    if (/total|sum|all combined|worth/.test(q)) {
        const total = Object.values(products).reduce((s, p) => s + p.price, 0);
        return `If you bought <b>everything</b>:<br><span class="text-2xl font-bold text-indigo-600">${rupee(total)}</span>`;
    }
    
    // random pick
    if (/random|surprise|pick one|what should i buy/.test(q)) {
        const keys = Object.keys(products);
        const pick = keys[Math.floor(Math.random() * keys.length)];
        const prod = products[pick];
        return `🎲 <b>Random Pick:</b><br><br><b>${prod.name}</b><br>${prod.desc}<br><b class="text-indigo-600 text-lg">${rupee(prod.price)}</b><br><br>Say <b>price of ${pick}</b> for more details!`;
    }
    
    // joke
    if (/joke|funny|laugh/.test(q)) {
        return "Why do programmers prefer dark mode? <br><br>Because light attracts <b>bugs</b>! 🐛";
    }
    
    // time
    if (/time|clock/.test(q)) {
        return `⏰ It's ${new Date().toLocaleTimeString()}`;
    }
    
    // date
    if (/date|day|today/.test(q)) {
        return `📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
    }
    
    // thanks
    if (/thanks|thank you|ty/.test(q)) {
        return "You're welcome! 😊";
    }
    
    // bye
    if (/bye|goodbye|see you/.test(q)) {
        return "👋 Bye! Come back anytime.";
    }
    
    // help
    if (/help|what can you do|commands/.test(q)) {
        return `<b>Things I know:</b><br><br>• "price of p1"<br>• "tell me about earbuds"<br>• "all products"<br>• "cheapest items"<br>• "under 500"<br>• "compare p1 and p4"<br>• "audio products"<br>• "random pick"<br>• "total value"`;
    }
    
    // fallback
    return `Hmm, not sure. 🤔<br><br>Try: <b>price of p1</b>, <b>all products</b>, or <b>help</b>`;
}