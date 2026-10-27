require("dotenv").config();
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

/* ---------- MySQL connection pool ---------- */
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "inventory_db",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL columns come back as numbers, not strings
  dateStrings: true     // DATE columns come back as 'YYYY-MM-DD'
});

/* ---------- Row -> JSON mappers (ids are strings so the UI can compare them safely) ---------- */
const toSupplier = r => ({ _id: String(r.id), name: r.name, city: r.city, phone: r.phone, rating: r.rating });
const toProduct = r => ({
  _id: String(r.id), sku: r.sku, name: r.name, category: r.category,
  supplier: String(r.supplier_id), price: r.price, qty: r.qty, reorder: r.reorder,
  tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags, // MariaDB returns JSON as text
  dims: { l: r.dim_l, w: r.dim_w, h: r.dim_h }, wh: r.warehouse
});
const toMovement = r => ({
  _id: String(r.id), product: String(r.product_id), type: r.type, qty: r.qty, date: r.moved_on, note: r.note
});

/* ---------- Helpers ---------- */
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const toId = v => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw httpErr(400, "Invalid id");
  return n;
};

function cleanProduct(b) {
  const sku = String(b.sku ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!sku || !name) throw httpErr(400, "SKU and name are required");
  const price = Number(b.price), qty = Number(b.qty), reorder = Number(b.reorder);
  if (!(price >= 0)) throw httpErr(400, "Price must be 0 or more");
  if (!Number.isInteger(qty) || qty < 0) throw httpErr(400, "Quantity must be a whole number, 0 or more");
  if (!Number.isInteger(reorder) || reorder < 0) throw httpErr(400, "Reorder level must be a whole number, 0 or more");
  const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean) : [];
  const d = b.dims || {};
  return {
    sku, name, category: String(b.category ?? "").trim() || "General",
    supplier_id: toId(b.supplier), price, qty, reorder, tags: JSON.stringify(tags),
    dim_l: Number(d.l) || 0, dim_w: Number(d.w) || 0, dim_h: Number(d.h) || 0
  };
}

/* ---------- App ---------- */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Everything the UI needs in one call
app.get("/api/data", wrap(async (req, res) => {
  const [[s], [p], [m]] = await Promise.all([
    pool.query("SELECT * FROM suppliers ORDER BY id"),
    pool.query("SELECT * FROM products ORDER BY id"),
    pool.query("SELECT * FROM stock_movements ORDER BY moved_on DESC, id DESC")
  ]);
  res.json({ suppliers: s.map(toSupplier), products: p.map(toProduct), movements: m.map(toMovement) });
}));

/* ----- Products ----- */
app.post("/api/products", wrap(async (req, res) => {
  const c = cleanProduct(req.body);
  const [r] = await pool.query(
    `INSERT INTO products (sku,name,category,supplier_id,price,qty,reorder,tags,dim_l,dim_w,dim_h)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [c.sku, c.name, c.category, c.supplier_id, c.price, c.qty, c.reorder, c.tags, c.dim_l, c.dim_w, c.dim_h]);
  res.status(201).json({ _id: String(r.insertId) });
}));

app.put("/api/products/:id", wrap(async (req, res) => {
  const id = toId(req.params.id), c = cleanProduct(req.body);
  const [r] = await pool.query(
    `UPDATE products SET sku=?,name=?,category=?,supplier_id=?,price=?,qty=?,reorder=?,tags=?,dim_l=?,dim_w=?,dim_h=?
     WHERE id=?`,
    [c.sku, c.name, c.category, c.supplier_id, c.price, c.qty, c.reorder, c.tags, c.dim_l, c.dim_w, c.dim_h, id]);
  if (!r.affectedRows) throw httpErr(404, "Product not found");
  res.json({ ok: true });
}));

app.delete("/api/products/:id", wrap(async (req, res) => {
  const [r] = await pool.query("DELETE FROM products WHERE id=?", [toId(req.params.id)]);
  if (!r.affectedRows) throw httpErr(404, "Product not found");
  res.json({ ok: true });
}));

/* ----- Stock movements (transaction: insert ledger row + update qty atomically) ----- */
app.post("/api/movements", wrap(async (req, res) => {
  const pid = toId(req.body.product);
  const type = req.body.type;
  const q = Number(req.body.qty);
  if (type !== "IN" && type !== "OUT") throw httpErr(400, "Type must be IN or OUT");
  if (!Number.isInteger(q) || q < 1) throw httpErr(400, "Enter a quantity above 0");
  const note = String(req.body.note || "").trim().slice(0, 120) || "manual";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT name, qty FROM products WHERE id=? FOR UPDATE", [pid]);
    if (!rows.length) throw httpErr(404, "Product not found");
    if (type === "OUT" && q > rows[0].qty) throw httpErr(400, `Only ${rows[0].qty} on hand for ${rows[0].name}`);
    await conn.query(
      "INSERT INTO stock_movements (product_id,type,qty,moved_on,note) VALUES (?,?,?,CURDATE(),?)",
      [pid, type, q, note]);
    await conn.query("UPDATE products SET qty = qty + ? WHERE id=?", [type === "IN" ? q : -q, pid]);
    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

/* ----- Suppliers ----- */
app.post("/api/suppliers", wrap(async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  if (!name) throw httpErr(400, "Enter a supplier name");
  const [r] = await pool.query(
    "INSERT INTO suppliers (name,city,phone,rating) VALUES (?,?,?,4.0)",
    [name, String(req.body.city ?? "").trim(), String(req.body.phone ?? "").trim()]);
  res.status(201).json({ _id: String(r.insertId) });
}));

app.delete("/api/suppliers/:id", wrap(async (req, res) => {
  const [r] = await pool.query("DELETE FROM suppliers WHERE id=?", [toId(req.params.id)]);
  if (!r.affectedRows) throw httpErr(404, "Supplier not found");
  res.json({ ok: true });
}));

/* ---------- Error handling ---------- */
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  let status = err.status || 500, message = err.message;
  if (err.code === "ER_DUP_ENTRY") { status = 409; message = "That SKU already exists (unique index)"; }
  else if (err.code === "ER_ROW_IS_REFERENCED_2") { status = 409; message = "Supplier still has products. Reassign them first."; }
  else if (err.code === "ER_NO_REFERENCED_ROW_2") { status = 400; message = "Selected supplier does not exist"; }
  if (status === 500) { console.error(err); message = "Database error. Check the server console."; }
  res.status(status).json({ error: message });
});

/* ---------- Start ---------- */
const PORT = Number(process.env.PORT || 5500);
pool.query("SELECT 1")
  .then(() => {
    console.log(`Connected to MySQL database "${process.env.DB_NAME || "inventory_db"}"`);
    app.listen(PORT, () => console.log(`StockRoom running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("Could not connect to MySQL:", err.code || "", err.message);
    console.error("Check DB_HOST / DB_USER / DB_PASSWORD in .env and that you ran schema.sql");
    process.exit(1);
  });
