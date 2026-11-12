// Máy chủ giả lập dùng chung cho kiểm thử: Graph API (Meta), Claude API (Anthropic), GHTK
const http = require('http'), crypto = require('crypto');
const os = require('os'), fs = require('fs'), path = require('path');

function fakeServer(handler) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', async () => {
      const u = new URL(req.url, 'http://x');
      const call = { method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), headers: req.headers, body: body ? JSON.parse(body) : null };
      calls.push(call);
      let status, out;
      try { [status, out] = await handler(call); }
      catch (e) { calls.errors = (calls.errors || []).concat(e); console.error('Lỗi trong máy chủ giả lập:', e.message); [status, out] = [400, { type: 'error', error: { type: 'invalid_request_error', message: 'assert: ' + e.message } }]; }
      res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
    });
  });
  return { calls, srv, listen: () => new Promise(r => srv.listen(0, () => r(`http://127.0.0.1:${srv.address().port}`))), close: () => srv.close() };
}

function setupEnv(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bht-'));
  Object.assign(process.env, { DB_PATH: path.join(tmp, 't.db'), META_APP_ID: '999', META_APP_SECRET: 'app-secret-test', META_WEBHOOK_VERIFY_TOKEN: 'verify-me', META_GRAPH_VERSION: 'v23.0', AI_DEBOUNCE_MS: '0', ...extra });
}

const FB_PAGE = '117228986319268', PAGE_TOKEN = 'EAAG-page-token-xyz';
function graphHandler(call) {
  const p = call.path.replace('/v23.0/', '');
  if (call.q.access_token !== PAGE_TOKEN && p !== 'debug_token') return [400, { error: { message: 'Invalid OAuth access token', code: 190 } }];
  if (p === 'debug_token') return [200, { data: { is_valid: true, type: 'PAGE', app_id: '999', scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'] } }];
  if (p === 'me' && call.method === 'GET') return [200, { id: FB_PAGE, name: 'Japanbikini_fashion' }];
  if (p === `${FB_PAGE}/subscribed_apps`) return [200, { success: true }];
  if (p === `${FB_PAGE}/conversations`) return [200, { data: [] }];
  if (p === 'me/messages') return [200, { recipient_id: call.body.recipient.id, message_id: 'm_out_' + crypto.randomBytes(4).toString('hex') }];
  if (/^\d+$/.test(p)) return [200, { name: 'Khách ' + p }];
  return [404, { error: { message: 'not found ' + p } }];
}

// Phản hồi Claude: kết quả JSON theo schema
function claudeJson(result, extra = {}) {
  return [200, { id: 'msg_' + crypto.randomBytes(4).toString('hex'), type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 100, output_tokens: 50 }, ...extra }];
}
function claudeTool(name, input) {
  return [200, { id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'toolu_' + crypto.randomBytes(3).toString('hex'), name, input }], usage: { input_tokens: 80, output_tokens: 20 } }];
}
const emptyOrder = { items: [], recipient_name: '', recipient_name_from_customer: false, phone: '', province: '', district: '', ward: '', street: '' };
function result(over = {}) {
  return { language: 'vi', intent: 'hoi_san_pham', needs_owner: false, flag_reason: '', flag_note: '', reply: 'Dạ áo len AL01 giá 12.000đ còn đủ size S, M, L ạ. Shop cảm ơn chị đã nhắn tin ạ!',
    order: emptyOrder, order_summary_in_reply: false, order_confirmed: false, asked_fb_name: false, ...over };
}

async function login(base, u, p) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (url, body, method) => {
    const res = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
}
function hook(base, obj) {
  const raw = JSON.stringify(obj);
  return fetch(base + '/webhooks/meta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', 'app-secret-test').update(raw).digest('hex') }, body: raw });
}
let tick = 0;
const msg = (psid, mid, text, opts = {}) => ({ object: 'page', entry: [{ id: FB_PAGE, time: Date.now(), messaging: [{
  sender: { id: opts.echo ? FB_PAGE : psid }, recipient: { id: opts.echo ? psid : FB_PAGE }, timestamp: Date.now() + (tick++) * 1000,
  message: { mid, text, ...(opts.echo ? { is_echo: true, app_id: opts.appId || 263902037430900 } : {}) } }] }] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function settle(AI) { for (let i = 0; i < 200; i++) { await sleep(20); if (AI.idle()) { await sleep(30); if (AI.idle()) return; } } throw new Error('AI chưa xong'); }

module.exports = { fakeServer, setupEnv, graphHandler, claudeJson, claudeTool, result, emptyOrder, login, hook, msg, sleep, settle, FB_PAGE, PAGE_TOKEN };
