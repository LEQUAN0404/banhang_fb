// Cơ sở dữ liệu — theo "Chuẩn dữ liệu cốt lõi" (mục 5 của quy trình)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'banhang.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// node:sqlite không nhận undefined/boolean — chuẩn hóa tham số cho mọi câu lệnh
const fix = a => a.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const rawPrepare = db.prepare.bind(db);
db.prepare = sql => {
  const st = rawPrepare(sql);
  return { run: (...a) => st.run(...fix(a)), get: (...a) => st.get(...fix(a)), all: (...a) => st.all(...fix(a)) };
};

db.exec(`
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, fb_url TEXT, order_prefix TEXT NOT NULL DEFAULT 'FB',
  settings TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','sales','warehouse')), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS user_pages (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, page_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), code TEXT NOT NULL,
  name TEXT NOT NULL, phone TEXT NOT NULL, fb_link TEXT,
  province TEXT, district TEXT, ward TEXT, street TEXT,
  usual_size TEXT, source TEXT, tags TEXT NOT NULL DEFAULT '', note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (page_id, phone), UNIQUE (page_id, code)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), code TEXT NOT NULL,
  name TEXT NOT NULL, image_url TEXT, price INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0,
  low_threshold INTEGER NOT NULL DEFAULT 3, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (page_id, code)
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, size, color)
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, variant_id INTEGER NOT NULL REFERENCES variants(id), qty INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('nhap','xuat','hoan','dieu_chinh')), order_id INTEGER, note TEXT,
  user_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT, phone TEXT, fb_link TEXT, channel TEXT NOT NULL DEFAULT 'inbox',
  source TEXT, content_code TEXT, is_new_customer INTEGER NOT NULL DEFAULT 1,
  interest TEXT, summary TEXT, tags TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'dang_tu_van' CHECK (outcome IN ('dang_tu_van','chot','khong_chot')),
  lost_reason TEXT, order_id INTEGER, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id), conversation_id INTEGER,
  parent_order_id INTEGER REFERENCES orders(id), kind TEXT NOT NULL DEFAULT 'ban' CHECK (kind IN ('ban','doi')),
  source TEXT, content_code TEXT, campaign_code TEXT,
  ship_name TEXT NOT NULL, ship_phone TEXT NOT NULL, province TEXT, district TEXT, ward TEXT, street TEXT,
  note TEXT, is_preorder INTEGER NOT NULL DEFAULT 0, stock_deducted INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0, ship_fee INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT 'cod' CHECK (pay_method IN ('cod','ck','coc')),
  paid_amount INTEGER NOT NULL DEFAULT 0, deposit_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'moi_tao',
  carrier TEXT, tracking_code TEXT, shipped_at TEXT, delivered_at TEXT, ship_cost_actual INTEGER,
  delivery_fail_count INTEGER NOT NULL DEFAULT 0, last_fail_note TEXT, last_fail_at TEXT,
  cancel_reason TEXT, return_reason TEXT, reminded_at TEXT,
  care_status TEXT, care_note TEXT, care_at TEXT,
  user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id), product_name TEXT NOT NULL, size TEXT, color TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0), price INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, from_status TEXT, to_status TEXT, note TEXT, user_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cod','ck','tien_mat')), amount INTEGER NOT NULL,
  ref TEXT, note TEXT, user_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS reconciliations (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), day TEXT NOT NULL,
  data TEXT NOT NULL, note TEXT, user_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (page_id, day)
);
CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), day TEXT NOT NULL,
  campaign_code TEXT, amount INTEGER NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS improvements (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), week TEXT NOT NULL,
  problem TEXT, action TEXT NOT NULL, result TEXT, done INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY, page_id INTEGER, user_id INTEGER, action TEXT NOT NULL, detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_orders_page_status ON orders(page_id, status);
CREATE INDEX IF NOT EXISTS ix_orders_page_created ON orders(page_id, created_at);
CREATE INDEX IF NOT EXISTS ix_conv_page ON conversations(page_id, created_at);
CREATE INDEX IF NOT EXISTS ix_moves_variant ON stock_moves(variant_id, at);
`);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx };
