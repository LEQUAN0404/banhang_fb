'use strict';
// ===== Tiện ích =====
const S = { me: null, page: null, meta: null, settings: null };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Math.round(Number(n) || 0)).toLocaleString('vi-VN') + 'đ';
const num = n => (Number(n) || 0).toLocaleString('vi-VN');
const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const dt = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + ' ' + s.slice(11, 16) : '';
const day = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const role = () => S.me.user.role;
const can = (...r) => r.includes(role());
const pill = st => `<span class="pill s-${st}">${esc(S.meta.STATUS[st] || st)}</span>`;
const variantLabel = v => [v.size, v.color].filter(Boolean).join(' / ') || 'Mặc định';
const addr = o => [o.street, o.ward, o.district, o.province].filter(Boolean).join(', ');
const tags = s => String(s || '').split(',').map(t => t.trim()).filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { }
  if (res.status === 401 && path !== '/api/login') { S.me = null; renderLogin(); throw new Error('Phiên đăng nhập đã hết'); }
  if (!res.ok) throw new Error((data && data.error) || 'Lỗi ' + res.status);
  return data;
}
const P = (path, opts) => api(`/api/p/${S.page.id}${path}`, opts);

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 2500);
}
async function run(fn) { try { return await fn(); } catch (e) { toast(e.message, true); } }
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(isNaN(el.value) ? el.value : Number(el.value)); } else o[el.name] = el.checked; }
    else o[el.name] = el.value;
  }
  return o;
}
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Đã chép — dán vào Messenger'), () => prompt('Chép nội dung:', text)); }
function fillTpl(tpl, o) {
  const st = S.settings;
  const lines = (o.items || []).map(i => `• ${i.product_name} ${variantLabel(i)} x${i.qty}: ${money(i.price * i.qty)}`).join('\n');
  const map = {
    ma_don: o.code, ten_khach: o.ship_name, san_pham: lines, tien_hang: money(o.subtotal), phi_ship: money(o.ship_fee), giam_gia: money(o.discount),
    tong_tien: money(o.total), thanh_toan: S.meta.PAY_METHODS[o.pay_method] + (o.pay_method === 'coc' ? `, cọc trước ${money(o.deposit_required)}` : '') + (o.pay_method === 'cod' && o.paid_amount > 0 ? `, đã nhận ${money(o.paid_amount)}` : ''),
    dia_chi: addr(o), chinh_sach: st.return_policy, gio_lam_viec: st.working_hours, ma_van_don: o.tracking_code || '', hang_van_chuyen: o.carrier || '',
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => k in map ? map[k] : m);
}

