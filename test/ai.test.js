// Kiểm thử AI soạn trả lời (giai đoạn 2: nháp chờ duyệt) với Claude API giả lập
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');
H.setupEnv();
require('../scripts/seed.js');
const app = require('../server/app');
const AI = require('../server/ai');
const { db } = require('../server/db');

const graph = H.fakeServer(H.graphHandler);
let claudeQueue = [];
const claude = H.fakeServer(call => { const f = claudeQueue.shift(); if (!f) return [500, { type: 'error', error: { type: 'api_error', message: 'hết kịch bản' } }]; return typeof f === 'function' ? f(call) : f; });
let server, base, admin, jb;
before(async () => {
  process.env.META_GRAPH_BASE = await graph.listen();
  process.env.ANTHROPIC_BASE_URL = await claude.listen();
  await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`;
  admin = await H.login(base, 'admin', 'admin123');
  jb = db.prepare("SELECT id FROM pages WHERE name='Japanbikini_fashion'").get().id;
  assert.equal((await admin('/api/admin/meta/connect', { token: H.PAGE_TOKEN, app_page_id: jb })).status, 200);
});
after(() => { server.close(); graph.close(); claude.close(); });
const conv = psid => db.prepare('SELECT * FROM conversations WHERE page_id=? AND fb_psid=?').get(jb, psid);
const drafts = id => db.prepare('SELECT * FROM ai_drafts WHERE conversation_id=? ORDER BY id').all(id);
const sends = () => graph.calls.filter(c => c.path.endsWith('me/messages'));

test('kiểm tra câu cảm ơn và số tiền', () => {
  const ctx = { catalog: AI.catalog(jb), quotes: [] };
  assert.deepEqual(AI.checkReply(H.result(), ctx), []);
  assert.ok(AI.checkReply(H.result({ reply: 'Dạ còn ạ. Cảm ơn chị! Chị lấy size nào ạ?' }), ctx).some(p => p.includes('Câu cuối')));
  assert.ok(AI.checkReply(H.result({ reply: 'Cảm ơn chị đã hỏi. Dạ còn ạ, cảm ơn chị!' }), ctx).some(p => p.includes('đúng 1')));
  assert.ok(AI.checkReply(H.result({ reply: 'Áo len giá 15k ạ. Cảm ơn chị!' }), ctx).some(p => p.includes('15.000')));
  assert.deepEqual(AI.checkReply(H.result({ language: 'en', reply: 'Yes, the sweater AL01 is 12,000đ. Thank you so much!' }), ctx), []);
  assert.deepEqual(AI.checkReply(H.result({ reply: 'Dạ 2 áo len là 24.000đ ạ. Shop cám ơn chị nhiều nha' }), ctx), []);
  assert.ok(AI.checkReply(H.result({ language: 'xx', reply: 'abc' }), ctx).length);
});

test('chưa có ANTHROPIC_API_KEY → chờ cấu hình, không ảnh hưởng phần khác', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await admin(`/api/p/${jb}/settings`, { ai_mode: 'draft' }, 'PUT');
  await H.hook(base, H.msg('2001', 'm_a1', 'Áo len còn không ạ?'));
  await H.settle(AI);
  const c = conv('2001');
  assert.equal(c.reply_state, 'chua_tra_loi');
  assert.equal(drafts(c.id).length, 0);
  const r = await admin(`/api/p/${jb}/conversations/${c.id}/ai`, {});
  assert.equal(r.status, 400); assert.match(r.data.error, /chờ cấu hình/);
  assert.equal((await admin(`/api/p/${jb}/messenger`)).data.ai.configured, false);
  assert.equal((await admin(`/api/p/${jb}/settings`, { ai_mode: 'bay' }, 'PUT')).status, 400);
});

test('chế độ nháp: soạn nháp, không tự gửi; duyệt thì gửi', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  claudeQueue.push(H.claudeJson(H.result()));
  await H.hook(base, H.msg('2002', 'm_b1', 'Áo len còn size M không ạ?'));
  await H.settle(AI);
  const c = conv('2002');
  const req = claude.calls.at(-1).body;
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.fallbacks, 'default');
  assert.match(JSON.stringify(req.system), /AL01 \| Áo len \| giá 12\.000đ/);
  assert.match(JSON.stringify(req.system), /QOX01 \| Quần ống xuông \| giá 130\.000đ \| S: còn 15; M: còn 15; L: còn 15/);
  assert.match(req.messages[0].content, /KHÁCH: Áo len còn size M không ạ\?/);
  const d = drafts(c.id);
  assert.equal(d.length, 1); assert.equal(d[0].status, 'cho_duyet'); assert.equal(c.flag, null);
  assert.equal(sends().length, 0, 'chế độ nháp không tự gửi');
  assert.equal((await admin(`/api/p/${jb}/messenger`)).data.drafts, 1);
  // duyệt sau khi sửa
  const r = await admin(`/api/p/${jb}/conversations/${c.id}/drafts/${d[0].id}/send`, { text: 'Dạ áo len AL01 còn size M ạ. Cảm ơn chị!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sends().at(-1).body.message.text, 'Dạ áo len AL01 còn size M ạ. Cảm ơn chị!');
  assert.equal(drafts(c.id)[0].status, 'da_gui');
  assert.equal(conv('2002').reply_state, 'da_tra_loi');
  assert.equal((await admin(`/api/p/${jb}/conversations/${c.id}/drafts/${d[0].id}/send`, {})).status, 400, 'không gửi lại lần 2');
});

test('sai giá → AI soạn lại 1 lần, vẫn sai thì gắn cờ kiểm tra', async () => {
  const bad = H.claudeJson(H.result({ reply: 'Dạ áo len giá 99.000đ ạ. Cảm ơn chị!' }));
  claudeQueue.push(bad, bad);
  const n0 = claude.calls.length;
  await H.hook(base, H.msg('2003', 'm_c1', 'Áo len bao nhiêu?'));
  await H.settle(AI);
  assert.equal(claude.calls.length - n0, 2);
  assert.match(claude.calls.at(-1).body.messages.at(-1).content, /99\.000đ không khớp/);
  const c = conv('2003'); const d = drafts(c.id)[0];
  assert.equal(c.flag, 'kiem_tra'); assert.match(d.checks, /99\.000đ/);
});

test('mặc cả → chỉ nháp + cờ báo chủ shop; công cụ GHTK chưa cấu hình', async () => {
  claudeQueue.push(H.claudeTool('ghtk_quote', { province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thủy', items: [{ code: 'QD01', size: 'M', qty: 1 }] }));
  claudeQueue.push(call => {
    const tr = call.body.messages.at(-1).content[0];
    assert.equal(tr.type, 'tool_result'); assert.match(tr.content, /"available":false/);
    return H.claudeJson(H.result({ needs_owner: true, flag_reason: 'mac_ca', flag_note: 'Khách xin giảm 20k', intent: 'khac', reply: 'Dạ shop xin phép kiểm tra lại ưu đãi và báo chị ngay ạ. Cảm ơn chị đã thông cảm!' }));
  });
  await H.hook(base, H.msg('2004', 'm_d1', 'Quần đùi bớt 20k được không shop, ship về Cầu Giấy Hà Nội'));
  await H.settle(AI);
  const c = conv('2004'); const d = drafts(c.id)[0];
  assert.equal(c.flag, 'mac_ca'); assert.equal(d.status, 'cho_duyet'); assert.match(d.flag_note, /20k/);
  assert.match(d.ship_quote, /available/);
  assert.equal((await admin(`/api/p/${jb}/messenger`)).data.flagged >= 1, true);
  assert.equal((await admin(`/api/p/${jb}/conversations?flag=1`)).data.some(x => x.id === c.id), true);
  // chủ shop tự trả lời trong Page inbox → nháp bị thay thế, gỡ cờ thủ công
  claudeQueue.push(H.claudeJson({ is_closing: false, complete: false, missing: [], order: H.emptyOrder })); // quy tắc j: không phải tin chốt đơn
  await H.hook(base, H.msg('2004', 'm_d2', 'Dạ shop giảm 10k cho chị nha', { echo: true }));
  await H.settle(AI);
  assert.equal(drafts(c.id)[0].status, 'thay_the');
  assert.equal((await admin(`/api/p/${jb}/conversations/${c.id}/flag`, {})).status, 200);
  assert.equal(conv('2004').flag, null);
});

test('khách nhắn liên tiếp → chỉ soạn cho tin mới nhất; lỗi API → ghi lỗi + cờ', async () => {
  process.env.AI_DEBOUNCE_MS = '150';
  claudeQueue.push(H.claudeJson(H.result({ language: 'en', reply: 'Hi! Yes we ship to Da Nang. Thank you for messaging us!' })));
  const n0 = claude.calls.length;
  await H.hook(base, H.msg('2005', 'm_e1', 'Hi'));
  await H.hook(base, H.msg('2005', 'm_e2', 'Do you ship to Da Nang?'));
  await H.sleep(250); await H.settle(AI);
  assert.equal(claude.calls.length - n0, 1, 'gom 2 tin thành 1 lần gọi');
  assert.match(claude.calls.at(-1).body.messages[0].content, /KHÁCH: Hi\n.*KHÁCH: Do you ship to Da Nang\?/s);
  process.env.AI_DEBOUNCE_MS = '0';
  await H.hook(base, H.msg('2006', 'm_f1', 'alo')); // hàng đợi trống → API lỗi
  await H.settle(AI);
  const c = conv('2006');
  assert.equal(drafts(c.id)[0].status, 'loi'); assert.equal(c.flag, 'khac');
});
