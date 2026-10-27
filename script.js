const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = n => "₹" + Number(n).toLocaleString("en-IN");
const sq = s => "'" + String(s).replace(/'/g, "''") + "'"; // SQL string literal for the console panel

/* ---------- Data lives in MySQL; D is just a cache of the last fetch ---------- */
const D = { suppliers: [], products: [], movements: [] };

async function api(method, url, body) {
    const r = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
}
async function load() { Object.assign(D, await api("GET", "/api/data")); }

const sup = id => D.suppliers.find(s => s._id === id)?.name || id;
const prod = id => D.products.find(p => p._id === id);
const status = p => p.qty === 0 ? ["Out of stock", "out"] : p.qty <= p.reorder ? ["Low", "low"] : ["In stock", "ok"];
function shell(t) { $("#shell").innerHTML = "<em>-- last query</em>\n" + esc(t) }
function toast(m) { const t = $("#toast"); t.textContent = m; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", 2600) }

const COLL = [
    ["suppliers", "Supplier directory", "PRIMARY (id), idx_suppliers_name (name)"],
    ["products", "SKU master with tags (JSON) and dim_l / dim_w / dim_h columns", "PRIMARY (id), UNIQUE (sku), idx (category), FK supplier_id → suppliers"],
    ["stock_movements", "IN / OUT ledger", "PRIMARY (id), idx (product_id, moved_on), FK product_id → products"]
];

const TABS = ["Dashboard", "Products", "Movements", "Suppliers", "Reports", "Tables"];
let tab = "Dashboard";
$("#nav").innerHTML = TABS.map(t => `<button data-t="${t}">${t}</button>`).join("");
$("#nav").onclick = e => { if (e.target.dataset.t) { tab = e.target.dataset.t; render() } };
function render() {
    document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
    ({ Dashboard, Products, Movements, Suppliers, Reports, Tables: Collections })[tab]();
}

/* ---------- Dashboard ---------- */
function Dashboard() {
    const P = D.products, val = P.reduce((a, p) => a + p.qty * p.price, 0), low = P.filter(p => p.qty > 0 && p.qty <= p.reorder), out = P.filter(p => p.qty === 0);
    shell("SELECT COUNT(*) AS products, SUM(qty*price) AS stock_value,\n       SUM(qty > 0 AND qty <= reorder) AS low, SUM(qty = 0) AS out_of_stock\nFROM products;");
    $("#view").innerHTML = `<div class="grid">
<div class="card stat"><b>${P.length}</b><span>Products tracked</span></div>
<div class="card stat"><b>${money(val)}</b><span>Stock value</span></div>
<div class="card stat"><b class="low">${low.length}</b><span>Below reorder level</span></div>
<div class="card stat"><b class="out">${out.length}</b><span>Out of stock</span></div></div>
<div class="card"><h2>Needs restocking</h2><div class="wrap"><table><tr><th>SKU</th><th>Product</th><th>Supplier</th><th>On hand</th><th>Reorder at</th><th></th></tr>
${[...out, ...low].map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(sup(p.supplier))}</td><td class="${status(p)[1]}">${p.qty}</td><td>${p.reorder}</td><td><button class="btn sm" onclick="moveDlg('${p._id}')">Receive stock</button></td></tr>`).join("") || "<tr><td colspan=6>Everything is above its reorder level.</td></tr>"}</table></div></div>`
}

/* ---------- Products ---------- */
const F = { q: "", cat: "", st: "", min: "", max: "", tag: "", lim: 10 };
function Products() {
    $("#view").innerHTML = `<div class="card"><div class="bar">
<label>Text search<input id="fq" placeholder="name or tag" value="${esc(F.q)}"></label>
<label>Category<select id="fc"><option value="">All</option>${[...new Set(D.products.map(p => p.category))].map(c => `<option ${F.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
<label>Status<select id="fs">${[["", "All"], ["low", "Low or out"], ["out", "Out of stock"], ["ok", "In stock"]].map(o => `<option value="${o[0]}" ${F.st === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></label>
<label>Min price<input id="fmin" type="number" style="width:90px" value="${F.min}"></label>
<label>Max price<input id="fmax" type="number" style="width:90px" value="${F.max}"></label>
<label>Limit<select id="fl">${[5, 10, 20].map(n => `<option ${F.lim == n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
<button class="btn" onclick="prodDlg()">Add product</button></div>
<div class="wrap" id="ptable"></div></div>`;
    ["fq", "fc", "fs", "fmin", "fmax", "fl"].forEach(id => $("#" + id).oninput = () => { F.q = $("#fq").value; F.cat = $("#fc").value; F.st = $("#fs").value; F.min = $("#fmin").value; F.max = $("#fmax").value; F.lim = +$("#fl").value; prodRows() });
    prodRows()
}
function prodRows() {
    let r = D.products.slice(), w = [];
    if (F.q) { const ws = F.q.toLowerCase().split(/\s+/); r = r.filter(p => ws.some(x => (p.name + " " + p.tags.join(" ")).toLowerCase().includes(x))); w.push(`(name LIKE ${sq("%" + F.q + "%")} OR JSON_SEARCH(tags,'one',${sq("%" + F.q + "%")}) IS NOT NULL)`) }
    if (F.cat) { r = r.filter(p => p.category === F.cat); w.push(`category = ${sq(F.cat)}`) }
    if (F.min) { r = r.filter(p => p.price >= +F.min); w.push(`price >= ${+F.min}`) }
    if (F.max) { r = r.filter(p => p.price <= +F.max); w.push(`price <= ${+F.max}`) }
    if (F.st === "low") { r = r.filter(p => p.qty <= p.reorder); w.push("qty <= reorder") }
    if (F.st === "out") { r = r.filter(p => p.qty === 0); w.push("qty = 0") }
    if (F.st === "ok") { r = r.filter(p => p.qty > p.reorder); w.push("qty > reorder") }
    const total = r.length; r = r.slice(0, F.lim);
    shell(`SELECT sku, name, price, qty, category, tags\nFROM products${w.length ? "\nWHERE " + w.join("\n  AND ") : ""}\nORDER BY name\nLIMIT ${F.lim};   -- ${total} match`);
    $("#ptable").innerHTML = `<table><tr><th>SKU</th><th>Name</th><th>Category</th><th>Tags</th><th>Size (cm)</th><th>Price</th><th>Qty</th><th>Status</th><th></th></tr>
${r.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${p.tags.map(t => `<span class="pill">${esc(t)}</span>`).join("")}</td><td>${p.dims.l}×${p.dims.w}×${p.dims.h}</td><td>${money(p.price)}</td><td>${p.qty}</td><td class="${status(p)[1]}">${status(p)[0]}</td>
<td style="white-space:nowrap"><button class="btn sm sec" onclick="prodDlg('${p._id}')">Edit</button> <button class="btn sm del" onclick="delProd('${p._id}')">Delete</button></td></tr>`).join("") || "<tr><td colspan=9>No products match these filters. Clear a filter to see more.</td></tr>"}</table>`
}
function prodDlg(id) {
    const p = id ? prod(id) : { sku: "", name: "", category: "Electronics", supplier: D.suppliers[0]?._id || "", price: "", qty: 0, reorder: 10, tags: [], dims: { l: "", w: "", h: "" } };
    $("#dlg").innerHTML = `<h2>${id ? "Edit product" : "Add product"}</h2>
<div class="f2"><label>SKU<input id="d_sku" value="${esc(p.sku)}"></label><label>Name<input id="d_name" value="${esc(p.name)}"></label>
<label>Category<input id="d_cat" list="cats" value="${esc(p.category)}"><datalist id="cats">${[...new Set(D.products.map(x => x.category))].map(c => `<option>${esc(c)}</option>`).join("")}</datalist></label>
<label>Supplier<select id="d_sup">${D.suppliers.map(s => `<option value="${s._id}" ${s._id === p.supplier ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
<label>Price (₹)<input id="d_price" type="number" value="${p.price}"></label><label>Quantity<input id="d_qty" type="number" value="${p.qty}"></label>
<label>Reorder level<input id="d_re" type="number" value="${p.reorder}"></label><label>Tags (comma separated)<input id="d_tags" value="${esc(p.tags.join(", "))}"></label>
<label>Length<input id="d_l" type="number" value="${p.dims.l}"></label><label>Width<input id="d_w" type="number" value="${p.dims.w}"></label><label>Height<input id="d_h" type="number" value="${p.dims.h}"></label></div>
<div class="bar"><button class="btn" onclick="saveProd('${id || ""}')">Save product</button><button class="btn sec" onclick="$('#dlg').close()">Cancel</button></div>`;
    $("#dlg").showModal()
}
async function saveProd(id) {
    const v = i => $("#" + i).value.trim();
    if (!v("d_sku") || !v("d_name") || !v("d_price")) { toast("SKU, name and price are required"); return }
    if (!v("d_sup")) { toast("Add a supplier first"); return }
    const doc = { sku: v("d_sku"), name: v("d_name"), category: v("d_cat"), supplier: v("d_sup"), price: +v("d_price"), qty: +v("d_qty"), reorder: +v("d_re"), tags: v("d_tags").split(",").map(t => t.trim()).filter(Boolean), dims: { l: +v("d_l"), w: +v("d_w"), h: +v("d_h") } };
    try {
        if (id) await api("PUT", "/api/products/" + id, doc); else await api("POST", "/api/products", doc);
        await load()
    } catch (e) { toast(e.message); return }
    const cols = `sku=${sq(doc.sku)}, name=${sq(doc.name)}, category=${sq(doc.category)}, supplier_id=${doc.supplier}, price=${doc.price}, qty=${doc.qty}, reorder=${doc.reorder}, tags=${sq(JSON.stringify(doc.tags))}, dim_l=${doc.dims.l}, dim_w=${doc.dims.w}, dim_h=${doc.dims.h}`;
    $("#dlg").close(); toast(id ? "Product updated" : "Product added"); Products();
    shell(id ? `UPDATE products SET ${cols}\nWHERE id = ${id};` : `INSERT INTO products SET ${cols};`)
}
async function delProd(id) {
    if (!confirm("Delete this product? Its stock movements will be deleted too.")) return;
    try { await api("DELETE", "/api/products/" + id); await load() } catch (e) { toast(e.message); return }
    Products(); shell(`DELETE FROM products WHERE id = ${id};`); toast("Product deleted")
}

/* ---------- Movements ---------- */
function Movements() {
    const r = [...D.movements].sort((a, b) => b.date.localeCompare(a.date) || b._id - a._id);
    $("#view").innerHTML = `<div class="card"><div class="bar"><h2 style="margin-right:auto">Stock ledger</h2><button class="btn" onclick="moveDlg()">Record movement</button></div>
<div class="wrap"><table><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reference</th></tr>
${r.map(m => `<tr><td>${m.date}</td><td>${esc(prod(m.product)?.name || m.product)}</td><td class="${m.type === "IN" ? "ok" : "low"}">${m.type === "IN" ? "Received" : "Issued"}</td><td>${m.qty}</td><td>${esc(m.note)}</td></tr>`).join("")}</table></div></div>`;
    shell("SELECT m.moved_on, p.name, m.type, m.qty, m.note\nFROM stock_movements m JOIN products p ON p.id = m.product_id\nORDER BY m.moved_on DESC, m.id DESC\nLIMIT 50;")
}
function moveDlg(pid) {
    $("#dlg").innerHTML = `<h2>Record stock movement</h2><div class="f2">
<label>Product<select id="m_p">${D.products.map(p => `<option value="${p._id}" ${p._id === pid ? "selected" : ""}>${esc(p.name)} (${p.qty})</option>`).join("")}</select></label>
<label>Type<select id="m_t"><option value="IN">Received (IN)</option><option value="OUT">Issued (OUT)</option></select></label>
<label>Quantity<input id="m_q" type="number" min="1" value="10"></label><label>Reference<input id="m_n" placeholder="PO / SO number"></label></div>
<div class="bar"><button class="btn" onclick="saveMove()">Save movement</button><button class="btn sec" onclick="$('#dlg').close()">Cancel</button></div>`;
    $("#dlg").showModal()
}
async function saveMove() {
    const p = prod($("#m_p").value), t = $("#m_t").value, q = +$("#m_q").value, note = $("#m_n").value.trim() || "manual";
    if (!(q > 0)) { toast("Enter a quantity above 0"); return }
    if (t === "OUT" && q > p.qty) { toast(`Only ${p.qty} on hand for ${p.name}`); return }
    try { await api("POST", "/api/movements", { product: p._id, type: t, qty: q, note }); await load() } catch (e) { toast(e.message); return }
    $("#dlg").close(); toast("Movement saved"); render();
    shell(`START TRANSACTION;\nINSERT INTO stock_movements (product_id, type, qty, moved_on, note)\nVALUES (${p._id}, '${t}', ${q}, CURDATE(), ${sq(note)});\nUPDATE products SET qty = qty ${t === "IN" ? "+" : "-"} ${q} WHERE id = ${p._id};\nCOMMIT;`)
}

/* ---------- Suppliers ---------- */
function Suppliers() {
    $("#view").innerHTML = `<div class="card"><div class="bar"><h2 style="margin-right:auto">Suppliers</h2>
<label>Name<input id="s_n"></label><label>City<input id="s_c"></label><label>Phone<input id="s_p"></label><button class="btn" onclick="addSup()">Add supplier</button></div>
<div class="wrap"><table><tr><th>Name</th><th>City</th><th>Phone</th><th>Rating</th><th>Products</th><th></th></tr>
${D.suppliers.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.city)}</td><td>${esc(s.phone)}</td><td>${s.rating}</td><td>${D.products.filter(p => p.supplier === s._id).length}</td><td><button class="btn sm del" onclick="delSup('${s._id}')">Delete</button></td></tr>`).join("")}</table></div></div>`;
    shell("SELECT s.name, s.city, s.phone, s.rating, COUNT(p.id) AS products\nFROM suppliers s LEFT JOIN products p ON p.supplier_id = s.id\nGROUP BY s.id\nORDER BY s.rating DESC;")
}
async function addSup() {
    const n = $("#s_n").value.trim(), c = $("#s_c").value.trim(), ph = $("#s_p").value.trim();
    if (!n) { toast("Enter a supplier name"); return }
    try { await api("POST", "/api/suppliers", { name: n, city: c, phone: ph }); await load() } catch (e) { toast(e.message); return }
    Suppliers(); shell(`INSERT INTO suppliers (name, city, phone, rating)\nVALUES (${sq(n)}, ${sq(c)}, ${sq(ph)}, 4.0);`)
}
async function delSup(id) {
    if (D.products.some(p => p.supplier === id)) { toast("Supplier still has products. Reassign them first."); return }
    try { await api("DELETE", "/api/suppliers/" + id); await load() } catch (e) { toast(e.message); return }
    Suppliers(); shell(`DELETE FROM suppliers WHERE id = ${id};`)
}

/* ---------- Reports (GROUP BY queries; charts computed from the fetched rows) ---------- */
function Reports() {
    const by = {}; D.products.forEach(p => { const c = by[p.category] ??= { _id: p.category, items: 0, units: 0, value: 0 }; c.items++; c.units += p.qty; c.value += p.qty * p.price });
    const A = Object.values(by).sort((a, b) => b.value - a.value), maxA = Math.max(...A.map(a => a.value), 1);
    const out = {}; D.movements.filter(m => m.type === "OUT").forEach(m => out[m.product] = (out[m.product] || 0) + m.qty);
    const B = Object.entries(out).map(([id, q]) => ({ name: prod(id)?.name || id, sold: q })).sort((a, b) => b.sold - a.sold).slice(0, 5), maxB = Math.max(...B.map(b => b.sold), 1);
    const sp = {}; D.products.forEach(p => { const s = sp[p.supplier] ??= { _id: sup(p.supplier), products: 0, avgPrice: 0, sum: 0 }; s.products++; s.sum += p.price });
    const C = Object.values(sp).map(s => ({ ...s, avgPrice: Math.round(s.sum / s.products) })).sort((a, b) => b.avgPrice - a.avgPrice);
    shell("-- see the three GROUP BY queries below");
    const bars = (rows, k, l, f) => rows.map(r => `<tr><td>${esc(r[l])}</td><td style="width:45%"><div class="hbar" style="width:${r[k] / (k === "value" ? maxA : maxB) * 100}%"></div></td><td>${f(r[k])}</td></tr>`).join("");
    $("#view").innerHTML = `<div class="two">
<div class="card"><h3>1 · Stock value by category</h3><table style="min-width:0">${bars(A, "value", "_id", money)}</table>
<div class="shell" style="margin:10px 0 0">SELECT category, COUNT(*) AS items,
       SUM(qty * price) AS value
FROM products
GROUP BY category
ORDER BY value DESC;</div></div>
<div class="card"><h3>2 · Top issued products</h3><table style="min-width:0">${bars(B, "sold", "name", x => x + " units")}</table>
<div class="shell" style="margin:10px 0 0">SELECT p.name, SUM(m.qty) AS sold
FROM stock_movements m
JOIN products p ON p.id = m.product_id
WHERE m.type = 'OUT'
GROUP BY p.id
ORDER BY sold DESC
LIMIT 5;</div></div>
<div class="card"><h3>3 · Average price by supplier</h3><table style="min-width:0"><tr><th>Supplier</th><th>Products</th><th>Avg price</th></tr>${C.map(c => `<tr><td>${esc(c._id)}</td><td>${c.products}</td><td>${money(c.avgPrice)}</td></tr>`).join("")}</table>
<div class="shell" style="margin:10px 0 0">SELECT s.name, COUNT(*) AS products,
       ROUND(AVG(p.price)) AS avg_price
FROM products p
JOIN suppliers s ON s.id = p.supplier_id
GROUP BY s.id
ORDER BY avg_price DESC;</div></div>
<div class="card"><h3>Index setup</h3><div class="shell" style="margin:0">ALTER TABLE products ADD UNIQUE KEY uq_products_sku (sku);
ALTER TABLE products ADD INDEX idx_products_category (category);
ALTER TABLE stock_movements ADD INDEX idx_movements_product_date (product_id, moved_on);</div></div></div>`
}

/* ---------- Tables ---------- */
function Collections() {
    shell("SHOW TABLES;   -- 3 tables in inventory_db");
    $("#view").innerHTML = `<div class="card"><h2>Database tables</h2><div class="wrap"><table><tr><th>Table</th><th>Purpose</th><th>Keys &amp; indexes</th></tr>
${COLL.map(c => `<tr><td><b>${c[0]}</b></td><td>${c[1]}</td><td>${c[2]}</td></tr>`).join("")}</table></div></div>`
}

/* ---------- Boot ---------- */
load().then(render).catch(e => {
    $("#view").innerHTML = `<div class="card"><h2>Can't reach the database</h2><p>${esc(e.message)}</p><p>Make sure the server is running (<code>npm start</code>) and MySQL is configured in <code>.env</code>. Open the app via <b>http://localhost:5500</b>, not by double-clicking the HTML file.</p></div>`
});
