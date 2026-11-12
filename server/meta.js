// Kết nối Facebook Page qua Meta Graph API chính thức (Messenger Platform).
// Quyền xin khi đăng nhập Facebook (xem docs/META_SETUP.md để biết lý do từng quyền khi nộp App Review):
//   pages_show_list       — liệt kê các Page mà chủ shop quản lý để chọn Page cần kết nối vào app
//   pages_messaging       — đọc hội thoại Messenger của Page và gửi trả lời cho khách
//   pages_manage_metadata — đăng ký webhook (subscribed_apps) để Meta đẩy tin nhắn mới về server
// Khi app Meta còn ở chế độ Development (chưa qua App Review): chỉ người có vai trò Admin/Developer/Tester
// trong app Meta mới kết nối được Page và chỉ nhận/gửi tin với những người có vai trò đó.
const crypto = require('crypto');
const { db, tx } = require('./db');
const D = require('./domain');
const { AppError } = D;
const { encrypt, decrypt } = require('./secret');

const SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
const WEBHOOK_FIELDS = ['messages', 'message_echoes', 'messaging_postbacks'];
const cfg = () => ({
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
  version: process.env.META_GRAPH_VERSION || 'v23.0',
  configId: process.env.META_LOGIN_CONFIG_ID || '', // tuỳ chọn: cấu hình "Facebook Login for Business"
  graphBase: process.env.META_GRAPH_BASE || 'https://graph.facebook.com', // chỉ đổi khi kiểm thử
  dialogBase: process.env.META_DIALOG_BASE || 'https://www.facebook.com',
});

// ---------- Gọi Graph API ----------
async function graph(method, pathname, params = {}, body) {
  const c = cfg();
  const url = new URL(`${c.graphBase}/${c.version}/${pathname.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await res.json(); } catch { }
  if (!res.ok || (data && data.error)) {
    const e = data && data.error || {};
    const err = new AppError('Facebook báo lỗi: ' + (e.message || 'HTTP ' + res.status), 502);
    err.fbCode = e.code; err.fbSubcode = e.error_subcode;
    throw err;
  }
  return data;
}
async function graphAll(pathname, params, max = 500) {
  let out = [], data = await graph('GET', pathname, params);
  while (true) {
    out = out.concat(data.data || []);
    const next = data.paging && data.paging.cursors && data.paging.next ? data.paging.cursors.after : null;
    if (!next || out.length >= max) return out;
    data = await graph('GET', pathname, { ...params, after: next });
  }
}

const fbTime = s => { // ISO của Facebook (2026-11-12T03:00:00+0000) hoặc mili-giây → giờ địa phương như phần còn lại của app
  const d = typeof s === 'number' ? new Date(s) : new Date(String(s).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ---------- Page đã kết nối ----------
const fbPageByApp = pid => db.prepare('SELECT * FROM fb_pages WHERE page_id=?').get(pid);
const fbPageByFb = fbid => db.prepare('SELECT * FROM fb_pages WHERE fb_page_id=?').get(String(fbid));
const tokenOf = fp => decrypt(fp.token_enc);
function markError(fp, e) {
  db.prepare('UPDATE fb_pages SET last_error=? WHERE page_id=?').run(e ? String(e.message || e).slice(0, 500) : null, fp.page_id);
}
function webhookLog(fbid, kind, ok, detail) {
  db.prepare('INSERT INTO fb_webhook_log (fb_page_id,kind,ok,detail) VALUES (?,?,?,?)').run(fbid ? String(fbid) : null, kind, ok ? 1 : 0, String(detail || '').slice(0, 1000));
  db.prepare('DELETE FROM fb_webhook_log WHERE id <= (SELECT MAX(id) - 1000 FROM fb_webhook_log)').run();
}

async function connectPage({ appPageId, newPageName, fbPageId, fbName, token, userId }) {
  let pid = appPageId ? Number(appPageId) : null;
  if (pid && !db.prepare('SELECT 1 FROM pages WHERE id=?').get(pid)) throw new AppError('Không tìm thấy Page trong app');
  const other = fbPageByFb(fbPageId);
  if (other && other.page_id !== pid) {
    const n = db.prepare('SELECT name FROM pages WHERE id=?').get(other.page_id);
    throw new AppError(`Page Facebook này đã kết nối với Page "${n ? n.name : other.page_id}" trong app`);
  }
  // Đăng ký nhận webhook trước — nếu thất bại thì không lưu gì
  await graph('POST', `${fbPageId}/subscribed_apps`, { subscribed_fields: WEBHOOK_FIELDS.join(','), access_token: token });
  pid = tx(() => {
    if (!pid) pid = Number(db.prepare('INSERT INTO pages (name,fb_url,order_prefix) VALUES (?,?,?)')
      .run(newPageName || fbName, `https://facebook.com/${fbPageId}`, 'FB').lastInsertRowid);
    db.prepare(`INSERT INTO fb_pages (page_id,fb_page_id,fb_name,token_enc,subscribed,connected_by) VALUES (?,?,?,?,1,?)
      ON CONFLICT(page_id) DO UPDATE SET fb_page_id=excluded.fb_page_id, fb_name=excluded.fb_name, token_enc=excluded.token_enc,
      subscribed=1, last_error=NULL, connected_by=excluded.connected_by, connected_at=datetime('now','localtime')`)
      .run(pid, String(fbPageId), fbName, encrypt(token), userId);
    D.log(pid, userId, 'ket_noi_facebook', `${fbName} (${fbPageId})`);
    return pid;
  });
  syncPage(pid).catch(e => console.error('Đồng bộ hội thoại lỗi:', e.message));
  return pid;
}
async function disconnectPage(pid, userId) {
  const fp = fbPageByApp(pid);
  if (!fp) return;
  try { await graph('DELETE', `${fp.fb_page_id}/subscribed_apps`, { access_token: tokenOf(fp) }); } catch (e) { /* token có thể đã hết hạn — vẫn gỡ khỏi app */ }
  db.prepare('DELETE FROM fb_pages WHERE page_id=?').run(pid);
  D.log(pid, userId, 'ngat_facebook', fp.fb_name);
}

