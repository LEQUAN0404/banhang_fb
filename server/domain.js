// Nghiệp vụ cốt lõi: trạng thái đơn (mục 4), tồn kho (nguyên tắc 4), mã đơn (GĐ4)
const { db, tx } = require('./db');

class AppError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

const STATUS = {
  moi_tao: 'Mới tạo', da_xac_nhan: 'Đã xác nhận', dang_dong_goi: 'Đang đóng gói', da_gui: 'Đã gửi hàng',
  giao_thanh_cong: 'Giao thành công', hoan_thanh: 'Hoàn thành',
  da_huy: 'Đã hủy', dang_doi_tra: 'Đang đổi/trả', hoan_ve_kho: 'Hoàn hàng về kho',
};

// Chuyển trạng thái hợp lệ + vai trò được phép. Không nhảy cóc, không trạng thái tự chế.
const TRANSITIONS = {
  moi_tao:         { da_xac_nhan: ['admin', 'sales'], da_huy: ['admin', 'sales'] },
  da_xac_nhan:     { dang_dong_goi: ['admin', 'warehouse'], da_huy: ['admin', 'sales'] },
  dang_dong_goi:   { da_gui: ['admin', 'warehouse'], da_huy: ['admin', 'sales'] },
  da_gui:          { giao_thanh_cong: ['admin', 'sales', 'warehouse'], hoan_ve_kho: ['admin', 'warehouse'] },
  giao_thanh_cong: { hoan_thanh: ['admin', 'sales'], dang_doi_tra: ['admin', 'sales'] },
  dang_doi_tra:    { hoan_thanh: ['admin', 'sales'], hoan_ve_kho: ['admin', 'warehouse'] },
  hoan_thanh: {}, da_huy: {}, hoan_ve_kho: {},
};

const PAY_METHODS = { cod: 'COD (thu khi giao)', ck: 'Chuyển khoản trước', coc: 'Cọc một phần' };
const ROLES = { admin: 'Quản trị', sales: 'Bán hàng', warehouse: 'Kho – đóng gói' };
const CARRIERS = ['GHN', 'GHTK', 'Viettel Post', 'J&T Express', 'SPX Express', 'VNPost', 'Ahamove', 'Khác'];
const SOURCES = ['Bài đăng', 'Reels', 'Quảng cáo (ads)', 'Marketplace', 'Khách cũ giới thiệu', 'Khách cũ quay lại', 'Livestream', 'Khác'];
// 34 tỉnh/thành sau sắp xếp đơn vị hành chính (hiệu lực 01/07/2025)
const PROVINCES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Huế', 'An Giang', 'Bắc Ninh', 'Cà Mau',
  'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh', 'Hưng Yên', 'Khánh Hòa', 'Lai Châu',
  'Lạng Sơn', 'Lào Cai', 'Lâm Đồng', 'Nghệ An', 'Ninh Bình', 'Phú Thọ', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sơn La',
  'Tây Ninh', 'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long'];

