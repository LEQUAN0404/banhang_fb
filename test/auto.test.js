// Kiểm thử giai đoạn 3: AI tự gửi, chốt đơn (xác nhận ngầm), trừ kho đúng 1 lần, chống trùng,
// chủ shop chốt tay trong Page inbox (quy tắc j), GHTK chờ cấu hình / tra phí / tạo vận đơn
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');
H.setupEnv({ ANTHROPIC_API_KEY: 'sk-test' });
require('../scripts/seed.js');
const app = require('../server/app');
const AI = require('../server/ai');
const { db } = require('../server/db');

const graph = H.fakeServer(call => {
  if (call.path.endsWith('me/messages') && call.body.recipient.id === '3999') return [400, { error: { message: '(#10) This message is sent outside of allowed window.', code: 10, error_subcode: 2018278 } }];
  return H.graphHandler(call);
});
const claudeQueue = [];
const claude = H.fakeServer(call => { const f = claudeQueue.shift(); if (!f) return [500, { type: 'error', error: { type: 'api_error', message: 'hết kịch bản' } }]; return typeof f === 'function' ? f(call) : f; });
const ghtk = H.fakeServer(call => {
  if (call.headers.token !== 'ghtk-token-abc') return [401, { success: false, message: 'Token không hợp lệ' }];
  if (call.path === '/services/shipment/fee') return [200, { success: true, fee: { name: 'area1', fee: 30000, insurance_fee: 0, delivery: true } }];
  if (call.path === '/services/shipment/deliver-time') return [200, { success: true, data: { deliver_time: '2–3 ngày' } }];
  if (call.path === '/services/shipment/order/') return [200, { success: true, order: { partner_id: call.body.order.id, label: 'S1.A1.' + (1000 + ghtk.calls.length), fee: '30000', insurance_fee: '0', estimated_deliver_time: 'Thứ Năm 14/11' } }];
  return [404, { success: false, message: 'không có ' + call.path }];
});
let server, base, admin, jb;
before(async () => {
  process.env.META_GRAPH_BASE = await graph.listen();
  process.env.ANTHROPIC_BASE_URL = await claude.listen();
  process.env.GHTK_BASE = await ghtk.listen();
  await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`;
  admin = await H.login(base, 'admin', 'admin123');
  jb = db.prepare("SELECT id FROM pages WHERE name='Japanbikini_fashion'").get().id;
  assert.equal((await admin('/api/admin/meta/connect', { token: H.PAGE_TOKEN, app_page_id: jb })).status, 200);
  assert.equal((await admin(`/api/p/${jb}/settings`, { ai_mode: 'auto' }, 'PUT')).status, 200);
});
after(() => { server.close(); graph.close(); claude.close(); ghtk.close(); });

const conv = psid => db.prepare('SELECT * FROM conversations WHERE page_id=? AND fb_psid=?').get(jb, psid);
const sends = () => graph.calls.filter(c => c.path.endsWith('me/messages') && c.body.recipient.id !== '3999');
const stock = (code, size) => db.prepare('SELECT v.stock FROM variants v JOIN products p ON p.id=v.product_id WHERE p.page_id=? AND p.code=? AND v.size=?').get(jb, code, size).stock;
const ordersOf = id => db.prepare('SELECT * FROM orders WHERE conversation_id=? ORDER BY id').all(id);
const addr = { province: 'Hà Nội', district: '', ward: 'Phường Cầu Giấy', street: '12 Trần Thái Tông' };
async function say(psid, mid, text, ...responses) { claudeQueue.push(...responses); await H.hook(base, H.msg(psid, mid, text)); await H.settle(AI); }

test('tự gửi + xác nhận ngầm → ghi đơn Đã xác nhận, trừ kho 1 lần, tên Facebook, GHTK chờ cấu hình', async () => {
  const s0 = stock('QD01', 'M');
  await say('3001', 'm1', 'Cho em 2 quần đùi size M', H.claudeJson(H.result({ intent: 'muon_mua', reply: 'Dạ quần đùi QD01 size M còn hàng, 2 chiếc là 246.000đ ạ. Chị cho shop xin tên người nhận, số điện thoại và địa chỉ giao hàng nhé. Shop cảm ơn chị ạ!',
    order: { ...H.emptyOrder, items: [{ code: 'QD01', size: 'M', qty: 2 }] } })));
  const c = conv('3001');
  assert.equal(sends().length, 1, 'tự gửi'); assert.match(sends()[0].body.message.text, /246\.000đ/);
  assert.equal(c.reply_state, 'da_tra_loi');
  const order1 = { items: [{ code: 'QD01', size: 'M', qty: 2 }], recipient_name: '', recipient_name_from_customer: false, phone: '0912345678', ...addr };
  await say('3001', 'm2', '0912345678, 12 Trần Thái Tông, P. Cầu Giấy, Hà Nội', H.claudeJson(H.result({ intent: 'muon_mua', order: order1, order_summary_in_reply: true,
    reply: 'Dạ shop tóm tắt đơn: 2 quần đùi QD01 size M, tiền hàng 246.000đ, phí ship shop đang kiểm tra với GHTK, giao đến 12 Trần Thái Tông, P. Cầu Giấy, Hà Nội, SĐT 0912345678, thanh toán khi nhận hàng. Chị kiểm tra giúp shop nhé, shop cảm ơn chị!' })));
  assert.equal(ordersOf(c.id).length, 0, 'mới tóm tắt, chưa chốt');
  // khách trả lời bất kỳ (không cho tên) → coi như xác nhận, dùng tên Facebook, hỏi 1 lần trước câu cảm ơn
  await say('3001', 'm3', 'ok shop', H.claudeJson(H.result({ intent: 'xac_nhan_don', order: order1, order_confirmed: true, asked_fb_name: true,
    reply: 'Dạ shop đã chốt đơn 2 quần đùi QD01 size M, tiền hàng 246.000đ, thanh toán khi nhận hàng ạ. Shop ghi tên người nhận là Khách 3001, chị muốn dùng tên Facebook này hay tên thật ạ? Cảm ơn chị đã ủng hộ shop!' })));
  const os = ordersOf(c.id);
  assert.equal(os.length, 1);
  const o = os[0];
  assert.equal(o.status, 'da_xac_nhan'); assert.equal(o.pay_method, 'cod'); assert.equal(o.ship_name, 'Khách 3001');
  assert.equal(o.user_id, AI.aiUser().id); assert.equal(o.stock_deducted, 1); assert.equal(o.ship_fee, 0); assert.equal(o.tracking_code, null);
  assert.equal(o.source_mid, 'm3');
  assert.equal(stock('QD01', 'M'), s0 - 2, 'trừ tồn đúng 2');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_moves WHERE order_id=? AND kind='xuat'").get(o.id).n, 1);
  assert.equal(conv('3001').outcome, 'chot');
  // AI lỡ báo chốt lần nữa → không ghi trùng, không trừ kho thêm
  await say('3001', 'm4', 'cảm ơn shop', H.claudeJson(H.result({ intent: 'xac_nhan_don', order: order1, order_confirmed: true, reply: 'Dạ đơn của chị shop đã ghi nhận rồi ạ. Cảm ơn chị!' })));
  assert.equal(ordersOf(c.id).length, 1); assert.equal(stock('QD01', 'M'), s0 - 2);
  // khách cho tên thật → cập nhật tên người nhận
  await say('3001', 'm5', 'Tên thật là Nguyễn Thị Lan nhé', H.claudeJson(H.result({ intent: 'xac_nhan_don', order: { ...order1, recipient_name: 'Nguyễn Thị Lan', recipient_name_from_customer: true },
    reply: 'Dạ shop đã cập nhật tên người nhận là Nguyễn Thị Lan ạ. Cảm ơn chị!' })));
  assert.equal(ordersOf(c.id)[0].ship_name, 'Nguyễn Thị Lan');
  // tạo vận đơn khi GHTK chưa cấu hình → báo chờ cấu hình, không chặn
  const r = await admin(`/api/p/${jb}/orders/${o.id}/ghtk`, {});
  assert.equal(r.status, 400); assert.match(r.data.error, /Chưa cấu hình GHTK/);
});

test('cờ báo chủ shop và lỗi kiểm tra không bao giờ tự gửi', async () => {
  const n = sends().length;
  await say('3002', 'n1', 'Bớt cho em 30k đi', H.claudeJson(H.result({ needs_owner: true, flag_reason: 'mac_ca', intent: 'khac', reply: 'Dạ shop xin phép kiểm tra lại và báo chị ngay ạ. Cảm ơn chị!' })));
  assert.equal(sends().length, n); assert.equal(conv('3002').flag, 'mac_ca');
  // chốt nhưng thiếu SĐT → không gửi, không ghi đơn
  const bad = H.claudeJson(H.result({ intent: 'xac_nhan_don', order_confirmed: true, order: { items: [{ code: 'AL01', size: 'S', qty: 1 }], recipient_name: 'Mai', recipient_name_from_customer: true, phone: '', ...addr },
    reply: 'Dạ shop đã chốt đơn áo len AL01 size S giá 12.000đ ạ. Cảm ơn chị!' }));
  await say('3003', 'p1', 'chốt nhé', bad, bad);
  const c = conv('3003');
  assert.equal(sends().length, n); assert.equal(ordersOf(c.id).length, 0); assert.equal(c.flag, 'kiem_tra');
  assert.match(db.prepare('SELECT checks FROM ai_drafts WHERE conversation_id=? ORDER BY id DESC').get(c.id).checks, /số điện thoại/);
  // ngoài cửa sổ 24h → tự gửi thất bại, giữ nháp + cờ
  await say('3999', 'q1', 'shop ơi', H.claudeJson(H.result({ reply: 'Dạ shop đây ạ. Cảm ơn chị đã nhắn shop!' })));
  const c9 = conv('3999');
  assert.equal(c9.flag, 'gui_loi');
  assert.equal(db.prepare('SELECT status FROM ai_drafts WHERE conversation_id=? ORDER BY id DESC').get(c9.id).status, 'cho_duyet');
});

test('GHTK đã cấu hình: AI tra phí thật, chốt đơn → tạo vận đơn, ghi mã + tổng tiền', async () => {
  let r = await admin(`/api/p/${jb}/ghtk`, { token: 'ghtk-token-abc', client_source: 'S123', env: 'staging', pick_name: 'Japanbikini', pick_tel: '0901234567', pick_address: '1 Phố Huế', pick_province: 'Hà Nội', pick_ward: 'Phường Hai Bà Trưng' }, 'PUT');
  assert.equal(r.status, 200); assert.equal(r.data.configured, true); assert.equal(r.data.token, undefined, 'không trả token ra ngoài');
  assert.ok(!db.prepare('SELECT token_enc FROM ghtk_config WHERE page_id=?').get(jb).token_enc.includes('ghtk-token-abc'));
  const s0 = stock('QOX01', 'L');
  const order = { items: [{ code: 'QOX01', size: 'L', qty: 1 }], recipient_name: 'Trần Hoa', recipient_name_from_customer: true, phone: '0987000111', ...addr };
  claudeQueue.push(H.claudeTool('ghtk_quote', { province: addr.province, district: '', ward: addr.ward, street: addr.street, items: order.items }));
  claudeQueue.push(call => {
    const tr = JSON.parse(call.body.messages.at(-1).content[0].content);
    assert.equal(tr.available, true); assert.equal(tr.fee, 30000); assert.equal(tr.leadtime_text, '2–3 ngày'); assert.equal(tr.weight_g, 300);
    return H.claudeJson(H.result({ intent: 'xac_nhan_don', order, order_confirmed: true,
      reply: 'Dạ shop đã chốt đơn 1 quần ống xuông QOX01 size L 130.000đ, phí ship GHTK 30.000đ, tổng 160.000đ, giao trong 2–3 ngày, thanh toán khi nhận hàng ạ. Cảm ơn chị Hoa!' }));
  });
  await say('3004', 'r1', 'Em lấy QOX01 size L, Trần Hoa 0987000111, 12 Trần Thái Tông P. Cầu Giấy Hà Nội');
  const fee = ghtk.calls.find(x => x.path === '/services/shipment/fee');
  assert.equal(fee.headers['x-client-source'], 'S123'); assert.equal(fee.q.weight, '300'); assert.equal(fee.q.pick_province, 'Hà Nội');
  const o = ordersOf(conv('3004').id)[0];
  assert.ok(o, 'đã ghi đơn');
  assert.equal(o.status, 'da_xac_nhan'); assert.equal(o.carrier, 'GHTK'); assert.match(o.tracking_code, /^S1\.A1\./);
  assert.equal(o.ship_fee, 30000); assert.equal(o.total, 160000);
  assert.equal(stock('QOX01', 'L'), s0 - 1);
  const created = ghtk.calls.find(x => x.path === '/services/shipment/order/');
  assert.equal(created.body.order.pick_money, 160000); assert.equal(created.body.order.tel, '0987000111'); assert.equal(created.body.products[0].weight, 0.3);
  // tạo lại → từ chối vì đã có mã vận đơn
  assert.equal((await admin(`/api/p/${jb}/orders/${o.id}/ghtk`, {})).status, 400);
  // đơn cũ (chưa có vận đơn) → tạo được bằng nút
  const old = ordersOf(conv('3001').id)[0];
  const r2 = await admin(`/api/p/${jb}/orders/${old.id}/ghtk`, {});
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const o2 = db.prepare('SELECT * FROM orders WHERE id=?').get(old.id);
  assert.equal(o2.ship_fee, 30000); assert.equal(o2.total, 246000 + 30000); assert.ok(o2.tracking_code);
});

test('quy tắc j: chủ shop chốt tay trong Page inbox → ghi đơn, không gửi thêm tin; thiếu thông tin → cờ', async () => {
  const n = sends().length, s0 = stock('AL01', 'L');
  claudeQueue.push(H.claudeJson(H.result({ reply: 'Dạ áo len AL01 còn size L ạ. Cảm ơn chị!' })));
  await H.hook(base, H.msg('3005', 's1', 'Áo len còn size L không?'));
  await H.settle(AI);
  const manual = { is_closing: true, complete: true, missing: [], order: { items: [{ code: 'AL01', size: 'L', qty: 3 }], recipient_name: 'Lê Hồng', recipient_name_from_customer: true, phone: '0977123456', province: 'TP. Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '5 Lê Lợi' } };
  claudeQueue.push(call => { assert.match(JSON.stringify(call.body.system), /CHỦ SHOP tự gõ/); assert.equal(call.body.tools, undefined); return H.claudeJson(manual); });
  const sentBefore = sends().length;
  await H.hook(base, H.msg('3005', 's2', 'Dạ shop lên đơn 3 áo len size L cho chị Hồng 0977123456, 5 Lê Lợi, P. Bến Thành, HCM nhé', { echo: true }));
  await H.settle(AI);
  const c = conv('3005'); const os = ordersOf(c.id);
  assert.equal(os.length, 1); assert.equal(os[0].status, 'da_xac_nhan'); assert.equal(os[0].ship_name, 'Lê Hồng'); assert.equal(os[0].source_mid, 's2');
  assert.match(os[0].note, /Chủ shop chốt/);
  assert.equal(stock('AL01', 'L'), s0 - 3);
  assert.equal(sends().length, sentBefore, 'không gửi thêm tin nào');
  assert.ok(os[0].tracking_code, 'GHTK đã cấu hình → có vận đơn');
  // Meta gửi lặp sự kiện echo → không ghi trùng
  await H.hook(base, H.msg('3005', 's2', 'Dạ shop lên đơn 3 áo len size L cho chị Hồng...', { echo: true }));
  await H.settle(AI);
  assert.equal(ordersOf(c.id).length, 1); assert.equal(stock('AL01', 'L'), s0 - 3);
  // gần đủ nhưng thiếu SĐT → cờ, không ghi đơn
  claudeQueue.push(H.claudeJson({ is_closing: true, complete: false, missing: ['số điện thoại'], order: { ...manual.order, phone: '', recipient_name: 'Hà' } }));
  await H.hook(base, H.msg('3006', 't1', 'Shop chốt 1 áo cộc tay size M cho chị Hà, 5 Lê Lợi Bến Thành HCM nhé', { echo: true }));
  await H.settle(AI);
  const c6 = conv('3006');
  assert.equal(ordersOf(c6.id).length, 0); assert.equal(c6.flag, 'chot_don_thieu');
  // tin thường của chủ shop → không phải chốt đơn
  claudeQueue.push(H.claudeJson({ is_closing: false, complete: false, missing: [], order: H.emptyOrder }));
  await H.hook(base, H.msg('3007', 'u1', 'Dạ chị đợi shop xíu nhé', { echo: true }));
  await H.settle(AI);
  assert.equal(conv('3007').flag, null);
  assert.equal(n <= sends().length, true);
});

test('chế độ nháp: duyệt bản chốt đơn → gửi rồi mới ghi đơn', async () => {
  await admin(`/api/p/${jb}/settings`, { ai_mode: 'draft' }, 'PUT');
  const order = { items: [{ code: 'ACT01', size: 'S', qty: 1 }], recipient_name: 'Vy', recipient_name_from_customer: true, phone: '0966000111', ...addr };
  claudeQueue.push(H.claudeTool('ghtk_quote', { province: addr.province, district: '', ward: addr.ward, street: addr.street, items: order.items }));
  claudeQueue.push(H.claudeJson(H.result({ intent: 'xac_nhan_don', order, order_confirmed: true, reply: 'Dạ shop đã chốt đơn áo cộc tay ACT01 size S 13.000đ, phí ship 30.000đ, tổng 43.000đ ạ. Cảm ơn chị Vy!' })));
  await H.hook(base, H.msg('3008', 'v1', 'ok chốt cho em')); await H.settle(AI);
  const c = conv('3008');
  assert.equal(ordersOf(c.id).length, 0, 'chưa duyệt thì chưa ghi đơn');
  const d = db.prepare("SELECT * FROM ai_drafts WHERE conversation_id=? AND status='cho_duyet'").get(c.id);
  const r = await admin(`/api/p/${jb}/conversations/${c.id}/drafts/${d.id}/send`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.order && r.data.order.code);
  const o = ordersOf(c.id)[0];
  assert.equal(o.total, 43000); assert.equal(o.status, 'da_xac_nhan'); assert.ok(o.tracking_code);
});
