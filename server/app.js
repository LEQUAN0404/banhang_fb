const express = require('express');
const path = require('path');
const { db, tx } = require('./db');
const D = require('./domain');
const { AppError } = D;
const { hashPassword, verifyPassword, createSession, userFromReq } = require('./auth');

const Meta = require('./meta');
const AI = require('./ai');

const app = express();
app.set('trust proxy', 1);

// ---------- Webhook Meta (đặt trước express.json để giữ nguyên body gốc khi kiểm tra chữ ký) ----------
app.get('/webhooks/meta', (req, res) => {
  const vt = Meta.cfg().verifyToken;
  if (req.query['hub.mode'] === 'subscribe' && vt && req.query['hub.verify_token'] === vt) return res.status(200).send(String(req.query['hub.challenge'] || ''));
  res.sendStatus(403);
});
app.post('/webhooks/meta', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!Meta.verifySignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
  res.sendStatus(200); // trả lời Meta ngay, xử lý sau
  Meta.handleWebhook(body).catch(e => console.error('Webhook lỗi:', e));
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const wrap = fn => (req, res, next) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
const int = v => (v === '' || v == null ? null : Math.round(Number(v)));

app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

// ---------- Đăng nhập ----------
app.post('/api/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(req.body.username || '').trim().toLowerCase());
  if (!u || !u.active || !verifyPassword(String(req.body.password || ''), u.password_hash)) throw new AppError('Sai tên đăng nhập hoặc mật khẩu', 401);
  const token = createSession(u.id);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${process.env.HTTPS ? '; Secure' : ''}`);
  D.log(null, u.id, 'dang_nhap', u.username);
  return { ok: true };
}));

app.use('/api', (req, res, next) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = u; next();
});

app.post('/api/logout', wrap((req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.user.token);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  return { ok: true };
}));

app.post('/api/me/password', wrap(req => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(String(req.body.old || ''), u.password_hash)) throw new AppError('Mật khẩu cũ không đúng');
  if (String(req.body.new || '').length < 6) throw new AppError('Mật khẩu mới tối thiểu 6 ký tự');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(req.body.new), u.id);
  return { ok: true };
}));

app.get('/api/me', wrap(req => {
  const pages = req.user.pageIds.length
    ? db.prepare(`SELECT id,name,fb_url,order_prefix,active FROM pages WHERE id IN (${req.user.pageIds.map(() => '?').join(',')}) ORDER BY name`).all(...req.user.pageIds)
    : [];
  const { token, ...user } = req.user;
  return {
    user, pages,
    meta: { AI_MODES: D.AI_MODES, STATUS: D.STATUS, TRANSITIONS: D.TRANSITIONS, PAY_METHODS: D.PAY_METHODS, ROLES: D.ROLES, CARRIERS: D.CARRIERS, SOURCES: D.SOURCES, PROVINCES: D.PROVINCES },
  };
}));

const need = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : next(new AppError('Bạn không có quyền thực hiện thao tác này', 403));

// ---------- Quản trị: Page & người dùng ----------
app.get('/api/admin/pages', need('admin'), wrap(() => db.prepare('SELECT * FROM pages ORDER BY id').all()));
app.post('/api/admin/pages', need('admin'), wrap(req => {
  const { name, fb_url, order_prefix } = req.body;
  if (!name) throw new AppError('Thiếu tên Page');
  const prefix = String(order_prefix || 'FB').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'FB';
  const r = db.prepare('INSERT INTO pages (name,fb_url,order_prefix) VALUES (?,?,?)').run(name, fb_url || null, prefix);
  D.log(Number(r.lastInsertRowid), req.user.id, 'tao_page', name);
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/admin/pages/:id', need('admin'), wrap(req => {
  const { name, fb_url, order_prefix, active } = req.body;
  db.prepare('UPDATE pages SET name=COALESCE(?,name), fb_url=?, order_prefix=COALESCE(?,order_prefix), active=COALESCE(?,active) WHERE id=?')
    .run(name || null, fb_url || null, order_prefix ? String(order_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '') : null, active == null ? null : (active ? 1 : 0), req.params.id);
  return { ok: true };
}));
app.get('/api/admin/users', need('admin'), wrap(() => {
  const users = db.prepare('SELECT id,username,name,role,active,created_at FROM users ORDER BY id').all();
  for (const u of users) u.page_ids = db.prepare('SELECT page_id FROM user_pages WHERE user_id=?').all(u.id).map(r => r.page_id);
  return users;
}));
function saveUserPages(userId, ids) {
  db.prepare('DELETE FROM user_pages WHERE user_id=?').run(userId);
  for (const pid of ids || []) db.prepare('INSERT OR IGNORE INTO user_pages (user_id,page_id) VALUES (?,?)').run(userId, pid);
}
app.post('/api/admin/users', need('admin'), wrap(req => {
  const { username, name, password, role, page_ids } = req.body;
  const un = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(un)) throw new AppError('Tên đăng nhập 3–30 ký tự, chỉ gồm chữ thường, số, . _ -');
  if (!name) throw new AppError('Thiếu họ tên');
  if (String(password || '').length < 6) throw new AppError('Mật khẩu tối thiểu 6 ký tự');
  if (!D.ROLES[role]) throw new AppError('Vai trò không hợp lệ');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(un)) throw new AppError('Tên đăng nhập đã tồn tại');
  return tx(() => {
    const r = db.prepare('INSERT INTO users (username,name,password_hash,role) VALUES (?,?,?,?)').run(un, name, hashPassword(password), role);
    saveUserPages(Number(r.lastInsertRowid), page_ids);
    D.log(null, req.user.id, 'tao_tai_khoan', `${un} (${role})`);
    return { id: Number(r.lastInsertRowid) };
  });
}));
app.put('/api/admin/users/:id', need('admin'), wrap(req => {
  const id = Number(req.params.id);
  const { name, role, active, password, page_ids } = req.body;
  if (role && !D.ROLES[role]) throw new AppError('Vai trò không hợp lệ');
  if (id === req.user.id && (role && role !== 'admin' || active === false)) throw new AppError('Không thể tự hạ quyền hoặc khóa chính mình');
  return tx(() => {
    db.prepare('UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=?')
      .run(name || null, role || null, active == null ? null : (active ? 1 : 0), id);
    if (password) {
      if (String(password).length < 6) throw new AppError('Mật khẩu tối thiểu 6 ký tự');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    if (active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    if (page_ids) saveUserPages(id, page_ids);
    D.log(null, req.user.id, 'sua_tai_khoan', String(id));
    return { ok: true };
  });
}));
// Sao lưu: tải về bản sao toàn bộ CSDL (file SQLite)
app.get('/api/admin/backup', need('admin'), (req, res, next) => {
  try {
    const os = require('os'), fs = require('fs');
    const file = path.join(os.tmpdir(), `banhang-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    D.log(null, req.user.id, 'sao_luu', '');
    res.download(file, `banhang-${D.todayStr()}.db`, () => fs.rm(file, { force: true }, () => {}));
  } catch (e) { next(e); }
});
app.get('/api/admin/activity', need('admin'), wrap(() => db.prepare(`SELECT a.*, u.name user_name, p.name page_name FROM activity_log a
  LEFT JOIN users u ON u.id=a.user_id LEFT JOIN pages p ON p.id=a.page_id ORDER BY a.id DESC LIMIT 300`).all()));