const AI_MODES = { off: 'Tắt', draft: 'Soạn nháp chờ duyệt' };
const DEFAULT_SETTINGS = {
  ai_mode: 'off',
  shop_province: 'Hà Nội',
  ship_fee_inner: 20000, ship_fee_outer: 30000, free_ship_from: 0,
  return_days: 7,
  deposit_from: 1000000, deposit_percent: 30,
  working_hours: '8:00 – 22:00',
  return_policy: 'Đổi size miễn phí trong 7 ngày kể từ khi nhận hàng, sản phẩm còn nguyên tem mác, chưa giặt. Shop chịu phí ship đổi lần đầu.',
  auto_reply: 'Dạ shop đã nhận được tin nhắn của chị ạ. Giờ làm việc của shop là {gio_lam_viec}, shop sẽ phản hồi chị sớm nhất ạ ❤️',
  tpl_confirm: 'Dạ shop xác nhận đơn {ma_don} của chị {ten_khach} ạ:\n{san_pham}\nTiền hàng: {tien_hang}\nPhí ship: {phi_ship}\nGiảm giá: {giam_gia}\nTổng thanh toán: {tong_tien} ({thanh_toan})\nGiao đến: {dia_chi}\nDự kiến nhận hàng: 2–4 ngày.\nChính sách đổi size: {chinh_sach}\nChị kiểm tra giúp shop thông tin đã đúng chưa ạ 🥰',
  tpl_remind: 'Dạ chị ơi, đơn {ma_don} của chị shop đang giữ hàng ạ. Chị xác nhận giúp shop để shop gửi đi sớm nhé ạ.',
  tpl_care: 'Dạ chị {ten_khach} ơi, đơn {ma_don} chị nhận được hàng chưa ạ? Size mặc có vừa không chị? Có gì chưa ưng chị nhắn shop hỗ trợ đổi ngay nhé ❤️',
  tpl_fail: 'Dạ chị ơi, shipper báo giao đơn {ma_don} chưa thành công ạ. Chị cho shop xin thời gian tiện nhận hàng để shop hẹn giao lại nhé ạ.',
  quick_replies: [
    'Dạ chào chị ạ, chị đang quan tâm mẫu nào để shop tư vấn ạ?',
    'Chị cho shop xin số đo vòng chân ngực và vòng ngực để shop tư vấn size chuẩn nhé ạ.',
    'Dạ mẫu này shop còn đủ size, chị lấy size nào để shop giữ hàng ạ?',
    'Chị cho shop xin họ tên, SĐT và địa chỉ đầy đủ để shop lên đơn nhé ạ.',
  ],
  conv_tags: ['hỏi giá', 'hỏi size', 'đang cân nhắc', 'chờ hàng về', 'khách VIP'],
  lost_reasons: ['Hết size/màu', 'Giá cao', 'Chỉ tham khảo', 'Phí ship cao', 'Không phản hồi', 'Mua chỗ khác', 'Khác'],
  cancel_reasons: ['Khách đổi ý', 'Khách không phản hồi quá 24h', 'Không cọc', 'Hết hàng', 'Trùng đơn', 'Khác'],
  return_reasons: ['Khách không nhận', 'Không liên lạc được', 'Sai địa chỉ', 'Hàng lỗi', 'Đổi size', 'Khác'],
};

function pageSettings(pageId) {
  const p = db.prepare('SELECT settings FROM pages WHERE id=?').get(pageId);
  if (!p) throw new AppError('Không tìm thấy Page', 404);
  return { ...DEFAULT_SETTINGS, ...JSON.parse(p.settings || '{}') };
}

function log(pageId, userId, action, detail) {
  db.prepare('INSERT INTO activity_log (page_id,user_id,action,detail) VALUES (?,?,?,?)')
    .run(pageId ?? null, userId ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail ?? null));
}

function orderEvent(orderId, kind, userId, note, from = null, to = null) {
  db.prepare('INSERT INTO order_events (order_id,kind,from_status,to_status,note,user_id) VALUES (?,?,?,?,?,?)')
    .run(orderId, kind, from, to, note ?? null, userId ?? null);
}

function nextOrderCode(page) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `${page.order_prefix}-${ymd}-`;
  const row = db.prepare("SELECT code FROM orders WHERE code LIKE ? ORDER BY code DESC LIMIT 1").get(prefix + '%');
  const n = row ? parseInt(row.code.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(3, '0');
}

function nextCustomerCode(pageId) {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(code,4) AS INTEGER)) n FROM customers WHERE page_id=?").get(pageId);
  return 'KH-' + String((row.n || 0) + 1).padStart(4, '0');
}

function normPhone(p) {
  let s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  return s;
}
function validPhone(p) { return /^0\d{9}$/.test(p); }