function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  $$('[data-close]', bg).forEach(b => b.onclick = close);
  document.body.appendChild(bg);
  const f = $('input,select,textarea', bg); if (f) f.focus();
  onMount && onMount(bg, close);
  return { el: bg, close };
}
// Hộp thoại form: fields = [{name,label,type,options,required,value,hint}]
function formModal(title, fields, onSubmit, submitLabel = 'Lưu') {
  const fld = f => {
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') input = `<select name="${f.name}" ${req}>${(f.options || []).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.name}" ${req}>${esc(f.value ?? '')}</textarea>`;
    else if (f.type === 'checkbox') return `<label class="row"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    else if (f.type === 'html') return f.html;
    else input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${req} ${f.list ? `list="${f.list}"` : ''} ${f.attrs || ''}>`;
    return `<label class="f"><span class="${f.required ? 'req' : ''}">${esc(f.label)}</span>${input}${f.hint ? `<div class="small muted">${esc(f.hint)}</div>` : ''}</label>`;
  };
  return modal(`<h2>${esc(title)}</h2><form class="grid">${fields.map(fld).join('')}
    <div class="row"><button class="btn p">${esc(submitLabel)}</button><button type="button" class="btn" data-close>Đóng</button></div></form>`, (bg, close) => {
    $('form', bg).onsubmit = async e => {
      e.preventDefault();
      const btn = $('button.p', bg); btn.disabled = true;
      try { await onSubmit(formData(e.target), close); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    };
  });
}

// ===== Đăng nhập & khung =====
function renderLogin() {
  document.body.innerHTML = `<div class="login"><div class="card"><h1>Quản lý bán hàng Facebook</h1>
    <form id="lf" class="grid"><label class="f"><span>Tên đăng nhập</span><input name="username" autocomplete="username" required></label>
    <label class="f"><span>Mật khẩu</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn p">Đăng nhập</button></form></div></div>`;
  $('#lf').onsubmit = e => { e.preventDefault(); run(async () => { await api('/api/login', { body: formData(e.target) }); await boot(); }); };
}

const NAV = [
  ['dashboard', '📊', 'Tổng quan', ['admin', 'sales', 'warehouse']],
  ['conversations', '💬', 'Hội thoại', ['admin', 'sales']],
  ['orders', '🧾', 'Đơn hàng', ['admin', 'sales', 'warehouse']],
  ['customers', '👥', 'Khách hàng', ['admin', 'sales']],
  ['products', '📦', 'Sản phẩm & Kho', ['admin', 'sales', 'warehouse']],
  ['reconcile', '💰', 'Đối soát', ['admin', 'sales']],
  ['reports', '📈', 'Báo cáo', ['admin']],
  ['settings', '⚙️', 'Cài đặt Page', ['admin']],
  ['admin', '🔐', 'Tài khoản & Page', ['admin']],
];

async function boot() {
  try { S.me = await api('/api/me'); } catch { return; }
  S.meta = S.me.meta;
  if (!S.me.pages.length && role() !== 'admin') {
    document.body.innerHTML = `<div class="login"><div class="card"><h2>Chưa được giao Page</h2><p>Tài khoản của bạn chưa được giao Page nào. Liên hệ quản trị viên.</p><button class="btn" id="lo">Đăng xuất</button></div></div>`;
    $('#lo').onclick = logout; return;
  }
  const saved = Number(localStorageGet('pageId'));
  S.page = S.me.pages.find(p => p.id === saved) || S.me.pages[0] || null;
  if (S.page) S.settings = await P('/settings');
  document.body.innerHTML = `<div class="layout"><aside class="side"><div class="brand">🛍️ Bán hàng FB</div>
    <select class="pagepick" id="pp"></select><nav id="nav"></nav><div class="sep"></div>
    <div class="small muted" style="padding:0 6px">${esc(S.me.user.name)} · ${esc(S.meta.ROLES[role()])}</div>
    <nav><a href="#/account">🔑 Tài khoản</a><a href="#" id="lo">↩️ Đăng xuất</a></nav></aside>
    <main class="main" id="view"></main></div><nav class="mnav" id="mnav"></nav>`;
  $('#pp').innerHTML = S.me.pages.map(p => `<option value="${p.id}" ${S.page && p.id === S.page.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option>(chưa có Page)</option>';
  $('#pp').onchange = async e => { S.page = S.me.pages.find(p => p.id === Number(e.target.value)); localStorageSet('pageId', S.page.id); S.settings = await P('/settings'); route(); };
  $('#lo').onclick = e => { e.preventDefault(); logout(); };
  window.onhashchange = route;
  route();
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { } }
async function logout() { await run(() => api('/api/logout', { body: {} })); S.me = null; renderLogin(); }

function renderNav(cur) {
  const items = NAV.filter(n => can(...n[3]));
  $('#nav').innerHTML = items.map(n => `<a href="#/${n[0]}" class="${cur === n[0] ? 'on' : ''}">${n[1]} ${n[2]}</a>`).join('');
  const mob = items.filter(n => ['dashboard', 'conversations', 'orders', 'products', 'customers'].includes(n[0])).slice(0, 4);
  $('#mnav').innerHTML = mob.map(n => `<a href="#/${n[0]}" class="${cur === n[0] ? 'on' : ''}"><span>${n[1]}</span>${n[2].split(' ')[0]}</a>`).join('') + `<a href="#/more" class="${cur === 'more' ? 'on' : ''}"><span>☰</span>Thêm</a>`;
}

async function route() {
  const hash = location.hash.slice(2) || 'dashboard';
  const [pathPart, qs] = hash.split('?');
  const parts = pathPart.split('/');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const v = $('#view'); if (!v) return;
  renderNav(parts[0]);
  if (!S.page && !['admin', 'account', 'more'].includes(parts[0])) { location.hash = '#/admin'; return; }
  const views = { dashboard: viewDashboard, orders: viewOrders, conversations: viewConversations, customers: viewCustomers, products: viewProducts,
    reconcile: viewReconcile, reports: viewReports, settings: viewSettings, admin: viewAdmin, account: viewAccount, print: viewPrint, more: viewMore };
  const fn = views[parts[0]];
  if (!fn) { v.innerHTML = '<div class="card">Không tìm thấy trang.</div>'; return; }
  v.innerHTML = '<div class="muted">Đang tải…</div>';
  try { await fn(v, parts.slice(1), q); window.scrollTo(0, 0); } catch (e) { v.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

function viewMore(v) {
  const items = NAV.filter(n => can(...n[3]));
  v.innerHTML = `<h1>Menu</h1><label class="f card"><span>Page đang làm việc</span><select id="pp2">${S.me.pages.map(p => `<option value="${p.id}" ${S.page && p.id === S.page.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <div class="card">${items.map(n => `<p><a href="#/${n[0]}">${n[1]} ${n[2]}</a></p>`).join('')}<p><a href="#/account">🔑 Tài khoản</a></p><p><a href="#" id="lo2">↩️ Đăng xuất</a></p></div>`;
  $('#pp2').onchange = e => { $('#pp').value = e.target.value; $('#pp').onchange({ target: e.target }); };
  $('#lo2').onclick = e => { e.preventDefault(); logout(); };
}

// ===== Dashboard =====
async function viewDashboard(v) {
  const d = await P('/dashboard');
  const t = d.tasks;
  const orderLi = (o, extra = '') => `<li><a href="#/orders/${o.id}">${esc(o.code)}</a> · ${esc(o.ship_name)} · ${money(o.total)} ${extra}</li>`;
  const box = (title, list, render, empty = 'Không có') => `<div class="card task"><h3><span>${title}</span><span class="pill">${list.length}</span></h3>
    ${list.length ? `<ul>${list.slice(0, 8).map(render).join('')}</ul>${list.length > 8 ? `<div class="small muted">… và ${list.length - 8} mục khác</div>` : ''}` : `<div class="muted small">${empty}</div>`}</div>`;
  const st = Object.keys(S.meta.STATUS);
  v.innerHTML = `<div class="topbar"><h1>Tổng quan · ${esc(S.page.name)}</h1><div class="row">
      ${can('admin', 'sales') ? `<a class="btn" href="#/conversations/new">+ Hội thoại</a><a class="btn p" href="#/orders/new">+ Tạo đơn</a>` : ''}</div></div>
    ${!d.reconciledToday && can('admin', 'sales') ? `<div class="alert">Hôm nay chưa chốt sổ đối soát. <a href="#/reconcile">Đối soát cuối ngày →</a></div>` : ''}
    <div class="grid g4">
      <div class="card stat"><div class="l">Đơn chốt hôm nay</div><div class="v">${d.todayOrders.n}</div><div class="small muted">${money(d.todayOrders.s)}</div></div>
      <div class="card stat"><div class="l">Tiền thu hôm nay</div><div class="v">${money(d.collected)}</div></div>
      <div class="card stat"><div class="l">Hội thoại mới hôm nay</div><div class="v">${d.convToday.n}</div><div class="small muted">Chốt ${d.convToday.chot || 0} · tỉ lệ ${d.convToday.n ? pct((d.convToday.chot || 0) / d.convToday.n) : '—'}</div></div>
      <div class="card stat"><div class="l">Hội thoại đang tư vấn</div><div class="v">${t.open_conversations}</div><div class="small"><a href="#/conversations?outcome=dang_tu_van">Xem →</a></div></div>
    </div>
    ${t.unanswered_messages && can('admin', 'sales') ? `<div class="alert err">💬 Có <b>${t.unanswered_messages}</b> hội thoại Messenger chưa trả lời. <a href="#/conversations?reply=chua_tra_loi">Trả lời ngay →</a></div>` : ''}
    <div class="card"><h3>Đơn theo trạng thái</h3><div class="row">${st.map(s => `<a href="#/orders?status=${s}">${pill(s)} <b>${d.byStatus[s] || 0}</b></a>`).join(' ')}</div></div>
    <h2>Việc cần xử lý</h2>
    <div class="grid g2">
      ${can('admin', 'sales') ? box('⏰ Đơn treo quá 24h chưa xác nhận', t.unconfirmed_overdue, o => orderLi(o, o.reminded_at ? '<span class="pill s-da_huy">đã nhắc → hủy theo quy tắc</span>' : '<span class="pill s-moi_tao">cần nhắc 1 lần</span>')) : ''}
      ${can('admin', 'sales') ? box('🆕 Đơn mới chờ xác nhận', t.unconfirmed, o => orderLi(o, `<span class="muted small">${dt(o.created_at)}</span>`)) : ''}
      ${can('admin', 'sales') ? box('💳 Chờ tiền chuyển khoản / cọc', t.waiting_payment, o => orderLi(o, `<span class="muted small">đã nhận ${money(o.paid_amount)}</span>`)) : ''}
      ${box('📦 Cần đóng gói & gửi', t.to_pack, o => orderLi(o, pill(o.status)))}
      ${box('🚚 Giao thất bại — liên hệ khách trong ngày', t.delivery_failed, o => orderLi(o, `<span class="pill s-da_huy">lần ${o.delivery_fail_count}</span> <span class="small muted">${esc(o.last_fail_note || '')}</span>`))}
      ${box('🐢 Đã gửi quá 5 ngày chưa giao xong', t.shipping_long, o => orderLi(o, `<span class="small muted">${esc(o.carrier || '')} ${esc(o.tracking_code || '')}</span>`))}
      ${can('admin', 'sales') ? box('💬 Chăm sóc sau bán (giao ≥ 1 ngày)', t.care_due, o => orderLi(o, `<span class="small muted">giao ${dt(o.delivered_at)}</span>`)) : ''}
      ${can('admin', 'sales') ? box('😟 Khách chưa hài lòng — xử lý trong 24h', t.unhappy, o => orderLi(o)) : ''}
      ${box('⚠️ Tồn kho sắp hết', t.low_stock, x => `<li>${esc(x.name)} · ${esc(variantLabel(x))} — còn <b>${x.stock}</b> <span class="muted small">(ngưỡng ${x.low_threshold})</span></li>`)}
    </div>`;
}

// ===== Hội thoại =====
async function viewConversations(v, parts, q) {
  if (parts[0] === 'new') return convForm(v, null);
  if (parts[0]) return convForm(v, await P('/conversations/' + parts[0]));
  const qs = new URLSearchParams({ q: q.q || '', outcome: q.outcome || '', tag: q.tag || '', reply: q.reply || '' });
  const [rows, ms] = await Promise.all([P('/conversations?' + qs), P('/messenger')]);
  const tabs = [['', '', 'Tất cả'], ['', 'chua_tra_loi', `Chưa trả lời${ms.unanswered ? ` (${ms.unanswered})` : ''}`], ['dang_tu_van', '', 'Đang tư vấn'], ['chot', '', 'Đã chốt'], ['khong_chot', '', 'Không chốt']];
  const cur = `${q.outcome || ''}|${q.reply || ''}`;
  const banner = ms.connected
    ? `<div class="alert ok small row">✅ Đã kết nối Messenger: <b>${esc(ms.fb_name)}</b> · tin mới tự về qua webhook${ms.last_event_at ? ` (gần nhất ${dt(ms.last_event_at)})` : ''}
        ${ms.last_error ? `<span style="color:var(--danger)">· Lỗi: ${esc(ms.last_error)}</span>` : ''}<button class="btn sm right" id="sync">⟳ Đồng bộ lại</button></div>`
    : `<div class="alert small">Page này chưa kết nối Messenger — hội thoại được ghi tay. ${can('admin') ? '<a href="#/admin/facebook">Kết nối Facebook Page →</a>' : 'Nhờ quản trị viên kết nối Facebook Page.'} Mục tiêu phản hồi: bình luận ≤ 15 phút, inbox 5–15 phút.</div>`;
  v.innerHTML = `<div class="topbar"><h1>Hội thoại</h1><div class="row"><button class="btn" id="qr">Câu trả lời nhanh</button><a class="btn p" href="#/conversations/new">+ Ghi hội thoại</a></div></div>
    ${banner}
    <div class="tabs">${tabs.map(([o, r, l]) => `<a href="#/conversations?outcome=${o}&reply=${r}" class="${cur === `${o}|${r}` ? 'on' : ''}">${l}</a>`).join('')}</div>
    <form class="row card" id="sf"><input name="q" placeholder="Tìm tên, SĐT, nội dung…" value="${esc(q.q || '')}" style="flex:1;min-width:160px">
      <select name="tag" style="width:auto"><option value="">Mọi nhãn</option>${S.settings.conv_tags.map(t => `<option ${q.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><button class="btn">Lọc</button></form>
    <div class="card tbl"><table><thead><tr><th>Thời gian</th><th>Khách</th><th class="hide-m">Nguồn</th><th>Tin cuối / tóm tắt</th><th>Kết quả</th><th></th></tr></thead><tbody>
    ${rows.map(c => `<tr class="click${c.reply_state === 'chua_tra_loi' ? ' unread' : ''}" data-href="#/conversations/${c.id}"><td class="small">${dt(c.last_msg_at || c.updated_at)}<div class="muted">${esc(c.user_name || '')}</div></td>
      <td><b>${esc(c.customer_name || '(chưa rõ tên)')}</b><div class="small muted">${esc(c.phone || '')} ${c.is_new_customer ? '<span class="tag">khách mới</span>' : '<span class="tag">khách cũ</span>'}</div></td>
      <td class="hide-m small">${c.fb_psid ? 'Messenger' : esc(c.channel === 'comment' ? 'Bình luận' : 'Inbox')}${c.source && c.source !== 'Messenger' ? ' · ' + esc(c.source) : ''}${c.content_code ? `<div class="muted">${esc(c.content_code)}</div>` : ''}</td>
      <td class="small">${c.fb_psid ? `${c.reply_state === 'chua_tra_loi' ? '<span class="pill s-da_huy">Chưa trả lời</span> ' : '<span class="pill s-hoan_thanh">Đã trả lời</span> '}<span>${c.last_msg_from === 'page' ? '<span class="muted">Shop:</span> ' : ''}${esc((c.last_msg_text || '').slice(0, 90))}</span>` : esc(c.interest || '')}
        <div class="muted">${esc((c.summary || '').slice(0, 90))}</div>${tags(c.tags)}</td>
      <td>${c.outcome === 'chot' ? `<span class="pill s-giao_thanh_cong">Chốt</span> <a href="#/orders/${c.order_id}">${esc(c.order_code || '')}</a>` : c.outcome === 'khong_chot' ? `<span class="pill s-da_huy">Không chốt</span><div class="small muted">${esc(c.lost_reason || '')}</div>` : '<span class="pill s-moi_tao">Đang tư vấn</span>'}</td>
      <td>${c.outcome === 'dang_tu_van' ? `<a class="btn sm p" href="#/orders/new?conv=${c.id}">Tạo đơn</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có hội thoại</td></tr>'}
    </tbody></table></div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); const f = formData(e.target); location.hash = `#/conversations?${new URLSearchParams({ ...q, ...f })}`; };
  $('#qr').onclick = quickReplies;
  if ($('#sync')) $('#sync').onclick = () => run(async () => { $('#sync').disabled = true; const r = await P('/messenger/sync', { body: {} }); toast(`Đã đồng bộ ${r.threads} hội thoại, ${r.new_messages} tin mới`); route(); });
  bindRowLinks(v);
  livePoll(v, () => P('/messenger').then(m => m.unanswered !== ms.unanswered || (m.last_event_at || '') !== (ms.last_event_at || '')));
}
// Tự tải lại trang khi có tin mới (kiểm tra mỗi 10 giây, dừng khi rời trang)
function livePoll(v, changed) {
  const h = location.hash;
  const t = setInterval(async () => {
    if (location.hash !== h || !document.body.contains(v)) return clearInterval(t);
    if (document.hidden || document.querySelector('.modal-bg') || (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))) return;
    try { if (await changed()) { clearInterval(t); route(); } } catch { }
  }, 10000);
}
function bindRowLinks(v) { $$('tr[data-href]', v).forEach(tr => tr.onclick = e => { if (e.target.closest('a,button,input')) return; location.hash = tr.dataset.href; }); }
function quickReplies() {
  const st = S.settings;
  const list = [...st.quick_replies, st.auto_reply.replace('{gio_lam_viec}', st.working_hours)];
  modal(`<h2>Câu trả lời nhanh</h2><p class="small muted">Bấm để chép, dán vào Messenger/bình luận.</p>${list.map((t, i) => `<div class="row" style="margin-bottom:8px"><pre class="msg" style="flex:1">${esc(t)}</pre><button class="btn sm" data-i="${i}">Chép</button></div>`).join('')}
    <button class="btn" data-close>Đóng</button>`, bg => $$('[data-i]', bg).forEach(b => b.onclick = () => copy(list[b.dataset.i])));
}
function convForm(v, c) {
  const st = S.settings, M = S.meta;
  c = c || { channel: 'inbox', outcome: 'dang_tu_van', tags: '' };
  const ctags = String(c.tags || '').split(',').map(s => s.trim());
  v.innerHTML = `<div class="topbar"><h1>${c.id ? 'Hội thoại #' + c.id : 'Ghi hội thoại mới'}</h1><div class="row"><button class="btn" id="qr">Câu trả lời nhanh</button>
    ${c.id && c.outcome === 'dang_tu_van' ? `<a class="btn p" href="#/orders/new?conv=${c.id}">Chốt → Tạo đơn</a>` : ''}${c.order_id ? `<a class="btn" href="#/orders/${c.order_id}">Xem đơn</a>` : ''}</div></div>
    ${c.fb_psid ? `<div class="card"><div class="row"><h3 style="margin:0">💬 Messenger</h3><span class="right small muted">${c.reply_state === 'chua_tra_loi' ? '<span class="pill s-da_huy">Chưa trả lời</span>' : '<span class="pill s-hoan_thanh">Đã trả lời</span>'}</span></div>
      <div class="chat" id="chat"><div class="muted small">Đang tải tin nhắn…</div></div>
      ${can('admin', 'sales') ? `<form class="row" id="rf" style="align-items:flex-end"><textarea name="text" rows="2" placeholder="Nhập trả lời gửi khách qua Messenger…" style="flex:1;min-width:200px" required></textarea>
        <div class="grid" style="gap:6px"><button class="btn p">Gửi</button><button type="button" class="btn sm" id="mk">${c.reply_state === 'chua_tra_loi' ? 'Đánh dấu đã trả lời' : 'Đánh dấu chưa trả lời'}</button></div></form>
        <div class="small muted">Messenger chỉ cho Page trả lời trong 24 giờ kể từ tin nhắn cuối của khách.</div>` : ''}</div>` : ''}
    <form class="card grid" id="cf">
      <div class="grid g3">
        <label class="f"><span>Tên khách (tên Facebook)</span><input name="customer_name" value="${esc(c.customer_name || '')}"></label>
        <label class="f"><span>SĐT</span><input name="phone" inputmode="tel" value="${esc(c.phone || '')}"></label>
        <label class="f"><span>Link Facebook khách</span><input name="fb_link" value="${esc(c.fb_link || '')}"></label>
        <label class="f"><span>Kênh</span><select name="channel"><option value="inbox" ${c.channel === 'inbox' ? 'selected' : ''}>Inbox</option><option value="comment" ${c.channel === 'comment' ? 'selected' : ''}>Bình luận</option></select></label>
        <label class="f"><span>Nguồn khách</span><select name="source"><option value="">—</option>${M.SOURCES.map(s => `<option ${c.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="f"><span>Mã nội dung / chiến dịch</span><input name="content_code" placeholder="VD: R-1106-A hoặc ADS-T11" value="${esc(c.content_code || '')}"></label>
      </div>
      <div id="custinfo" class="small"></div>
      <label class="f"><span>Sản phẩm quan tâm</span><input name="interest" value="${esc(c.interest || '')}"></label>
      <label class="f"><span>Tóm tắt (nhu cầu, size, băn khoăn, ưu đãi đã báo…)</span><textarea name="summary">${esc(c.summary || '')}</textarea></label>
      <div><div class="small muted">Nhãn</div>${st.conv_tags.map(t => `<label class="tag"><input type="checkbox" name="tags" data-multi="1" value="${esc(t)}" ${ctags.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join(' ')}</div>
      <div class="grid g2"><label class="f"><span>Kết quả</span><select name="outcome" ${c.order_id ? 'disabled' : ''}>
        <option value="dang_tu_van" ${c.outcome === 'dang_tu_van' ? 'selected' : ''}>Đang tư vấn</option><option value="khong_chot" ${c.outcome === 'khong_chot' ? 'selected' : ''}>Không chốt</option>
        ${c.outcome === 'chot' ? '<option value="chot" selected>Đã chốt</option>' : ''}</select></label>
        <label class="f" id="lr"><span class="req">Lý do không chốt</span><select name="lost_reason"><option value="">—</option>${st.lost_reasons.map(r => `<option ${c.lost_reason === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label></div>
      <div class="card" style="background:var(--bg)"><b>Kịch bản chuẩn 5 bước:</b> (1) hỏi nhu cầu/size → (2) gợi ý 2–3 SP kèm ảnh, giá → (3) xử lý băn khoăn (chất liệu, đổi size, phí ship) → (4) nêu ưu đãi → (5) chốt: xin họ tên, SĐT, địa chỉ đầy đủ.</div>
      <div class="row"><button class="btn p">Lưu</button><a class="btn" href="#/conversations">Quay lại</a></div>
    </form>`;
  const sync = () => { $('#lr').style.display = $('[name=outcome]').value === 'khong_chot' ? '' : 'none'; };
  $('[name=outcome]').onchange = sync; sync();
  if (c.fb_psid) chatThread(v, c);
  $('#qr').onclick = quickReplies;
  const lookup = async () => {
    const ph = $('[name=phone]').value.trim(); if (ph.length < 9) { $('#custinfo').innerHTML = ''; return; }
    const cu = await P('/customers/by-phone/' + encodeURIComponent(ph)).catch(() => null);
    $('#custinfo').innerHTML = cu ? `<div class="alert ok">Khách cũ: <a href="#/customers/${cu.id}">${esc(cu.code)} · ${esc(cu.name)}</a> · ${cu.total_orders} đơn · đã chi ${money(cu.total_spent)}${cu.usual_size ? ' · size thường mua: <b>' + esc(cu.usual_size) + '</b>' : ''} ${tags(cu.tags)}</div>` : '<span class="muted">Khách mới</span>';
    if (cu && !$('[name=customer_name]').value) $('[name=customer_name]').value = cu.name;
  };
  $('[name=phone]').onchange = lookup; lookup();
  $('#cf').onsubmit = e => {
    e.preventDefault();
    const f = formData(e.target); f.tags = (f.tags || []).join(', ');
    if (c.order_id) f.outcome = 'chot';
    run(async () => {
      if (c.id) { await P('/conversations/' + c.id, { method: 'PUT', body: f }); toast('Đã lưu'); route(); }
      else { const r = await P('/conversations', { body: f }); toast('Đã ghi hội thoại'); location.hash = '#/conversations/' + r.id; }
    });
  };
}

async function chatThread(v, c) {
  let last = '';
  const load = async () => {
    const msgs = await P(`/conversations/${c.id}/messages`);
    const sig = msgs.length + '|' + (msgs.at(-1)?.id || '');
    if (sig === last) return false;
    last = sig;
    const att = a => a.url && a.type === 'image' ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="ảnh khách gửi"></a>` : `<span class="tag">${esc(a.type || 'tệp')}${a.name ? ': ' + esc(a.name) : ''}</span>`;
    $('#chat').innerHTML = msgs.map(m => `<div class="bub ${m.direction}"><div class="tx">${esc(m.text || '')}</div>${(m.attachments || []).map(att).join('')}
      <div class="meta">${dt(m.at)}${m.direction === 'out' ? ` · ${m.sent_via === 'app' ? 'gửi từ app' + (m.user_name ? ' (' + esc(m.user_name) + ')' : '') : 'gửi từ Page inbox'}` : ''}</div></div>`).join('') || '<div class="muted small">Chưa có tin nhắn</div>';
    $('#chat').scrollTop = $('#chat').scrollHeight;
    return true;
  };
  await run(load);
  const rf = $('#rf');
  if (rf) {
    rf.onsubmit = e => { e.preventDefault(); const btn = $('button.p', rf); btn.disabled = true;
      run(async () => { await P(`/conversations/${c.id}/reply`, { body: formData(rf) }); rf.reset(); toast('Đã gửi'); await load(); }).finally(() => { btn.disabled = false; }); };
    $('#mk').onclick = () => run(async () => { await P(`/conversations/${c.id}/mark`, { body: { reply_state: c.reply_state === 'chua_tra_loi' ? 'da_tra_loi' : 'chua_tra_loi' } }); route(); });
  }
  const h = location.hash;
  const t = setInterval(() => { if (location.hash !== h || !document.body.contains(v)) return clearInterval(t); if (!document.hidden) load().catch(() => { }); }, 8000);
}

// ===== Đơn hàng =====
async function viewOrders(v, parts, q) {
  if (parts[0] === 'new') return orderForm(v, null, q);
  if (parts[1] === 'edit') return orderForm(v, await P('/orders/' + parts[0]), q);
  if (parts[0]) return orderDetail(v, Number(parts[0]));
  const rows = await P('/orders?' + new URLSearchParams({ status: q.status || '', q: q.q || '', from: q.from || '', to: q.to || '' }));
  const sts = Object.keys(S.meta.STATUS);
  v.innerHTML = `<div class="topbar"><h1>Đơn hàng</h1><div class="row"><button class="btn" id="pr" disabled>🖨️ In phiếu giao đã chọn</button>${can('admin', 'sales') ? '<a class="btn p" href="#/orders/new">+ Tạo đơn</a>' : ''}</div></div>
    <div class="tabs"><a href="#/orders" class="${!q.status ? 'on' : ''}">Tất cả</a>${sts.map(s => `<a href="#/orders?status=${s}" class="${q.status === s ? 'on' : ''}">${S.meta.STATUS[s]}</a>`).join('')}</div>
    <form class="row card" id="sf"><input name="q" placeholder="Mã đơn, tên, SĐT, mã vận đơn…" value="${esc(q.q || '')}" style="flex:1;min-width:160px">
      <input type="date" name="from" value="${esc(q.from || '')}" style="width:auto"><input type="date" name="to" value="${esc(q.to || '')}" style="width:auto"><button class="btn">Lọc</button></form>
    <div class="card tbl"><table><thead><tr><th><input type="checkbox" id="all"></th><th>Mã đơn</th><th>Khách</th><th class="hide-m">Sản phẩm</th><th class="n">Tổng</th><th>Thanh toán</th><th>Trạng thái</th></tr></thead><tbody>
    ${rows.map(o => `<tr class="click" data-href="#/orders/${o.id}"><td><input type="checkbox" class="sel" value="${o.id}"></td>
      <td><b>${esc(o.code)}</b>${o.kind === 'doi' ? ' <span class="tag">đơn đổi</span>' : ''}${o.is_preorder ? ' <span class="tag">đặt trước</span>' : ''}<div class="small muted">${dt(o.created_at)} · ${esc(o.user_name || '')}</div></td>
      <td>${esc(o.ship_name)}<div class="small muted">${esc(o.ship_phone)} · ${esc(o.province || '')}</div></td>
      <td class="hide-m small">${esc(o.items_text || '')}</td><td class="n">${money(o.total)}</td>
      <td class="small">${esc(o.pay_method.toUpperCase())} · ${o.paid_amount >= o.total ? '<span style="color:var(--ok)">đã thu đủ</span>' : o.paid_amount > 0 ? 'thu ' + money(o.paid_amount) : 'chưa thu'}</td>
      <td>${pill(o.status)}${o.tracking_code ? `<div class="small muted">${esc(o.carrier || '')} ${esc(o.tracking_code)}</div>` : ''}${o.delivery_fail_count ? `<div class="small" style="color:var(--danger)">giao lỗi ${o.delivery_fail_count} lần</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Không có đơn</td></tr>'}
    </tbody></table></div><div class="small muted">Hiển thị tối đa 500 đơn gần nhất.</div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); location.hash = `#/orders?${new URLSearchParams({ status: q.status || '', ...formData(e.target) })}`; };
  const upd = () => { $('#pr').disabled = !$$('.sel:checked').length; };
  $$('.sel').forEach(c => c.onchange = upd);
  $('#all').onchange = e => { $$('.sel').forEach(c => c.checked = e.target.checked); upd(); };
  $('#pr').onclick = () => { location.hash = '#/print?ids=' + $$('.sel:checked').map(c => c.value).join(','); };
  bindRowLinks(v);
}

async function orderForm(v, o, q) {
  const st = S.settings, M = S.meta;
  const products = await P('/products');
  const variants = [];
  for (const p of products) for (const x of p.variants) if (x.active) variants.push({ ...x, name: p.name, price: p.price, code: p.code });
  let conv = null, parent = null;
  if (!o && q.conv) conv = await P('/conversations/' + q.conv);
  if (!o && q.parent) parent = await P('/orders/' + q.parent);
  const base = o || (parent ? { ...parent, items: parent.items.map(i => ({ ...i, price: 0 })), discount: 0, note: `Đổi hàng cho đơn ${parent.code}`, pay_method: 'cod' }
    : { ship_name: conv?.customer_name || '', ship_phone: conv?.phone || '', source: conv?.source || '', content_code: conv?.content_code || '', items: [], pay_method: 'cod', discount: 0 });
  if (!o && conv?.phone) {
    const cu = await P('/customers/by-phone/' + encodeURIComponent(conv.phone)).catch(() => null);
    if (cu) Object.assign(base, { ship_name: cu.name, province: cu.province, district: cu.district, ward: cu.ward, street: cu.street });
  }
  const items = (base.items || []).map(i => ({ variant_id: i.variant_id, qty: i.qty, price: i.price }));
  if (!items.length) items.push({ variant_id: '', qty: 1, price: '' });
  const vOpt = sel => `<option value="">— Chọn sản phẩm —</option>` + variants.map(x => `<option value="${x.id}" ${String(sel) === String(x.id) ? 'selected' : ''}>${esc(x.code)} · ${esc(x.name)} · ${esc(variantLabel(x))} (tồn ${x.stock}) — ${num(x.price)}</option>`).join('');
  let shipManual = !!o;
  v.innerHTML = `<div class="topbar"><h1>${o ? 'Sửa đơn ' + esc(o.code) : parent ? 'Tạo đơn đổi cho ' + esc(parent.code) : 'Tạo đơn mới'}</h1></div>
    ${conv ? `<div class="alert ok">Tạo đơn từ hội thoại #${conv.id} · ${esc(conv.customer_name || '')} — ${esc(conv.interest || '')}</div>` : ''}
    <datalist id="provs">${M.PROVINCES.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <form id="of">
    <div class="card grid"><h2>Thông tin giao hàng (bắt buộc khi chốt)</h2>
      <div class="grid g2">
        <label class="f"><span class="req">SĐT</span><input name="ship_phone" inputmode="tel" required value="${esc(base.ship_phone || '')}"></label>
        <label class="f"><span class="req">Họ tên người nhận</span><input name="ship_name" required value="${esc(base.ship_name || '')}"></label>
      </div><div id="custinfo" class="small"></div>
      <div class="grid g3">
        <label class="f"><span class="req">Tỉnh / Thành phố</span><input name="province" list="provs" required value="${esc(base.province || '')}"></label>
        <label class="f"><span>Quận / Huyện (nếu dùng địa chỉ cũ)</span><input name="district" value="${esc(base.district || '')}"></label>
        <label class="f"><span class="req">Phường / Xã</span><input name="ward" required value="${esc(base.ward || '')}"></label>
      </div>
      <label class="f"><span class="req">Số nhà, đường, thôn/xóm</span><input name="street" required value="${esc(base.street || '')}"></label>
      <label class="f"><span>Ghi chú (giờ giao, yêu cầu riêng)</span><input name="note" value="${esc(base.note || '')}"></label>
    </div>
    <div class="card"><h2>Sản phẩm</h2><div class="tbl"><table class="items"><thead><tr><th>Sản phẩm · size/màu</th><th style="width:70px">SL</th><th style="width:120px">Đơn giá</th><th class="n" style="width:100px">Thành tiền</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      <button type="button" class="btn sm" id="add">+ Thêm sản phẩm</button>
      <label class="row" style="margin-top:8px"><input type="checkbox" name="is_preorder" ${base.is_preorder ? 'checked' : ''}> Đơn đặt trước (hàng chưa về — trừ kho khi đóng gói)</label>
      <div id="stockwarn"></div></div>
    <div class="card grid"><h2>Thanh toán & nguồn</h2><div class="grid g3">
      <label class="f"><span>Phí ship <a href="#" id="autoship" class="small">(tự tính)</a></span><input name="ship_fee" type="number" min="0" step="1000" value="${esc(base.ship_fee ?? '')}"></label>
      <label class="f"><span>Giảm giá</span><input name="discount" type="number" min="0" step="1000" value="${esc(base.discount || 0)}"></label>
      <label class="f"><span>Phương thức thanh toán</span><select name="pay_method">${Object.entries(M.PAY_METHODS).map(([k, l]) => `<option value="${k}" ${base.pay_method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" id="depw"><span>Số tiền cọc</span><input name="deposit_required" type="number" min="0" step="1000" value="${esc(base.pay_method === 'coc' ? base.deposit_required : '')}"></label>
      <label class="f"><span>Nguồn đơn</span><select name="source"><option value="">—</option>${M.SOURCES.map(s => `<option ${base.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="f"><span>Mã nội dung (bài/Reels)</span><input name="content_code" value="${esc(base.content_code || '')}"></label>
      <label class="f"><span>Mã chiến dịch ads</span><input name="campaign_code" value="${esc(base.campaign_code || '')}"></label>
    </div><div id="sum" class="card" style="background:var(--bg);margin:0"></div></div>
    <div class="row"><button class="btn p">${o ? 'Lưu thay đổi' : 'Tạo đơn'}</button><a class="btn" href="${o ? '#/orders/' + o.id : '#/orders'}">Hủy bỏ</a></div></form>`;

  const draw = () => {
    $('#rows').innerHTML = items.map((it, i) => `<tr><td><select data-i="${i}" data-k="variant_id">${vOpt(it.variant_id)}</select></td>
      <td><input type="number" min="1" data-i="${i}" data-k="qty" value="${esc(it.qty)}"></td>
      <td><input type="number" min="0" step="1000" data-i="${i}" data-k="price" placeholder="giá niêm yết" value="${esc(it.price ?? '')}"></td>
      <td class="n" id="lt${i}"></td><td><button type="button" class="btn sm d" data-del="${i}">✕</button></td></tr>`).join('');
    $$('#rows [data-k]').forEach(el => el.oninput = el.onchange = () => {
      const it = items[el.dataset.i]; it[el.dataset.k] = el.value;
      if (el.dataset.k === 'variant_id') { const x = variants.find(x => String(x.id) === el.value); if (x && (it.price === '' || it.price == null)) { it.price = x.price; draw(); return; } }
      calc();
    });
    $$('[data-del]').forEach(b => b.onclick = () => { items.splice(b.dataset.del, 1); if (!items.length) items.push({ variant_id: '', qty: 1, price: '' }); draw(); });
    calc();
  };
  const calc = () => {
    let sub = 0; const need = {};
    items.forEach((it, i) => {
      const x = variants.find(x => String(x.id) === String(it.variant_id));
      const price = it.price === '' || it.price == null ? (x ? x.price : 0) : Number(it.price);
      const lt = price * (Number(it.qty) || 0); sub += lt;
      const el = $('#lt' + i); if (el) el.textContent = num(lt);
      if (x) need[x.id] = (need[x.id] || 0) + (Number(it.qty) || 0);
    });
    const prov = $('[name=province]').value.trim();
    if (!shipManual) $('[name=ship_fee]').value = st.free_ship_from > 0 && sub >= st.free_ship_from ? 0 : (prov && prov === st.shop_province ? st.ship_fee_inner : st.ship_fee_outer);
    const ship = Number($('[name=ship_fee]').value) || 0, disc = Number($('[name=discount]').value) || 0, total = Math.max(0, sub + ship - disc);
    const pm = $('[name=pay_method]').value;
    $('#depw').style.display = pm === 'coc' ? '' : 'none';
    if (pm === 'coc' && !$('[name=deposit_required]').value) $('[name=deposit_required]').placeholder = num(Math.round(total * st.deposit_percent / 100));
    const short = Object.entries(need).map(([id, n]) => { const x = variants.find(x => String(x.id) === id); return x.stock < n ? `${x.name} ${variantLabel(x)}: cần ${n}, tồn ${x.stock}` : null; }).filter(Boolean);
    $('#stockwarn').innerHTML = short.length ? `<div class="alert" style="margin-top:8px">⚠️ Không đủ tồn kho — đơn sẽ không xác nhận được (hoặc đánh dấu "Đơn đặt trước"):<br>${short.map(esc).join('<br>')}</div>` : '';
    const hint = pm === 'cod' && total >= st.deposit_from && st.deposit_from > 0 ? `<div class="small" style="color:var(--warn)">Đơn giá trị cao (≥ ${money(st.deposit_from)}) — cân nhắc thu cọc theo quy trình.</div>` : '';
    $('#sum').innerHTML = `<div class="row"><span>Tiền hàng: <b>${money(sub)}</b></span><span>Ship: <b>${money(ship)}</b></span><span>Giảm: <b>${money(disc)}</b></span><span class="right" style="font-size:18px">Tổng: <b>${money(total)}</b></span></div>${hint}`;
  };
  $('#add').onclick = () => { items.push({ variant_id: '', qty: 1, price: '' }); draw(); };
  $('[name=ship_fee]').oninput = () => { shipManual = true; calc(); };
  $('#autoship').onclick = e => { e.preventDefault(); shipManual = false; calc(); };
  ['discount', 'pay_method', 'province', 'deposit_required'].forEach(n => $(`[name=${n}]`).addEventListener('input', calc));
  const lookup = async () => {
    const ph = $('[name=ship_phone]').value.trim(); if (ph.length < 9) return;
    const cu = await P('/customers/by-phone/' + encodeURIComponent(ph)).catch(() => null);
    if (!cu) { $('#custinfo').innerHTML = '<span class="muted">Khách mới — sẽ tự tạo hồ sơ khách.</span>'; return; }
    $('#custinfo').innerHTML = `<div class="alert ok">Khách cũ <a href="#/customers/${cu.id}">${esc(cu.code)}</a> · ${cu.total_orders} đơn · ${money(cu.total_spent)}${cu.usual_size ? ' · size thường mua <b>' + esc(cu.usual_size) + '</b>' : ''} ${tags(cu.tags)}</div>`;
    for (const k of ['ship_name', 'province', 'district', 'ward', 'street']) { const el = $(`[name=${k}]`); const src = k === 'ship_name' ? cu.name : cu[k]; if (!el.value && src) el.value = src; }
    calc();
  };
  $('[name=ship_phone]').onchange = lookup;
  draw(); if (!o) lookup();
  $('#of').onsubmit = e => {
    e.preventDefault();
    const f = formData(e.target);
    f.items = items.filter(i => i.variant_id).map(i => ({ variant_id: Number(i.variant_id), qty: Number(i.qty), price: i.price }));
    if (conv) { f.conversation_id = conv.id; f.fb_link = conv.fb_link; }
    if (parent) f.parent_order_id = parent.id;
    run(async () => {
      if (o) { await P('/orders/' + o.id, { method: 'PUT', body: f }); toast('Đã lưu đơn'); location.hash = '#/orders/' + o.id; }
      else { const r = await P('/orders', { body: f }); toast('Đã tạo đơn'); location.hash = '#/orders/' + r.id; }
    });
  };
}

const ACTION_LABEL = { da_xac_nhan: '✔ Xác nhận đơn', dang_dong_goi: '📦 Bắt đầu đóng gói', da_gui: '🚚 Gửi hàng', giao_thanh_cong: '✅ Giao thành công',
  hoan_thanh: '🏁 Hoàn thành', da_huy: 'Hủy đơn', dang_doi_tra: '↔ Đổi/trả', hoan_ve_kho: '↩ Hoàn hàng về kho' };
const CARE = { hai_long: 'Hài lòng', chua_hai_long: 'Chưa hài lòng', da_xu_ly: 'Đã xử lý xong', khong_lien_lac: 'Không liên lạc được' };

async function orderDetail(v, id) {
  const o = await P('/orders/' + id);
  const st = S.settings, M = S.meta;
  const next = Object.entries(M.TRANSITIONS[o.status] || {}).filter(([, roles]) => roles.includes(role())).map(([k]) => k);
  const remain = o.total - o.paid_amount;
  const evLabel = { status: 'Trạng thái', payment: 'Thanh toán', remind: 'Nhắc khách', delivery_fail: 'Giao thất bại', care: 'Chăm sóc', tracking: 'Vận đơn', edit: 'Sửa đơn', note: 'Ghi chú' };
  const tplBtns = [['tpl_confirm', 'Tin xác nhận đơn'], ['tpl_remind', 'Tin nhắc xác nhận'], ['tpl_fail', 'Tin giao thất bại'], ['tpl_care', 'Tin chăm sóc sau bán']];
  v.innerHTML = `<div class="topbar"><div><h1 style="margin:0">${esc(o.code)} ${pill(o.status)}</h1>
      <div class="small muted">Tạo ${dt(o.created_at)} bởi ${esc(o.user_name || '')}${o.kind === 'doi' && o.parent ? ` · Đơn đổi của <a href="#/orders/${o.parent.id}">${esc(o.parent.code)}</a>` : ''}${o.is_preorder ? ' · <b>Đơn đặt trước</b>' : ''}</div></div>
      <div class="row"><a class="btn" href="#/print?ids=${o.id}">🖨️ In phiếu</a>${o.status === 'moi_tao' && can('admin', 'sales') ? `<a class="btn" href="#/orders/${o.id}/edit">Sửa</a>` : ''}</div></div>
    ${o.shortages.length && ['moi_tao', 'da_xac_nhan'].includes(o.status) ? `<div class="alert">⚠️ Chưa đủ tồn kho: ${o.shortages.map(esc).join('; ')}</div>` : ''}
    ${o.status === 'moi_tao' && o.reminded_at ? `<div class="alert">Đã nhắc khách lúc ${dt(o.reminded_at)}. Nếu khách vẫn không phản hồi → hủy theo quy tắc.</div>` : ''}
    <div class="card"><div class="row">${next.map(s => `<button class="btn ${['da_huy', 'hoan_ve_kho'].includes(s) ? 'd' : 'p'}" data-to="${s}">${ACTION_LABEL[s]}</button>`).join('')}
      ${o.status === 'moi_tao' && !o.reminded_at && can('admin', 'sales') ? '<button class="btn" id="remind">Đã nhắc khách</button>' : ''}
      ${can('admin', 'sales') && !['da_huy'].includes(o.status) ? '<button class="btn" id="pay">+ Ghi nhận thanh toán</button>' : ''}
      ${o.status === 'da_gui' ? '<button class="btn" id="fail">Giao thất bại</button>' : ''}
      ${o.status === 'da_gui' && can('admin', 'warehouse') ? '<button class="btn" id="trk">Sửa vận đơn</button>' : ''}
      ${['giao_thanh_cong', 'hoan_thanh', 'dang_doi_tra'].includes(o.status) && can('admin', 'sales') ? '<button class="btn" id="care">Ghi chăm sóc sau bán</button>' : ''}
      ${['giao_thanh_cong', 'dang_doi_tra'].includes(o.status) && can('admin', 'sales') ? `<a class="btn" href="#/orders/new?parent=${o.id}">Tạo đơn đổi</a>` : ''}
      ${!next.length ? '<span class="muted small">Không có bước tiếp theo cho vai trò của bạn.</span>' : ''}</div></div>
    <div class="grid g2">
      <div>
        <div class="card"><h2>Giao hàng</h2>
          <div><b>${esc(o.ship_name)}</b> · <a href="tel:${esc(o.ship_phone)}">${esc(o.ship_phone)}</a> · <a href="#/customers/${o.customer.id}">${esc(o.customer.code)}</a></div>
          <div>${esc(addr(o))}</div>${o.note ? `<div class="small">📝 ${esc(o.note)}</div>` : ''}
          ${o.tracking_code ? `<div class="small" style="margin-top:6px">🚚 ${esc(o.carrier)} · <b>${esc(o.tracking_code)}</b> · gửi ${dt(o.shipped_at)}${o.delivered_at ? ' · giao ' + dt(o.delivered_at) : ''}${o.ship_cost_actual != null ? ' · phí thực ' + money(o.ship_cost_actual) : ''}</div>` : ''}
          ${o.delivery_fail_count ? `<div class="small" style="color:var(--danger)">Giao thất bại ${o.delivery_fail_count} lần: ${esc(o.last_fail_note)}</div>` : ''}
          ${o.cancel_reason ? `<div class="small" style="color:var(--danger)">Lý do hủy: ${esc(o.cancel_reason)}</div>` : ''}${o.return_reason ? `<div class="small" style="color:var(--danger)">Lý do hoàn: ${esc(o.return_reason)}</div>` : ''}
          ${o.care_status ? `<div class="small">Chăm sóc: <b>${esc(CARE[o.care_status])}</b> ${esc(o.care_note || '')}</div>` : ''}
          <div class="small muted" style="margin-top:6px">Nguồn: ${esc(o.source || '—')} ${o.content_code ? '· ' + esc(o.content_code) : ''} ${o.campaign_code ? '· ads ' + esc(o.campaign_code) : ''}</div>
          ${o.children.length ? `<div class="small">Đơn đổi: ${o.children.map(c => `<a href="#/orders/${c.id}">${esc(c.code)}</a> ${pill(c.status)}`).join(' ')}</div>` : ''}
        </div>
        <div class="card tbl"><h2>Sản phẩm</h2><table><thead><tr><th>Sản phẩm</th><th class="n">SL</th><th class="n">Giá</th><th class="n">Thành tiền</th></tr></thead><tbody>
          ${o.items.map(i => `<tr><td>${esc(i.product_name)}<div class="small muted">${esc(variantLabel(i))}${!o.stock_deducted ? ` · tồn ${i.stock}` : ''}</div></td><td class="n">${i.qty}</td><td class="n">${num(i.price)}</td><td class="n">${num(i.price * i.qty)}</td></tr>`).join('')}
          <tr><td colspan="3" class="n">Tiền hàng</td><td class="n">${num(o.subtotal)}</td></tr><tr><td colspan="3" class="n">Phí ship</td><td class="n">${num(o.ship_fee)}</td></tr>
          <tr><td colspan="3" class="n">Giảm giá</td><td class="n">${o.discount ? '-' + num(o.discount) : '0'}</td></tr><tr><td colspan="3" class="n b">Tổng</td><td class="n b">${money(o.total)}</td></tr></tbody></table>
          <div class="small muted">${o.stock_deducted ? '✔ Đã trừ kho' : 'Chưa trừ kho'}</div></div>
      </div>
      <div>
        <div class="card"><h2>Thanh toán</h2><div>${esc(M.PAY_METHODS[o.pay_method])}${o.pay_method === 'coc' ? ` · cọc yêu cầu ${money(o.deposit_required)}` : ''}</div>
          <div>Đã thu: <b>${money(o.paid_amount)}</b> · ${remain > 0 ? `Còn phải thu: <b style="color:var(--warn)">${money(remain)}</b>${o.pay_method !== 'ck' ? ' (shipper thu COD)' : ''}` : '<span style="color:var(--ok)">Đã thu đủ</span>'}</div>
          ${o.payments.length ? `<table style="margin-top:6px"><tbody>${o.payments.map(p => `<tr><td class="small">${dt(p.at)}</td><td class="small">${esc(p.method)}${p.ref ? ' · ' + esc(p.ref) : ''}<div class="muted">${esc(p.note || '')} ${esc(p.user_name || '')}</div></td><td class="n">${money(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
        <div class="card"><h2>Mẫu tin nhắn</h2><div class="row">${tplBtns.map(([k, l]) => `<button class="btn sm" data-tpl="${k}">${l}</button>`).join('')}</div></div>
        <div class="card"><h2>Lịch sử</h2><ul class="timeline">${o.events.map(e => `<li><div class="small muted">${dt(e.at)} · ${esc(e.user_name || '')} · ${esc(evLabel[e.kind] || e.kind)}</div>
          ${e.kind === 'status' ? `${e.from_status ? pill(e.from_status) + ' → ' : ''}${pill(e.to_status)}` : ''} <span class="small">${esc(e.note || '')}</span></li>`).join('')}</ul></div>
      </div></div>`;

  const reload = () => orderDetail(v, id);
  $$('[data-tpl]', v).forEach(b => b.onclick = () => {
    const text = fillTpl(st[b.dataset.tpl], o);
    modal(`<h2>${esc(b.textContent)}</h2><pre class="msg">${esc(text)}</pre><div class="row" style="margin-top:10px"><button class="btn p" id="cp">Chép</button><button class="btn" data-close>Đóng</button></div>`, bg => $('#cp', bg).onclick = () => copy(text));
  });
  const doStatus = async (to, body, close) => { await P(`/orders/${id}/status`, { body: { to, ...body } }); close && close(); toast('Đã chuyển: ' + M.STATUS[to]); await reload();
    if (to === 'da_xac_nhan') $('[data-tpl=tpl_confirm]').click(); };
  $$('[data-to]', v).forEach(b => b.onclick = () => {
    const to = b.dataset.to;
    if (to === 'da_xac_nhan') return run(() => doStatus(to, {}));
    if (to === 'dang_dong_goi') return run(() => doStatus(to, {}));
    if (to === 'da_gui') return formModal('Gửi hàng — bàn giao vận chuyển', [
      { name: 'carrier', label: 'Hãng vận chuyển', type: 'select', options: M.CARRIERS, required: true, value: o.carrier },
      { name: 'tracking_code', label: 'Mã vận đơn', required: true, value: o.tracking_code },
      { type: 'html', html: `<div class="alert">Tiền COD shipper phải thu: <b>${money(Math.max(0, remain))}</b></div>` },
      { name: 'checked', type: 'checkbox', label: 'Đã kiểm chéo sản phẩm/size lần 2 trước khi niêm phong' },
    ], (f, close) => doStatus(to, f, close), 'Xác nhận gửi');
    if (to === 'giao_thanh_cong') return formModal('Giao thành công', [
      ...(remain > 0 && o.pay_method !== 'ck' ? [{ name: 'cod_collected', label: `Tiền COD thực thu (phải thu ${money(remain)})`, type: 'number', value: remain },
        { name: 'diff_reason', label: 'Lý do chênh lệch (nếu có)' }] : []),
      { name: 'ship_cost_actual', label: 'Phí ship thực tế trả hãng', type: 'number' },
    ], (f, close) => doStatus(to, f, close), 'Xác nhận');
    if (to === 'hoan_thanh') return formModal('Hoàn thành đơn', [
      { type: 'html', html: `<p>Điều kiện: đã thu đủ tiền và qua thời hạn đổi trả (${st.return_days} ngày).</p>` },
      ...(role() === 'admin' ? [{ name: 'force', type: 'checkbox', label: 'Bỏ qua thời hạn đổi trả (quản trị)' }] : []),
    ], (f, close) => doStatus(to, f, close), 'Hoàn thành');
    const reasons = { da_huy: st.cancel_reasons, hoan_ve_kho: st.return_reasons, dang_doi_tra: st.return_reasons }[to];
    formModal(ACTION_LABEL[to], [
      { name: 'reason', label: 'Lý do', type: 'select', options: reasons, required: true },
      { name: 'note', label: 'Ghi chú thêm' },
      ...(to === 'hoan_ve_kho' ? [{ name: 'restock', type: 'checkbox', label: 'Nhập lại kho (bỏ chọn nếu hàng lỗi/hỏng)', value: true }] : []),
    ], (f, close) => { if (f.note) f.reason = f.reason + ' – ' + f.note; delete f.note; return doStatus(to, f, close); }, 'Xác nhận');
  });
  $('#remind') && ($('#remind').onclick = () => run(async () => { copy(fillTpl(st.tpl_remind, o)); await P(`/orders/${id}/remind`, { body: {} }); reload(); }));
  $('#pay') && ($('#pay').onclick = () => formModal('Ghi nhận thanh toán', [
    { name: 'method', label: 'Hình thức', type: 'select', options: [['ck', 'Chuyển khoản'], ['tien_mat', 'Tiền mặt'], ['cod', 'COD (đối soát hãng vận chuyển)']] },
    { name: 'amount', label: 'Số tiền (số âm = hoàn tiền cho khách)', type: 'number', required: true, value: Math.max(0, o.pay_method === 'coc' && o.paid_amount < o.deposit_required ? o.deposit_required - o.paid_amount : remain) },
    { name: 'ref', label: 'Mã giao dịch (bắt buộc với chuyển khoản)' }, { name: 'note', label: 'Ghi chú' },
  ], async (f, close) => { await P(`/orders/${id}/payment`, { body: f }); close(); toast('Đã ghi nhận'); reload(); }));
  $('#fail') && ($('#fail').onclick = () => formModal('Giao thất bại', [
    { type: 'html', html: `<p class="small">Liên hệ khách trong ngày, hẹn giao lại tối đa 2 lần. Đã thất bại ${o.delivery_fail_count} lần.</p>` },
    { name: 'note', label: 'Lý do / lịch hẹn giao lại', required: true },
  ], async (f, close) => { await P(`/orders/${id}/delivery-fail`, { body: f }); close(); copy(fillTpl(st.tpl_fail, o)); reload(); }));
  $('#trk') && ($('#trk').onclick = () => formModal('Sửa vận đơn', [
    { name: 'carrier', label: 'Hãng', type: 'select', options: M.CARRIERS, value: o.carrier }, { name: 'tracking_code', label: 'Mã vận đơn', value: o.tracking_code },
    { name: 'ship_cost_actual', label: 'Phí ship thực tế', type: 'number', value: o.ship_cost_actual ?? '' },
  ], async (f, close) => { await P(`/orders/${id}/tracking`, { body: f }); close(); reload(); }));
  $('#care') && ($('#care').onclick = () => formModal('Chăm sóc sau bán', [
    { name: 'care_status', label: 'Kết quả', type: 'select', options: Object.entries(CARE), value: o.care_status || 'hai_long' },
    { name: 'note', label: 'Ghi chú / nguyên nhân (bắt buộc nếu chưa hài lòng)' }, { name: 'usual_size', label: 'Cập nhật size thường mua của khách', value: o.customer.usual_size || '' },
  ], async (f, close) => { await P(`/orders/${id}/care`, { body: f }); close(); reload(); }));
}

async function viewPrint(v, parts, q) {
  const ids = String(q.ids || '').split(',').filter(Boolean);
  const orders = await Promise.all(ids.map(id => P('/orders/' + id)));
  v.innerHTML = `<div class="topbar noprint"><h1>In phiếu giao (${orders.length})</h1><div class="row"><button class="btn p" onclick="print()">🖨️ In</button><a class="btn" href="javascript:history.back()">Quay lại</a></div></div>
    ${orders.map(o => `<div class="slip"><div class="row"><h2>${esc(S.page.name)}</h2><span class="right b">${esc(o.code)}</span></div>
      <div>Người nhận: <b>${esc(o.ship_name)}</b> · SĐT: <b>${esc(o.ship_phone)}</b></div><div>Địa chỉ: ${esc(addr(o))}</div>
      ${o.note ? `<div>Ghi chú: ${esc(o.note)}</div>` : ''}
      <table><tbody>${o.items.map(i => `<tr><td>☐ ${esc(i.product_name)} — ${esc(variantLabel(i))}</td><td class="n">x${i.qty}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:6px"><span>${o.carrier ? esc(o.carrier) + ' · ' + esc(o.tracking_code || '') : 'Vận đơn: ____________'}</span>
      <span class="right cod">THU COD: ${money(Math.max(0, o.total - o.paid_amount))}</span></div>
      <div class="small">Kiểm chéo lần 2: ☐ đúng SP ☐ đúng size/màu ☐ đủ SL · Người soạn: ________</div></div>`).join('')}`;
}

// ===== Khách hàng =====
async function viewCustomers(v, parts, q) {
  if (parts[0]) return customerDetail(v, Number(parts[0]));
  const rows = await P('/customers?' + new URLSearchParams({ q: q.q || '', tag: q.tag || '' }));
  v.innerHTML = `<div class="topbar"><h1>Khách hàng</h1><button class="btn p" id="add">+ Thêm khách</button></div>
    <form class="row card" id="sf"><input name="q" placeholder="Tên, SĐT, mã KH…" value="${esc(q.q || '')}" style="flex:1;min-width:160px"><input name="tag" placeholder="Nhãn" value="${esc(q.tag || '')}" style="width:140px"><button class="btn">Lọc</button></form>
    <div class="card tbl"><table><thead><tr><th>Khách</th><th class="hide-m">Địa chỉ</th><th>Size</th><th class="n">Số đơn</th><th class="n">Tổng chi</th><th class="hide-m">Đơn gần nhất</th></tr></thead><tbody>
    ${rows.map(c => `<tr class="click" data-href="#/customers/${c.id}"><td><b>${esc(c.name)}</b> <span class="small muted">${esc(c.code)}</span><div class="small">${esc(c.phone)} ${tags(c.tags)}</div></td>
      <td class="hide-m small">${esc(addr(c))}</td><td>${esc(c.usual_size || '')}</td><td class="n">${c.total_orders}</td><td class="n">${money(c.total_spent)}</td><td class="hide-m small">${day(c.last_order_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có khách</td></tr>'}
    </tbody></table></div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); location.hash = '#/customers?' + new URLSearchParams(formData(e.target)); };
  $('#add').onclick = () => customerModal(null);
  bindRowLinks(v);
}
function customerModal(c) {
  c = c || {};
  formModal(c.id ? 'Sửa khách ' + c.code : 'Thêm khách', [
    { name: 'name', label: 'Họ tên', required: true, value: c.name }, { name: 'phone', label: 'SĐT (khóa nhận diện)', required: true, value: c.phone },
    { name: 'fb_link', label: 'Link Facebook', value: c.fb_link },
    { type: 'html', html: `<datalist id="provs2">${S.meta.PROVINCES.map(p => `<option value="${esc(p)}">`).join('')}</datalist>` },
    { name: 'province', label: 'Tỉnh/Thành', value: c.province, list: 'provs2' }, { name: 'district', label: 'Quận/Huyện (nếu có)', value: c.district },
    { name: 'ward', label: 'Phường/Xã', value: c.ward }, { name: 'street', label: 'Số nhà, đường', value: c.street },
    { name: 'usual_size', label: 'Size thường mua', value: c.usual_size },
    { name: 'source', label: 'Nguồn khách', type: 'select', options: ['', ...S.meta.SOURCES], value: c.source },
    { name: 'tags', label: 'Nhãn (cách nhau dấu phẩy)', value: c.tags }, { name: 'note', label: 'Ghi chú', type: 'textarea', value: c.note },
  ], async (f, close) => {
    if (c.id) await P('/customers/' + c.id, { method: 'PUT', body: f }); else { const r = await P('/customers', { body: f }); location.hash = '#/customers/' + r.id; }
    close(); toast('Đã lưu'); route();
  });
}
async function customerDetail(v, id) {
  const c = await P('/customers/' + id);
  v.innerHTML = `<div class="topbar"><h1>${esc(c.name)} <span class="muted small">${esc(c.code)}</span></h1><div class="row">
    <button class="btn" id="ed">Sửa</button><a class="btn" href="#/conversations/new">+ Hội thoại</a></div></div>
    <div class="grid g4"><div class="card stat"><div class="l">Tổng số đơn</div><div class="v">${c.total_orders}</div></div>
      <div class="card stat"><div class="l">Tổng chi tiêu</div><div class="v">${money(c.total_spent)}</div></div>
      <div class="card stat"><div class="l">Size thường mua</div><div class="v">${esc(c.usual_size || '—')}</div></div>
      <div class="card stat"><div class="l">Nguồn</div><div class="v" style="font-size:15px">${esc(c.source || '—')}</div></div></div>
    <div class="card"><div>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a> ${c.fb_link ? `· <a href="${esc(c.fb_link)}" target="_blank" rel="noopener">Facebook</a>` : ''}</div>
      <div>📍 ${esc(addr(c) || '—')}</div><div>${tags(c.tags)}</div>${c.note ? `<div class="small">📝 ${esc(c.note)}</div>` : ''}</div>
    <div class="grid g2"><div class="card tbl"><h2>Lịch sử mua</h2><table><tbody>${c.orders.map(o => `<tr class="click" data-href="#/orders/${o.id}"><td>${esc(o.code)}<div class="small muted">${dt(o.created_at)}</div></td><td>${pill(o.status)}</td><td class="n">${money(o.total)}</td></tr>`).join('') || '<tr><td class="muted">Chưa có đơn</td></tr>'}</tbody></table></div>
      <div><div class="card tbl"><h2>Sản phẩm đã mua (gu & size)</h2><table><tbody>${c.items.map(i => `<tr><td>${esc(i.product_name)}</td><td>${esc(variantLabel(i))}</td><td class="n">x${i.qty}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
      <div class="card"><h2>Hội thoại</h2>${c.conversations.map(x => `<p class="small"><a href="#/conversations/${x.id}">${dt(x.created_at)}</a> · ${esc(x.outcome === 'chot' ? 'Chốt' : x.outcome === 'khong_chot' ? 'Không chốt: ' + (x.lost_reason || '') : 'Đang tư vấn')} — ${esc((x.summary || '').slice(0, 80))}</p>`).join('') || '<span class="muted small">—</span>'}</div></div></div>`;
  $('#ed').onclick = () => customerModal(c);
  bindRowLinks(v);
}

// ===== Sản phẩm & Kho =====
async function viewProducts(v, parts, q) {
  if (parts[0] === 'moves') return stockMoves(v);
  if (parts[0]) return productDetail(v, Number(parts[0]));
  const rows = await P('/products?' + new URLSearchParams({ q: q.q || '', all: q.all || '' }));
  const edit = can('admin', 'warehouse');
  v.innerHTML = `<div class="topbar"><h1>Sản phẩm & Kho</h1><div class="row"><a class="btn" href="#/products/moves">Lịch sử nhập – xuất</a>${edit ? '<button class="btn p" id="add">+ Thêm sản phẩm</button>' : ''}</div></div>
    <form class="row card" id="sf"><input name="q" placeholder="Tên, mã SP…" value="${esc(q.q || '')}" style="flex:1;min-width:160px"><label class="row small"><input type="checkbox" name="all" value="1" ${q.all ? 'checked' : ''}> gồm SP ngừng bán</label><button class="btn">Lọc</button></form>
    <div class="card tbl"><table><thead><tr><th>Sản phẩm</th><th class="n">Giá bán</th>${can('admin') ? '<th class="n hide-m">Giá vốn</th>' : ''}<th>Tồn theo size/màu</th><th class="n">Tổng tồn</th></tr></thead><tbody>
    ${rows.map(p => `<tr class="click" data-href="#/products/${p.id}"><td class="row" style="flex-wrap:nowrap">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : ''}<div><b>${esc(p.name)}</b><div class="small muted">${esc(p.code)}${p.active ? '' : ' · ngừng bán'}</div></div></td>
      <td class="n">${num(p.price)}</td>${can('admin') ? `<td class="n hide-m">${num(p.cost)}</td>` : ''}
      <td class="small">${p.variants.filter(x => x.active).map(x => `<span class="tag" style="${x.stock <= p.low_threshold ? 'border-color:var(--danger);color:var(--danger)' : ''}">${esc(variantLabel(x))}: ${x.stock}</span>`).join('')}</td>
      <td class="n">${p.total_stock}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Chưa có sản phẩm</td></tr>'}</tbody></table></div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); const f = formData(e.target); location.hash = '#/products?' + new URLSearchParams({ q: f.q, all: f.all ? '1' : '' }); };
  $('#add') && ($('#add').onclick = () => productModal(null));
  bindRowLinks(v);
}
function productModal(p) {
  p = p || { variants: [], low_threshold: 3 };
  const rows = p.variants.length ? p.variants.map(x => ({ ...x })) : [{ size: '', color: '', stock: 0 }];
  const m = modal(`<h2>${p.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2><form class="grid" id="pf">
    <div class="grid g2"><label class="f"><span class="req">Mã SP</span><input name="code" required value="${esc(p.code || '')}"></label>
      <label class="f"><span class="req">Tên SP</span><input name="name" required value="${esc(p.name || '')}"></label>
      <label class="f"><span>Giá bán</span><input name="price" type="number" min="0" step="1000" value="${esc(p.price ?? '')}"></label>
      <label class="f"><span>Giá vốn</span><input name="cost" type="number" min="0" step="1000" value="${esc(p.cost ?? '')}"></label>
      <label class="f"><span>Ngưỡng cảnh báo sắp hết (mỗi biến thể)</span><input name="low_threshold" type="number" min="0" value="${esc(p.low_threshold)}"></label>
      <label class="f"><span>Link ảnh</span><input name="image_url" value="${esc(p.image_url || '')}"></label></div>
    ${p.id ? `<label class="row"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Đang bán</label>` : ''}
    <div><h3>Biến thể size / màu</h3><p class="small muted">${p.id ? 'Tồn kho của biến thể đã có chỉ thay đổi qua phiếu nhập/điều chỉnh.' : 'Nhập tồn đầu kỳ cho từng biến thể.'} Nhập nhanh: <input id="bulk" placeholder="VD size: 70B,75B,80B · màu: Đen,Da" style="width:auto;min-width:220px"> <button type="button" class="btn sm" id="gen">Tạo tổ hợp</button></p>
      <table class="items"><thead><tr><th>Size</th><th>Màu</th><th>Tồn${p.id ? '' : ' đầu kỳ'}</th><th></th></tr></thead><tbody id="vr"></tbody></table><button type="button" class="btn sm" id="addv">+ Biến thể</button></div>
    <div class="row"><button class="btn p">Lưu</button><button type="button" class="btn" data-close>Đóng</button></div></form>`);
  const bg = m.el;
  const draw = () => {
    $('#vr', bg).innerHTML = rows.map((x, i) => `<tr><td><input data-i="${i}" data-k="size" value="${esc(x.size)}"></td><td><input data-i="${i}" data-k="color" value="${esc(x.color)}"></td>
      <td>${x.id ? `<b>${x.stock}</b>` : `<input type="number" min="0" data-i="${i}" data-k="stock" value="${esc(x.stock || 0)}">`}</td>
      <td>${x.id ? `<label class="small"><input type="checkbox" data-i="${i}" data-k="active" ${x.active ? 'checked' : ''}> bán</label>` : `<button type="button" class="btn sm d" data-del="${i}">✕</button>`}</td></tr>`).join('');
    $$('[data-k]', bg).forEach(el => el.oninput = el.onchange = () => { rows[el.dataset.i][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
    $$('[data-del]', bg).forEach(b => b.onclick = () => { rows.splice(b.dataset.del, 1); draw(); });
  };
  draw();
  $('#addv', bg).onclick = () => { rows.push({ size: '', color: '', stock: 0 }); draw(); };
  $('#gen', bg).onclick = () => {
    const t = $('#bulk', bg).value; const sm = /size\s*:\s*([^·|]+)/i.exec(t), cm = /m[àa]u\s*:\s*([^·|]+)/i.exec(t);
    const sizes = sm ? sm[1].split(',').map(s => s.trim()).filter(Boolean) : [''], colors = cm ? cm[1].split(',').map(s => s.trim()).filter(Boolean) : [''];
    for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].id && !rows[i].size && !rows[i].color) rows.splice(i, 1);
    for (const s of sizes) for (const c of colors) if (!rows.some(r => r.size === s && r.color === c)) rows.push({ size: s, color: c, stock: 0 });
    draw();
  };
  $('#pf', bg).onsubmit = e => {
    e.preventDefault();
    const f = formData(e.target); f.variants = rows.filter(r => r.id || r.size || r.color || rows.length === 1);
    if (!p.id) delete f.active;
    run(async () => {
      if (p.id) await P('/products/' + p.id, { method: 'PUT', body: f }); else { const r = await P('/products', { body: f }); location.hash = '#/products/' + r.id; }
      m.close(); toast('Đã lưu'); route();
    });
  };
}
async function productDetail(v, id) {
  const p = await P('/products/' + id);
  const edit = can('admin', 'warehouse');
  const KIND = { nhap: 'Nhập', xuat: 'Xuất bán', hoan: 'Nhập lại (hủy/hoàn)', dieu_chinh: 'Điều chỉnh' };
  v.innerHTML = `<div class="topbar"><h1>${esc(p.name)} <span class="small muted">${esc(p.code)}</span></h1>${edit ? '<div class="row"><button class="btn" id="ed">Sửa</button></div>' : ''}</div>
    <div class="card row">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:8px">` : ''}
      <div>Giá bán <b>${money(p.price)}</b>${can('admin') ? ` · Giá vốn ${money(p.cost)}` : ''} · Ngưỡng cảnh báo ${p.low_threshold} · ${p.active ? 'Đang bán' : 'Ngừng bán'}</div></div>
    <div class="card tbl"><h2>Tồn kho theo biến thể</h2><table><thead><tr><th>Size / màu</th><th class="n">Tồn</th><th></th></tr></thead><tbody>
      ${p.variants.map(x => `<tr><td>${esc(variantLabel(x))}${x.active ? '' : ' <span class="tag">ngừng</span>'}</td><td class="n ${x.stock <= p.low_threshold ? 'b' : ''}" style="${x.stock <= p.low_threshold ? 'color:var(--danger)' : ''}">${x.stock}</td>
      <td class="n">${edit ? `<button class="btn sm" data-in="${x.id}">+ Nhập</button> <button class="btn sm" data-adj="${x.id}">Điều chỉnh</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="card tbl"><h2>Lịch sử nhập – xuất</h2><table><thead><tr><th>Thời gian</th><th>Biến thể</th><th>Loại</th><th class="n">SL</th><th>Ghi chú</th></tr></thead><tbody>
      ${p.moves.map(m => `<tr><td class="small">${dt(m.at)}<div class="muted">${esc(m.user_name || '')}</div></td><td>${esc(variantLabel(m))}</td><td>${KIND[m.kind]}</td><td class="n">${m.qty > 0 ? '+' : ''}${m.qty}</td>
      <td class="small">${m.order_code ? `<a href="#/orders/${m.order_id}">${esc(m.order_code)}</a> ` : ''}${esc(m.note || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div>`;
  $('#ed') && ($('#ed').onclick = () => productModal(p));
  const stockModal = (vid, kind) => formModal(kind === 'nhap' ? 'Phiếu nhập kho' : 'Điều chỉnh tồn (kiểm kê, hỏng, mất…)', [
    { name: 'qty', label: kind === 'nhap' ? 'Số lượng nhập' : 'Số lượng tăng/giảm (số âm để giảm)', type: 'number', required: true },
    { name: 'note', label: kind === 'nhap' ? 'Ghi chú (nhà cung cấp, lô…)' : 'Lý do (bắt buộc)', required: kind !== 'nhap' },
  ], async (f, close) => { await P('/stock', { body: { ...f, variant_id: vid, kind } }); close(); toast('Đã cập nhật kho'); productDetail(v, id); });
  $$('[data-in]', v).forEach(b => b.onclick = () => stockModal(Number(b.dataset.in), 'nhap'));
  $$('[data-adj]', v).forEach(b => b.onclick = () => stockModal(Number(b.dataset.adj), 'dieu_chinh'));
}
async function stockMoves(v) {
  const rows = await P('/stock-moves');
  const KIND = { nhap: 'Nhập', xuat: 'Xuất bán', hoan: 'Nhập lại', dieu_chinh: 'Điều chỉnh' };
  v.innerHTML = `<div class="topbar"><h1>Lịch sử nhập – xuất kho</h1><a class="btn" href="#/products">← Sản phẩm</a></div>
    <div class="card tbl"><table><thead><tr><th>Thời gian</th><th>Sản phẩm</th><th>Loại</th><th class="n">SL</th><th>Ghi chú</th></tr></thead><tbody>
    ${rows.map(m => `<tr><td class="small">${dt(m.at)}<div class="muted">${esc(m.user_name || '')}</div></td><td>${esc(m.name)}<div class="small muted">${esc(variantLabel(m))}</div></td><td>${KIND[m.kind]}</td>
      <td class="n">${m.qty > 0 ? '+' : ''}${m.qty}</td><td class="small">${m.order_code ? `<a href="#/orders/${m.order_id}">${esc(m.order_code)}</a> ` : ''}${esc(m.note || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div>`;
}

// ===== Đối soát =====
async function viewReconcile(v, parts, q) {
  const dday = q.day || today();
  const { live: d, saved, history } = await P('/reconcile?day=' + dday);
  const ML = { cod: 'COD', ck: 'Chuyển khoản', tien_mat: 'Tiền mặt' };
  v.innerHTML = `<div class="topbar"><h1>Đối soát cuối ngày</h1><form class="row" id="df"><input type="date" name="day" value="${dday}" style="width:auto"><button class="btn">Xem</button></form></div>
    <p class="muted small">Khớp 3 thứ mỗi ngày: số đơn · số tiền thu · số hàng xuất kho.</p>
    ${saved ? `<div class="alert ok">Đã chốt sổ ngày ${day(dday)} lúc ${dt(saved.at)} bởi ${esc(saved.user_name || '')}${saved.note ? ' — ' + esc(saved.note) : ''}. Có thể chốt lại nếu số liệu thay đổi.</div>` : ''}
    ${d.warnings.map(w => `<div class="alert">⚠️ ${esc(w)}</div>`).join('')}
    <div class="grid g4">
      <div class="card stat"><div class="l">Đơn tạo trong ngày</div><div class="v">${d.created.n}</div><div class="small muted">${money(d.created.s)}</div></div>
      <div class="card stat"><div class="l">Đơn đã gửi trong ngày</div><div class="v">${d.shipped.length}</div><div class="small muted">${d.shippedQty} sản phẩm · COD chờ thu ${money(d.cod_outstanding)}</div></div>
      <div class="card stat"><div class="l">Tiền thu trong ngày</div><div class="v">${money(d.totalCollected)}</div><div class="small muted">${Object.entries(d.byMethod).map(([k, s]) => `${ML[k]}: ${money(s)}`).join(' · ') || '—'}</div></div>
      <div class="card stat"><div class="l">Hàng xuất kho (bán)</div><div class="v">${d.outByOrders}</div><div class="small muted">${d.moves.map(m => `${m.kind}: ${m.qty > 0 ? '+' : ''}${m.qty}`).join(' · ')}</div></div></div>
    <div class="grid g2"><div class="card tbl"><h2>Đơn gửi đi</h2><table><tbody>${d.shipped.map(o => `<tr><td><a href="#/orders/${o.id}">${esc(o.code)}</a><div class="small muted">${esc(o.carrier || '')} ${esc(o.tracking_code || '')}</div></td><td class="n">${o.qty} SP</td><td class="n">${money(o.total)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
      <div class="card tbl"><h2>Khoản thu</h2><table><tbody>${d.payments.map(p => `<tr><td><a href="#/orders/${p.order_id}">${esc(p.code)}</a><div class="small muted">${ML[p.method]}${p.ref ? ' · ' + esc(p.ref) : ''} ${esc(p.note || '')}</div></td><td class="n">${money(p.amount)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div></div>
    <form class="card grid" id="rf"><h2>Chốt sổ ngày ${day(dday)}</h2><label class="f"><span>Ghi chú / giải trình chênh lệch${d.warnings.length ? ' (bắt buộc)' : ''}</span><textarea name="note">${esc(saved?.note || '')}</textarea></label><div><button class="btn p">Chốt sổ</button></div></form>
    <div class="card"><h2>Các ngày đã chốt</h2>${history.map(h => `<p class="small"><a href="#/reconcile?day=${h.day}">${day(h.day)}</a> · ${esc(h.user_name || '')} · ${esc(h.note || '')}</p>`).join('') || '<span class="muted small">—</span>'}</div>`;
  $('#df').onsubmit = e => { e.preventDefault(); location.hash = '#/reconcile?day=' + formData(e.target).day; };
  $('#rf').onsubmit = e => { e.preventDefault(); run(async () => { await P('/reconcile', { body: { day: dday, ...formData(e.target) } }); toast('Đã chốt sổ'); route(); }); };
}

// ===== Báo cáo (GĐ8) =====
async function viewReports(v, parts, q) {
  const t = new Date(), iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const lmS = new Date(t.getFullYear(), t.getMonth() - 1, 1), lmE = new Date(t.getFullYear(), t.getMonth(), 0);
  const lwS = new Date(mon); lwS.setDate(mon.getDate() - 7); const lwE = new Date(mon); lwE.setDate(mon.getDate() - 1);
  const presets = [['Hôm nay', iso(t), iso(t)], ['Tuần này', iso(mon), iso(t)], ['Tuần trước', iso(lwS), iso(lwE)], ['Tháng này', iso(t).slice(0, 8) + '01', iso(t)], ['Tháng trước', iso(lmS), iso(lmE)]];
  const from = q.from || presets[1][1], to = q.to || presets[1][2];
  const [r, ads, imps] = await Promise.all([P(`/reports?from=${from}&to=${to}`), P('/ad-spend'), P('/improvements')]);
  const k = r.kpi;
  const tile = (l, val, sub = '') => `<div class="card stat"><div class="l">${l}</div><div class="v">${val}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const list = (title, rows, fmt) => `<div class="card"><h3>${title}</h3>${rows.length ? `<table><tbody>${rows.map(fmt).join('')}</tbody></table>` : '<div class="muted small">—</div>'}</div>`;
  const maxD = Math.max(1, ...r.daily.map(x => x.amount));
  v.innerHTML = `<div class="topbar"><h1>Báo cáo & cải tiến</h1></div>
    <div class="card"><div class="tabs" style="margin:0 0 8px">${presets.map(([l, a, b]) => `<a href="#/reports?from=${a}&to=${b}" class="${from === a && to === b ? 'on' : ''}">${l}</a>`).join('')}</div>
      <form class="row" id="rf"><input type="date" name="from" value="${from}" style="width:auto"> → <input type="date" name="to" value="${to}" style="width:auto"><button class="btn">Xem</button></form></div>
    <div class="grid g4">
      ${tile('Hội thoại mới', num(k.conversations), `${k.new_customers} khách mới`)}
      ${tile('Tỉ lệ chốt (đơn ÷ hội thoại)', pct(k.close_rate), `${k.conv_closed} hội thoại chốt`)}
      ${tile('Số đơn', num(k.orders), `Giá trị chốt ${money(k.gmv)}`)}
      ${tile('Doanh thu (đã giao)', money(k.revenue), `${k.delivered_orders} đơn · lãi gộp ~${money(k.gross_profit)}`)}
      ${tile('Giá trị đơn trung bình', k.aov == null ? '—' : money(k.aov))}
      ${tile('Tỉ lệ giao thành công', pct(k.delivery_success_rate))}
      ${tile('Tỉ lệ hủy / hoàn', `${pct(k.cancel_rate)} / ${pct(k.return_rate)}`)}
      ${tile('Chi phí ads ÷ số đơn', k.cost_per_order == null ? '—' : money(k.cost_per_order), `Ads ${money(k.ad_spend)} · ${k.ads_orders} đơn từ ads`)}
    </div>
    <div class="card"><h3>Doanh số chốt theo ngày</h3>${r.daily.map(x => `<div class="row small" style="flex-wrap:nowrap"><span style="width:50px">${x.d.slice(8)}/${x.d.slice(5, 7)}</span><div class="bar" style="flex:1"><i style="width:${(x.amount / maxD * 100).toFixed(1)}%"></i></div><span style="width:120px" class="n">${x.n} đơn · ${num(x.amount)}</span></div>`).join('') || '<div class="muted small">—</div>'}</div>
    <div class="grid g3">
      ${list('Lý do hủy (top 3)', r.cancelReasons, x => `<tr><td>${esc(x.reason)}</td><td class="n">${x.n}</td></tr>`)}
      ${list('Lý do hoàn (top 3)', r.returnReasons, x => `<tr><td>${esc(x.reason)}</td><td class="n">${x.n}</td></tr>`)}
      ${list('Lý do không chốt', r.lostReasons, x => `<tr><td>${esc(x.reason)}</td><td class="n">${x.n}</td></tr>`)}
    </div>
    <div class="grid g2">
      ${list('Bán chạy theo size/màu', r.bestSellers, x => `<tr><td>${esc(x.product_name)}<div class="small muted">${esc(variantLabel(x))}</div></td><td class="n">${x.qty}</td><td class="n">${num(x.amount)}</td></tr>`)}
      ${list('Tồn kho sắp hết', r.lowStock, x => `<tr><td>${esc(x.name)} · ${esc(variantLabel(x))}</td><td class="n" style="color:var(--danger)">${x.stock}</td></tr>`)}
      ${list('Đơn theo nguồn', r.bySource, x => `<tr><td>${esc(x.source)}</td><td class="n">${x.n} đơn</td><td class="n">${num(x.amount)}</td></tr>`)}
      ${list('Hội thoại theo nguồn', r.convBySource, x => `<tr><td>${esc(x.source)}</td><td class="n">${x.n}</td><td class="n">chốt ${pct(x.n ? (x.chot || 0) / x.n : null)}</td></tr>`)}
      ${list('Đơn theo mã nội dung / chiến dịch', r.byContent, x => `<tr><td>${esc(x.code)}</td><td class="n">${x.n} đơn</td><td class="n">${num(x.amount)}</td></tr>`)}
      ${list('Theo nhân viên', r.byStaff, x => `<tr><td>${esc(x.name)}</td><td class="n">${x.n} đơn</td><td class="n">${num(x.amount)}</td></tr>`)}
      ${list('Khách chưa hài lòng — nguyên nhân', r.unhappy, x => `<tr><td>${esc(x.reason)}</td><td class="n">${x.n}</td></tr>`)}
    </div>
    <div class="grid g2">
      <div class="card"><h3>Chi phí quảng cáo</h3><form class="row" id="af"><input type="date" name="day" value="${today()}" style="width:auto"><input name="campaign_code" placeholder="Mã chiến dịch" style="width:130px"><input name="amount" type="number" min="0" placeholder="Số tiền" style="width:120px" required><button class="btn">Thêm</button></form>
        <table><tbody>${ads.slice(0, 15).map(a => `<tr><td class="small">${day(a.day)}</td><td>${esc(a.campaign_code || '')}</td><td class="n">${money(a.amount)}</td><td><button class="btn sm d" data-delad="${a.id}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>Họp tuần 30 phút: 3 chỉ số xấu nhất → 1–3 hành động</h3><form class="grid" id="imf"><input name="problem" placeholder="Chỉ số xấu / vấn đề"><input name="action" placeholder="Hành động cải tiến" required><button class="btn">Ghi lại</button></form>
        <table><tbody>${imps.map(i => `<tr><td class="small">${day(i.week)}</td><td><b>${esc(i.action)}</b><div class="small muted">${esc(i.problem || '')}</div>${i.result ? `<div class="small">→ ${esc(i.result)}</div>` : ''}</td>
          <td>${i.done ? '<span class="pill s-giao_thanh_cong">Đã kiểm tra</span>' : `<button class="btn sm" data-imp="${i.id}">Kiểm tra kết quả</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#rf').onsubmit = e => { e.preventDefault(); location.hash = '#/reports?' + new URLSearchParams(formData(e.target)); };
  $('#af').onsubmit = e => { e.preventDefault(); run(async () => { await P('/ad-spend', { body: formData(e.target) }); route(); }); };
  $$('[data-delad]').forEach(b => b.onclick = () => run(async () => { await P('/ad-spend/' + b.dataset.delad, { method: 'DELETE' }); route(); }));
  $('#imf').onsubmit = e => { e.preventDefault(); run(async () => { await P('/improvements', { body: formData(e.target) }); route(); }); };
  $$('[data-imp]').forEach(b => b.onclick = () => formModal('Kết quả sau 1 tuần', [{ name: 'result', label: 'Kết quả', type: 'textarea', required: true }],
    async (f, close) => { await P('/improvements/' + b.dataset.imp, { method: 'PUT', body: { ...f, done: true } }); close(); route(); }));
}

// ===== Cài đặt Page =====
async function viewSettings(v) {
  const s = await P('/settings');
  const lists = [['quick_replies', 'Mẫu câu trả lời nhanh'], ['conv_tags', 'Nhãn hội thoại'], ['lost_reasons', 'Lý do không chốt'], ['cancel_reasons', 'Lý do hủy đơn'], ['return_reasons', 'Lý do hoàn/đổi trả']];
  const tpls = [['tpl_confirm', 'Mẫu tin xác nhận đơn'], ['tpl_remind', 'Mẫu tin nhắc xác nhận'], ['tpl_fail', 'Mẫu tin giao thất bại'], ['tpl_care', 'Mẫu tin chăm sóc sau bán'], ['auto_reply', 'Tin tự động ngoài giờ']];
  v.innerHTML = `<div class="topbar"><h1>Cài đặt · ${esc(S.page.name)}</h1></div><form id="sf">
    <div class="card grid"><h2>Phí ship & thanh toán</h2><div class="grid g3">
      <label class="f"><span>Tỉnh/thành của shop</span><select name="shop_province">${S.meta.PROVINCES.map(p => `<option ${s.shop_province === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <label class="f"><span>Phí ship nội tỉnh</span><input type="number" name="ship_fee_inner" value="${s.ship_fee_inner}"></label>
      <label class="f"><span>Phí ship liên tỉnh</span><input type="number" name="ship_fee_outer" value="${s.ship_fee_outer}"></label>
      <label class="f"><span>Miễn ship cho đơn từ (0 = không áp dụng)</span><input type="number" name="free_ship_from" value="${s.free_ship_from}"></label>
      <label class="f"><span>Gợi ý thu cọc cho đơn từ</span><input type="number" name="deposit_from" value="${s.deposit_from}"></label>
      <label class="f"><span>% cọc mặc định</span><input type="number" name="deposit_percent" value="${s.deposit_percent}"></label></div></div>
    <div class="card grid"><h2>Chính sách</h2><div class="grid g2">
      <label class="f"><span>Thời hạn đổi trả (ngày)</span><input type="number" name="return_days" value="${s.return_days}"></label>
      <label class="f"><span>Giờ làm việc</span><input name="working_hours" value="${esc(s.working_hours)}"></label></div>
      <label class="f"><span>Chính sách đổi trả (điều kiện, thời hạn, ai chịu phí ship)</span><textarea name="return_policy">${esc(s.return_policy)}</textarea></label></div>
    <div class="card grid"><h2>Mẫu tin nhắn</h2><p class="small muted">Biến: {ma_don} {ten_khach} {san_pham} {tien_hang} {phi_ship} {giam_gia} {tong_tien} {thanh_toan} {dia_chi} {chinh_sach} {gio_lam_viec} {ma_van_don} {hang_van_chuyen}</p>
      ${tpls.map(([k, l]) => `<label class="f"><span>${l}</span><textarea name="${k}" rows="5">${esc(s[k])}</textarea></label>`).join('')}</div>
    <div class="card grid"><h2>Danh mục (mỗi dòng một mục)</h2><div class="grid g2">${lists.map(([k, l]) => `<label class="f"><span>${l}</span><textarea name="${k}" rows="5">${esc((s[k] || []).join('\n'))}</textarea></label>`).join('')}</div></div>
    <button class="btn p">Lưu cài đặt</button></form>`;
  $('#sf').onsubmit = e => {
    e.preventDefault(); const f = formData(e.target);
    for (const [k] of lists) f[k] = f[k].split('\n').map(x => x.trim()).filter(Boolean);
    run(async () => { await P('/settings', { method: 'PUT', body: f }); S.settings = await P('/settings'); toast('Đã lưu cài đặt'); });
  };
}

// ===== Quản trị: Page, tài khoản =====
async function viewAdmin(v, parts, q) {
  const [pages, users] = await Promise.all([api('/api/admin/pages'), api('/api/admin/users')]);
  const tab = parts[0] || 'users';
  v.innerHTML = `<div class="topbar"><h1>Tài khoản & Page</h1></div>
    <div class="tabs"><a href="#/admin/users" class="${tab === 'users' ? 'on' : ''}">Người dùng</a><a href="#/admin/pages" class="${tab === 'pages' ? 'on' : ''}">Page / kênh bán</a><a href="#/admin/facebook" class="${tab === 'facebook' ? 'on' : ''}">Kết nối Facebook</a><a href="#/admin/log" class="${tab === 'log' ? 'on' : ''}">Nhật ký thao tác</a><a href="/api/admin/backup">⬇ Tải bản sao lưu dữ liệu</a></div><div id="t"></div>`;
  const t = $('#t');
  const pageChecks = ids => `<div><div class="small muted">Page được giao</div>${pages.map(p => `<label class="tag"><input type="checkbox" name="page_ids" data-multi="1" value="${p.id}" ${(ids || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join(' ') || '<span class="small muted">Chưa có Page</span>'}</div>`;
  const reloadMe = async () => { S.me = await api('/api/me'); if (!S.page && S.me.pages[0]) { S.page = S.me.pages[0]; S.settings = await P('/settings'); } boot(); };
  if (tab === 'users') {
    t.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn p" id="addu">+ Thêm tài khoản</button></div>
      <div class="card"><p class="small muted">Quản trị: toàn quyền, thấy mọi Page · Bán hàng: hội thoại, đơn, khách, đối soát · Kho – đóng gói: đơn (đóng gói, gửi, hoàn) và kho.</p><div class="tbl"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Page</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td><b>${esc(u.name)}</b><div class="small muted">${esc(u.username)}</div></td><td>${esc(S.meta.ROLES[u.role])}</td>
        <td class="small">${u.role === 'admin' ? 'Tất cả' : u.page_ids.map(id => esc(pages.find(p => p.id === id)?.name || '')).join(', ') || '<span style="color:var(--danger)">chưa giao</span>'}</td>
        <td>${u.active ? 'Hoạt động' : '<span class="pill s-da_huy">Đã khóa</span>'}</td><td><button class="btn sm" data-u="${u.id}">Sửa</button></td></tr>`).join('')}</tbody></table></div></div>`;
    $('#addu').onclick = () => formModal('Thêm tài khoản', [
      { name: 'name', label: 'Họ tên', required: true }, { name: 'username', label: 'Tên đăng nhập', required: true }, { name: 'password', label: 'Mật khẩu (≥ 6 ký tự)', required: true, type: 'text' },
      { name: 'role', label: 'Vai trò', type: 'select', options: Object.entries(S.meta.ROLES), value: 'sales' }, { type: 'html', html: pageChecks([]) },
    ], async (f, close) => { await api('/api/admin/users', { body: f }); close(); toast('Đã tạo tài khoản'); route(); });
    $$('[data-u]').forEach(b => b.onclick = () => {
      const u = users.find(x => x.id === Number(b.dataset.u));
      formModal('Sửa tài khoản ' + u.username, [
        { name: 'name', label: 'Họ tên', value: u.name, required: true }, { name: 'role', label: 'Vai trò', type: 'select', options: Object.entries(S.meta.ROLES), value: u.role },
        { type: 'html', html: pageChecks(u.page_ids) }, { name: 'active', type: 'checkbox', label: 'Đang hoạt động', value: !!u.active },
        { name: 'password', label: 'Đặt lại mật khẩu (để trống nếu không đổi)' },
      ], async (f, close) => { await api('/api/admin/users/' + u.id, { method: 'PUT', body: f }); close(); toast('Đã lưu'); u.id === S.me.user.id ? reloadMe() : route(); });
    });
  } else if (tab === 'pages') {
    t.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn p" id="addp">+ Thêm Page</button></div>
      <div class="card tbl"><p class="small muted">Mỗi Page là một shop/kênh riêng: đơn, khách, kho, báo cáo tách theo Page.</p><table><thead><tr><th>Page</th><th>Tiền tố mã đơn</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${pages.map(p => `<tr><td><b>${esc(p.name)}</b>${p.fb_url ? `<div class="small"><a href="${esc(p.fb_url)}" target="_blank" rel="noopener">${esc(p.fb_url)}</a></div>` : ''}</td><td>${esc(p.order_prefix)}-YYYYMMDD-001</td><td>${p.active ? 'Hoạt động' : 'Tạm dừng'}</td><td><button class="btn sm" data-p="${p.id}">Sửa</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có Page — thêm Page đầu tiên để bắt đầu.</td></tr>'}</tbody></table></div>`;
    const pf = p => [{ name: 'name', label: 'Tên Page', required: true, value: p?.name }, { name: 'fb_url', label: 'Link Page Facebook', value: p?.fb_url },
      { name: 'order_prefix', label: 'Tiền tố mã đơn (VD: FB, LBT)', value: p?.order_prefix || 'FB' }, ...(p ? [{ name: 'active', type: 'checkbox', label: 'Hoạt động', value: !!p.active }] : [])];
    $('#addp').onclick = () => formModal('Thêm Page', pf(null), async (f, close) => { await api('/api/admin/pages', { body: f }); close(); toast('Đã thêm Page'); reloadMe(); });
    $$('[data-p]').forEach(b => b.onclick = () => { const p = pages.find(x => x.id === Number(b.dataset.p)); formModal('Sửa Page', pf(p), async (f, close) => { await api('/api/admin/pages/' + p.id, { method: 'PUT', body: f }); close(); reloadMe(); }); });
  } else if (tab === 'facebook') {
    await adminFacebook(t, pages, q || {}, reloadMe);
  } else {
    const log = await api('/api/admin/activity');
    t.innerHTML = `<div class="card tbl"><table><thead><tr><th>Thời gian</th><th>Người</th><th>Page</th><th>Thao tác</th><th>Chi tiết</th></tr></thead><tbody>
      ${log.map(a => `<tr><td class="small">${dt(a.at)}</td><td>${esc(a.user_name || '')}</td><td class="small">${esc(a.page_name || '')}</td><td>${esc(a.action)}</td><td class="small">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }
}

async function adminFacebook(t, pages, q, reloadMe) {
  const m = await api('/api/admin/meta');
  const cfgOk = m.configured.META_APP_ID && m.configured.META_APP_SECRET && m.configured.META_WEBHOOK_VERIFY_TOKEN;
  const pageOpts = (sel) => `<option value="">— Tạo Page mới trong app —</option>${pages.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}${m.pages.some(x => x.page_id === p.id) ? ' (đã có kết nối)' : ''}</option>`).join('')}`;
  t.innerHTML = `${q.err ? `<div class="alert err">${esc(q.err)}</div>` : ''}
    <div class="card"><h3>Cấu hình server</h3>
      <div class="row small">${Object.entries(m.configured).map(([k, ok]) => `<span class="tag">${ok ? '✅' : (k === 'TOKEN_ENCRYPTION_KEY' || k === 'META_LOGIN_CONFIG_ID' ? '➖' : '❌')} ${k}</span>`).join('')}</div>
      ${cfgOk ? '' : '<div class="alert small" style="margin-top:8px">Thiếu biến môi trường trên Railway — xem hướng dẫn <b>docs/META_SETUP.md</b> trong repo.</div>'}
      <table class="small" style="margin-top:8px"><tr><td>Callback URL (webhook)</td><td><code>${esc(m.webhook_url)}</code> <button class="btn sm" data-copy="${esc(m.webhook_url)}">Chép</button></td></tr>
        <tr><td>Valid OAuth Redirect URI</td><td><code>${esc(m.redirect_uri)}</code> <button class="btn sm" data-copy="${esc(m.redirect_uri)}">Chép</button></td></tr>
        <tr><td>Privacy Policy URL</td><td><code>${esc(m.privacy_url)}</code></td></tr>
        <tr><td>Phiên bản Graph API</td><td>${esc(m.graph_version)} · Quyền: ${m.scopes.map(esc).join(', ')}</td></tr></table></div>
    <div class="card"><h3>Page đã kết nối</h3><div class="tbl"><table><thead><tr><th>Page Facebook</th><th>Page trong app</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${m.pages.map(p => `<tr><td><b>${esc(p.fb_name)}</b><div class="small muted">ID ${esc(p.fb_page_id)}</div></td><td>${esc(p.page_name)}</td>
        <td class="small">${p.last_error ? `<span style="color:var(--danger)">Lỗi: ${esc(p.last_error)}</span>` : (p.subscribed ? 'Đang nhận webhook' : 'Chưa đăng ký webhook')}
          <div class="muted">Kết nối ${dt(p.connected_at)}${p.last_event_at ? ` · tin gần nhất ${dt(p.last_event_at)}` : ''}${p.last_sync_at ? ` · đồng bộ ${dt(p.last_sync_at)}` : ''}</div></td>
        <td><button class="btn sm d" data-dc="${p.page_id}">Ngắt</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa kết nối Page nào</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:10px"><a class="btn p ${cfgOk ? '' : 'disabled'}" href="/api/admin/meta/oauth/start">🔗 Kết nối Facebook Page</a><button class="btn" id="tok">Dán Page Access Token (thử nghiệm)</button></div>
      <p class="small muted">Khi app Meta còn ở chế độ Development (chưa qua App Review), chỉ Page do tài khoản Admin/Developer/Tester của app Meta quản lý mới kết nối được, và chỉ nhận/gửi tin với những tài khoản đó.</p></div>
    <div id="pick"></div>
    <div class="card"><h3>Sự kiện webhook gần đây</h3><div class="tbl"><table class="small"><tbody>${m.log.map(l => `<tr><td>${dt(l.at)}</td><td>${l.ok ? '✅' : '⚠️'} ${esc(l.kind)}</td><td>${esc(l.fb_page_id || '')}</td><td>${esc(l.detail || '')}</td></tr>`).join('') || '<tr><td class="muted">Chưa nhận sự kiện nào</td></tr>'}</tbody></table></div></div>`;
  $$('[data-copy]', t).forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Đã chép')));
  $$('[data-dc]', t).forEach(b => b.onclick = () => confirm('Ngắt kết nối Messenger của Page này? Hội thoại đã lưu vẫn giữ lại.') && run(async () => { await api('/api/admin/meta/pages/' + b.dataset.dc, { method: 'DELETE' }); toast('Đã ngắt'); route(); }));
  const connectForm = (title, extra, body) => formModal(title, [...extra,
    { name: 'app_page_id', label: 'Gắn vào Page trong app', type: 'select', options: [['', '— Tạo Page mới trong app —'], ...pages.map(p => [p.id, p.name])] },
    { name: 'new_page_name', label: 'Tên Page mới (nếu tạo mới)', hint: 'Để trống sẽ lấy tên Page Facebook' },
  ], async (f, close) => { const r = await api('/api/admin/meta/connect', { body: { ...body, ...f } }); close(); toast('Đã kết nối ' + r.fb_name + ' — đang đồng bộ hội thoại'); location.hash = '#/admin/facebook'; reloadMe(); }, 'Kết nối');
  $('#tok').onclick = () => connectForm('Kết nối bằng Page Access Token', [{ name: 'token', label: 'Page Access Token', type: 'textarea', required: true, hint: 'Lấy trong Graph API Explorer (chọn Page, cấp quyền pages_messaging, pages_manage_metadata). Token được mã hoá khi lưu.' }], {});
  if (q.pick) {
    const list = await api('/api/admin/meta/oauth/' + encodeURIComponent(q.pick)).catch(e => { toast(e.message, true); return []; });
    $('#pick').innerHTML = `<div class="card"><h3>Chọn Page Facebook để kết nối</h3>${list.map(p => {
      const linked = m.pages.find(x => x.fb_page_id === p.id);
      return `<div class="row" style="padding:6px 0;border-bottom:1px dashed var(--line)"><b>${esc(p.name)}</b><span class="small muted">ID ${esc(p.id)}</span>
        ${linked ? `<span class="tag">đã gắn với ${esc(linked.page_name)}</span>` : ''}<button class="btn sm p right" data-fb="${esc(p.id)}">${linked ? 'Kết nối lại' : 'Kết nối'}</button></div>`;
    }).join('') || '<p class="muted">Tài khoản Facebook này không quản lý Page nào (hoặc chưa tích chọn Page khi cấp quyền).</p>'}</div>`;
    $$('[data-fb]', t).forEach(b => b.onclick = () => {
      const p = list.find(x => x.id === b.dataset.fb), linked = m.pages.find(x => x.fb_page_id === p.id);
      const auto = linked ? linked.page_id : (pages.find(x => x.name.trim().toLowerCase() === p.name.trim().toLowerCase()) || {}).id;
      connectForm('Kết nối ' + p.name, [], { state: q.pick, fb_page_id: p.id });
      if (auto) $('.modal [name=app_page_id]').value = auto;
    });
  }
}

async function viewAccount(v) {
  v.innerHTML = `<h1>Tài khoản</h1><div class="card"><b>${esc(S.me.user.name)}</b> · ${esc(S.me.user.username)} · ${esc(S.meta.ROLES[role()])}</div>
    <form class="card grid" id="pw" style="max-width:420px"><h2>Đổi mật khẩu</h2><label class="f"><span>Mật khẩu cũ</span><input type="password" name="old" required></label>
    <label class="f"><span>Mật khẩu mới</span><input type="password" name="new" required minlength="6"></label><button class="btn p">Đổi mật khẩu</button></form>`;
  $('#pw').onsubmit = e => { e.preventDefault(); run(async () => { await api('/api/me/password', { body: formData(e.target) }); toast('Đã đổi mật khẩu'); e.target.reset(); }); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
boot().then(() => { if (!S.me) renderLogin(); });