// ---------- Quản trị: kết nối Facebook ----------
const baseUrl = req => (process.env.APP_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : `${req.protocol}://${req.get('host')}`)).replace(/\/$/, '');
const redirectUri = req => baseUrl(req) + '/api/meta/oauth/callback';
app.get('/api/admin/ai', need('admin'), wrap(() => AI.status()));
app.get('/api/admin/meta', need('admin'), wrap(req => ({ ...Meta.status(), webhook_url: baseUrl(req) + '/webhooks/meta', redirect_uri: redirectUri(req), privacy_url: baseUrl(req) + '/privacy.html' })));
app.get('/api/admin/meta/oauth/start', need('admin'), (req, res, next) => {
  try {
    const c = Meta.cfg();
    if (!c.appId || !c.appSecret) throw new AppError('Chưa cấu hình META_APP_ID / META_APP_SECRET trên server');
    const state = require('crypto').randomBytes(24).toString('hex');
    db.prepare("DELETE FROM fb_oauth WHERE expires_at < datetime('now')").run();
    db.prepare("INSERT INTO fb_oauth (state,user_id,expires_at) VALUES (?,?,datetime('now','+20 minutes'))").run(state, req.user.id);
    res.redirect(Meta.oauthUrl(state, redirectUri(req)));
  } catch (e) { next(e); }
});
app.get('/api/meta/oauth/callback', need('admin'), async (req, res) => {
  const st = db.prepare("SELECT * FROM fb_oauth WHERE state=? AND user_id=? AND expires_at >= datetime('now')").get(String(req.query.state || ''), req.user.id);
  const back = (q) => res.redirect('/#/admin/facebook?' + new URLSearchParams(q));
  if (!st) return back({ err: 'Phiên kết nối đã hết hạn hoặc không hợp lệ — bấm Kết nối lại' });
  if (req.query.error) return back({ err: 'Bạn đã huỷ hoặc Facebook từ chối: ' + (req.query.error_description || req.query.error) });
  try {
    const pages = await Meta.oauthExchange(String(req.query.code || ''), redirectUri(req));
    db.prepare('UPDATE fb_oauth SET pages_enc=? WHERE state=?').run(Meta.encrypt(JSON.stringify(pages)), st.state);
    back({ pick: st.state });
  } catch (e) { back({ err: e.message }); }
});
const oauthPages = (state, userId) => {
  const st = db.prepare("SELECT * FROM fb_oauth WHERE state=? AND user_id=? AND expires_at >= datetime('now')").get(String(state || ''), userId);
  if (!st || !st.pages_enc) throw new AppError('Phiên kết nối đã hết hạn — bấm Kết nối Facebook lại');
  return JSON.parse(Meta.decrypt(st.pages_enc));
};
app.get('/api/admin/meta/oauth/:state', need('admin'), wrap(req => oauthPages(req.params.state, req.user.id).map(({ token, ...p }) => p)));
app.post('/api/admin/meta/connect', need('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    let fbPage;
    if (b.state) {
      fbPage = oauthPages(b.state, req.user.id).find(p => p.id === String(b.fb_page_id));
      if (!fbPage) throw new AppError('Không tìm thấy Page Facebook đã chọn');
      if (fbPage.tasks.length && !fbPage.tasks.includes('MESSAGING') && !fbPage.tasks.includes('MANAGE')) throw new AppError('Tài khoản của bạn không có quyền nhắn tin trên Page này');
    } else if (b.token) {
      const info = await Meta.inspectPageToken(String(b.token).trim());
      fbPage = { ...info, token: String(b.token).trim() };
    } else throw new AppError('Thiếu thông tin Page');
    if (!b.app_page_id && !b.new_page_name) throw new AppError('Chọn Page trong app để gắn, hoặc nhập tên Page mới');
    const pid = await Meta.connectPage({ appPageId: b.app_page_id, newPageName: b.new_page_name, fbPageId: fbPage.id, fbName: fbPage.name, token: fbPage.token, userId: req.user.id });
    res.json({ ok: true, page_id: pid, fb_name: fbPage.name });
  } catch (e) { next(e); }
});
app.delete('/api/admin/meta/pages/:pid', need('admin'), async (req, res, next) => {
  try { await Meta.disconnectPage(Number(req.params.pid), req.user.id); res.json({ ok: true }); } catch (e) { next(e); }
});

// ---------- Phạm vi Page ----------
const P = express.Router({ mergeParams: true });
app.use('/api/p/:pid', (req, res, next) => {
  const pid = Number(req.params.pid);
  if (!req.user.pageIds.includes(pid)) return next(new AppError('Bạn không được giao Page này', 403));
  req.pid = pid; next();
}, P);

// Cài đặt
P.get('/settings', wrap(req => D.pageSettings(req.pid)));
P.put('/settings', need('admin'), wrap(req => {
  const allowed = Object.keys(D.DEFAULT_SETTINGS);
  const cur = JSON.parse(db.prepare('SELECT settings FROM pages WHERE id=?').get(req.pid).settings || '{}');
  for (const k of allowed) if (k in req.body) cur[k] = req.body[k];
  if ('ai_mode' in cur && !D.AI_MODES[cur.ai_mode]) throw new AppError('Chế độ AI không hợp lệ');
  for (const k of ['ship_fee_inner', 'ship_fee_outer', 'free_ship_from', 'return_days', 'deposit_from', 'deposit_percent'])
    if (k in cur) cur[k] = Math.max(0, Number(cur[k]) || 0);
  db.prepare('UPDATE pages SET settings=? WHERE id=?').run(JSON.stringify(cur), req.pid);
  D.log(req.pid, req.user.id, 'sua_cai_dat', Object.keys(req.body).join(','));
  return { ok: true };
}));