// Tìm hoặc tạo khách theo SĐT (SĐT là khóa nhận diện)
function upsertCustomer(pageId, c) {
  const phone = normPhone(c.phone);
  if (!validPhone(phone)) throw new AppError('Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)');
  if (!c.name || !c.name.trim()) throw new AppError('Thiếu họ tên khách');
  const ex = db.prepare('SELECT * FROM customers WHERE page_id=? AND phone=?').get(pageId, phone);
  if (ex) {
    db.prepare(`UPDATE customers SET name=?, province=COALESCE(?,province), district=COALESCE(?,district),
      ward=COALESCE(?,ward), street=COALESCE(?,street), fb_link=COALESCE(?,fb_link),
      usual_size=COALESCE(?,usual_size), source=COALESCE(source,?) WHERE id=?`)
      .run(c.name.trim(), c.province || null, c.district || null, c.ward || null, c.street || null,
        c.fb_link || null, c.usual_size || null, c.source || null, ex.id);
    return { id: ex.id, created: false };
  }
  const r = db.prepare(`INSERT INTO customers (page_id,code,name,phone,fb_link,province,district,ward,street,usual_size,source,tags,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pageId, nextCustomerCode(pageId), c.name.trim(), phone, c.fb_link || null,
    c.province || null, c.district || null, c.ward || null, c.street || null, c.usual_size || null, c.source || null,
    c.tags || '', c.note || null);
  return { id: Number(r.lastInsertRowid), created: true };
}

function calcShipFee(settings, province, subtotal) {
  if (settings.free_ship_from > 0 && subtotal >= settings.free_ship_from) return 0;
  return province && province === settings.shop_province ? settings.ship_fee_inner : settings.ship_fee_outer;
}

function stockMove(variantId, qty, kind, orderId, note, userId) {
  db.prepare('UPDATE variants SET stock = stock + ? WHERE id=?').run(qty, variantId);
  db.prepare('INSERT INTO stock_moves (variant_id,qty,kind,order_id,note,user_id) VALUES (?,?,?,?,?,?)')
    .run(variantId, qty, kind, orderId ?? null, note ?? null, userId ?? null);
}

// Kiểm tra tồn kho theo biến thể — trả danh sách thiếu
function stockShortages(items) {
  const need = {};
  for (const it of items) need[it.variant_id] = (need[it.variant_id] || 0) + it.qty;
  const out = [];
  for (const [vid, qty] of Object.entries(need)) {
    const v = db.prepare('SELECT v.*, p.name FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(vid);
    if (!v || v.stock < qty) out.push(`${v ? v.name : '#' + vid} ${v ? [v.size, v.color].filter(Boolean).join('/') : ''}: cần ${qty}, còn ${v ? v.stock : 0}`);
  }
  return out;
}

function deductStock(order, userId) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  const short = stockShortages(items);
  if (short.length) throw new AppError('Không đủ tồn kho: ' + short.join('; '));
  for (const it of items) stockMove(it.variant_id, -it.qty, 'xuat', order.id, `Xuất cho đơn ${order.code}`, userId);
  db.prepare('UPDATE orders SET stock_deducted=1 WHERE id=?').run(order.id);
}

function restock(order, userId, note) {
  if (!order.stock_deducted) return;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  for (const it of items) stockMove(it.variant_id, it.qty, 'hoan', order.id, note || `Nhập lại từ đơn ${order.code}`, userId);
  db.prepare('UPDATE orders SET stock_deducted=0 WHERE id=?').run(order.id);
}

function createOrder(pageId, user, body) {
  const page = db.prepare('SELECT * FROM pages WHERE id=?').get(pageId);
  const settings = pageSettings(pageId);
  const items = (body.items || []).filter(i => i.variant_id && Number(i.qty) > 0);
  if (!items.length) throw new AppError('Đơn cần ít nhất 1 sản phẩm');
  for (const k of ['ship_name', 'ship_phone', 'province', 'ward', 'street'])
    if (!String(body[k] || '').trim()) throw new AppError('Thiếu thông tin bắt buộc khi chốt: họ tên, SĐT, địa chỉ đầy đủ (tỉnh/thành, phường/xã, số nhà – đường)');
  if (!PAY_METHODS[body.pay_method || 'cod']) throw new AppError('Phương thức thanh toán không hợp lệ');

  return tx(() => {
    const cust = upsertCustomer(pageId, {
      name: body.ship_name, phone: body.ship_phone, province: body.province, district: body.district, ward: body.ward,
      street: body.street, fb_link: body.fb_link, source: body.source,
    });
    let subtotal = 0;
    const lines = items.map(i => {
      const v = db.prepare(`SELECT v.*, p.name, p.price, p.cost, p.page_id FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(i.variant_id);
      if (!v || v.page_id !== pageId) throw new AppError('Sản phẩm không thuộc Page này');
      const price = i.price != null && i.price !== '' ? Math.round(Number(i.price)) : v.price;
      const qty = Math.round(Number(i.qty));
      subtotal += price * qty;
      return { variant_id: v.id, product_name: v.name, size: v.size, color: v.color, qty, price, cost: v.cost };
    });
    const ship_fee = body.ship_fee != null && body.ship_fee !== '' ? Math.round(Number(body.ship_fee)) : calcShipFee(settings, body.province, subtotal);
    const discount = Math.max(0, Math.round(Number(body.discount || 0)));
    const total = Math.max(0, subtotal + ship_fee - discount);
    const pay_method = body.pay_method || 'cod';
    let deposit_required = 0;
    if (pay_method === 'coc') deposit_required = Math.round(Number(body.deposit_required) || total * settings.deposit_percent / 100);
    if (pay_method === 'ck') deposit_required = total;
    const code = nextOrderCode(page);
    const r = db.prepare(`INSERT INTO orders (page_id,code,customer_id,conversation_id,parent_order_id,kind,source,content_code,campaign_code,
      ship_name,ship_phone,province,district,ward,street,note,is_preorder,subtotal,ship_fee,discount,total,pay_method,deposit_required,user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      pageId, code, cust.id, body.conversation_id || null, body.parent_order_id || null, body.parent_order_id ? 'doi' : 'ban',
      body.source || null, body.content_code || null, body.campaign_code || null,
      body.ship_name.trim(), normPhone(body.ship_phone), body.province, body.district || null, body.ward, body.street,
      body.note || null, body.is_preorder ? 1 : 0, subtotal, ship_fee, discount, total, pay_method, deposit_required, user.id);
    const orderId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_items (order_id,variant_id,product_name,size,color,qty,price,cost) VALUES (?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(orderId, l.variant_id, l.product_name, l.size, l.color, l.qty, l.price, l.cost);
    orderEvent(orderId, 'status', user.id, body.parent_order_id ? `Đơn đổi cho đơn gốc #${body.parent_order_id}` : 'Tạo đơn', null, 'moi_tao');
    if (body.conversation_id) {
      db.prepare(`UPDATE conversations SET outcome='chot', order_id=?, customer_id=?, updated_at=datetime('now','localtime') WHERE id=? AND page_id=?`)
        .run(orderId, cust.id, body.conversation_id, pageId);
    }
    if (body.parent_order_id) {
      const parent = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(body.parent_order_id, pageId);
      if (parent) orderEvent(parent.id, 'note', user.id, `Tạo đơn đổi ${code}`);
    }
    log(pageId, user.id, 'tao_don', code);
    return orderId;
  });
}