// ---------- Hội thoại & tin nhắn ----------
function upsertConversation(pid, psid, name) {
  let c = db.prepare('SELECT * FROM conversations WHERE page_id=? AND fb_psid=?').get(pid, String(psid));
  if (c) {
    if (name && !c.customer_name) db.prepare('UPDATE conversations SET customer_name=? WHERE id=?').run(name, c.id);
    return c.id;
  }
  return Number(db.prepare(`INSERT INTO conversations (page_id,customer_name,channel,source,fb_psid,reply_state,summary)
    VALUES (?,?,'inbox','Messenger',?,'chua_tra_loi',NULL)`).run(pid, name || null, String(psid)).lastInsertRowid);
}
// Lưu 1 tin nhắn (bỏ qua nếu trùng mid) và cập nhật trạng thái đã/chưa trả lời theo tin mới nhất
function saveMessage(convId, { mid, direction, text, attachments, sentVia, userId, at }) {
  const r = db.prepare(`INSERT OR IGNORE INTO fb_messages (conversation_id,mid,direction,text,attachments,sent_via,user_id,at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(convId, String(mid), direction, text || null, attachments && attachments.length ? JSON.stringify(attachments) : null, sentVia || null, userId || null, at);
  if (!r.changes) return false;
  const c = db.prepare('SELECT last_msg_at FROM conversations WHERE id=?').get(convId);
  if (!c.last_msg_at || at >= c.last_msg_at) {
    const preview = text || (attachments && attachments.length ? `[${attachments.map(a => a.type || 'tệp').join(', ')}]` : '');
    db.prepare(`UPDATE conversations SET last_msg_at=?, last_msg_from=?, last_msg_text=?, reply_state=?, updated_at=? WHERE id=?`)
      .run(at, direction === 'in' ? 'customer' : 'page', preview.slice(0, 300), direction === 'in' ? 'chua_tra_loi' : 'da_tra_loi', at, convId);
  }
  return true;
}
const attOf = list => (list || []).map(a => ({ type: a.type || (a.mime_type || '').split('/')[0] || 'file', url: a.payload?.url || a.image_data?.url || a.file_url || null, name: a.name || null }));

async function fillProfileName(fp, convId, psid) {
  const c = db.prepare('SELECT customer_name FROM conversations WHERE id=?').get(convId);
  if (c.customer_name) return;
  try {
    const u = await graph('GET', String(psid), { fields: 'name,first_name,last_name', access_token: tokenOf(fp) });
    const name = u.name || [u.last_name, u.first_name].filter(Boolean).join(' ');
    if (name) db.prepare('UPDATE conversations SET customer_name=? WHERE id=? AND customer_name IS NULL').run(name, convId);
  } catch (e) { /* hồ sơ có thể bị ẩn — giữ trống tên */ }
}

// Xử lý body webhook đã xác thực chữ ký
async function handleWebhook(body) {
  if (!body || body.object !== 'page') return;
  for (const entry of body.entry || []) {
    const fp = fbPageByFb(entry.id);
    if (!fp) { webhookLog(entry.id, 'unknown_page', false, 'Page chưa kết nối trong app'); continue; }
    db.prepare("UPDATE fb_pages SET last_event_at=datetime('now','localtime') WHERE page_id=?").run(fp.page_id);
    for (const ev of entry.messaging || []) {
      try {
        const m = ev.message || (ev.postback ? { mid: ev.postback.mid || `pb_${ev.sender.id}_${ev.timestamp}`, text: ev.postback.title } : null);
        if (!m || !m.mid) continue; // delivery / read / reaction: bỏ qua
        const echo = !!m.is_echo;
        const psid = echo ? ev.recipient.id : ev.sender.id;
        const convId = upsertConversation(fp.page_id, psid);
        const sentVia = echo ? (m.app_id && String(m.app_id) === cfg().appId ? 'app' : 'inbox') : null;
        saveMessage(convId, { mid: m.mid, direction: echo ? 'out' : 'in', text: m.text, attachments: attOf(m.attachments), sentVia, at: fbTime(ev.timestamp || Date.now()) });
        webhookLog(entry.id, echo ? 'echo' : 'message', true, (m.text || '').slice(0, 120));
        if (!echo) fillProfileName(fp, convId, psid);
      } catch (e) {
        webhookLog(entry.id, 'error', false, e.message);
      }
    }
  }
}

// Đồng bộ lại hội thoại gần đây từ Graph API (lần đầu kết nối, hoặc khi bấm "Đồng bộ")
async function syncPage(pid, limit = 50) {
  const fp = fbPageByApp(pid);
  if (!fp) throw new AppError('Page chưa kết nối Facebook');
  try {
    const threads = await graphAll(`${fp.fb_page_id}/conversations`, {
      platform: 'messenger', limit: 25, access_token: tokenOf(fp),
      fields: 'id,updated_time,participants,messages.limit(25){id,message,from,created_time,attachments{mime_type,name,image_data,file_url}}',
    }, limit);
    let n = 0;
    for (const t of threads) {
      const cust = (t.participants?.data || []).find(p => String(p.id) !== String(fp.fb_page_id));
      if (!cust) continue;
      const convId = upsertConversation(pid, cust.id, cust.name);
      db.prepare('UPDATE conversations SET fb_thread_id=? WHERE id=?').run(t.id, convId);
      for (const m of [...(t.messages?.data || [])].reverse()) {
        const out = String(m.from?.id) === String(fp.fb_page_id);
        if (saveMessage(convId, { mid: m.id, direction: out ? 'out' : 'in', text: m.message, attachments: attOf(m.attachments?.data), sentVia: out ? 'inbox' : null, at: fbTime(m.created_time) })) n++;
      }
    }
    db.prepare("UPDATE fb_pages SET last_sync_at=datetime('now','localtime'), last_error=NULL WHERE page_id=?").run(pid);
    return { threads: threads.length, new_messages: n };
  } catch (e) { markError(fp, e); throw e; }
}

// Gửi tin nhắn văn bản cho khách (trong cửa sổ 24 giờ kể từ tin cuối của khách — quy định của Messenger)
async function sendText(pid, convId, text, userId) {
  const fp = fbPageByApp(pid);
  if (!fp) throw new AppError('Page chưa kết nối Facebook');
  const c = db.prepare('SELECT * FROM conversations WHERE id=? AND page_id=?').get(convId, pid);
  if (!c || !c.fb_psid) throw new AppError('Hội thoại này không phải hội thoại Messenger');
  text = String(text || '').trim();
  if (!text) throw new AppError('Nội dung trống');
  if (text.length > 2000) throw new AppError('Tin nhắn tối đa 2000 ký tự');
  let r;
  try {
    r = await graph('POST', 'me/messages', { access_token: tokenOf(fp) }, { recipient: { id: c.fb_psid }, messaging_type: 'RESPONSE', message: { text } });
  } catch (e) {
    if (e.fbCode === 10 || e.fbSubcode === 2018278) e.message = 'Đã quá 24 giờ kể từ tin nhắn cuối của khách — Messenger không cho Page gửi tin chủ động. Hãy trả lời trong Page inbox.';
    if (e.fbCode === 190) markError(fp, e);
    throw e;
  }
  saveMessage(c.id, { mid: r.message_id, direction: 'out', text, sentVia: 'app', userId, at: D.nowStr() });
  D.log(pid, userId, 'gui_tin_messenger', `Hội thoại #${c.id}`);
  return { ok: true, message_id: r.message_id };
}

// ---------- Xác thực webhook ----------
function verifySignature(raw, header) {
  const secret = cfg().appSecret;
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(String(header).slice(7));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ---------- Đăng nhập Facebook (OAuth) ----------
function oauthUrl(state, redirectUri) {
  const c = cfg();
  const u = new URL(`${c.dialogBase}/${c.version}/dialog/oauth`);
  u.searchParams.set('client_id', c.appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  if (c.configId) u.searchParams.set('config_id', c.configId);
  else u.searchParams.set('scope', SCOPES.join(','));
  return u.toString();
}
async function oauthExchange(code, redirectUri) {
  const c = cfg();
  const short = await graph('GET', 'oauth/access_token', { client_id: c.appId, client_secret: c.appSecret, redirect_uri: redirectUri, code });
  // Đổi sang token người dùng dài hạn → token Page lấy từ đó không hết hạn
  const long = await graph('GET', 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: c.appId, client_secret: c.appSecret, fb_exchange_token: short.access_token });
  const pages = await graphAll('me/accounts', { fields: 'id,name,access_token,tasks', limit: 100, access_token: long.access_token });
  return pages.map(p => ({ id: String(p.id), name: p.name, token: p.access_token, tasks: p.tasks || [] }));
}
// Kết nối bằng Page Access Token dán tay (dùng khi thử nghiệm với Graph API Explorer)
async function inspectPageToken(token) {
  const c = cfg();
  if (c.appId && c.appSecret) {
    const d = (await graph('GET', 'debug_token', { input_token: token, access_token: `${c.appId}|${c.appSecret}` })).data || {};
    if (!d.is_valid) throw new AppError('Token không hợp lệ hoặc đã hết hạn');
    if (d.type && d.type !== 'PAGE') throw new AppError('Đây không phải Page Access Token (loại: ' + d.type + ')');
    if (d.app_id && String(d.app_id) !== c.appId) throw new AppError('Token thuộc một app Meta khác META_APP_ID');
    const missing = ['pages_messaging', 'pages_manage_metadata'].filter(s => !(d.scopes || []).includes(s));
    if (missing.length) throw new AppError('Token thiếu quyền: ' + missing.join(', '));
  }
  const me = await graph('GET', 'me', { fields: 'id,name', access_token: token });
  return { id: String(me.id), name: me.name };
}

function status() {
  const c = cfg();
  return {
    configured: { META_APP_ID: !!c.appId, META_APP_SECRET: !!c.appSecret, META_WEBHOOK_VERIFY_TOKEN: !!c.verifyToken, TOKEN_ENCRYPTION_KEY: !!process.env.TOKEN_ENCRYPTION_KEY, META_LOGIN_CONFIG_ID: !!c.configId },
    graph_version: c.version, scopes: SCOPES, webhook_fields: WEBHOOK_FIELDS,
    pages: db.prepare(`SELECT f.page_id, f.fb_page_id, f.fb_name, f.subscribed, f.last_error, f.last_sync_at, f.last_event_at, f.connected_at, p.name page_name
      FROM fb_pages f JOIN pages p ON p.id=f.page_id ORDER BY p.name`).all(),
    log: db.prepare('SELECT * FROM fb_webhook_log ORDER BY id DESC LIMIT 30').all(),
  };
}

module.exports = { cfg, graph, SCOPES, connectPage, disconnectPage, syncPage, sendText, handleWebhook, verifySignature, oauthUrl, oauthExchange, inspectPageToken, status, fbPageByApp, encrypt, decrypt };