// ---------- Dashboard ----------
P.get('/dashboard', wrap(req => {
  const pid = req.pid, today = D.todayStr();
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders WHERE page_id=? GROUP BY status').all(pid).map(r => [r.status, r.n]));
  const todayOrders = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE page_id=? AND date(created_at)=? AND status NOT IN ('da_huy')`).get(pid, today);
  const collected = db.prepare(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.page_id=? AND date(p.at)=?`).get(pid, today).s;
  const convToday = db.prepare(`SELECT COUNT(*) n, SUM(outcome='chot') chot FROM conversations WHERE page_id=? AND date(created_at)=?`).get(pid, today);
  const brief = `SELECT o.id,o.code,o.ship_name,o.ship_phone,o.total,o.status,o.created_at,o.reminded_at,o.pay_method,o.paid_amount,o.deposit_required,
    o.tracking_code,o.carrier,o.shipped_at,o.delivered_at,o.delivery_fail_count,o.last_fail_note FROM orders o WHERE o.page_id=?`;
  const tasks = {
    unconfirmed_overdue: db.prepare(`${brief} AND status='moi_tao' AND created_at <= datetime('now','localtime','-24 hours') ORDER BY created_at`).all(pid),
    unconfirmed: db.prepare(`${brief} AND status='moi_tao' AND created_at > datetime('now','localtime','-24 hours') ORDER BY created_at`).all(pid),
    waiting_payment: db.prepare(`${brief} AND status IN ('da_xac_nhan','dang_dong_goi') AND ((pay_method='ck' AND paid_amount<total) OR (pay_method='coc' AND paid_amount<deposit_required)) ORDER BY created_at`).all(pid),
    to_pack: db.prepare(`${brief} AND status IN ('da_xac_nhan','dang_dong_goi') ORDER BY created_at`).all(pid),
    delivery_failed: db.prepare(`${brief} AND status='da_gui' AND delivery_fail_count>0 ORDER BY last_fail_at`).all(pid),
    shipping_long: db.prepare(`${brief} AND status='da_gui' AND shipped_at <= datetime('now','localtime','-5 days') ORDER BY shipped_at`).all(pid),
    care_due: db.prepare(`${brief} AND status IN ('giao_thanh_cong','hoan_thanh') AND care_status IS NULL AND delivered_at <= datetime('now','localtime','-1 day') AND delivered_at >= datetime('now','localtime','-14 days') ORDER BY delivered_at`).all(pid),
    unhappy: db.prepare(`${brief} AND care_status='chua_hai_long' ORDER BY care_at`).all(pid),
    low_stock: db.prepare(`SELECT v.id,v.size,v.color,v.stock,p.name,p.code,p.low_threshold FROM variants v JOIN products p ON p.id=v.product_id
      WHERE p.page_id=? AND p.active=1 AND v.active=1 AND v.stock<=p.low_threshold ORDER BY v.stock, p.name`).all(pid),
    open_conversations: db.prepare(`SELECT COUNT(*) n FROM conversations WHERE page_id=? AND outcome='dang_tu_van'`).get(pid).n,
    unanswered_messages: db.prepare(`SELECT COUNT(*) n FROM conversations WHERE page_id=? AND reply_state='chua_tra_loi'`).get(pid).n,
    flagged_conversations: db.prepare(`SELECT COUNT(*) n FROM conversations WHERE page_id=? AND flag IS NOT NULL`).get(pid).n,
    ai_drafts: db.prepare(`SELECT COUNT(DISTINCT conversation_id) n FROM ai_drafts WHERE page_id=? AND status='cho_duyet'`).get(pid).n,
  };
  const reconciledToday = !!db.prepare('SELECT 1 FROM reconciliations WHERE page_id=? AND day=?').get(pid, today);
  return { today, byStatus, todayOrders, collected, convToday, tasks, reconciledToday };
}));