function paymentStatus(o) {
  if (o.paid_amount >= o.total) return 'paid';
  if (o.paid_amount > 0) return 'partial';
  return 'unpaid';
}

// Chuyển trạng thái đơn theo chuẩn, kèm các điều kiện nghiệp vụ
function changeStatus(orderId, pageId, user, to, opts = {}) {
  return tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=? AND page_id=?').get(orderId, pageId);
    if (!o) throw new AppError('Không tìm thấy đơn', 404);
    const allowed = TRANSITIONS[o.status] || {};
    if (!allowed[to]) throw new AppError(`Không thể chuyển từ "${STATUS[o.status]}" sang "${STATUS[to] || to}"`);
    if (!allowed[to].includes(user.role)) throw new AppError(`Vai trò ${ROLES[user.role]} không được chuyển sang "${STATUS[to]}"`, 403);
    const settings = pageSettings(pageId);
    const sets = {};
    let note = opts.note || null;

    if (to === 'da_xac_nhan') {
      // Đơn cọc/chuyển khoản có thể xác nhận trước, nhưng bị chặn ở bước gửi hàng nếu chưa nhận tiền
      if (!o.is_preorder) deductStock(o, user.id);
      else note = (note ? note + ' · ' : '') + 'Đơn đặt trước — trừ kho khi đóng gói';
    }
    if (to === 'dang_dong_goi') {
      if (!o.stock_deducted) deductStock(o, user.id);
    }
    if (to === 'da_gui') {
      if (!opts.carrier || !opts.tracking_code) throw new AppError('Cần nhập hãng vận chuyển và mã vận đơn trước khi gửi hàng');
      if (o.pay_method === 'ck' && o.paid_amount < o.total) throw new AppError('Đơn chuyển khoản: chỉ gửi hàng khi đã xác nhận tiền về đủ');
      if (o.pay_method === 'coc' && o.paid_amount < o.deposit_required) throw new AppError(`Đơn cọc: cần nhận cọc tối thiểu ${o.deposit_required.toLocaleString('vi-VN')}đ trước khi gửi`);
      if (!opts.checked) throw new AppError('Cần xác nhận đã kiểm chéo sản phẩm/size lần 2 trước khi niêm phong');
      Object.assign(sets, { carrier: opts.carrier, tracking_code: opts.tracking_code.trim(), shipped_at: opts.shipped_at || nowStr() });
      note = (note ? note + ' · ' : '') + `${opts.carrier} ${opts.tracking_code} · đã kiểm chéo lần 2`;
    }
    if (to === 'giao_thanh_cong') {
      sets.delivered_at = nowStr();
      if (opts.ship_cost_actual != null && opts.ship_cost_actual !== '') sets.ship_cost_actual = Math.round(Number(opts.ship_cost_actual));
      const remain = o.total - o.paid_amount;
      if (o.pay_method !== 'ck' && remain > 0) {
        const collected = opts.cod_collected != null && opts.cod_collected !== '' ? Math.round(Number(opts.cod_collected)) : remain;
        if (collected !== remain && !opts.diff_reason) throw new AppError('Số tiền thực thu khác số phải thu — cần ghi lý do chênh lệch');
        if (collected > 0) {
          db.prepare('INSERT INTO payments (order_id,method,amount,ref,note,user_id) VALUES (?,?,?,?,?,?)')
            .run(o.id, 'cod', collected, null, collected !== remain ? `Chênh lệch ${(collected - remain).toLocaleString('vi-VN')}đ: ${opts.diff_reason || 'chưa ghi lý do'}` : 'Thu COD', user.id);
          db.prepare('UPDATE orders SET paid_amount = paid_amount + ? WHERE id=?').run(collected, o.id);
        }
      }
    }
    if (to === 'hoan_thanh') {
      const fresh = db.prepare('SELECT paid_amount,total,delivered_at FROM orders WHERE id=?').get(o.id);
      if (fresh.paid_amount < fresh.total) throw new AppError('Chưa thu đủ tiền — chưa thể Hoàn thành');
      if (o.status === 'giao_thanh_cong' && fresh.delivered_at) {
        const days = (Date.now() - new Date(fresh.delivered_at.replace(' ', 'T')).getTime()) / 86400000;
        if (days < settings.return_days && !(opts.force && user.role === 'admin')) throw new AppError(`Chưa qua thời hạn đổi trả (${settings.return_days} ngày kể từ khi giao)`);
      }
    }
    if (to === 'da_huy') {
      if (!opts.reason) throw new AppError('Cần ghi lý do hủy');
      sets.cancel_reason = opts.reason;
      restock(o, user.id, `Hủy đơn ${o.code}`);
      note = (note ? note + ' · ' : '') + 'Lý do: ' + opts.reason;
    }
    if (to === 'hoan_ve_kho') {
      if (!opts.reason) throw new AppError('Cần ghi lý do hoàn hàng');
      sets.return_reason = opts.reason;
      if (opts.restock !== false) restock(o, user.id, `Hàng hoàn đơn ${o.code}: ${opts.reason}`);
      note = (note ? note + ' · ' : '') + 'Lý do: ' + opts.reason + (opts.restock === false ? ' · hàng lỗi, không nhập lại kho' : ' · đã nhập lại kho');
    }
    if (to === 'dang_doi_tra') {
      if (!opts.reason) throw new AppError('Cần ghi lý do đổi/trả');
      note = (note ? note + ' · ' : '') + 'Lý do: ' + opts.reason;
    }
    sets.status = to;
    const keys = Object.keys(sets);
    db.prepare(`UPDATE orders SET ${keys.map(k => k + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(...keys.map(k => sets[k]), o.id);
    orderEvent(o.id, 'status', user.id, note, o.status, to);
    log(pageId, user.id, 'doi_trang_thai', `${o.code}: ${o.status} → ${to}`);
    return true;
  });
}

function nowStr() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function todayStr() { return nowStr().slice(0, 10); }

module.exports = {
  AppError, AI_MODES, STATUS, TRANSITIONS, PAY_METHODS, ROLES, CARRIERS, SOURCES, PROVINCES, DEFAULT_SETTINGS,
  pageSettings, log, orderEvent, upsertCustomer, normPhone, validPhone, createOrder, changeStatus, stockMove,
  stockShortages, paymentStatus, calcShipFee, nowStr, todayStr,
};
