// Kiểm thử quy trình chuẩn qua API: node --test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'));
process.env.DB_PATH = path.join(tmp, 't.db');
require('../scripts/seed.js');
const app = require('../server/app');
let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

async function login(u, p) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (url, body, method) => {
    const res = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    return { status: res.status, data };
  };
}

test('quy trình đơn đầy đủ + ràng buộc', async () => {
  const admin = await login('admin', 'admin123'), sales = await login('banhang', '123456'), kho = await login('kho', '123456');
  const me = (await sales('/api/me')).data; const pid = me.pages[0].id;
  assert.equal(me.pages.length, 1, 'nhân viên chỉ thấy Page được giao');
  assert.equal((await sales('/api/p/2/orders')).status, 403, 'không truy cập Page không được giao');
  assert.equal((await sales('/api/admin/users')).status, 403);

  const prods = (await sales(`/api/p/${pid}/products`)).data;
  const v = prods[0].variants[0];
  const stock0 = v.stock;
  // thiếu địa chỉ → từ chối
  let r = await sales(`/api/p/${pid}/orders`, { ship_name: 'A', ship_phone: '0901234567', items: [{ variant_id: v.id, qty: 1 }] });
  assert.equal(r.status, 400);
  r = await sales(`/api/p/${pid}/orders`, { ship_name: 'Khách Test', ship_phone: '+84 901 234 567', province: 'Hà Nội', ward: 'P. Láng', street: '1 Láng', items: [{ variant_id: v.id, qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  let o = (await sales(`/api/p/${pid}/orders/${id}`)).data;
  assert.match(o.code, /^FB-\d{8}-\d{3}$/);
  assert.equal(o.ship_phone, '0901234567');
  assert.equal(o.ship_fee, 20000, 'nội tỉnh Hà Nội');
  // không nhảy cóc
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'da_gui' })).status, 400);
  // kho không được xác nhận
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'da_xac_nhan' })).status, 403);
  assert.equal((await sales(`/api/p/${pid}/orders/${id}/status`, { to: 'da_xac_nhan' })).status, 200);
  let pv = (await sales(`/api/p/${pid}/products/${prods[0].id}`)).data.variants.find(x => x.id === v.id);
  assert.equal(pv.stock, stock0 - 1, 'trừ kho khi xác nhận');
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'dang_dong_goi' })).status, 200);
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'da_gui', carrier: 'GHN', tracking_code: 'X1' })).status, 400, 'phải kiểm chéo');
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'da_gui', carrier: 'GHN', tracking_code: 'X1', checked: true })).status, 200);
  assert.equal((await kho(`/api/p/${pid}/orders/${id}/delivery-fail`, { note: 'Khách vắng nhà' })).status, 200);
  o = (await sales(`/api/p/${pid}/orders/${id}`)).data;
  r = await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'giao_thanh_cong', cod_collected: o.total - 10000 });
  assert.equal(r.status, 400, 'chênh lệch cần lý do');
  r = await kho(`/api/p/${pid}/orders/${id}/status`, { to: 'giao_thanh_cong', cod_collected: o.total });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  o = (await sales(`/api/p/${pid}/orders/${id}`)).data;
  assert.equal(o.paid_amount, o.total);
  assert.equal((await sales(`/api/p/${pid}/orders/${id}/status`, { to: 'hoan_thanh' })).status, 400, 'chưa qua hạn đổi trả');
  assert.equal((await sales(`/api/p/${pid}/orders/${id}/status`, { to: 'hoan_thanh', force: true })).status, 400, 'chỉ quản trị được bỏ qua');
  assert.equal((await admin(`/api/p/${pid}/orders/${id}/status`, { to: 'hoan_thanh', force: true })).status, 200);

  // đơn chuyển khoản: không gửi khi chưa nhận tiền; hủy thì hoàn kho
  r = await sales(`/api/p/${pid}/orders`, { ship_name: 'CK', ship_phone: '0901111222', province: 'Huế', ward: 'X', street: 'Y', pay_method: 'ck', items: [{ variant_id: v.id, qty: 2 }] });
  const id2 = r.data.id;
  o = (await sales(`/api/p/${pid}/orders/${id2}`)).data;
  assert.equal(o.ship_fee, 30000);
  await sales(`/api/p/${pid}/orders/${id2}/status`, { to: 'da_xac_nhan' });
  await kho(`/api/p/${pid}/orders/${id2}/status`, { to: 'dang_dong_goi' });
  assert.equal((await kho(`/api/p/${pid}/orders/${id2}/status`, { to: 'da_gui', carrier: 'GHN', tracking_code: 'X2', checked: true })).status, 400);
  assert.equal((await sales(`/api/p/${pid}/orders/${id2}/payment`, { method: 'ck', amount: 1000 })).status, 400, 'CK cần mã giao dịch');
  assert.equal((await sales(`/api/p/${pid}/orders/${id2}/status`, { to: 'da_huy' })).status, 400, 'hủy cần lý do');
  const before = (await sales(`/api/p/${pid}/products/${prods[0].id}`)).data.variants.find(x => x.id === v.id).stock;
  assert.equal((await sales(`/api/p/${pid}/orders/${id2}/status`, { to: 'da_huy', reason: 'Khách đổi ý' })).status, 200);
  const after = (await sales(`/api/p/${pid}/products/${prods[0].id}`)).data.variants.find(x => x.id === v.id).stock;
  assert.equal(after, before + 2, 'hủy đơn → nhập lại kho');

  // không đủ tồn → không xác nhận
  r = await sales(`/api/p/${pid}/orders`, { ship_name: 'Big', ship_phone: '0901111333', province: 'Huế', ward: 'X', street: 'Y', items: [{ variant_id: v.id, qty: 999 }] });
  assert.equal((await sales(`/api/p/${pid}/orders/${r.data.id}/status`, { to: 'da_xac_nhan' })).status, 400);

  // hội thoại không chốt cần lý do
  assert.equal((await sales(`/api/p/${pid}/conversations`, { customer_name: 'X', outcome: 'khong_chot' })).status, 400);
  // dashboard, đối soát, báo cáo
  assert.equal((await sales(`/api/p/${pid}/dashboard`)).status, 200);
  const rec = (await sales(`/api/p/${pid}/reconcile`)).data;
  assert.ok(rec.live.totalCollected > 0);
  assert.equal((await sales(`/api/p/${pid}/reports`)).status, 403);
  const rep = (await admin(`/api/p/${pid}/reports`)).data;
  assert.ok(rep.kpi.orders > 0);
});