// ---------- Sản phẩm & Kho ----------
function productWithVariants(p) {
  p.variants = db.prepare('SELECT * FROM variants WHERE product_id=? ORDER BY id').all(p.id);
  p.total_stock = p.variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0);
  return p;
}
P.get('/products', wrap(req => {
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare(`SELECT * FROM products WHERE page_id=? AND (name LIKE ? OR code LIKE ?) ${req.query.all ? '' : 'AND active=1'} ORDER BY name`).all(req.pid, q, q);
  return rows.map(productWithVariants);
}));
P.get('/products/:id', wrap(req => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!p) throw new AppError('Không tìm thấy sản phẩm', 404);
  productWithVariants(p);
  p.moves = db.prepare(`SELECT m.*, v.size, v.color, u.name user_name, o.code order_code FROM stock_moves m JOIN variants v ON v.id=m.variant_id
    LEFT JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id WHERE v.product_id=? ORDER BY m.id DESC LIMIT 200`).all(p.id);
  return p;
}));
function saveVariants(productId, variants, userId) {
  for (const v of variants || []) {
    const size = String(v.size || '').trim(), color = String(v.color || '').trim();
    if (v.id) {
      db.prepare('UPDATE variants SET size=?, color=?, active=? WHERE id=? AND product_id=?').run(size, color, v.active === false || v.active === 0 ? 0 : 1, v.id, productId);
    } else {
      const ex = db.prepare('SELECT id FROM variants WHERE product_id=? AND size=? AND color=?').get(productId, size, color);
      if (ex) continue;
      const r = db.prepare('INSERT INTO variants (product_id,size,color,stock) VALUES (?,?,?,0)').run(productId, size, color);
      const qty = int(v.stock) || 0;
      if (qty > 0) D.stockMove(Number(r.lastInsertRowid), qty, 'nhap', null, 'Tồn đầu kỳ', userId);
    }
  }
}
P.post('/products', need('admin', 'warehouse'), wrap(req => {
  const b = req.body;
  if (!b.code || !b.name) throw new AppError('Cần mã SP và tên SP');
  if (!(b.variants || []).length) throw new AppError('Cần ít nhất 1 biến thể size/màu');
  return tx(() => {
    const r = db.prepare('INSERT INTO products (page_id,code,name,image_url,price,cost,low_threshold) VALUES (?,?,?,?,?,?,?)')
      .run(req.pid, String(b.code).trim().toUpperCase(), b.name.trim(), b.image_url || null, int(b.price) || 0, int(b.cost) || 0, int(b.low_threshold) ?? 3);
    const id = Number(r.lastInsertRowid);
    saveVariants(id, b.variants, req.user.id);
    D.log(req.pid, req.user.id, 'tao_sp', b.code);
    return { id };
  });
}));
P.put('/products/:id', need('admin', 'warehouse'), wrap(req => {
  const b = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!p) throw new AppError('Không tìm thấy sản phẩm', 404);
  return tx(() => {
    db.prepare('UPDATE products SET code=?, name=?, image_url=?, price=?, cost=?, low_threshold=?, active=? WHERE id=?')
      .run(String(b.code ?? p.code).trim().toUpperCase(), b.name ?? p.name, b.image_url ?? p.image_url, int(b.price) ?? p.price, int(b.cost) ?? p.cost,
        int(b.low_threshold) ?? p.low_threshold, b.active == null ? p.active : (b.active ? 1 : 0), p.id);
    saveVariants(p.id, b.variants, req.user.id);
    D.log(req.pid, req.user.id, 'sua_sp', p.code);
    return { ok: true };
  });
}));
// Nhập kho / điều chỉnh tồn
P.post('/stock', need('admin', 'warehouse'), wrap(req => {
  const { variant_id, qty, kind, note } = req.body;
  const v = db.prepare('SELECT v.*, p.page_id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(variant_id);
  if (!v || v.page_id !== req.pid) throw new AppError('Biến thể không hợp lệ');
  const n = int(qty);
  if (!n) throw new AppError('Số lượng phải khác 0');
  if (!['nhap', 'dieu_chinh'].includes(kind)) throw new AppError('Loại phiếu không hợp lệ');
  if (kind === 'nhap' && n < 0) throw new AppError('Phiếu nhập phải là số dương');
  if (kind === 'dieu_chinh' && !note) throw new AppError('Điều chỉnh tồn cần ghi lý do');
  if (v.stock + n < 0) throw new AppError('Tồn kho không được âm');
  tx(() => D.stockMove(v.id, n, kind, null, note || null, req.user.id));
  return { ok: true };
}));
P.get('/stock-moves', wrap(req => db.prepare(`SELECT m.*, v.size, v.color, p.name, p.code, u.name user_name, o.code order_code FROM stock_moves m
  JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id
  WHERE p.page_id=? ORDER BY m.id DESC LIMIT 300`).all(req.pid)));

// ---------- Khách hàng ----------
const CUST_STATS = `(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status NOT IN ('da_huy')) total_orders,
  (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id=c.id AND o.status IN ('giao_thanh_cong','hoan_thanh','dang_doi_tra')) total_spent,
  (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id=c.id) last_order_at`;
P.get('/customers', wrap(req => {
  const q = `%${req.query.q || ''}%`, tag = req.query.tag ? `%${req.query.tag}%` : '%';
  return db.prepare(`SELECT c.*, ${CUST_STATS} FROM customers c WHERE c.page_id=? AND (c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ?) AND c.tags LIKE ?
    ORDER BY c.id DESC LIMIT 500`).all(req.pid, q, q, q, tag);
}));
P.get('/customers/by-phone/:phone', wrap(req => {
  const c = db.prepare(`SELECT c.*, ${CUST_STATS} FROM customers c WHERE page_id=? AND phone=?`).get(req.pid, D.normPhone(req.params.phone));
  return c || null;
}));
P.get('/customers/:id', wrap(req => {
  const c = db.prepare(`SELECT c.*, ${CUST_STATS} FROM customers c WHERE c.id=? AND c.page_id=?`).get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy khách', 404);
  c.orders = db.prepare('SELECT id,code,total,status,created_at FROM orders WHERE customer_id=? ORDER BY id DESC').all(c.id);
  c.items = db.prepare(`SELECT i.product_name,i.size,i.color,SUM(i.qty) qty FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.customer_id=? AND o.status NOT IN ('da_huy') GROUP BY 1,2,3 ORDER BY qty DESC`).all(c.id);
  c.conversations = db.prepare('SELECT id,channel,summary,outcome,lost_reason,created_at FROM conversations WHERE customer_id=? ORDER BY id DESC').all(c.id);
  return c;
}));
P.post('/customers', need('admin', 'sales'), wrap(req => {
  if (db.prepare('SELECT 1 FROM customers WHERE page_id=? AND phone=?').get(req.pid, D.normPhone(req.body.phone))) throw new AppError('SĐT này đã có trong danh sách khách');
  const r = tx(() => D.upsertCustomer(req.pid, req.body));
  return { id: r.id };
}));
P.put('/customers/:id', need('admin', 'sales'), wrap(req => {
  const c = db.prepare('SELECT * FROM customers WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy khách', 404);
  const b = req.body;
  const phone = b.phone != null ? D.normPhone(b.phone) : c.phone;
  if (!D.validPhone(phone)) throw new AppError('Số điện thoại không hợp lệ');
  const dup = db.prepare('SELECT id FROM customers WHERE page_id=? AND phone=? AND id<>?').get(req.pid, phone, c.id);
  if (dup) throw new AppError('SĐT trùng với khách khác');
  const f = k => (k in b ? (b[k] === '' ? null : b[k]) : c[k]);
  db.prepare(`UPDATE customers SET name=?, phone=?, fb_link=?, province=?, district=?, ward=?, street=?, usual_size=?, source=?, tags=?, note=? WHERE id=?`)
    .run(f('name') || c.name, phone, f('fb_link'), f('province'), f('district'), f('ward'), f('street'), f('usual_size'), f('source'), b.tags ?? c.tags, f('note'), c.id);
  return { ok: true };
}));

// ---------- Hội thoại ----------
P.get('/conversations', wrap(req => {
  const where = ['c.page_id=?'], args = [req.pid];
  if (req.query.outcome) { where.push('c.outcome=?'); args.push(req.query.outcome); }
  if (req.query.q) { where.push('(c.customer_name LIKE ? OR c.phone LIKE ? OR c.summary LIKE ? OR c.interest LIKE ? OR c.last_msg_text LIKE ?)'); const q = `%${req.query.q}%`; args.push(q, q, q, q, q); }
  if (req.query.tag) { where.push('c.tags LIKE ?'); args.push(`%${req.query.tag}%`); }
  if (['chua_tra_loi', 'da_tra_loi'].includes(req.query.reply)) { where.push('c.reply_state=?'); args.push(req.query.reply); }
  if (req.query.flag) where.push('c.flag IS NOT NULL');
  if (req.query.draft) where.push("EXISTS (SELECT 1 FROM ai_drafts d WHERE d.conversation_id=c.id AND d.status='cho_duyet')");
  return db.prepare(`SELECT c.*, u.name user_name, o.code order_code,
    (SELECT COUNT(*) FROM ai_drafts d WHERE d.conversation_id=c.id AND d.status='cho_duyet') draft_pending FROM conversations c LEFT JOIN users u ON u.id=c.user_id
    LEFT JOIN orders o ON o.id=c.order_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(c.last_msg_at, c.updated_at) DESC LIMIT 300`).all(...args);
}));
P.get('/messenger', wrap(req => {
  const fp = Meta.fbPageByApp(req.pid);
  const unanswered = db.prepare("SELECT COUNT(*) n FROM conversations WHERE page_id=? AND reply_state='chua_tra_loi'").get(req.pid).n;
  const flagged = db.prepare('SELECT COUNT(*) n FROM conversations WHERE page_id=? AND flag IS NOT NULL').get(req.pid).n;
  const drafts = db.prepare("SELECT COUNT(DISTINCT conversation_id) n FROM ai_drafts WHERE page_id=? AND status='cho_duyet'").get(req.pid).n;
  return { connected: !!fp, fb_name: fp?.fb_name || null, last_sync_at: fp?.last_sync_at || null, last_event_at: fp?.last_event_at || null, last_error: fp?.last_error || null,
    unanswered, flagged, drafts, ai: { configured: AI.enabled(), mode: D.pageSettings(req.pid).ai_mode, mode_label: D.AI_MODES[D.pageSettings(req.pid).ai_mode] }, flag_reasons: AI.FLAG_REASONS };
}));
P.post('/messenger/sync', need('admin', 'sales'), async (req, res, next) => {
  try { res.json(await Meta.syncPage(req.pid)); } catch (e) { next(e); }
});
P.get('/conversations/:id/messages', wrap(req => {
  const c = db.prepare('SELECT id FROM conversations WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy hội thoại', 404);
  return db.prepare(`SELECT m.id, m.direction, m.text, m.attachments, m.sent_via, m.at, u.name user_name FROM fb_messages m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.conversation_id=? ORDER BY m.at, m.id`).all(c.id).map(m => ({ ...m, attachments: m.attachments ? JSON.parse(m.attachments) : [] }));
}));
P.post('/conversations/:id/reply', need('admin', 'sales'), async (req, res, next) => {
  try { res.json(await Meta.sendText(req.pid, Number(req.params.id), req.body.text, req.user.id)); } catch (e) { next(e); }
});
P.get('/conversations/:id/drafts', wrap(req => db.prepare(`SELECT d.*, u.name reviewer FROM ai_drafts d LEFT JOIN users u ON u.id=d.reviewed_by
  WHERE d.conversation_id=? AND d.page_id=? ORDER BY d.id DESC LIMIT 10`).all(req.params.id, req.pid)
  .map(d => ({ ...d, order: d.order_json ? JSON.parse(d.order_json) : null, ship_quote: d.ship_quote ? JSON.parse(d.ship_quote) : null, checks: d.checks ? JSON.parse(d.checks) : [] }))));
P.post('/conversations/:id/drafts/:did/send', need('admin', 'sales'), async (req, res, next) => {
  try { res.json(await AI.sendDraft(req.pid, Number(req.params.id), Number(req.params.did), req.body.text, req.user)); } catch (e) { next(e); }
});
P.post('/conversations/:id/drafts/:did/discard', need('admin', 'sales'), wrap(req => AI.discardDraft(req.pid, Number(req.params.id), Number(req.params.did), req.user)));
P.post('/conversations/:id/ai', need('admin', 'sales'), async (req, res, next) => {
  try {
    const c = db.prepare('SELECT id FROM conversations WHERE id=? AND page_id=? AND fb_psid IS NOT NULL').get(req.params.id, req.pid);
    if (!c) throw new AppError('Không tìm thấy hội thoại Messenger', 404);
    res.json({ draft_id: await AI.processConversation(c.id, { force: true, userId: req.user.id }) });
  } catch (e) { next(e); }
});
P.post('/conversations/:id/flag', need('admin', 'sales'), wrap(req => {
  const c = db.prepare('SELECT id FROM conversations WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy hội thoại', 404);
  AI.setFlag(c.id, null);
  D.log(req.pid, req.user.id, 'go_co_ai', `Hội thoại #${c.id}`);
  return { ok: true };
}));
P.post('/conversations/:id/mark', need('admin', 'sales'), wrap(req => {
  const st = req.body.reply_state === 'chua_tra_loi' ? 'chua_tra_loi' : 'da_tra_loi';
  db.prepare('UPDATE conversations SET reply_state=? WHERE id=? AND page_id=? AND fb_psid IS NOT NULL').run(st, req.params.id, req.pid);
  return { ok: true };
}));
P.get('/conversations/:id', wrap(req => {
  const c = db.prepare('SELECT * FROM conversations WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy hội thoại', 404);
  return c;
}));
function convFields(pid, b) {
  if (b.outcome === 'khong_chot' && !b.lost_reason) throw new AppError('Không chốt được — cần ghi lý do (dữ liệu để cải tiến sản phẩm và giá)');
  const phone = b.phone ? D.normPhone(b.phone) : null;
  const cust = phone ? db.prepare('SELECT id FROM customers WHERE page_id=? AND phone=?').get(pid, phone) : null;
  return { ...b, phone, customer_id: cust ? cust.id : null, is_new_customer: cust ? 0 : 1 };
}
P.post('/conversations', need('admin', 'sales'), wrap(req => {
  const b = convFields(req.pid, req.body);
  if (!b.customer_name && !b.phone && !b.fb_link) throw new AppError('Cần tên khách, SĐT hoặc link Facebook của khách');
  const r = db.prepare(`INSERT INTO conversations (page_id,customer_id,customer_name,phone,fb_link,channel,source,content_code,is_new_customer,interest,summary,tags,outcome,lost_reason,user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.pid, b.customer_id, b.customer_name || null, b.phone, b.fb_link || null, b.channel || 'inbox',
    b.source || null, b.content_code || null, b.is_new_customer, b.interest || null, b.summary || null, b.tags || '', b.outcome || 'dang_tu_van', b.lost_reason || null, req.user.id);
  return { id: Number(r.lastInsertRowid) };
}));
P.put('/conversations/:id', need('admin', 'sales'), wrap(req => {
  const c = db.prepare('SELECT * FROM conversations WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!c) throw new AppError('Không tìm thấy hội thoại', 404);
  const b = convFields(req.pid, { ...c, ...req.body });
  if (c.order_id && b.outcome !== 'chot') throw new AppError('Hội thoại đã có đơn — không thể đổi kết quả');
  db.prepare(`UPDATE conversations SET customer_id=?, customer_name=?, phone=?, fb_link=?, channel=?, source=?, content_code=?, is_new_customer=?, interest=?, summary=?, tags=?,
    outcome=?, lost_reason=?, updated_at=datetime('now','localtime') WHERE id=?`).run(b.customer_id, b.customer_name || null, b.phone, b.fb_link || null, b.channel,
    b.source || null, b.content_code || null, b.is_new_customer, b.interest || null, b.summary || null, b.tags || '', b.outcome, b.outcome === 'khong_chot' ? b.lost_reason : null, c.id);
  return { ok: true };
}));

// ---------- Đơn hàng ----------
P.get('/orders', wrap(req => {
  const where = ['o.page_id=?'], args = [req.pid];
  if (req.query.status) { where.push(`o.status IN (${req.query.status.split(',').map(() => '?').join(',')})`); args.push(...req.query.status.split(',')); }
  if (req.query.q) { where.push('(o.code LIKE ? OR o.ship_name LIKE ? OR o.ship_phone LIKE ? OR o.tracking_code LIKE ?)'); const q = `%${req.query.q}%`; args.push(q, q, q, q); }
  if (req.query.from) { where.push('date(o.created_at)>=?'); args.push(req.query.from); }
  if (req.query.to) { where.push('date(o.created_at)<=?'); args.push(req.query.to); }
  return db.prepare(`SELECT o.*, u.name user_name,
    (SELECT GROUP_CONCAT(i.product_name || ' ' || i.size || CASE WHEN i.color<>'' THEN '/' || i.color ELSE '' END || ' x' || i.qty, ', ') FROM order_items i WHERE i.order_id=o.id) items_text
    FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 500`).all(...args);
}));
function loadOrder(id, pid) {
  const o = db.prepare('SELECT o.*, u.name user_name FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=? AND o.page_id=?').get(id, pid);
  if (!o) throw new AppError('Không tìm thấy đơn', 404);
  o.items = db.prepare('SELECT i.*, v.stock FROM order_items i JOIN variants v ON v.id=i.variant_id WHERE order_id=?').all(o.id);
  o.events = db.prepare('SELECT e.*, u.name user_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE order_id=? ORDER BY e.id').all(o.id);
  o.payments = db.prepare('SELECT p.*, u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE order_id=? ORDER BY p.id').all(o.id);
  o.customer = db.prepare('SELECT id,code,name,phone,usual_size,tags FROM customers WHERE id=?').get(o.customer_id);
  o.parent = o.parent_order_id ? db.prepare('SELECT id,code,status FROM orders WHERE id=?').get(o.parent_order_id) : null;
  o.children = db.prepare('SELECT id,code,status FROM orders WHERE parent_order_id=?').all(o.id);
  o.payment_status = D.paymentStatus(o);
  o.shortages = o.stock_deducted ? [] : D.stockShortages(o.items);
  return o;
}
P.get('/orders/:id', wrap(req => loadOrder(req.params.id, req.pid)));
P.post('/orders', need('admin', 'sales'), wrap(req => ({ id: D.createOrder(req.pid, req.user, req.body) })));
// Sửa đơn: chỉ khi còn "Mới tạo"
P.put('/orders/:id', need('admin', 'sales'), wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o) throw new AppError('Không tìm thấy đơn', 404);
  if (o.status !== 'moi_tao') throw new AppError('Chỉ sửa được đơn ở trạng thái "Mới tạo"');
  return tx(() => {
    const b = req.body;
    const items = (b.items || []).filter(i => i.variant_id && Number(i.qty) > 0);
    if (!items.length) throw new AppError('Đơn cần ít nhất 1 sản phẩm');
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(o.id);
    let subtotal = 0;
    for (const i of items) {
      const v = db.prepare('SELECT v.*, p.name, p.price, p.cost, p.page_id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(i.variant_id);
      if (!v || v.page_id !== req.pid) throw new AppError('Sản phẩm không thuộc Page này');
      const price = i.price != null && i.price !== '' ? int(i.price) : v.price, qty = int(i.qty);
      subtotal += price * qty;
      db.prepare('INSERT INTO order_items (order_id,variant_id,product_name,size,color,qty,price,cost) VALUES (?,?,?,?,?,?,?,?)').run(o.id, v.id, v.name, v.size, v.color, qty, price, v.cost);
    }
    const ship_fee = int(b.ship_fee) ?? o.ship_fee, discount = Math.max(0, int(b.discount) ?? 0), total = Math.max(0, subtotal + ship_fee - discount);
    const pay_method = D.PAY_METHODS[b.pay_method] ? b.pay_method : o.pay_method;
    let deposit_required = 0;
    if (pay_method === 'coc') deposit_required = int(b.deposit_required) || Math.round(total * D.pageSettings(req.pid).deposit_percent / 100);
    if (pay_method === 'ck') deposit_required = total;
    for (const k of ['ship_name', 'ship_phone', 'province', 'ward', 'street']) if (!String(b[k] || '').trim()) throw new AppError('Thiếu thông tin giao hàng bắt buộc');
    db.prepare(`UPDATE orders SET ship_name=?, ship_phone=?, province=?, district=?, ward=?, street=?, note=?, is_preorder=?, source=?, content_code=?, campaign_code=?,
      subtotal=?, ship_fee=?, discount=?, total=?, pay_method=?, deposit_required=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.ship_name, D.normPhone(b.ship_phone), b.province, b.district || null, b.ward, b.street, b.note || null, b.is_preorder ? 1 : 0, b.source || null,
        b.content_code || null, b.campaign_code || null, subtotal, ship_fee, discount, total, pay_method, deposit_required, o.id);
    D.orderEvent(o.id, 'edit', req.user.id, 'Sửa thông tin đơn');
    return { ok: true };
  });
}));
P.post('/orders/:id/status', wrap(req => { D.changeStatus(Number(req.params.id), req.pid, req.user, req.body.to, req.body); return { ok: true }; }));
P.post('/orders/:id/payment', need('admin', 'sales'), wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o) throw new AppError('Không tìm thấy đơn', 404);
  if (['da_huy', 'hoan_ve_kho'].includes(o.status) && int(req.body.amount) > 0) throw new AppError('Đơn đã hủy/hoàn — chỉ ghi được khoản hoàn tiền (số âm)');
  const amount = int(req.body.amount);
  if (!amount) throw new AppError('Số tiền phải khác 0');
  const method = req.body.method || 'ck';
  if (!['cod', 'ck', 'tien_mat'].includes(method)) throw new AppError('Phương thức không hợp lệ');
  if (method === 'ck' && amount > 0 && !String(req.body.ref || '').trim()) throw new AppError('Chuyển khoản cần ghi mã giao dịch để đối soát');
  if (amount < 0 && !req.body.note) throw new AppError('Hoàn tiền cần ghi lý do');
  tx(() => {
    db.prepare('INSERT INTO payments (order_id,method,amount,ref,note,user_id) VALUES (?,?,?,?,?,?)').run(o.id, method, amount, req.body.ref || null, req.body.note || null, req.user.id);
    db.prepare('UPDATE orders SET paid_amount=paid_amount+?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(amount, o.id);
    D.orderEvent(o.id, 'payment', req.user.id, `${amount > 0 ? 'Thu' : 'Hoàn'} ${Math.abs(amount).toLocaleString('vi-VN')}đ (${method}${req.body.ref ? ' · ' + req.body.ref : ''})`);
  });
  return { ok: true };
}));
P.post('/orders/:id/remind', need('admin', 'sales'), wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o || o.status !== 'moi_tao') throw new AppError('Chỉ nhắc được đơn "Mới tạo"');
  if (o.reminded_at) throw new AppError('Đơn đã được nhắc 1 lần — theo quy tắc, hủy nếu khách vẫn không phản hồi');
  db.prepare("UPDATE orders SET reminded_at=datetime('now','localtime') WHERE id=?").run(o.id);
  D.orderEvent(o.id, 'remind', req.user.id, 'Đã nhắc khách xác nhận (lần 1)');
  return { ok: true };
}));
P.post('/orders/:id/delivery-fail', wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o || o.status !== 'da_gui') throw new AppError('Chỉ ghi giao thất bại cho đơn "Đã gửi hàng"');
  if (!req.body.note) throw new AppError('Ghi rõ lý do giao thất bại / lịch hẹn giao lại');
  if (o.delivery_fail_count >= 3) throw new AppError('Đã quá số lần hẹn giao lại (tối đa 2 lần) — chuyển "Hoàn hàng về kho"');
  db.prepare("UPDATE orders SET delivery_fail_count=delivery_fail_count+1, last_fail_note=?, last_fail_at=datetime('now','localtime') WHERE id=?").run(req.body.note, o.id);
  D.orderEvent(o.id, 'delivery_fail', req.user.id, `Giao thất bại lần ${o.delivery_fail_count + 1}: ${req.body.note}`);
  return { ok: true };
}));
P.post('/orders/:id/tracking', need('admin', 'warehouse'), wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o || !['da_gui'].includes(o.status)) throw new AppError('Chỉ cập nhật vận đơn khi đơn đang "Đã gửi hàng"');
  db.prepare('UPDATE orders SET carrier=?, tracking_code=?, ship_cost_actual=? WHERE id=?').run(req.body.carrier || o.carrier, req.body.tracking_code || o.tracking_code, int(req.body.ship_cost_actual) ?? o.ship_cost_actual, o.id);
  D.orderEvent(o.id, 'tracking', req.user.id, `Cập nhật vận đơn: ${req.body.carrier || o.carrier} ${req.body.tracking_code || o.tracking_code}`);
  return { ok: true };
}));
P.post('/orders/:id/care', need('admin', 'sales'), wrap(req => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(req.params.id, req.pid);
  if (!o) throw new AppError('Không tìm thấy đơn', 404);
  const st = req.body.care_status;
  if (!['hai_long', 'chua_hai_long', 'da_xu_ly', 'khong_lien_lac'].includes(st)) throw new AppError('Kết quả chăm sóc không hợp lệ');
  if (st === 'chua_hai_long' && !req.body.note) throw new AppError('Khách chưa hài lòng — cần ghi nguyên nhân');
  db.prepare("UPDATE orders SET care_status=?, care_note=?, care_at=datetime('now','localtime') WHERE id=?").run(st, req.body.note || null, o.id);
  if (req.body.usual_size) db.prepare('UPDATE customers SET usual_size=? WHERE id=?').run(req.body.usual_size, o.customer_id);
  D.orderEvent(o.id, 'care', req.user.id, `Chăm sóc sau bán: ${st}${req.body.note ? ' · ' + req.body.note : ''}`);
  return { ok: true };
}));

