// Kiểm thử kết nối Messenger: webhook (verify token, chữ ký), kết nối Page, đồng bộ, gửi trả lời — dùng Graph API giả lập
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http'), crypto = require('crypto');
const os = require('os'), fs = require('fs'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhm-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 't.db'), META_APP_ID: '999', META_APP_SECRET: 'app-secret-test', META_WEBHOOK_VERIFY_TOKEN: 'verify-me', META_GRAPH_VERSION: 'v23.0' });
require('../scripts/seed.js');
const app = require('../server/app');
const { db } = require('../server/db');

const FB_PAGE = '117228986319268', PAGE_TOKEN = 'EAAG-page-token-xyz', PSID = '5550001';
const calls = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); calls.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null });
    const send = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const p = u.pathname.replace('/v23.0/', '');
    if (p === 'debug_token') return send({ data: { is_valid: true, type: 'PAGE', app_id: '999', scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'] } });
    if (u.searchParams.get('access_token') !== PAGE_TOKEN) { res.statusCode = 400; return send({ error: { message: 'Invalid OAuth access token', code: 190 } }); }
    if (p === 'me' && req.method === 'GET') return send({ id: FB_PAGE, name: 'Japanbikini_fashion' });
    if (p === `${FB_PAGE}/subscribed_apps`) return send({ success: true });
    if (p === `${FB_PAGE}/conversations`) return send({ data: [{ id: 't_1', participants: { data: [{ id: '7770001', name: 'Khách Cũ' }, { id: FB_PAGE, name: 'Japanbikini_fashion' }] },
      messages: { data: [ // Graph trả mới nhất trước
        { id: 'm_h2', message: 'Dạ còn ạ', from: { id: FB_PAGE }, created_time: '2026-11-10T03:01:00+0000' },
        { id: 'm_h1', message: 'Quần đùi còn size M không shop?', from: { id: '7770001' }, created_time: '2026-11-10T03:00:00+0000' }] } }] });
    if (p === PSID) return send({ name: 'Nguyễn Thị Test' });
    if (p === 'me/messages' && req.method === 'POST') return send({ recipient_id: body && JSON.parse(body).recipient.id, message_id: 'm_out_1' });
    res.statusCode = 404; send({ error: { message: 'not found ' + p } });
  });
});
let server, base;
before(async () => {
  await new Promise(r => fake.listen(0, r)); process.env.META_GRAPH_BASE = `http://127.0.0.1:${fake.address().port}`;
  await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fake.close(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function login(u, p) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (url, body, method) => {
    const res = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
}
const hook = (obj, secret = 'app-secret-test') => {
  const raw = JSON.stringify(obj);
  return fetch(base + '/webhooks/meta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
};
const msgEvent = (m, echo) => ({ object: 'page', entry: [{ id: FB_PAGE, time: Date.now(), messaging: [{ sender: { id: echo ? FB_PAGE : PSID }, recipient: { id: echo ? PSID : FB_PAGE }, timestamp: Date.now(), message: m }] }] });

test('webhook verify token', async () => {
  let r = await fetch(base + '/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
  assert.equal(r.status, 200); assert.equal(await r.text(), '12345');
  r = await fetch(base + '/webhooks/meta?hub.mode=subscribe&hub.verify_token=sai&hub.challenge=12345');
  assert.equal(r.status, 403);
});

test('kết nối Page, đồng bộ, nhận tin, trả lời', async () => {
  const admin = await login('admin', 'admin123'), sales = await login('banhang', '123456');
  const jb = db.prepare("SELECT id FROM pages WHERE name='Japanbikini_fashion'").get().id;
  const prods = (await admin(`/api/p/${jb}/products`)).data;
  assert.equal(prods.length, 6, 'có 6 sản phẩm mẫu Japanbikini');
  for (const [code, total] of [['QOX01', 45], ['QD01', 44], ['QK01', 40], ['ASM01', 23], ['ACT01', 43], ['AL01', 43]]) {
    const vs = prods.find(p => p.code === code).variants;
    assert.deepEqual(vs.map(v => v.size), ['S', 'M', 'L']);
    assert.equal(vs.reduce((s, v) => s + v.stock, 0), total, code + ' tổng tồn khớp');
    assert.ok(Math.max(...vs.map(v => v.stock)) - Math.min(...vs.map(v => v.stock)) <= 1, code + ' chia đều');
  }

  assert.equal((await sales('/api/admin/meta')).status, 403, 'chỉ quản trị được kết nối');
  let r = await admin('/api/admin/meta/connect', { token: 'sai-token', app_page_id: jb });
  assert.equal(r.status, 502);
  r = await admin('/api/admin/meta/connect', { token: PAGE_TOKEN, app_page_id: jb });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(calls.some(c => c.path.endsWith(`${FB_PAGE}/subscribed_apps`) && c.method === 'POST' && c.q.subscribed_fields.includes('messages')));
  const row = db.prepare('SELECT token_enc FROM fb_pages WHERE page_id=?').get(jb);
  assert.ok(!row.token_enc.includes(PAGE_TOKEN), 'token được mã hoá');
  await sleep(150);
  let convs = (await admin(`/api/p/${jb}/conversations`)).data;
  const old = convs.find(c => c.fb_psid === '7770001');
  assert.ok(old, 'đồng bộ hội thoại cũ'); assert.equal(old.reply_state, 'da_tra_loi'); assert.equal(old.customer_name, 'Khách Cũ');

  // chữ ký sai → 401, không lưu
  r = await hook(msgEvent({ mid: 'm_bad', text: 'x' }), 'sai-secret'); assert.equal(r.status, 401);
  r = await fetch(base + '/webhooks/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 401);
  // tin khách mới
  r = await hook(msgEvent({ mid: 'm_in_1', text: 'Áo len còn không ạ?' })); assert.equal(r.status, 200);
  await hook(msgEvent({ mid: 'm_in_1', text: 'Áo len còn không ạ?' })); // Meta gửi lặp → không trùng
  await sleep(150);
  convs = (await admin(`/api/p/${jb}/conversations?reply=chua_tra_loi`)).data;
  assert.equal(convs.length, 1); const c = convs[0];
  assert.equal(c.fb_psid, PSID); assert.equal(c.customer_name, 'Nguyễn Thị Test'); assert.equal(c.last_msg_text, 'Áo len còn không ạ?');
  assert.equal((await admin(`/api/p/${jb}/dashboard`)).data.tasks.unanswered_messages, 1);
  assert.equal((await admin(`/api/p/${jb}/conversations/${c.id}/messages`)).data.length, 1);

  // trả lời từ app → gọi Send API, chuyển sang đã trả lời; echo của chính tin đó không tạo bản ghi trùng
  r = await admin(`/api/p/${jb}/conversations/${c.id}/reply`, { text: 'Dạ áo len còn đủ size S/M/L ạ. Cảm ơn chị!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sent = calls.find(x => x.path.endsWith('me/messages'));
  assert.equal(sent.body.recipient.id, PSID); assert.equal(sent.body.messaging_type, 'RESPONSE');
  await hook(msgEvent({ mid: 'm_out_1', text: 'Dạ áo len còn đủ size S/M/L ạ. Cảm ơn chị!', is_echo: true, app_id: 999 }, true));
  await sleep(100);
  let msgs = (await admin(`/api/p/${jb}/conversations/${c.id}/messages`)).data;
  assert.equal(msgs.length, 2); assert.equal(msgs[1].sent_via, 'app');
  assert.equal((await admin(`/api/p/${jb}/conversations/${c.id}`)).data.reply_state, 'da_tra_loi');

  // chủ shop trả lời trong Page inbox (echo từ app khác) → ghi nhận "gửi từ Page inbox"
  await hook(msgEvent({ mid: 'm_in_2', text: 'Cho em 1 áo len size M' }));
  await hook(msgEvent({ mid: 'm_out_inbox', text: 'Dạ vâng ạ', is_echo: true, app_id: 263902037430900 }, true));
  await sleep(150);
  msgs = (await admin(`/api/p/${jb}/conversations/${c.id}/messages`)).data;
  assert.equal(msgs.at(-1).sent_via, 'inbox');
  assert.equal((await admin(`/api/p/${jb}/conversations/${c.id}`)).data.reply_state, 'da_tra_loi');

  // Page chưa kết nối → ghi log, không lỗi
  r = await hook({ object: 'page', entry: [{ id: '000', messaging: [{ sender: { id: '1' }, recipient: { id: '000' }, timestamp: Date.now(), message: { mid: 'm_x', text: 'hi' } }] }] });
  assert.equal(r.status, 200);
  const st = (await admin('/api/admin/meta')).data;
  assert.equal(st.pages.length, 1); assert.ok(st.log.some(l => l.kind === 'unknown_page'));
  assert.ok(st.webhook_url.endsWith('/webhooks/meta'));

  // nhân viên bán hàng không thấy Page chưa được giao
  assert.equal((await sales(`/api/p/${jb}/conversations`)).status, 403);
  // ngắt kết nối
  assert.equal((await admin(`/api/admin/meta/pages/${jb}`, null, 'DELETE')).status, 200);
  assert.equal((await admin(`/api/p/${jb}/messenger`)).data.connected, false);
});
