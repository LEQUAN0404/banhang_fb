// Tích hợp Giao Hàng Tiết Kiệm (GHTK): tra phí ship, thời gian giao, tạo vận đơn.
// Tài liệu: https://api.ghtk.vn/docs — header bắt buộc: Token (API token của shop) và X-Client-Source (mã đối tác).
// Khi Page chưa lưu token GHTK: mọi chức năng ở trạng thái "chờ cấu hình", không chặn phần khác của app.
const { db } = require('./db');
const D = require('./domain');
const { AppError } = D;
const { encrypt, decrypt } = require('./secret');

db.exec(`CREATE TABLE IF NOT EXISTS ghtk_config (
  page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  token_enc TEXT, client_source TEXT, env TEXT NOT NULL DEFAULT 'production',
  pick_name TEXT, pick_tel TEXT, pick_address TEXT, pick_province TEXT, pick_district TEXT, pick_ward TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const BASES = { production: 'https://services.giaohangtietkiem.vn', staging: 'https://services-staging.ghtklab.com' };
const base = c => process.env.GHTK_BASE || BASES[c.env] || BASES.production;
const getConfig = pid => db.prepare('SELECT * FROM ghtk_config WHERE page_id=?').get(pid);
function missing(c) {
  if (!c || !c.token_enc) return ['API token'];
  return [['pick_name', 'tên người gửi'], ['pick_tel', 'SĐT lấy hàng'], ['pick_address', 'địa chỉ lấy hàng'], ['pick_province', 'tỉnh/thành lấy hàng']]
    .filter(([k]) => !String(c[k] || '').trim()).map(([, l]) => l);
}
const ready = pid => !missing(getConfig(pid)).length;
function publicConfig(pid) {
  const c = getConfig(pid) || {};
  const m = missing(c);
  return { configured: !m.length, missing: m, has_token: !!c.token_enc, client_source: c.client_source || '', env: c.env || 'production',
    pick_name: c.pick_name || '', pick_tel: c.pick_tel || '', pick_address: c.pick_address || '', pick_province: c.pick_province || '', pick_district: c.pick_district || '', pick_ward: c.pick_ward || '' };
}
function saveConfig(pid, b, userId) {
  const c = getConfig(pid) || {};
  const tokenEnc = b.token ? encrypt(String(b.token).trim()) : (b.clear_token ? null : c.token_enc || null);
  const tel = b.pick_tel ? D.normPhone(b.pick_tel) : '';
  if (tel && !D.validPhone(tel)) throw new AppError('SĐT lấy hàng không hợp lệ');
  db.prepare(`INSERT INTO ghtk_config (page_id,token_enc,client_source,env,pick_name,pick_tel,pick_address,pick_province,pick_district,pick_ward,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime')) ON CONFLICT(page_id) DO UPDATE SET token_enc=excluded.token_enc, client_source=excluded.client_source, env=excluded.env,
    pick_name=excluded.pick_name, pick_tel=excluded.pick_tel, pick_address=excluded.pick_address, pick_province=excluded.pick_province,
    pick_district=excluded.pick_district, pick_ward=excluded.pick_ward, updated_at=excluded.updated_at`)
    .run(pid, tokenEnc, b.client_source || null, BASES[b.env] ? b.env : 'production', b.pick_name || null, tel || null, b.pick_address || null, b.pick_province || null, b.pick_district || null, b.pick_ward || null);
  D.log(pid, userId, 'cau_hinh_ghtk', b.token ? 'cập nhật token' : 'cập nhật thông tin lấy hàng');
  return publicConfig(pid);
}

async function call(c, method, path, params, body) {
  const u = new URL(base(c) + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') u.searchParams.set(k, v);
  const headers = { Token: decrypt(c.token_enc), 'Content-Type': 'application/json' };
  if (c.client_source) headers['X-Client-Source'] = c.client_source;
  const res = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let data = null;
  try { data = await res.json(); } catch { }
  if (!res.ok || !data || data.success === false) throw new AppError('GHTK báo lỗi: ' + ((data && (data.message || data.error)) || 'HTTP ' + res.status), 502);
  return data;
}

// Khối lượng (gram) và giá trị hàng theo mã + size
function parcel(pid, items) {
  let weight = 0, value = 0;
  for (const it of items || []) {
    const p = db.prepare('SELECT price, weight_g FROM products WHERE page_id=? AND upper(code)=upper(?)').get(pid, it.code);
    if (!p) continue;
    weight += (p.weight_g || 300) * (it.qty || 1); value += p.price * (it.qty || 1);
  }
  return { weight: Math.max(weight, 100), value };
}
const addrParams = (c, a, weight, value) => ({
  pick_province: c.pick_province, pick_district: c.pick_district, pick_ward: c.pick_ward, pick_address: c.pick_address,
  province: a.province, district: a.district, ward: a.ward, address: a.street, weight, value, transport: 'road', deliver_option: 'none',
});
function leadtimeText(d) {
  const v = d && (d.data || d);
  const t = v && (v.deliver_time || v.estimated_deliver_time || v.leadtime || v.time);
  if (!t) return null;
  if (typeof t === 'number') return new Date((t > 1e12 ? t : t * 1000)).toLocaleDateString('vi-VN');
  return String(t);
}

// Tra phí ship thật. Không tra được → available=false (AI sẽ nói shop đang kiểm tra, không đoán số)
async function quote(pid, addr) {
  const c = getConfig(pid);
  const m = missing(c);
  if (m.length) return { available: false, reason: 'Chưa cấu hình GHTK (' + m.join(', ') + ') — shop chưa tra được phí ship' };
  if (!addr.province || !(addr.ward || addr.district)) return { available: false, reason: 'Chưa đủ địa chỉ để tra phí' };
  const { weight, value } = parcel(pid, addr.items);
  try {
    const d = await call(c, 'GET', '/services/shipment/fee', addrParams(c, addr, weight, value));
    const f = d.fee || {};
    if (f.delivery === false) return { available: false, reason: 'GHTK chưa hỗ trợ giao tới địa chỉ này' };
    const fee = Number(f.fee) + Number(f.insurance_fee || 0);
    if (!Number.isFinite(fee)) return { available: false, reason: 'GHTK không trả về phí' };
    let leadtime_text = null;
    try { leadtime_text = leadtimeText(await call(c, 'GET', '/services/shipment/deliver-time', addrParams(c, addr, weight, value))); } catch { }
    return { available: true, fee, weight_g: weight, leadtime_text, note: leadtime_text ? null : 'GHTK chưa trả thời gian giao — nói shop đang kiểm tra thời gian giao' };
  } catch (e) { return { available: false, reason: e.message }; }
}

// Tạo vận đơn GHTK cho đơn chưa có mã vận đơn; ghi mã vận đơn + tổng tiền (hàng + ship thật) về đơn
async function createShipment(pid, orderId, userId) {
  const c = getConfig(pid);
  const m = missing(c);
  if (m.length) throw new AppError('Chưa cấu hình GHTK: thiếu ' + m.join(', '));
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(orderId, pid);
  if (!o) throw new AppError('Không tìm thấy đơn', 404);
  if (o.tracking_code) throw new AppError('Đơn đã có mã vận đơn ' + o.tracking_code);
  if (['da_huy', 'hoan_ve_kho', 'hoan_thanh'].includes(o.status)) throw new AppError('Đơn đã kết thúc, không tạo vận đơn');
  const items = db.prepare('SELECT i.*, p.code, p.weight_g FROM order_items i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE i.order_id=?').all(o.id);
  const addr = { province: o.province, district: o.district, ward: o.ward, street: o.street, items: items.map(i => ({ code: i.code, qty: i.qty })) };
  // phí thật trước khi tạo để thu hộ đúng tổng tiền
  const q = await quote(pid, addr);
  const fee = q.available ? q.fee : o.ship_fee;
  const total = Math.max(0, o.subtotal + fee - o.discount);
  const pickMoney = Math.max(0, total - o.paid_amount); // phần còn phải thu của người nhận
  const body = {
    products: items.map(i => ({ name: `${i.product_name} ${[i.size, i.color].filter(Boolean).join(' ')}`.trim(), weight: (i.weight_g || 300) / 1000, quantity: i.qty, product_code: i.code })),
    order: {
      id: o.code, pick_name: c.pick_name, pick_address: c.pick_address, pick_province: c.pick_province, pick_district: c.pick_district || '', pick_ward: c.pick_ward || '', pick_tel: c.pick_tel,
      tel: o.ship_phone, name: o.ship_name, address: o.street, province: o.province, district: o.district || '', ward: o.ward, hamlet: 'Khác',
      is_freeship: '1', pick_money: pickMoney, value: o.subtotal, note: o.note || '', transport: 'road', pick_option: 'cod',
    },
  };
  let d;
  try { d = await call(c, 'POST', '/services/shipment/order/', { ver: '1.5' }, body); }
  catch (e) { D.orderEvent(o.id, 'note', userId, 'Tạo vận đơn GHTK thất bại: ' + e.message); throw e; }
  const r = d.order || {};
  const realFee = Number(r.fee) + Number(r.insurance_fee || 0);
  const shipFee = Number.isFinite(realFee) && realFee > 0 ? realFee : fee;
  const label = r.label || r.tracking_id;
  if (!label) throw new AppError('GHTK không trả về mã vận đơn');
  db.prepare("UPDATE orders SET carrier='GHTK', tracking_code=?, ship_fee=?, total=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(String(label), shipFee, Math.max(0, o.subtotal + shipFee - o.discount), o.id);
  D.orderEvent(o.id, 'note', userId, `Tạo vận đơn GHTK ${label} · phí ship ${shipFee.toLocaleString('vi-VN')}đ · thu hộ ${pickMoney.toLocaleString('vi-VN')}đ${r.estimated_deliver_time ? ' · dự kiến giao ' + r.estimated_deliver_time : ''}${shipFee + o.subtotal - o.discount - o.paid_amount !== pickMoney ? ' · LƯU Ý: phí thật khác phí lúc tạo, kiểm tra tiền thu hộ' : ''}`);
  D.log(pid, userId, 'tao_van_don_ghtk', `${o.code} → ${label}`);
  return { tracking_code: String(label), ship_fee: shipFee, estimated_deliver_time: r.estimated_deliver_time || null };
}

module.exports = { publicConfig, saveConfig, quote, createShipment, ready };