// ---------- Đối soát cuối ngày ----------
function reconcileData(pid, day) {
  const created = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE page_id=? AND date(created_at)=?`).get(pid, day);
  const shipped = db.prepare(`SELECT o.id,o.code,o.ship_name,o.total,o.paid_amount,o.pay_method,o.carrier,o.tracking_code,
      (SELECT SUM(qty) FROM order_items WHERE order_id=o.id) qty FROM orders o WHERE page_id=? AND date(shipped_at)=? ORDER BY o.code`).all(pid, day);
  const payments = db.prepare(`SELECT p.*, o.code, u.name user_name FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN users u ON u.id=p.user_id
      WHERE o.page_id=? AND date(p.at)=? ORDER BY p.id`).all(pid, day);
  const moves = db.prepare(`SELECT m.kind, SUM(m.qty) qty FROM stock_moves m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id
      WHERE p.page_id=? AND date(m.at)=? GROUP BY m.kind`).all(pid, day);
  const outByOrders = db.prepare(`SELECT COALESCE(-SUM(m.qty),0) q FROM stock_moves m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id
      WHERE p.page_id=? AND date(m.at)=? AND m.kind='xuat'`).get(pid, day).q;
  const shippedQty = shipped.reduce((s, o) => s + (o.qty || 0), 0);
  const cod_outstanding = shipped.filter(o => o.pay_method !== 'ck').reduce((s, o) => s + Math.max(0, o.total - o.paid_amount), 0);
  const byMethod = {};
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  const diffs = payments.filter(p => p.note && p.note.startsWith('Chênh lệch'));
  const warnings = [];
  if (outByOrders !== shippedQty) warnings.push(`Số hàng xuất kho hôm nay (${outByOrders}) khác số hàng trong đơn đã gửi hôm nay (${shippedQty}) — kiểm tra đơn đã trừ kho nhưng chưa gửi, hoặc gửi đơn trừ kho từ hôm trước.`);
  if (diffs.length) warnings.push(`${diffs.length} khoản thu có chênh lệch so với số phải thu.`);
  return { day, created, shipped, shippedQty, outByOrders, payments, byMethod, totalCollected: payments.reduce((s, p) => s + p.amount, 0), cod_outstanding, moves, warnings };
}
P.get('/reconcile', need('admin', 'sales'), wrap(req => {
  const day = req.query.day || D.todayStr();
  const saved = db.prepare('SELECT r.*, u.name user_name FROM reconciliations r LEFT JOIN users u ON u.id=r.user_id WHERE page_id=? AND day=?').get(req.pid, day);
  return { live: reconcileData(req.pid, day), saved: saved ? { ...saved, data: JSON.parse(saved.data) } : null,
    history: db.prepare('SELECT r.day, r.note, r.at, u.name user_name FROM reconciliations r LEFT JOIN users u ON u.id=r.user_id WHERE page_id=? ORDER BY day DESC LIMIT 30').all(req.pid) };
}));
P.post('/reconcile', need('admin', 'sales'), wrap(req => {
  const day = req.body.day || D.todayStr();
  const data = reconcileData(req.pid, day);
  if (data.warnings.length && !req.body.note) throw new AppError('Có điểm chưa khớp — cần ghi chú giải trình trước khi chốt sổ');
  db.prepare(`INSERT INTO reconciliations (page_id,day,data,note,user_id) VALUES (?,?,?,?,?)
    ON CONFLICT(page_id,day) DO UPDATE SET data=excluded.data, note=excluded.note, user_id=excluded.user_id, at=datetime('now','localtime')`)
    .run(req.pid, day, JSON.stringify(data), req.body.note || null, req.user.id);
  D.log(req.pid, req.user.id, 'chot_so', day);
  return { ok: true };
}));

// ---------- Báo cáo (GĐ8) ----------
P.get('/reports', need('admin'), wrap(req => {
  const pid = req.pid, from = req.query.from || D.todayStr().slice(0, 8) + '01', to = req.query.to || D.todayStr();
  const R = [pid, from, to];
  const inRange = col => `date(${col}) BETWEEN ? AND ?`;
  const conv = db.prepare(`SELECT COUNT(*) n, SUM(outcome='chot') chot, SUM(outcome='khong_chot') lost, SUM(is_new_customer) new_cust FROM conversations WHERE page_id=? AND ${inRange('created_at')}`).get(...R);
  const ord = db.prepare(`SELECT COUNT(*) n, SUM(status='da_huy') cancelled, SUM(status='hoan_ve_kho') returned,
      SUM(status IN ('giao_thanh_cong','hoan_thanh','dang_doi_tra')) delivered,
      COALESCE(SUM(CASE WHEN status<>'da_huy' THEN total END),0) gmv FROM orders WHERE page_id=? AND kind='ban' AND ${inRange('created_at')}`).get(...R);
  const rev = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue, COALESCE(SUM(ship_fee),0) ship_fee, COALESCE(SUM(ship_cost_actual),0) ship_cost
      FROM orders WHERE page_id=? AND status IN ('giao_thanh_cong','hoan_thanh','dang_doi_tra') AND ${inRange('delivered_at')}`).get(...R);
  const cogs = db.prepare(`SELECT COALESCE(SUM(i.qty*i.cost),0) c FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.page_id=? AND o.status IN ('giao_thanh_cong','hoan_thanh','dang_doi_tra') AND ${inRange('o.delivered_at')}`).get(...R).c;
  const shippedDone = db.prepare(`SELECT SUM(status IN ('giao_thanh_cong','hoan_thanh','dang_doi_tra')) ok, SUM(status='hoan_ve_kho') ret FROM orders WHERE page_id=? AND ${inRange('shipped_at')}`).get(...R);
  const top = (col, st) => db.prepare(`SELECT ${col} reason, COUNT(*) n FROM orders WHERE page_id=? AND status='${st}' AND ${inRange('updated_at')} AND ${col} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 3`).all(...R);
  const lostReasons = db.prepare(`SELECT lost_reason reason, COUNT(*) n FROM conversations WHERE page_id=? AND outcome='khong_chot' AND ${inRange('created_at')} GROUP BY 1 ORDER BY n DESC LIMIT 5`).all(...R);
  const bestSellers = db.prepare(`SELECT i.product_name, i.size, i.color, SUM(i.qty) qty, SUM(i.qty*i.price) amount FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.page_id=? AND o.status NOT IN ('da_huy','hoan_ve_kho') AND ${inRange('o.created_at')} GROUP BY 1,2,3 ORDER BY qty DESC LIMIT 15`).all(...R);
  const bySource = db.prepare(`SELECT COALESCE(source,'(chưa ghi)') source, COUNT(*) n, COALESCE(SUM(CASE WHEN status<>'da_huy' THEN total END),0) amount FROM orders
      WHERE page_id=? AND ${inRange('created_at')} GROUP BY 1 ORDER BY n DESC`).all(...R);
  const byContent = db.prepare(`SELECT COALESCE(content_code, campaign_code) code, COUNT(*) n, COALESCE(SUM(CASE WHEN status<>'da_huy' THEN total END),0) amount FROM orders
      WHERE page_id=? AND ${inRange('created_at')} AND COALESCE(content_code, campaign_code) IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 15`).all(...R);
  const convBySource = db.prepare(`SELECT COALESCE(source,'(chưa ghi)') source, COUNT(*) n, SUM(outcome='chot') chot FROM conversations WHERE page_id=? AND ${inRange('created_at')} GROUP BY 1 ORDER BY n DESC`).all(...R);
  const byStaff = db.prepare(`SELECT u.name, COUNT(o.id) n, COALESCE(SUM(CASE WHEN o.status<>'da_huy' THEN o.total END),0) amount FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.page_id=? AND ${inRange('o.created_at')} GROUP BY u.id ORDER BY amount DESC`).all(...R);
  const ads = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ad_spend WHERE page_id=? AND day BETWEEN ? AND ?`).get(...R).s;
  const adsOrders = db.prepare(`SELECT COUNT(*) n FROM orders WHERE page_id=? AND ${inRange('created_at')} AND status<>'da_huy' AND (campaign_code IS NOT NULL OR source LIKE 'Quảng cáo%')`).get(...R).n;
  const daily = db.prepare(`SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(CASE WHEN status<>'da_huy' THEN total END),0) amount FROM orders WHERE page_id=? AND ${inRange('created_at')} GROUP BY 1 ORDER BY 1`).all(...R);
  const lowStock = db.prepare(`SELECT p.name, v.size, v.color, v.stock, p.low_threshold FROM variants v JOIN products p ON p.id=v.product_id
      WHERE p.page_id=? AND p.active=1 AND v.active=1 AND v.stock<=p.low_threshold ORDER BY v.stock`).all(pid);
  const unhappy = db.prepare(`SELECT care_note reason, COUNT(*) n FROM orders WHERE page_id=? AND care_status='chua_hai_long' AND ${inRange('care_at')} GROUP BY 1 ORDER BY n DESC LIMIT 5`).all(...R);
  const n = ord.n || 0;
  return {
    from, to,
    kpi: {
      conversations: conv.n || 0, new_customers: conv.new_cust || 0, conv_closed: conv.chot || 0,
      close_rate: conv.n ? (conv.chot || 0) / conv.n : null,
      orders: n, gmv: ord.gmv, revenue: rev.revenue, delivered_orders: rev.n,
      aov: n - (ord.cancelled || 0) > 0 ? ord.gmv / (n - (ord.cancelled || 0)) : null,
      gross_profit: rev.revenue - cogs - rev.ship_cost,
      delivery_success_rate: (shippedDone.ok || 0) + (shippedDone.ret || 0) ? (shippedDone.ok || 0) / ((shippedDone.ok || 0) + (shippedDone.ret || 0)) : null,
      cancel_rate: n ? (ord.cancelled || 0) / n : null, return_rate: n ? (ord.returned || 0) / n : null,
      ad_spend: ads, ads_orders: adsOrders, cost_per_order: ads && adsOrders ? ads / adsOrders : null,
    },
    cancelReasons: top('cancel_reason', 'da_huy'), returnReasons: top('return_reason', 'hoan_ve_kho'), lostReasons, unhappy,
    bestSellers, bySource, byContent, convBySource, byStaff, daily, lowStock,
  };
}));
P.get('/ad-spend', need('admin'), wrap(req => db.prepare('SELECT * FROM ad_spend WHERE page_id=? ORDER BY day DESC, id DESC LIMIT 200').all(req.pid)));
P.post('/ad-spend', need('admin'), wrap(req => {
  const amount = int(req.body.amount);
  if (!req.body.day || !amount || amount < 0) throw new AppError('Cần ngày và số tiền hợp lệ');
  db.prepare('INSERT INTO ad_spend (page_id,day,campaign_code,amount,note) VALUES (?,?,?,?,?)').run(req.pid, req.body.day, req.body.campaign_code || null, amount, req.body.note || null);
  return { ok: true };
}));
P.delete('/ad-spend/:id', need('admin'), wrap(req => { db.prepare('DELETE FROM ad_spend WHERE id=? AND page_id=?').run(req.params.id, req.pid); return { ok: true }; }));
P.get('/improvements', need('admin'), wrap(req => db.prepare('SELECT i.*, u.name user_name FROM improvements i LEFT JOIN users u ON u.id=i.user_id WHERE page_id=? ORDER BY week DESC, id DESC LIMIT 100').all(req.pid)));
P.post('/improvements', need('admin'), wrap(req => {
  if (!req.body.action) throw new AppError('Cần ghi hành động cải tiến');
  db.prepare('INSERT INTO improvements (page_id,week,problem,action,user_id) VALUES (?,?,?,?,?)').run(req.pid, req.body.week || D.todayStr(), req.body.problem || null, req.body.action, req.user.id);
  return { ok: true };
}));
P.put('/improvements/:id', need('admin'), wrap(req => {
  db.prepare('UPDATE improvements SET result=?, done=? WHERE id=? AND page_id=?').run(req.body.result || null, req.body.done ? 1 : 0, req.params.id, req.pid);
  return { ok: true };
}));

// ---------- Lỗi ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
app.use((err, req, res, next) => {
  const status = err.status || (String(err.message).includes('UNIQUE') ? 400 : 500);
  let msg = err.message;
  if (String(msg).includes('UNIQUE constraint failed: products.page_id, products.code')) msg = 'Mã sản phẩm đã tồn tại';
  else if (String(msg).includes('UNIQUE')) msg = 'Dữ liệu bị trùng';
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Lỗi hệ thống: ' + msg : msg });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

module.exports = app;
