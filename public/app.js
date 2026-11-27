'use strict';
/* Quản lí kho Vitot — frontend standalone (vanilla JS) — v39.271126 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Ngôn ngữ VI/EN ---------- */
const I18N = {
  vi: { dashboard: 'Dashboard', inventory: 'Tra cứu tồn kho', inbound: 'Nhập hàng', outbound: 'Xuất hàng', stocktake: 'Kiểm kho', processing: 'Chế biến / Sơ chế', recon: 'Đối soát đơn', calendar: 'Lịch', calendar_manage: 'Quản lí lịch (thêm / sửa / xoá sự kiện)', inbound_plan: 'Tạo phiếu nhập đặt trước (có ngày về dự kiến)', history: 'Lịch sử phiếu', settings: 'Cài đặt', logout: 'Đăng xuất', understood: 'Đã hiểu', activity: 'Hoạt động nhân viên', goods: 'Hàng hoá & Tồn kho', staffsum: 'Tổng hợp nhân viên' },
  en: { dashboard: 'Dashboard', inventory: 'Inventory lookup', inbound: 'Goods receipt', outbound: 'Goods issue', stocktake: 'Stock check', processing: 'Processing', recon: 'Order audit', calendar: 'Calendar', calendar_manage: 'Manage calendar (add / edit / delete events)', inbound_plan: 'Create pre-order goods receipts (with expected arrival date)', history: 'Slip history', settings: 'Settings', logout: 'Log out', understood: 'OK, got it', activity: 'Staff activity', goods: 'Goods & stock', staffsum: 'Staff summary' }
};
let lang = localStorage.getItem('qk-lang') || 'vi';
const t = k => (I18N[lang] && I18N[lang][k]) || I18N.vi[k] || k;
function applyI18n() { $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n)); $('#modalOk').textContent = t('understood'); }

/* ---------- Giao diện sáng/tối ---------- */
function applyTheme() {
  const mode = localStorage.getItem('qk-theme') || 'system';
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();

/* ---------- Ngày tháng Asia/Bangkok ---------- */
function bkkKey(offsetDays = 0) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offsetDays * 864e5)).forEach(x => p[x.type] = x.value);
  return `${p.year}-${p.month}-${p.day}`;
}
function fmtAutoTime(d) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const p = {}; parts.forEach(x => p[x.type] = x.value);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase()}`;
}
const fmtKg = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('vi-VN');

/* ---------- Trạng thái ---------- */
let S = { token: localStorage.getItem('qk-token') || '', user: null, boot: null, products: [], whProducts: [], view: '', slipLines: [], reconCodes: [], reconBusy: false, dashPreset: 'today', dashFrom: '', dashTo: '', monPreset: '7d', monFrom: '', monTo: '', calY: 0, calM: 0, calSel: '', calData: { arrivals: [], events: [] } };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Đã có lỗi xảy ra.');
  return j;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

/* ---------- Modal thông báo + xác nhận + toast ---------- */
function showModal(type, title, msg) {
  const icons = { warn: '!', error: '✕', success: '✓', info: 'i' };
  const ic = $('#modalIcon'); ic.className = 'modal-icon ' + type; ic.textContent = icons[type] || 'i';
  $('#modalTitle').textContent = title; $('#modalMsg').textContent = msg;
  const ok = $('#modalOk'); ok.className = 'btn ' + type;
  $('#modalWrap').classList.add('show');
  return new Promise(res => { ok.onclick = () => { $('#modalWrap').classList.remove('show'); res(); }; });
}
const alertWarn = (title, msg) => showModal('warn', title, msg);
const alertErr = (title, msg) => showModal('error', title, msg);
const alertOk = (title, msg) => showModal('success', title, msg);
const alertInfo = (title, msg) => showModal('info', title, msg);
function showConfirm(title, msg) {
  $('#confirmTitle').textContent = title; $('#confirmMsg').textContent = msg;
  $('#confirmWrap').classList.add('show');
  return new Promise(res => {
    $('#confirmYes').onclick = () => { $('#confirmWrap').classList.remove('show'); res(true); };
    $('#confirmNo').onclick = () => { $('#confirmWrap').classList.remove('show'); res(false); };
  });
}
function toast(msg, err) {
  const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = msg;
  $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3200);
}
/* Thông báo khi 1 đợt đồng bộ tồn kho kết thúc — dùng chung cho mọi nút đồng bộ trong app, mỗi đợt báo đúng 1 lần */
function notifySyncDone(r) {
  const slipsLine = r.slips !== undefined && r.slips !== null ? `\nĐã đọc ${r.slips} phiếu từ các tab phiếu.` : '';
  return alertOk('Đồng bộ hoàn tất', `Đã đồng bộ ${r.count} sản phẩm từ tab TỒN_KHO_POS.${slipsLine}\nHoàn tất lúc: ${r.syncedAt || ''}`);
}
/* Đồng bộ THỦ CÔNG — MỘT cơ chế duy nhất cho mọi nút đồng bộ (nút "Đồng bộ" trên thanh đầu
   và nút trong Cài đặt): đọc lại toàn bộ Sheet qua /api/sheet-sync,
   nạp lại bootstrap + chip tồn kho, vẽ lại màn hình đang mở (giữ nguyên dữ liệu đang soạn trong S),
   rồi bật thông báo hoàn tất đúng 1 lần. Đang chạy thì khoá, bấm thêm không chạy đợt mới. */
let syncing = false;
async function doSync() {
  if (syncing) return;
  syncing = true;
  const btn = $('#syncBtn'); const oldLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.classList.add('syncing'); btn.textContent = '⟳ Đang đồng bộ…'; }
  try {
    const r = await post('/api/sheet-sync');
    S.boot = await api('/api/bootstrap');
    setInvBadge();
    if (S.view) renderView(); // nạp lại dữ liệu đang hiển thị
    await notifySyncDone(r);
  } catch (e) { await alertErr('Đồng bộ thất bại', e.message); }
  finally {
    syncing = false;
    if (btn) { btn.disabled = false; btn.classList.remove('syncing'); btn.textContent = oldLabel; }
  }
}
function wsPill(s) {
  if (s.writeStatus === 'written') return '<span class="pill">Đã ghi Sheet</span>';
  if (s.writeStatus === 'error') return '<span class="pill warn">Ghi lỗi</span>';
  return '<span class="pill warn">Chưa ghi Sheet</span>';
}

/* ---------- Đăng nhập PIN ---------- */
let pinBuf = '';
function renderPinDots() { $$('#pinDots span').forEach((s, i) => s.classList.toggle('on', i < pinBuf.length)); }
function buildPinPad() {
  const pad = $('#pinPad'); pad.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k => {
    const b = document.createElement('button'); b.textContent = k;
    b.onclick = async () => {
      if (k === '⌫') pinBuf = pinBuf.slice(0, -1);
      else if (k && pinBuf.length < 4) pinBuf += k;
      renderPinDots();
      if (pinBuf.length === 4) {
        try {
          const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinBuf }) }).then(x => x.json());
          if (!r.token) throw new Error(r.error || 'PIN không đúng');
          S.token = r.token; localStorage.setItem('qk-token', S.token); pinBuf = ''; renderPinDots();
          await enterApp();
        } catch (e) { pinBuf = ''; renderPinDots(); await alertErr('Đăng nhập thất bại', e.message); }
      }
    };
    pad.appendChild(b);
  });
}

/* ---------- Khung app / điều hướng ---------- */
const NAV = [
  ['dashboard', '▦'], ['inventory', '🔍'], ['inbound', '📥'], ['outbound', '📤'],
  ['stocktake', '🧮'], ['processing', '🔪'], ['recon', '📦'], ['calendar', '🗓️'], ['history', '🕘'], ['settings', '⚙️']
];
/* Menu ADMIN (v33): thuần GIÁM SÁT — KHÔNG có Nhập hàng / Xuất hàng; Kiểm kho / Chế biến /
   Đối soát mở màn hình theo dõi (ADMIN_VIEWS) thay cho form làm việc của nhân viên kho. */
const NAV_ADMIN = [
  ['dashboard', '▦', 'Tổng quan'], ['activity', '👥', 'Hoạt động nhân viên'], ['goods', '📦', 'Hàng hoá & Tồn kho'],
  ['processing', '🔪', 'Chế biến / Sơ chế'], ['recon', '🧾', 'Đối soát đơn'], ['stocktake', '🧮', 'Kiểm kho'],
  ['staffsum', '📊', 'Tổng hợp nhân viên'], ['history', '🕘', 'Lịch sử phiếu'], ['inventory', '🔍', 'Tra cứu tồn kho'],
  ['calendar', '🗓️', 'Lịch'], ['settings', '⚙️', 'Cài đặt']
];
function navLabel(key) {
  if (S.user && S.user.admin) { const f = NAV_ADMIN.find(x => x[0] === key); if (f) return f[2]; }
  return t(key);
}
function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  const items = (S.user && S.user.admin)
    ? NAV_ADMIN.map(([key, icon, lbl]) => ({ key, icon, lbl }))
    : NAV.map(([key, icon]) => ({ key, icon, lbl: t(key) }));
  for (const { key, icon, lbl } of items) {
    if (!S.user.admin) {
      if (key !== 'settings' && !S.user.perms[key]) continue;
      if (key === 'dashboard') continue;
    }
    const b = document.createElement('button');
    b.className = 'nav-item' + (S.view === key ? ' active' : '');
    b.innerHTML = `<span>${icon}</span><span>${esc(lbl)}</span>`;
    b.onclick = () => { go(key); document.body.classList.remove('nav-open'); $('#sidebar').classList.remove('open'); };
    nav.appendChild(b);
  }
  $('#footName').textContent = S.user.name;
  $('#footRole').textContent = S.user.role;
}
/* Chip "Tồn kho" trên thanh đầu: hiển thị tồn THỰC TẾ theo SỔ KHO (từ bootstrap.warehouseStock),
   KHÔNG dùng số sản phẩm đồng bộ POS nữa. Chưa có dữ liệu sổ kho → "Tồn kho: 0". */
function whBadgeText(ws) {
  if (!ws || (!ws.totalQty && !ws.productCount)) return 'Tồn kho: 0';
  return `Tồn kho: ${fmtKg(ws.totalQty)} (${ws.productCount} SP)`;
}
function setInvBadge() { const b = $('#invBadge'); if (b) b.textContent = whBadgeText(S.boot && S.boot.warehouseStock); }
async function enterApp() {
  const me = await api('/api/me'); S.user = me.user;
  S.boot = await api('/api/bootstrap');
  $('#loginWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  setInvBadge();
  go(S.user.admin ? 'dashboard' : (NAV.find(([k]) => k !== 'settings' && S.user.perms[k]) || ['settings'])[0]);
}
/* Điều phối màn hình: ADMIN mở các màn GIÁM SÁT (ADMIN_VIEWS) cho Kiểm/Chế biến/Đối soát;
   nhân viên kho giữ nguyên form làm việc trong VIEWS. */
function renderView() {
  const fn = (S.user && S.user.admin && typeof ADMIN_VIEWS !== 'undefined' && ADMIN_VIEWS[S.view]) || VIEWS[S.view];
  if (fn) fn();
}
function go(view) { S.view = view; S.slipLines = []; S.reconCodes = []; S.reconBusy = false; buildNav(); $('#viewTitle').textContent = navLabel(view); renderView(); window.scrollTo(0, 0); }
$('#syncBtn').onclick = () => doSync();
$('#hamburger').onclick = () => { $('#sidebar').classList.toggle('open'); document.body.classList.toggle('nav-open'); };
$('#scrim').onclick = () => { $('#sidebar').classList.remove('open'); document.body.classList.remove('nav-open'); };
$('#logoutBtn').onclick = async () => { try { await post('/api/logout'); } catch {} S.token = ''; localStorage.removeItem('qk-token'); location.reload(); };

/* ---------- Thành phần dùng chung ---------- */
function lockedFields() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) + ' ' + now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Bangkok' });
  return `<div class="grid2">
    <div class="field"><label class="f">Thời gian (Tự động)</label><div class="locked"><span class="lk">🔒</span><span>${esc(timeStr)}</span></div></div>
    <div class="field"><label class="f">Nhân viên thực hiện</label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.name)}</span></div></div>
  </div>`;
}
function selOptions(list, cur) { return list.map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join(''); }
/* Kho mặc định (ADMIN đặt trong Cài đặt, server lưu ở APP_CAI_DAT) — chọn sẵn cho mọi dropdown kho */
function defWh() { return (S.boot && S.boot.defaultWarehouse) || ''; }
async function loadProducts(blind) {
  const r = await api('/api/products' + (blind ? '?blind=1' : ''));
  S.products = r.items; return r.items;
}
/* "Sản phẩm của kho" — dataset tổng hợp từ phiếu Nhập (server /api/warehouse-products).
   blind=1: server chỉ trả tên + mã (kiểm kho mù). */
async function loadWhProducts(blind) {
  const r = await api('/api/warehouse-products' + (blind ? '?blind=1' : ''));
  S.whProducts = r.items; return r.items;
}
/* Cách hiển thị 1 dòng trong picker sản phẩm-của-kho: tên + Mã SP · Mã mẫu (v35) kèm tồn thực tế;
   bản mù chỉ tên + 2 mã, không số liệu */
const whItemHtml = p => `<span class="nm">${esc(p.name)}</span><span class="meta">Mã SP: ${esc(p.sku || '') || '—'} · Mã mẫu: ${esc(p.sampleCode || p.code || '') || '—'} • Tồn: ${fmtKg(p.balance)}</span>`;
const whBlindHtml = p => `<span class="nm">${esc(p.name)}</span><span class="meta">Mã SP: ${esc(p.sku || '') || '—'} · Mã mẫu: ${esc(p.sampleCode || p.code || '') || '—'}</span>`;
/* Dòng phụ chuẩn cho picker danh mục POS (v35): "Mã SP: … · Mã mẫu: …" để phân biệt sản phẩm trùng tên */
const posCodesMeta = p => `Mã SP: ${esc(p.sku || '') || '—'} · Mã mẫu: ${esc(p.sampleCode || '') || '—'}`;
/* Ô chọn sản phẩm dạng dropdown tìm kiếm; onPick(item). opts:
   - items: nguồn dữ liệu thay cho S.products (vd S.whProducts); itemHtml(p): tuỳ biến hiển thị 1 dòng
   - warehouse: chuỗi hoặc HÀM trả chuỗi (lọc theo kho đang chọn trên form, đọc lại mỗi lần mở danh sách)
   - emptyMsg: thông điệp khi không tìm thấy */
function productPicker(inputEl, listEl, opts, onPick) {
  opts = opts || {};
  function render(q) {
    const src = opts.items || S.products;
    const whF = typeof opts.warehouse === 'function' ? opts.warehouse() : opts.warehouse;
    const items = src.filter(p => !whF || p.warehouse === whF)
      .filter(p => !q || (p.name + ' ' + (p.variant || '') + ' ' + (p.sku || '') + ' ' + (p.code || '') + ' ' + (p.sampleCode || '') + ' ' + (p.barcode || '')).toLowerCase().includes(q.toLowerCase()))
      .slice(0, 40);
    listEl.innerHTML = items.length ? '' : `<div class="mut" style="padding:10px;line-height:1.5">${esc(opts.emptyMsg || 'Không tìm thấy sản phẩm.')}</div>`;
    listEl.classList.remove('hidden');
    for (const p of items) {
      const b = document.createElement('button');
      b.innerHTML = opts.itemHtml ? opts.itemHtml(p)
        : opts.blind
        ? `<span class="nm">${esc(p.name)}${p.variant ? ' — ' + esc(p.variant) : ''}</span><span class="meta">${posCodesMeta(p)}</span>`
        : (p.stock === undefined
          // Nhân viên: server không trả số POS → chỉ hiện tên + Mã SP · Mã mẫu, TUYỆT ĐỐI không hiện tồn/bán POS
          ? `<span class="nm">${esc(p.name)}${p.variant ? ' — ' + esc(p.variant) : ''}</span><span class="meta">${posCodesMeta(p)}</span>`
          : `<span class="nm">${esc(p.name)}${p.variant ? ' — ' + esc(p.variant) : ''}</span><span class="meta">${posCodesMeta(p)} • Tồn: ${p.stock} • Bán: ${p.sellable}</span>`);
      b.onclick = () => { listEl.classList.add('hidden'); inputEl.value = ''; onPick(p); };
      listEl.appendChild(b);
    }
  }
  inputEl.addEventListener('focus', () => render(inputEl.value));
  inputEl.addEventListener('input', () => render(inputEl.value));
  document.addEventListener('click', e => { if (!listEl.contains(e.target) && e.target !== inputEl) listEl.classList.add('hidden'); });
}
function linesEditor(container, renderLine) {
  container.innerHTML = '';
  S.slipLines.forEach((l, idx) => {
    const row = document.createElement('div'); row.className = 'line-row';
    row.innerHTML = renderLine(l, idx);
    row.querySelector('[data-del]').onclick = () => { S.slipLines.splice(idx, 1); linesEditor(container, renderLine); };
    const qty = row.querySelector('[data-qty]');
    if (qty) qty.oninput = () => { l[qty.dataset.qty] = qty.value; const ev = new CustomEvent('linechange'); container.dispatchEvent(ev); };
    container.appendChild(row);
  });
}

/* ================= CÁC MÀN HÌNH ================= */
const VIEWS = {};
const ADMIN_VIEWS = {}; // bản GIÁM SÁT của Kiểm kho / Chế biến / Đối soát — chỉ ADMIN (v33)

/* ---------- Dùng chung cho các màn giám sát ADMIN (v33) ---------- */
const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
function monRange() {
  const tk = bkkKey(0);
  switch (S.monPreset) {
    case 'today': return { from: tk, to: tk };
    case 'yesterday': return { from: bkkKey(-1), to: bkkKey(-1) };
    case '30d': return { from: bkkKey(-29), to: tk };
    case 'month': return { from: tk.slice(0, 8) + '01', to: tk };
    case 'custom': return { from: S.monFrom || tk, to: S.monTo || tk };
    default: return { from: bkkKey(-6), to: tk }; // 7d
  }
}
/* Thanh lọc kỳ dùng chung (chip + Tuỳ chọn Từ–Đến) cho các màn giám sát — trạng thái ở S.mon* */
function mountPeriodBar(box, onChange) {
  const presets = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['custom', 'Tuỳ chọn']];
  box.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
    ${presets.map(([k, lbl]) => `<button class="chip ${S.monPreset === k ? 'active' : ''}" data-mp="${k}">${lbl}</button>`).join('')}
    <span class="${S.monPreset === 'custom' ? '' : 'hidden'}" style="display:inline-flex;gap:6px;align-items:center">
      <input class="in mon-from" type="date" value="${esc(S.monFrom)}" style="width:150px;height:30px">
      <span class="mut">→</span>
      <input class="in mon-to" type="date" value="${esc(S.monTo)}" style="width:150px;height:30px">
      <button class="btn primary mon-apply">Áp dụng</button>
    </span></div>`;
  box.querySelectorAll('[data-mp]').forEach(c => c.onclick = () => { S.monPreset = c.dataset.mp; mountPeriodBar(box, onChange); if (S.monPreset !== 'custom') onChange(); });
  const ap = box.querySelector('.mon-apply');
  if (ap) ap.onclick = () => {
    const f = box.querySelector('.mon-from').value, tt = box.querySelector('.mon-to').value;
    if (!f || !tt) return alertWarn('Chưa chọn đủ ngày', 'Hãy chọn cả Từ ngày và Đến ngày.');
    if (f > tt) return alertWarn('Khoảng ngày không hợp lệ', 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    S.monFrom = f; S.monTo = tt; onChange();
  };
}
/* Trạng thái xử lí chênh lệch (v34): badge gọn + nút ⋯ mở editor inline (select + ghi chú + Lưu/Huỷ) — dùng ở Đối soát & Kiểm kho giám sát.
   Trạng thái hiện tại giữ ở discState: mở editor là prefill đúng, Lưu xong cập nhật badge tại chỗ (không refetch). Mỗi lần chỉ 1 editor mở. */
const DISC_LBL = { open: 'Chưa xử lí', explained: 'Đã rõ nguyên nhân', resolved: 'Đã xử lí' };
const discState = new Map();
const fmtDateVN = k => { const p = String(k || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(k || ''); };
function discBadgesInner(st) {
  return `<span class="disc-badge ${st.status}">${DISC_LBL[st.status] || DISC_LBL.open}</span>${st.note ? `<span class="disc-note-ic" title="${esc(st.note)}">✎</span>` : ''}`;
}
function discCellHTML(it) {
  discState.set(it.id, { status: it.status || 'open', note: it.note || '' });
  return `<span class="disc-badges" data-disc-badges="${esc(it.id)}">${discBadgesInner(discState.get(it.id))}</span> <button class="btn disc-dots" data-disc-dots="${esc(it.id)}" title="Cập nhật trạng thái / ghi chú xử lí">⋯</button>`;
}
function discEditorInnerHTML() {
  return `<span class="disc-editor"><select class="in disc-sel">${Object.entries(DISC_LBL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input class="in disc-note" placeholder="Ghi chú xử lí…"><button class="btn primary disc-save">Lưu</button><button class="btn disc-cancel">Huỷ</button></span>`;
}
function wireDiscCompact(root) {
  const closeAll = () => root.querySelectorAll('[data-disc-panel]').forEach(p => p.classList.add('hidden'));
  root.querySelectorAll('[data-disc-dots]').forEach(b => b.onclick = () => {
    const id = b.dataset.discDots;
    const panel = root.querySelector(`[data-disc-panel="${CSS.escape(id)}"]`);
    if (!panel) return;
    const willOpen = panel.classList.contains('hidden');
    closeAll();
    if (willOpen) {
      const st = discState.get(id) || { status: 'open', note: '' };
      const sel = panel.querySelector('.disc-sel'); if (sel) sel.value = st.status;
      const note = panel.querySelector('.disc-note'); if (note) note.value = st.note;
      panel.classList.remove('hidden');
      if (note) note.focus();
    }
  });
  root.querySelectorAll('[data-disc-panel]').forEach(p => {
    const id = p.dataset.discPanel;
    const cancel = p.querySelector('.disc-cancel');
    if (cancel) cancel.onclick = () => p.classList.add('hidden');
    const save = p.querySelector('.disc-save');
    if (save) save.onclick = async () => {
      const sel = p.querySelector('.disc-sel');
      const note = p.querySelector('.disc-note');
      const status = sel ? sel.value : 'open', noteVal = note ? note.value : '';
      save.disabled = true;
      try {
        await post('/api/admin/discrepancy-status', { id, status, note: noteVal });
        discState.set(id, { status, note: noteVal });
        root.querySelectorAll(`[data-disc-badges="${CSS.escape(id)}"]`).forEach(w => { w.innerHTML = discBadgesInner(discState.get(id)); });
        p.classList.add('hidden');
        toast('Đã lưu trạng thái xử lí');
      } catch (e) { alertErr('Không lưu được trạng thái', e.message); }
      save.disabled = false;
    };
  });
}
/* ---------- Modal chi tiết phiếu gốc (v33 §10) ---------- */
function slipDetailHTML(s) {
  const head = `<div class="mut" style="margin-bottom:8px">${esc(TYPE_LBL[s.type] || s.type)} • Kho: <b>${esc(s.warehouse || '—')}</b> • ${esc(s.createdAt || '')} • Người làm: <b>${esc(s.creatorName || '')}</b> ${wsPill(s)}</div>
    ${s.type === 'in' ? `<div class="mut">Nhà cung cấp: ${esc(s.supplier || '—')}${s.expectedDate ? ` • Ngày về dự kiến: ${esc(s.expectedDate)}` : ''}${s.checker ? ` • Người kiểm: ${esc(s.checker)}` : ''}</div>` : ''}
    ${s.type === 'out' ? `<div class="mut">Phân loại: ${esc(s.exportType || '—')} • Nơi nhận: ${esc(s.recipient || '—')}</div>` : ''}
    ${s.note ? `<div class="mut">Ghi chú: ${esc(s.note)}</div>` : ''}
    ${s.writeStatus === 'error' ? `<div style="color:var(--red);font-weight:600;margin-top:4px">Ghi lỗi Sheet: ${esc(s.writeError || '')}</div>` : ''}
    ${arrivalLineHTML(s)}`;
  let tbl = '';
  if (s.type === 'check') {
    tbl = `<table class="tbl"><tr><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Đếm thực tế</th><th>Tồn hệ thống</th><th>Chênh lệch</th></tr>${(s.lines || []).map(l => `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}</td><td>${l.counted}</td><td>${l.systemStock ?? ''}</td><td>${l.variance !== undefined ? (l.variance > 0 ? '+' : '') + l.variance : ''}</td></tr>`).join('')}</table>`;
  } else if (s.type === 'process') {
    tbl = `<table class="tbl"><tr><th>Mã SP</th><th>Mã mẫu</th><th>Nguyên liệu</th><th>Đầu vào</th><th>Thành phẩm</th><th>Bán được</th><th>Hủy</th><th>Hao hụt</th></tr>${(s.lines || []).map(l => `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}</td><td>${l.inputQty}</td><td>${esc(l.finishedName || '')}${l.posQty ? ` (${l.posQty})` : ''}</td><td>${l.usable} (${l.usablePct}%)</td><td>${l.discard} (${l.discardPct}%)</td><td>${l.loss} (${l.lossPct}%)</td></tr>`).join('')}</table>`;
  } else if (s.type === 'recon') {
    tbl = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${(s.lines || []).map(l => `<span class="recon-chip"><b>${esc(l.code)}</b></span>`).join('') || '<span class="mut">Không có mã nào.</span>'}</div><div class="mut" style="margin-top:6px">Tổng: ${(s.lines || []).length} mã quét</div>`;
  } else {
    tbl = `<table class="tbl"><tr><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Số lượng</th><th>ĐVT</th><th>Ghi chú</th></tr>${(s.lines || []).map(l => `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}</td><td>${l.qty}</td><td>${esc(l.unit || '')}</td><td>${esc(l.note || '')}</td></tr>`).join('')}</table>`;
  }
  return head + tbl;
}
async function openSlipModal(code, type) {
  const wrap = $('#slipWrap'); if (!wrap) return;
  $('#slipTitle').textContent = 'Chi tiết phiếu ' + code;
  $('#slipBody').innerHTML = '<p class="mut">Đang tải…</p>';
  wrap.classList.add('show');
  try {
    const r = await api('/api/slip?code=' + encodeURIComponent(code) + (type ? '&type=' + encodeURIComponent(type) : ''));
    $('#slipTitle').textContent = 'Chi tiết phiếu ' + r.slip.code;
    $('#slipBody').innerHTML = slipDetailHTML(r.slip);
    wireArrivalButtons($('#slipBody'), () => openSlipModal(code, type));
  } catch (e) { $('#slipBody').innerHTML = `<p>${esc(e.message)}</p>`; }
}
function closeSlipModal() { const w = $('#slipWrap'); if (w) w.classList.remove('show'); }
function slipLinkHTML(code, type) { return `<span class="pill link" data-slip-link="${esc(code)}" data-slip-type="${esc(type || '')}">${esc(code)}</span>`; }
function wireSlipLinks(root) {
  root.querySelectorAll('[data-slip-link]').forEach(el => el.onclick = e => { e.stopPropagation(); openSlipModal(el.dataset.slipLink, el.dataset.slipType || ''); });
}
if ($('#slipClose')) {
  $('#slipClose').onclick = closeSlipModal;
  $('#slipWrap').addEventListener('click', e => { if (e.target.id === 'slipWrap') closeSlipModal(); });
}

/* ---------- Xác nhận nhận hàng (v36): dòng trạng thái trong chi tiết phiếu / Lịch sử ---------- */
function arrivalLineHTML(s) {
  const a = s.arrival; if (!a) return '';
  if (a.confirmed) return `<div style="margin-top:6px"><span class="pill">✓ Đã nhận: ${esc(a.by || '')} · ${esc(a.at || '')}</span>
    ${a.shortage ? `<div style="color:var(--red);font-weight:700;margin-top:3px">⚠️ Nhận THIẾU số lượng / hàng hỏng</div>` : ''}
    ${a.note ? `<div class="mut">Ghi chú nhận hàng: ${esc(a.note)}</div>` : ''}
    ${S.user && S.user.admin ? `<div style="margin-top:6px"><button class="btn danger" data-arr-unconfirm="${esc(s.code)}">Huỷ xác nhận</button></div>` : ''}</div>`;
  return `<div style="margin-top:6px"><span class="pill warn">Chưa xác nhận nhận hàng</span>${a.overdueDays ? ` <span style="color:var(--red);font-weight:700">Quá hạn ${a.overdueDays} ngày</span>` : ''}
    <button class="btn primary" style="margin-left:6px" data-arr-confirm="${esc(s.code)}">✓ Xác nhận đã nhận</button></div>`;
}
let arrCode = null, arrDone = null;
function openArrConfirm(code, onDone) {
  const wrap = $('#arrWrap'); if (!wrap) return;
  arrCode = code; arrDone = onDone || null;
  $('#arrTitle').textContent = 'Xác nhận đã nhận hàng — ' + code;
  $('#arrBy').textContent = S.user ? S.user.name : '';
  $('#arrNote').value = '';
  $('#arrShortage').checked = false;
  wrap.classList.add('show');
  setTimeout(() => { const n = $('#arrNote'); if (n) n.focus(); }, 60);
}
function closeArrConfirm() { const w = $('#arrWrap'); if (w) w.classList.remove('show'); arrCode = null; arrDone = null; }
if ($('#arrClose')) {
  $('#arrClose').onclick = closeArrConfirm;
  $('#arrCancel').onclick = closeArrConfirm;
  $('#arrWrap').addEventListener('click', e => { if (e.target.id === 'arrWrap') closeArrConfirm(); });
  $('#arrOk').onclick = async () => {
    const code = arrCode, done = arrDone;
    const btn = $('#arrOk'); btn.disabled = true;
    try {
      await post('/api/arrivals/confirm', { code, note: $('#arrNote').value, shortage: $('#arrShortage').checked });
      closeArrConfirm();
      toast('Đã xác nhận nhận hàng — phiếu ' + code);
      if (done) done();
    } catch (e) { alertErr('Không xác nhận được', e.message); }
    btn.disabled = false;
  };
}
function wireArrivalButtons(root, refresh) {
  if (!root) return;
  root.querySelectorAll('[data-arr-confirm]').forEach(b => b.onclick = e => { e.stopPropagation(); openArrConfirm(b.dataset.arrConfirm, refresh); });
  root.querySelectorAll('[data-arr-unconfirm]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const code = b.dataset.arrUnconfirm;
    if (!await showConfirm('Huỷ xác nhận nhận hàng', `Huỷ xác nhận đã nhận của phiếu ${code}? Phiếu sẽ hiện lại trên Lịch ở trạng thái chưa nhận.`)) return;
    try { await post('/api/arrivals/unconfirm', { code }); toast('Đã huỷ xác nhận — phiếu ' + code); if (refresh) refresh(); }
    catch (err) { alertErr('Không huỷ xác nhận được', err.message); }
  });
}

/* ---------- Dashboard (ADMIN): bộ lọc thời gian chung + hiệu suất chế biến + đối soát ---------- */
function dashRange() {
  const tk = bkkKey(0);
  switch (S.dashPreset) {
    case 'yesterday': return { from: bkkKey(-1), to: bkkKey(-1) };
    case '7d': return { from: bkkKey(-6), to: tk };
    case '30d': return { from: bkkKey(-29), to: tk };
    case 'month': return { from: tk.slice(0, 8) + '01', to: tk };
    case 'custom': return { from: S.dashFrom || tk, to: S.dashTo || tk };
    default: return { from: tk, to: tk };
  }
}
VIEWS.dashboard = async () => {
  const v = $('#view'); v.className = 'view';
  const presets = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['7d', '7 ngày gần nhất'], ['30d', '30 ngày gần nhất'], ['month', 'Tháng này'], ['custom', 'Tuỳ chọn']];
  v.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      ${presets.map(([k, lbl]) => `<button class="chip ${S.dashPreset === k ? 'active' : ''}" data-dp="${k}">${lbl}</button>`).join('')}
      <span id="dashCustom" class="${S.dashPreset === 'custom' ? '' : 'hidden'}" style="display:inline-flex;gap:6px;align-items:center">
        <input class="in" type="date" id="dashFrom" value="${esc(S.dashFrom)}" style="width:150px;height:30px">
        <span class="mut">→</span>
        <input class="in" type="date" id="dashTo" value="${esc(S.dashTo)}" style="width:150px;height:30px">
        <button class="btn primary" id="dashApply">Áp dụng</button>
      </span>
    </div>
    <div id="dashBody"><div class="card">Đang tải…</div></div>`;
  $$('#view [data-dp]').forEach(c => c.onclick = () => { S.dashPreset = c.dataset.dp; VIEWS.dashboard(); });
  const ap = $('#dashApply');
  if (ap) ap.onclick = () => {
    const f = $('#dashFrom').value, tt = $('#dashTo').value;
    if (!f || !tt) return alertWarn('Chưa chọn đủ ngày', 'Hãy chọn cả Từ ngày và Đến ngày.');
    if (f > tt) return alertWarn('Khoảng ngày không hợp lệ', 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    S.dashFrom = f; S.dashTo = tt; load();
  };
  async function load() {
    const { from, to } = dashRange();
    const body = $('#dashBody'); if (!body || S.view !== 'dashboard') return;
    try {
      const d = await api(`/api/dashboard?from=${from}&to=${to}`);
      const ov = await api(`/api/admin/overview?from=${from}&to=${to}`).catch(() => null);
      const stat = (num, lbl) => `<div class="card stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
      const maxBar = Math.max(1, ...d.chart.map(c => Math.max(c.in, c.out)));
      const cb = d.cheBienStats;
      /* ---- Khối CHỈ SỐ KIỂM SOÁT KHO (v33): 6 thẻ KPI cho lãnh đạo ---- */
      let kpiHtml = '';
      if (ov) {
        const K = ov.kpis;
        const lightColor = l => l === 'green' ? 'var(--green)' : l === 'yellow' ? 'var(--amber)' : l === 'red' ? 'var(--red)' : 'var(--border)';
        const deltaHtml = (k, lowerBetter, unit) => {
          if (k.value == null) return '<div class="kpi-delta mut">Chưa có dữ liệu trong kỳ</div>';
          if (k.delta == null) return '<div class="kpi-delta mut">— chưa có dữ liệu kỳ trước</div>';
          if (k.delta === 0) return '<div class="kpi-delta mut">▬ Không đổi so với kỳ trước</div>';
          const up = k.delta > 0;
          const good = lowerBetter ? !up : up;
          return `<div class="kpi-delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(k.delta)}${unit || ' điểm'} so với kỳ trước</div>`;
        };
        const pct = v => v == null ? '—' : v + '%';
        const card = (name, k, valTxt, delta, extra) => `<div class="card kpi-card" style="border-left:5px solid ${lightColor(k.light)}">
          <div class="kpi-name"><span class="kpi-dot" style="background:${lightColor(k.light)}"></span>${name}</div>
          <div class="kpi-val">${valTxt}</div>${delta}<div class="kpi-extra">${extra || ''}</div></div>`;
        kpiHtml = `<div class="mut" style="margin-bottom:6px"><b style="color:var(--text);font-size:14.5px">CHỈ SỐ KIỂM SOÁT KHO</b> — kỳ ${esc(ov.period.from)} → ${esc(ov.period.to)} (so với kỳ trước ${esc(ov.prevPeriod.from)} → ${esc(ov.prevPeriod.to)}):</div>
        <div class="kpis">
          ${card('Độ chính xác tồn kho', K.accuracy, pct(K.accuracy.value), deltaHtml(K.accuracy, false), `${K.accuracy.extra.lines} dòng kiểm trong kỳ`)}
          ${card('Tỉ lệ hao hụt', K.shrinkage, pct(K.shrinkage.value), deltaHtml(K.shrinkage, true), `Lệch thiếu kiểm ${fmtKg(K.shrinkage.extra.negVar)} + hao hụt chế biến ${fmtKg(K.shrinkage.extra.processLoss)} Kg`)}
          ${card('Chênh lệch cửa hàng ↔ POS', K.posDiff, pct(K.posDiff.value), '<div class="kpi-delta mut">— số liệu hiện tại, không so kỳ trước</div>', `Lệch ${K.posDiff.extra.mismatchCount} / ${K.posDiff.extra.totalRows} mặt hàng`)}
          ${card('Tỉ lệ thành phẩm bán được (chế biến)', K.yield, pct(K.yield.value), deltaHtml(K.yield, false), `${K.yield.extra.batches} mẻ • Đầu vào ${fmtKg(K.yield.extra.inputKg)} Kg • Hủy ${K.yield.extra.discardPct ?? '—'}% • Hao hụt ${K.yield.extra.lossPct ?? '—'}%`)}
          ${card('Tỉ lệ đối soát đủ đơn', K.recon, pct(K.recon.value), deltaHtml(K.recon, false), `Đã quét khớp ${K.recon.extra.matched} / ${K.recon.extra.expected} đơn POS kỳ vọng`)}
          ${card('Vụ bất thường còn treo', K.openIssues, String(K.openIssues.value), '<div class="kpi-delta mut">— số liệu hiện tại, không so kỳ trước</div>', K.openIssues.value ? `Vụ lâu nhất đã treo ${K.openIssues.extra.oldestDays} ngày` : 'Không còn vụ nào chưa xử lí')}
        </div>
        <div class="mut" style="margin:6px 0 12px">Ngưỡng đèn là mức mặc định do quản lí đặt (xanh = đạt, vàng = chú ý, đỏ = cần can thiệp). Tỉ lệ hao hụt tính theo SỐ LƯỢNG — hệ thống chưa có dữ liệu giá vốn nên chưa quy ra tiền.</div>`;
        var alertsHtml = ov.alerts && ov.alerts.length ? `<div class="card" style="margin-top:12px"><b>HỘP CẢNH BÁO</b> <span class="badge r">${ov.alerts.length}</span>
          ${ov.alerts.map(a => `<div class="alert-item ${a.severity === 'red' ? 'red' : 'yellow'}" data-alert-go="${esc(a.target || '')}"><span class="al-dot"></span><span>${esc(a.text)}</span></div>`).join('')}</div>` : '';
      }
      body.innerHTML = `${kpiHtml || ''}` + `
      <div class="mut" style="margin-bottom:6px">Số tồn kho (hiện tại, không lọc theo thời gian):</div>
      <div class="stats">
        ${stat(d.totalProducts, 'Tổng sản phẩm')}${stat(d.totalStock.toLocaleString('vi-VN'), 'Tổng tồn kho')}
        ${stat(d.outOfStock, 'Hết hàng')}${stat(d.lowStockList.length, 'Sắp hết (≤5)')}
      </div>
      <div class="mut" style="margin:12px 0 6px">Hoạt động trong kỳ ${esc(d.period.from)} → ${esc(d.period.to)}:</div>
      <div class="stats">
        ${stat(d.slipsInPeriod, 'Phiếu trong kỳ')}
        ${stat(d.reconScanned, 'Đơn đã đối soát')}
        ${stat(d.reconDuplicates, 'Đơn quét trùng')}
        ${stat(d.written, 'Đã ghi lên Sheet')}
        ${stat(d.reconWarnings, 'Phiếu kiểm lệch')}
      </div>
      <div class="mut" style="margin-top:6px">Nhập ${d.byType.in} • Xuất ${d.byType.out} • Kiểm ${d.byType.check} • Chế biến ${d.byType.process} • Đối soát ${d.byType.recon} (số phiếu)</div>
      <div class="card" style="margin-top:12px"><b>Nhập / Xuất theo ngày trong kỳ</b>
        <div class="chart">${d.chart.map(c => `<div class="col"><div class="bars"><div class="bar" style="height:${Math.round(c.in / maxBar * 100)}px" title="Nhập ${c.in}"></div><div class="bar out" style="height:${Math.round(c.out / maxBar * 100)}px" title="Xuất ${c.out}"></div></div><div class="dl">${c.day}</div></div>`).join('')}</div>
        <div class="mut">■ Nhập &nbsp; ■ Xuất (màu vàng)</div></div>
      <div class="card" style="margin-top:12px"><b>Hiệu suất chế biến / sơ chế</b> <span class="mut">(${cb.batches} mẻ • Tổng đầu vào ${fmtKg(cb.inputKg)} Kg)</span>
        <div class="cb-stats" style="margin-top:10px">
          <div class="cb-stat green"><div class="cb-pct">${cb.sellablePct}%</div><div class="cb-lbl">Bán được</div><div class="cb-kg">${fmtKg(cb.sellableKg)} Kg</div></div>
          <div class="cb-stat red"><div class="cb-pct">${cb.wastePct}%</div><div class="cb-lbl">Hỏng / Hủy</div><div class="cb-kg">${fmtKg(cb.wasteKg)} Kg</div></div>
          <div class="cb-stat amber"><div class="cb-pct">${cb.lossPct}%</div><div class="cb-lbl">Hao hụt</div><div class="cb-kg">${fmtKg(cb.lossKg)} Kg</div></div>
        </div>
        <div class="cb-bar"><span class="seg-use" style="width:${cb.sellablePct}%"></span><span class="seg-dis" style="width:${cb.wastePct}%"></span><span class="seg-loss" style="width:${cb.lossPct}%"></span></div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card"><b>Sắp hết hàng</b>${d.lowStockList.length ? `<table class="tbl"><tr><th>Sản phẩm</th><th>Tồn</th></tr>${d.lowStockList.map(i => `<tr><td>${esc(i.name)}${i.variant ? ' — ' + esc(i.variant) : ''}</td><td><span class="badge y">${i.stock}</span></td></tr>`).join('')}</table>` : '<p class="mut">Không có.</p>'}</div>
        <div class="card"><b>Hoạt động gần đây</b>${d.recent.length ? d.recent.map(s => `<p style="margin:8px 0"><span class="pill">${esc(s.code)}</span> ${esc(s.creatorName)} • ${esc(s.createdAt)} ${wsPill(s)}</p>`).join('') : '<p class="mut">Chưa có phiếu nào.</p>'}</div>
      </div>` + (typeof alertsHtml !== 'undefined' ? alertsHtml : '');
      body.querySelectorAll('[data-alert-go]').forEach(el => el.onclick = () => { const tg = el.dataset.alertGo; if (tg && (VIEWS[tg] || ADMIN_VIEWS[tg])) go(tg); });
    } catch (e) { body.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  }
  load();
};

/* ---------- Hoạt động nhân viên (ADMIN, v33 §3) ---------- */
const ACT_LBL = { in: 'Nhập hàng', out: 'Xuất hàng', check: 'Kiểm kho', process: 'Chế biến', recon: 'Đối soát đơn' };
const ACT_CLS = { in: 'act-in', out: 'act-out', check: 'act-check', process: 'act-proc', recon: 'act-recon' };
VIEWS.activity = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card"><div id="actBar"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="width:210px;margin-bottom:0"><label class="f">Nhân viên</label><select class="in" id="actUser"><option value="">Tất cả nhân viên</option>${(S.boot.staffNames || []).map(n => `<option>${esc(n)}</option>`).join('')}</select></div>
      <div class="field" style="width:210px;margin-bottom:0"><label class="f">Loại hành động</label><select class="in" id="actType"><option value="">Tất cả</option>${Object.entries(ACT_LBL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    </div>
    <div id="actList">Đang tải…</div></div>`;
  mountPeriodBar($('#actBar'), load);
  async function load() {
    const box = $('#actList'); if (!box || S.view !== 'activity') return;
    const { from, to } = monRange();
    const q = new URLSearchParams({ from, to });
    if ($('#actUser').value) q.set('user', $('#actUser').value);
    if ($('#actType').value) q.set('type', $('#actType').value);
    try {
      const r = await api('/api/admin/activity?' + q.toString());
      box.innerHTML = r.items.length ? `<table class="tbl"><tr><th>Giờ</th><th>Nhân viên</th><th>Hành động</th><th>Chi tiết</th><th>Mã phiếu</th></tr>${r.items.map(i => `<tr><td style="white-space:nowrap">${esc(i.at)}</td><td><b>${esc(i.user)}</b></td><td><span class="act-chip ${ACT_CLS[i.type] || ''}">${ACT_LBL[i.type] || i.type}</span></td><td>${esc(i.summary)}</td><td>${slipLinkHTML(i.code, i.type)}</td></tr>`).join('')}</table>` : '<p class="mut">Không có hoạt động nào trong kỳ.</p>';
      wireSlipLinks(box);
    } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  $('#actUser').onchange = load;
  $('#actType').onchange = load;
  load();
};

/* ---------- Hàng hoá & Tồn kho (ADMIN, v33 §4): tab Kho cửa hàng + từng kho POS + THẺ KHO ---------- */
VIEWS.goods = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card">
    <div class="wh-tabs" id="gTabs"></div>
    <div class="mut hidden" id="gPosNote" style="margin:8px 0">Số tồn POS là TỔNG tồn của sản phẩm trên Pancake POS — dữ liệu Sheet hiện chưa tách riêng số tồn cho từng kho.</div>
    <div id="gBody">Đang tải…</div></div>
  <div id="gCard"></div>`;
  await loadProducts(false); // payload ADMIN: warehouses[] + unit + tồn/bán POS
  await loadWhProducts(false);
  const inv = await api('/api/inventory').catch(() => null);
  const pcRows = inv && inv.posCompare ? inv.posCompare.rows : [];
  const pcMap = new Map(pcRows.map(r => [r.code + '\u0002' + normName(r.name), r]));
  const posWarehouses = [...new Set(S.products.flatMap(p => p.warehouses || []))];
  let tab = 'store';
  function renderTabs() {
    const tabs = [['store', 'Kho cửa hàng'], ...posWarehouses.map(w => ['pos:' + w, w + ' (POS)'])];
    $('#gTabs').innerHTML = tabs.map(([k, l]) => `<button class="chip ${tab === k ? 'active' : ''}" data-gt="${esc(k)}">${esc(l)}</button>`).join('');
    $$('#gTabs [data-gt]').forEach(b => b.onclick = () => { tab = b.dataset.gt; renderTabs(); renderBody(); });
    $('#gPosNote').classList.toggle('hidden', tab === 'store');
  }
  function renderBody() {
    const box = $('#gBody'); if (!box) return;
    if (tab === 'store') {
      const groups = new Map();
      for (const e of S.whProducts) {
        const k = e.code + '\u0002' + normName(e.name);
        let g = groups.get(k);
        if (!g) { g = { code: e.code, name: e.name, unit: e.unit || '', warehouse: e.warehouse, sku: e.sku || '', skuAmb: false, sampleCode: e.sampleCode || e.code || '', totalIn: 0, totalOut: 0, balance: 0 }; groups.set(k, g); }
        // Gộp nhiều kho: mã chỉ giữ khi mọi dòng cùng 1 giá trị — khác nhau thì để trống ("—"), không đoán
        if (e.sku) { if (!g.sku && !g.skuAmb) g.sku = e.sku; else if (g.sku && e.sku !== g.sku) { g.sku = ''; g.skuAmb = true; } }
        g.totalIn += Number(e.totalIn) || 0; g.totalOut += Number(e.totalOut) || 0; g.balance += Number(e.balance) || 0;
      }
      const rows = [...groups.values()].map(g => {
        const pc = pcMap.get(g.code + '\u0002' + normName(g.name));
        const pos = pc ? pc.posStock : 0;
        return { ...g, sku: g.sku || (pc ? pc.sku : '') || '', sampleCode: g.sampleCode || (pc ? pc.sampleCode : '') || g.code, pos, diff: Math.round((g.balance - pos) * 1000) / 1000 };
      });
      for (const [k, pc] of pcMap) if (!groups.has(k)) rows.push({ code: pc.code, name: pc.name, unit: pc.unit || '', warehouse: '', sku: pc.sku || '', sampleCode: pc.sampleCode || '', totalIn: 0, totalOut: 0, balance: 0, pos: pc.posStock, diff: -pc.posStock });
      rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name, 'vi'));
      box.innerHTML = `<table class="tbl"><tr><th>STT</th><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Tổng nhập</th><th>Tổng xuất</th><th>Tồn cửa hàng</th><th>Tồn POS</th><th>Chênh lệch</th></tr>${rows.map((r, idx) => `<tr class="clickable" data-gcard="${esc(r.code)}" data-gname="${esc(r.name)}" data-gwh="${esc(r.warehouse || '')}"><td>${idx + 1}</td><td>${esc(r.sku || '') || '—'}</td><td>${esc(r.sampleCode || r.code || '') || '—'}</td><td><b>${esc(r.name)}</b>${r.unit ? `<div class="mut">${esc(r.unit)}</div>` : ''}</td><td>${fmtKg(r.totalIn)}</td><td>${fmtKg(r.totalOut)}</td><td><span class="badge ${r.balance > 0 ? 'g' : r.balance < 0 ? 'r' : 'y'}">${fmtKg(r.balance)}</span></td><td>${fmtKg(r.pos)}</td><td><span class="badge ${r.diff === 0 ? 'g' : 'r'}">${r.diff > 0 ? '+' : ''}${fmtKg(r.diff)}</span></td></tr>`).join('') || '<tr><td colspan="9" class="mut">Chưa có dữ liệu.</td></tr>'}</table>
      <div class="mut" style="margin-top:6px">Bấm vào 1 dòng để mở THẺ KHO của sản phẩm.</div>`;
    } else {
      const whName = tab.slice(4);
      const groups = new Map();
      for (const p of S.products) {
        if (!(p.warehouses || []).includes(whName)) continue;
        const label = p.variant ? `${p.name} (${p.variant})` : p.name;
        const k = (p.sampleCode || p.sku || '') + '\u0002' + normName(label);
        let g = groups.get(k);
        if (!g) { g = { name: label, code: p.sampleCode || p.sku || '', unit: p.unit || '', stock: 0, sellable: 0, warehouses: new Set(), skus: new Set(), samples: new Set() }; groups.set(k, g); }
        g.stock += Number(p.stock) || 0; g.sellable += Number(p.sellable) || 0;
        if (p.sku) g.skus.add(p.sku);
        if (p.sampleCode) g.samples.add(p.sampleCode);
        (p.warehouses || []).forEach(w => g.warehouses.add(w));
      }
      // Nhóm gộp nhiều dòng POS: mã chỉ hiện khi cả nhóm có đúng 1 giá trị — nhiều giá trị khác nhau thì "—"
      const singleOf = set => set.size === 1 ? [...set][0] : '';
      const rows = [...groups.values()].map(g => ({ ...g, sku: singleOf(g.skus), sampleCode: singleOf(g.samples) }));
      box.innerHTML = `<table class="tbl"><tr><th>STT</th><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>ĐVT</th><th>Tồn POS</th><th>Có thể bán</th><th>Kho thao tác</th></tr>${rows.map((r, idx) => `<tr class="clickable" data-gcard="${esc(r.code)}" data-gname="${esc(r.name)}" data-gwh=""><td>${idx + 1}</td><td>${esc(r.sku || '') || '—'}</td><td>${esc(r.sampleCode || '') || '—'}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.unit) || '—'}</td><td>${fmtKg(r.stock)}</td><td>${fmtKg(r.sellable)}</td><td class="mut">${[...r.warehouses].filter(w => w !== whName).join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="mut">Không có sản phẩm nào thuộc kho này trên POS.</td></tr>'}</table>`;
    }
    box.querySelectorAll('[data-gcard]').forEach(tr => tr.onclick = () => openStockCard(tr.dataset.gwh, tr.dataset.gcard, tr.dataset.gname));
  }
  async function openStockCard(wh, code, name) {
    const box = $('#gCard'); if (!box) return;
    box.innerHTML = '<div class="card" style="margin-top:12px">Đang tải thẻ kho…</div>';
    try {
      const r = await api(`/api/admin/stock-card?warehouse=${encodeURIComponent(wh || '')}&code=${encodeURIComponent(code || '')}&name=${encodeURIComponent(name || '')}`);
      const e = r.entry;
      const EV_LBL = { nhap: 'Nhập', xuat: 'Xuất', 'chebien-out': 'Chế biến — nguyên liệu ra', 'chebien-in': 'Chế biến — thành phẩm vào', kiem: 'Kiểm kho' };
      box.innerHTML = `<div class="card" style="margin-top:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>THẺ KHO — ${esc(e.name)}</b><span class="pill">Mã SP: ${esc(e.sku || '') || '—'}</span><span class="pill">Mã mẫu: ${esc(e.sampleCode || e.code || '') || '—'}</span><span class="mut">${esc(e.warehouse || '')}</span></div>
        <div class="stats" style="margin-top:10px">
          <div class="card stat"><div class="num">${fmtKg(e.stock)}</div><div class="lbl">Tồn cửa hàng hiện tại ${esc(e.unit || '')}</div></div>
          <div class="card stat"><div class="num">${fmtKg(e.totalIn)}</div><div class="lbl">Tổng đã nhập</div></div>
          <div class="card stat"><div class="num">${fmtKg(e.totalOut)}</div><div class="lbl">Tổng đã xuất</div></div>
          <div class="card stat"><div class="num">${fmtKg(e.posStock)}</div><div class="lbl">Tồn POS hiện tại</div></div>
        </div>
        ${r.events.length ? `<div style="overflow-x:auto"><table class="tbl" style="margin-top:10px"><tr><th>Thời gian</th><th>Loại</th><th>Phiếu</th><th>Người làm</th><th>Biến động</th><th>Tồn sau</th><th>Ghi chú</th></tr>${r.events.map(ev => `<tr><td style="white-space:nowrap">${esc(ev.at)}</td><td>${EV_LBL[ev.type] || ev.type}</td><td>${slipLinkHTML(ev.code, '')}</td><td>${esc(ev.by || '')}</td><td>${ev.type === 'kiem' ? '—' : (ev.delta > 0 ? '+' : '') + fmtKg(ev.delta)}</td><td><b>${fmtKg(ev.balanceAfter)}</b></td><td class="mut">${ev.type === 'kiem' ? `Đếm ${ev.counted} · Tồn sổ lúc kiểm ${ev.book}` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mut" style="margin-top:8px">Sản phẩm chưa có biến động ở kho cửa hàng.</p>'}
      </div>`;
      wireSlipLinks(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { box.innerHTML = `<div class="card" style="margin-top:12px">${esc(err.message)}</div>`; }
  }
  renderTabs(); renderBody();
};

/* ---------- Chế biến — GIÁM SÁT (ADMIN, v33 §5); nhân viên kho vẫn dùng form ở VIEWS.processing ---------- */
ADMIN_VIEWS.processing = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card"><div id="pmBar"></div><div id="pmBody">Đang tải…</div></div>`;
  mountPeriodBar($('#pmBar'), load);
  async function load() {
    const box = $('#pmBody'); if (!box || S.view !== 'processing') return;
    const { from, to } = monRange();
    try {
      const r = await api(`/api/history?type=process&from=${from}&to=${to}`);
      let tIn = 0, tUse = 0, tDis = 0, tLoss = 0;
      const rowsHtml = [];
      for (const s of r.slips) for (const l of s.lines || []) {
        tIn += Number(l.inputQty) || 0; tUse += Number(l.usable) || 0; tDis += Number(l.discard) || 0; tLoss += Number(l.loss) || 0;
        rowsHtml.push(`<tr><td>${slipLinkHTML(s.code, 'process')}</td><td style="white-space:nowrap">${esc(s.createdAt)}</td><td>${esc(s.creatorName)}</td><td>${fmtKg(l.inputQty)}</td><td>${fmtKg(l.usable)} (${l.usablePct}%)</td><td>${fmtKg(l.discard)} (${l.discardPct}%)</td><td>${l.lossPct}%<div class="cb-bar" style="margin-top:4px;min-width:110px"><span class="seg-use" style="width:${l.usablePct}%"></span><span class="seg-dis" style="width:${l.discardPct}%"></span><span class="seg-loss" style="width:${l.lossPct}%"></span></div></td></tr>`);
      }
      const pctT = x => tIn > 0 ? Math.round(x / tIn * 1000) / 10 : 0;
      box.innerHTML = rowsHtml.length ? `<div style="overflow-x:auto"><table class="tbl"><tr><th>Mã mẻ</th><th>Giờ</th><th>Người làm</th><th>Đầu vào (Kg)</th><th>Bán được</th><th>Hủy</th><th>Hao hụt</th></tr>${rowsHtml.join('')}<tr style="font-weight:700"><td colspan="3">TỔNG KỲ</td><td>${fmtKg(tIn)}</td><td>${fmtKg(tUse)} (${pctT(tUse)}%)</td><td>${fmtKg(tDis)} (${pctT(tDis)}%)</td><td>${pctT(tLoss)}%</td></tr></table></div>` : '<p class="mut">Không có mẻ chế biến nào trong kỳ.</p>';
      wireSlipLinks(box);
    } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  load();
};

/* ---------- Đối soát — GIÁM SÁT (ADMIN, v33 §6 + v34 accordion theo ngày): POS báo ↔ đã quét ---------- */
ADMIN_VIEWS.recon = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div id="rcBar"></div><div id="rcBody">Đang tải…</div>`;
  mountPeriodBar($('#rcBar'), load);
  async function load() {
    const box = $('#rcBody'); if (!box || S.view !== 'recon') return;
    const { from, to } = monRange();
    try {
      const r = await api(`/api/admin/recon-check?from=${from}&to=${to}`);
      box.innerHTML = r.days.map((d, idx) => {
        const open = idx === 0; /* server trả ngày giảm dần: ngày mới nhất mở sẵn, các ngày còn lại thu gọn */
        return `<div class="card rc-day" style="margin-bottom:12px">
        <div class="rc-day-head" data-rc-toggle="${idx}" title="Bấm để mở / thu gọn ngày này">
          <span class="rc-chev">${open ? '▾' : '▸'}</span><b>Ngày ${esc(fmtDateVN(d.date))}</b>
          <span class="pill">POS báo: ${d.expectedCount}</span><span class="pill">Đã quét: ${d.scannedDistinct} đơn (${d.scannedRows} mã)</span>
          <span class="pill ${d.missing.length ? 'warn' : ''}">Thiếu: ${d.missing.length}</span><span class="pill ${d.extra.length ? 'warn' : ''}">Thừa: ${d.extra.length}</span><span class="pill ${d.duplicates ? 'warn' : ''}">Quét trùng: ${d.duplicates}</span>
        </div>
        <div class="rc-day-body${open ? '' : ' hidden'}" data-rc-body="${idx}">
          ${!d.hasExpected ? '<div class="mut" style="margin-top:6px">Chưa có dữ liệu đơn POS cho ngày này (tab ĐƠN_POS_ẨN trống) — chỉ có số đã quét.</div>' : ''}
          ${d.missingItems.length ? `<div style="margin-top:8px"><b>Đơn còn thiếu:</b>${d.missingItems.map(m => `<div class="disc-row"><span class="pill warn">${esc(m.code)}</span>${discCellHTML(m)}</div><div class="disc-panel hidden" data-disc-panel="${esc(m.id)}">${discEditorInnerHTML()}</div>`).join('')}</div>` : ''}
          ${d.extra.length ? `<div class="mut" style="margin-top:6px">Đơn quét thừa (không có trong danh sách POS): ${d.extra.map(x => esc(x)).join(', ')}</div>` : ''}
        </div>
      </div>`;
      }).join('') || '<p class="mut">Không có ngày nào trong kỳ.</p>';
      /* v39: hàng chờ "Dòng bán chưa trừ được" — dòng hàng của đơn đã quét mà app chưa trừ được
         vào kho khi chốt đối soát (không khớp sản phẩm kho / số lượng bất thường / lỗi tạo phiếu). */
      if (r.review && r.review.length) {
        box.insertAdjacentHTML('beforeend', `<div class="card" style="margin-bottom:12px">
          <b>⚠️ Dòng bán chưa trừ được (${r.review.length})</b>
          <div class="mut" style="margin:4px 0 8px">Dòng hàng trong các đơn đã chốt đối soát nhưng app CHƯA trừ được vào kho. Kiểm tra và xử lí tay (tạo phiếu xuất / sửa dữ liệu gốc), xong thì bấm "Đã xử lí" để đóng dòng.</div>
          ${r.review.map(x => `<div class="disc-row"><span class="pill warn">${esc(x.orderCode)}</span><span><b>${esc(x.lineText)}</b><div class="mut">${esc(x.reason)} • ${esc(x.at || '')} • phiên ${esc(x.sessionCode || '')}${x.by ? ` • ${esc(x.by)}` : ''}</div></span><button class="btn" style="margin-left:auto;flex:0 0 auto" data-drev="${esc(x.id)}">Đã xử lí</button></div>`).join('')}
        </div>`);
        box.querySelectorAll('[data-drev]').forEach(b => b.onclick = async () => {
          b.disabled = true;
          try { await post('/api/deduct-review-dismiss', { id: b.dataset.drev }); toast('Đã đóng dòng chờ xử lí'); load(); }
          catch (e) { alertErr('Không đóng được dòng', e.message); b.disabled = false; }
        });
      }
      box.querySelectorAll('[data-rc-toggle]').forEach(h => h.onclick = () => {
        const body = box.querySelector(`[data-rc-body="${h.dataset.rcToggle}"]`);
        if (!body) return;
        const nowHidden = body.classList.toggle('hidden');
        const chev = h.querySelector('.rc-chev'); if (chev) chev.textContent = nowHidden ? '▸' : '▾';
      });
      wireDiscCompact(box);
    } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  }
  load();
};

/* ---------- Kiểm kho — GIÁM SÁT (ADMIN, v33 §7): đếm thực tế ↔ tồn sổ ↔ tồn POS ---------- */
ADMIN_VIEWS.stocktake = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card"><div id="ckBar"></div><div id="ckBody">Đang tải…</div></div>`;
  mountPeriodBar($('#ckBar'), load);
  async function load() {
    const box = $('#ckBody'); if (!box || S.view !== 'stocktake') return;
    const { from, to } = monRange();
    try {
      const r = await api(`/api/admin/checks?from=${from}&to=${to}`);
      const badge = x => `<span class="badge ${x === 0 ? 'g' : 'r'}">${x > 0 ? '+' : ''}${fmtKg(x)}</span>`;
      box.innerHTML = r.items.length ? `<div style="overflow-x:auto"><table class="tbl"><tr><th>STT</th><th>Phiếu</th><th>Giờ</th><th>Người kiểm</th><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Tồn sổ</th><th>Đếm thực tế</th><th>Lệch sổ</th><th>Tồn POS</th><th>Lệch POS</th><th>Trạng thái xử lí</th></tr>${r.items.map((i, idx) => {
        const hasDisc = i.varBook !== 0;
        const row = `<tr><td>${idx + 1}</td><td>${slipLinkHTML(i.slipCode, 'check')}</td><td style="white-space:nowrap">${esc(i.at)}</td><td>${esc(i.user)}</td><td>${esc(i.sku || '') || '—'}</td><td>${esc(i.sampleCode || '') || '—'}</td><td><b>${esc(i.name)}</b><div class="mut">${esc(i.warehouse || '')}</div></td><td>${fmtKg(i.book)}</td><td>${fmtKg(i.counted)}</td><td>${badge(i.varBook)}</td><td>${fmtKg(i.posNow)}</td><td>${badge(i.varPos)}</td><td>${hasDisc ? discCellHTML({ id: i.discrepancyId, status: i.status, note: i.note }) : '<span class="pill">Khớp</span>'}</td></tr>`;
        const ed = hasDisc ? `<tr class="disc-ed-tr hidden" data-disc-panel="${esc(i.discrepancyId)}"><td colspan="13">${discEditorInnerHTML()}</td></tr>` : '';
        return row + ed;
      }).join('')}</table></div>` : '<p class="mut">Không có dòng kiểm kho nào trong kỳ.</p>';
      wireSlipLinks(box);
      wireDiscCompact(box);
    } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  load();
};

/* ---------- Tổng hợp nhân viên (ADMIN, v33 §8) ---------- */
VIEWS.staffsum = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card"><div id="ssBar"></div><div id="ssBody">Đang tải…</div></div>`;
  mountPeriodBar($('#ssBar'), load);
  async function load() {
    const box = $('#ssBody'); if (!box || S.view !== 'staffsum') return;
    const { from, to } = monRange();
    try {
      const r = await api(`/api/admin/staff-summary?from=${from}&to=${to}`);
      box.innerHTML = r.rows.length ? `<table class="tbl"><tr><th>Nhân viên</th><th>Phiếu nhập</th><th>Phiếu xuất</th><th>Kiểm kho</th><th>Chế biến</th><th>Đối soát</th></tr>${r.rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${x.in}</td><td>${x.out}</td><td>${x.check} phiếu • ${x.checkLines} dòng • ${x.checkVarLines} dòng lệch</td><td>${x.process} mẻ • hủy ${x.discardPct}%</td><td>${x.recon} phiên • ${x.reconCodes} mã quét</td></tr>`).join('')}</table>` : '<p class="mut">Chưa có hoạt động nào trong kỳ.</p>';
    } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  load();
};

/* ---------- Tra cứu tồn kho ---------- */
VIEWS.inventory = async () => {
  const v = $('#view'); v.className = 'view';
  const wh = S.boot.lists.warehouses;
  v.innerHTML = `<div class="card">
    <div class="grid2">
      <div class="field"><label class="f">Kho hàng</label><select class="in" id="invWh"><option value="">Tất cả kho</option>${selOptions(wh, defWh())}</select></div>
      <div class="field"><label class="f">Tìm kiếm</label><input class="in" id="invQ" placeholder="Tên sản phẩm, mã sản phẩm…"></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="chip active" data-f="all">Tất cả sản phẩm (<span id="cAll">0</span>)</button>
      <button class="chip" data-f="available">Còn hàng (&gt;0) (<span id="cAv">0</span>)</button>
      <button class="chip" data-f="out">Hết / âm kho (≤0) (<span id="cOut">0</span>)</button>
    </div>
    <div class="mut" id="invMeta" style="margin-top:10px"></div>
    <div class="inv-summary" id="invSummary"></div>
    <div id="invList" style="margin-top:6px"></div>
    <div style="text-align:center;margin-top:10px"><button class="btn hidden" id="invMore">Xem thêm</button></div>
  </div>
  <div id="invPosWrap"></div>`;
  let filter = 'all', page = 1;
  let pcOnlyDiff = false; // công tắc "Chỉ hiện dòng có chênh lệch" của khối đối chiếu POS (chỉ ADMIN)
  let lastPc = null;      // dữ liệu đối chiếu của lần tải gần nhất — công tắc lọc HIỂN THỊ ngay tại client, không gọi lại API
  const PC_CAP = 100;     // chưa gõ tìm kiếm: chỉ render tối đa ngần này dòng đối chiếu đầu tiên (đã sắp xếp lệch lớn nhất trước)
  /* Khối đối chiếu kho POS chính — server CHỈ trả posCompare cho ADMIN; nhân viên không thấy khối này.
     rows từ server đã lọc theo ô tìm kiếm chính; tại đây chỉ lọc thêm công tắc lệch + giới hạn hiển thị. */
  function renderPc() {
    const pw = $('#invPosWrap');
    if (!pw) return;
    if (!lastPc) { pw.innerHTML = ''; return; }
    const pc = lastPc;
    const totalAll = pc.totalRows != null ? pc.totalRows : pc.rows.length; // tổng kết "Lệch: X / Y" luôn trên TOÀN BỘ danh sách
    let rows = pc.rows;
    if (pcOnlyDiff) rows = rows.filter(x => x.diff !== 0);
    const qVal = (($('#invQ') || {}).value || '').trim();
    const capped = !qVal && rows.length > PC_CAP;
    const shown = capped ? rows.slice(0, PC_CAP) : rows;
    const prows = shown.map((x, idx) => `<tr class="${x.diff !== 0 ? 'diffrow' : ''}"><td>${idx + 1}</td><td>${esc(x.sku || '') || '—'}</td><td>${esc(x.sampleCode || x.code || '') || '—'}</td><td><b>${esc(x.name)}</b><div class="mut">${esc(x.warehouse || '')}</div></td><td>${fmtKg(x.storeStock)}</td><td>${fmtKg(x.posStock)}</td><td><span class="badge ${x.diff === 0 ? 'g' : 'r'}">${x.diff > 0 ? '+' : ''}${fmtKg(x.diff)}</span></td></tr>`).join('');
    pw.innerHTML = `<div class="card" style="margin-top:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>Đối chiếu kho POS chính</b><span class="badge y">Chỉ quản lí (ADMIN)</span><span style="margin-left:auto" class="mut">Lệch: <b>${pc.mismatchCount}</b> / ${totalAll} mặt hàng</span></div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer"><input type="checkbox" id="pcOnlyDiff" ${pcOnlyDiff ? 'checked' : ''}> Chỉ hiện dòng có chênh lệch</label>
      <div class="mut" style="margin:6px 0">Chênh lệch = Tồn kho cửa hàng (sổ kho) − Tồn kho POS chính (tổng tồn POS của sản phẩm trên toàn bộ dữ liệu POS). Dòng tô đỏ là mặt hàng đang lệch số giữa 2 kho; sản phẩm chỉ có ở 1 phía vẫn được liệt kê. Bảng này lọc theo ô Tìm kiếm ở trên.</div>
      <table class="tbl"><tr><th>STT</th><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Tồn kho cửa hàng</th><th>Tồn kho POS chính</th><th>Chênh lệch</th></tr>${prows || '<tr><td colspan="7" class="mut">Không có mặt hàng nào khớp.</td></tr>'}</table>
      ${capped ? `<div class="mut" style="margin-top:6px">Đang hiện ${shown.length} / ${rows.length} mặt hàng — gõ tìm kiếm để thu hẹp.</div>` : ''}</div>`;
    const tg = $('#pcOnlyDiff');
    if (tg) tg.onchange = () => { pcOnlyDiff = tg.checked; renderPc(); };
  }
  async function load(reset) {
    if (reset) page = 1;
    const r = await api(`/api/inventory?warehouse=${encodeURIComponent($('#invWh').value)}&q=${encodeURIComponent($('#invQ').value)}&filter=${filter}&page=${page}`);
    // Chip "Tồn kho" trên thanh đầu dùng CHUNG số tổng hợp toàn kho do server trả kèm (cùng hàm
    // warehouseSummary với bootstrap) → chip, dòng tóm tắt và bảng Tra cứu không bao giờ lệch nhau.
    if (r.warehouseStock && S.boot) { S.boot.warehouseStock = r.warehouseStock; setInvBadge(); }
    $('#cAll').textContent = r.counts.all; $('#cAv').textContent = r.counts.available; $('#cOut').textContent = r.counts.out;
    $('#invMeta').textContent = `Sản phẩm của kho — TỔNG HỢP theo mã từ mọi phiếu Nhập đã ghi (1 mã nhập nhiều lần chỉ hiện 1 dòng). Tồn sổ = Tổng đã nhập − Tổng đã xuất: "Tổng đã nhập" gồm phiếu Nhập + thành phẩm chế biến nhập lại kho; "Tổng đã xuất" gồm xuất kho + nguyên liệu đưa vào chế biến. Phiếu Kiểm kho chỉ để đối chiếu, KHÔNG thay đổi số tồn. Tồn thực tế = Tồn sổ − số đã bán hôm nay (đơn POS đã giao) chưa được trừ khi chốt đối soát. Cập nhật: ${r.syncedAt || '—'}`;
    if (r.summary) $('#invSummary').innerHTML = `Tổng tồn thực tế trong kho: <b>${fmtKg(r.summary.totalQty)}</b> &nbsp;•&nbsp; <b>${r.summary.productCount}</b> mặt hàng đang có tồn <span class="mut">(theo sổ kho${$('#invWh').value ? ' của kho đang chọn' : ''})</span>`;
    const sttOff = (page - 1) * 100; // STT chạy liên tục theo đúng thứ tự đang hiển thị (kể cả khi bấm "Xem thêm")
    const rows = r.items.map((i, idx) => `<tr><td>${sttOff + idx + 1}</td><td>${esc(i.sku || '') || '—'}</td><td>${esc(i.sampleCode || i.code || '') || '—'}</td><td><b>${esc(i.name)}</b><div class="mut">${esc(i.warehouse)}</div></td>
      <td>${esc(i.unit) || '—'}</td>
      <td>${fmtKg(i.totalIn)}</td>
      <td>${fmtKg(i.totalOut)}</td>
      <td><span class="badge ${i.stock > 5 ? 'g' : i.stock > 0 ? 'y' : 'r'}">${fmtKg(i.stock)}</span></td>
      <td><span class="badge ${(i.actualStock ?? i.stock) > 5 ? 'g' : (i.actualStock ?? i.stock) > 0 ? 'y' : 'r'}">${fmtKg(i.actualStock ?? i.stock)}</span>${(i.soldTodayUndeducted || 0) > 0 ? `<div class="mut">đã bán hôm nay chưa trừ: ${fmtKg(i.soldTodayUndeducted)}</div>` : ''}</td></tr>`).join('');
    const html = `<table class="tbl"><tr><th>STT</th><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>ĐVT</th><th>Tổng đã nhập</th><th>Tổng đã xuất</th><th>Tồn sổ</th><th>Tồn thực tế</th></tr>${rows || '<tr><td colspan="9" class="mut">Chưa có sản phẩm nào trong kho. Sản phẩm chỉ xuất hiện tại đây sau khi đã có phiếu NHẬP ghi xuống Sheet (kho độc lập — không lấy danh mục/tồn của POS).</td></tr>'}</table>`;
    if (reset || page === 1) $('#invList').innerHTML = html; else $('#invList').querySelector('tbody').insertAdjacentHTML('beforeend', rows);
    /* Đối chiếu kho POS chính — giữ dữ liệu lần tải này rồi dựng qua renderPc() (công tắc lệch + giới hạn hiển thị) */
    lastPc = r.posCompare || null;
    renderPc();
    $('#invMore').classList.toggle('hidden', r.total <= page * 100);
  }
  let deb; $('#invQ').oninput = () => { clearTimeout(deb); deb = setTimeout(() => load(true), 160); };
  $('#invWh').onchange = () => load(true);
  $$('#view .chip').forEach(c => c.onclick = () => { $$('#view .chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); filter = c.dataset.f; load(true); });
  $('#invMore').onclick = () => { page++; load(false); };
  load(true);
};

/* ---------- Xuất hàng (2 cột; phân loại do ADMIN tuỳ chỉnh trong Cài đặt) ---------- */
VIEWS.outbound = async () => {
  const v = $('#view'); v.className = 'view';
  await loadWhProducts(false); // picker xuất chỉ gồm SẢN PHẨM CỦA KHO (đã từng nhập) — không lấy danh mục POS nữa
  const L = S.boot.lists;
  const cats = (S.boot.exportCategories && S.boot.exportCategories.length) ? S.boot.exportCategories : ['Bán hàng'];
  const catIcon = name => /bán/i.test(name) ? '🛒' : /chuyển/i.test(name) ? '🔄' : /trả/i.test(name) ? '↩️' : /hủy|huỷ/i.test(name) ? '🗑️' : '📦';
  v.innerHTML = `
  <div class="in-grid">
    <div class="card">
      <div class="in-search out-search picker">
        <span class="sic">🔍</span>
        <input class="in" id="outPick" placeholder="Tìm tên hải sản, mã SKU hoặc quét mã vạch cần xuất..." autocomplete="off">
        <div class="picker-list hidden" id="outPickList"></div>
      </div>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="tbl in-tbl out-tbl">
          <thead><tr><th>Sản phẩm xuất kho</th><th>SL Xuất <span class="req">*</span></th><th>ĐVT</th><th>Ghi chú chi tiết</th><th style="width:50px">Xóa</th></tr></thead>
          <tbody id="outRows"></tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="info-head"><b>Thông tin phiếu xuất kho</b><span class="badge-out">XUẤT KHO</span></div>
      <div class="irow"><label>Kho xuất hàng: <span class="req">*</span></label><select class="in" id="outWh">${selOptions(L.warehouses, defWh())}</select></div>
      <div class="irow"><label>Phân loại xuất kho: <span class="req">*</span></label><select class="in" id="outKind">${cats.map(c => `<option value="${esc(c)}">${catIcon(c)} ${esc(c)}</option>`).join('')}</select></div>
      <div class="irow"><label>Nơi nhận / Khách nhận / Khu vực tủ:</label><input class="in" id="outRecv" placeholder="VD: 3 tủ Cửa hàng, Khách sỉ A, Hủy bể..." autocomplete="off"></div>
      <div class="irow"><label>Thời gian xuất (Khóa tự động):</label><div class="locked-in"><span class="lk">🔒</span><input class="in" id="outCreated" disabled value="${fmtAutoTime(new Date())}"></div></div>
      <div class="irow"><label>Nhân viên xuất kho: <span class="req">*</span></label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.name)}</span></div></div>
      <div class="rules-box-pink"><b>Quy trình Vitot Food:</b><br>
      • Phiếu xuất khi lưu sẽ <b>ghi thẳng xuống Google Sheet</b> (tab XUẤT_HÀNG) — không cần quản lí xác nhận, hãy kiểm tra kỹ số lượng trước khi lưu.<br>
      • Sau khi ghi, số liệu trên Sheet là căn cứ bảo toàn số kho.</div>
      <button class="btn primary submit-lg" id="outSubmit" style="margin-top:16px">✓ Lưu phiếu xuất hàng</button>
    </div>
  </div>`;
  const clock = setInterval(() => { const el = $('#outCreated'); if (!el || S.view !== 'outbound') { clearInterval(clock); return; } el.value = fmtAutoTime(new Date()); }, 20000);
  const rowsBox = $('#outRows');
  function renderRows() {
    if (!S.slipLines.length) {
      rowsBox.innerHTML = `<tr><td colspan="5"><div class="in-empty"><span class="box">📤</span>Chưa có sản phẩm nào trong phiếu xuất<div class="sub">Gõ tên sản phẩm hoặc mã SKU vào ô tìm kiếm phía trên để thêm hàng xuất</div></div></td></tr>`;
    } else {
      rowsBox.innerHTML = S.slipLines.map((l, i) => `<tr>
        <td><b>${esc(l.name)}</b>${l.variant ? ' — ' + esc(l.variant) : ''}<div class="mut">${esc(l.sampleCode || '')}</div></td>
        <td><input class="in" type="number" min="0" step="0.01" value="${l.qty ?? ''}" data-q="${i}" placeholder="0"></td>
        <td><select class="in" data-u="${i}">${L.units.map(u => `<option ${u === l.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
        <td><input class="in note-in" type="text" value="${esc(l.note || '')}" data-n="${i}" placeholder="Ghi chú dòng này..." autocomplete="off"></td>
        <td><button class="icon-btn" data-d="${i}" title="Xoá">✕</button></td></tr>`).join('');
      rowsBox.querySelectorAll('[data-q]').forEach(inp => inp.oninput = () => { S.slipLines[+inp.dataset.q].qty = inp.value; });
      rowsBox.querySelectorAll('[data-u]').forEach(s => s.onchange = () => { S.slipLines[+s.dataset.u].unit = s.value; });
      rowsBox.querySelectorAll('[data-n]').forEach(inp => inp.oninput = () => { S.slipLines[+inp.dataset.n].note = inp.value; });
      rowsBox.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.slipLines.splice(+b.dataset.d, 1); renderRows(); });
    }
  }
  productPicker($('#outPick'), $('#outPickList'), { items: S.whProducts, itemHtml: whItemHtml, warehouse: () => $('#outWh').value, emptyMsg: 'Không thấy sản phẩm trong kho đang chọn. Chỉ xuất được sản phẩm kho ĐÃ TỪNG NHẬP — nếu chưa nhập lần nào, hãy tạo phiếu Nhập hàng trước.' }, p => {
    S.slipLines.push({ key: p.posKey || '', name: p.name, variant: '', sampleCode: p.code, warehouse: p.warehouse, unit: p.unit || 'Kg', qty: '', note: '' });
    renderRows();
  });
  renderRows();
  $('#outSubmit').onclick = async () => {
    if (!$('#outWh').value) return alertWarn('Chưa chọn kho xuất hàng', 'Vui lòng chọn kho xuất hàng trước khi lưu phiếu.');
    if (!$('#outKind').value) return alertWarn('Chưa chọn phân loại xuất kho', 'Vui lòng chọn phân loại xuất kho.');
    if (!S.slipLines.length) return alertWarn('Chưa thêm sản phẩm', 'Gõ tên sản phẩm hoặc mã SKU vào ô tìm kiếm phía trên để thêm hàng xuất.');
    if (S.slipLines.some(l => !(Number(l.qty) > 0))) return alertWarn('Thiếu số lượng', 'Có dòng chưa nhập số lượng xuất hợp lệ.');
    try {
      const r = await post('/api/slips', { type: 'out', warehouse: $('#outWh').value, exportType: $('#outKind').value, recipient: $('#outRecv').value.trim(), lines: S.slipLines });
      if (r.slip.writeStatus === 'written') await alertOk('Đã lưu phiếu xuất hàng', `Phiếu ${r.slip.code} đã ghi xuống Sheet.\nNgười tạo: ${r.slip.creatorName} • ${r.slip.createdAt}`);
      else await alertWarn('Đã lưu phiếu, chưa ghi được Sheet', `Phiếu ${r.slip.code} đã lưu trong app nhưng ghi Sheet lỗi: ${r.slip.writeError}\nVào Lịch sử phiếu bấm "Ghi lại" khi đã xử lí xong lỗi.`);
      go('outbound');
    } catch (e) { alertErr('Không lưu được phiếu', e.message); }
  };
};

/* ---------- Nhập hàng (2 cột; danh mục gốc là POS — không tạo sản phẩm trong app) ---------- */
VIEWS.inbound = async () => {
  const v = $('#view'); v.className = 'view';
  await loadProducts(false); // picker Nhập GIỮ danh mục POS — đây là cổng đưa mã MỚI vào kho
  await loadWhProducts(false); // dataset kho: chỉ để hiện thông tin tham khảo "đã nhập tổng / tồn hiện tại" cho mã đã từng nhập
  const L = S.boot.lists;
  // v37: phiếu nhập CÓ ngày về dự kiến = phiếu hàng ĐẶT TRƯỚC — chỉ quản lí (quyền inbound_plan) mới tạo được;
  // nhân viên không có quyền thì không hiện ô nhập ngày (server cũng chặn ở POST /api/slips).
  const canPlan = !!(S.user && S.user.perms && S.user.perms.inbound_plan);
  v.innerHTML = `
  <div class="in-grid">
    <div class="card">
      <div class="in-search picker">
        <span class="sic">🔍</span>
        <input class="in" id="inPick" placeholder="Tìm Tên SP, Mã mẫu hoặc Mã vạch..." autocomplete="off">
        <div class="picker-list hidden" id="inPickList"></div>
      </div>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="tbl in-tbl">
          <thead><tr><th style="width:42px">STT</th><th>Mã mẫu</th><th>Tên sản phẩm</th><th>SL kiểm thực tế</th><th>ĐVT</th><th style="width:50px">Xóa</th></tr></thead>
          <tbody id="inRows"></tbody>
        </table>
      </div>
      <div class="in-foot"><span>Số mặt hàng: <b id="inCnt">0 mã</b></span><span>Tổng SL kiểm: <b id="inTot">0</b></span></div>
    </div>
    <div class="card">
      <div class="info-head"><b>Thông tin phiếu nhập</b><span class="badge-in">NHẬP KHO</span></div>
      <div class="irow"><label>Kho hàng: <span class="req">*</span></label><select class="in" id="inWh">${selOptions(L.warehouses, defWh())}</select></div>
      <div class="irow"><label>Nhà cung cấp: <span class="req">*</span></label>
        <span><input class="in" id="inSup" list="inSupList" placeholder="Chọn hoặc nhập tên NCC..." autocomplete="off">
        <datalist id="inSupList">${L.suppliers.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist></span></div>
      <div class="irow"><label>Ngày tạo phiếu: <span class="req">*</span></label><div class="locked-in"><span class="lk">🔒</span><input class="in" id="inCreated" disabled value="${fmtAutoTime(new Date())}"></div></div>
      ${canPlan
        ? `<div class="irow"><label>Ngày về dự kiến:</label><input class="in" type="date" id="inExpected"></div>`
        : `<div class="irow"><span class="mut">Ngày về dự kiến: chỉ quản lí mới tạo phiếu hàng đặt trước.</span></div>`}
      <div class="irow"><label>Người kiểm: <span class="req">*</span></label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.name)}</span></div></div>
      <button class="btn primary submit-lg" id="inSubmit">✓ Tạo phiếu nhập hàng</button>
      ${canPlan
        ? `<p class="mut" style="margin:10px 0 0">Phiếu tạo xong sẽ ghi thẳng xuống Sheet (tab NHẬP_HÀNG). Nếu có điền "Ngày về dự kiến", phiếu sẽ tự hiện trên màn Lịch (nhãn "Hàng về").</p>`
        : `<p class="mut" style="margin:10px 0 0">Phiếu tạo xong sẽ ghi thẳng xuống Sheet (tab NHẬP_HÀNG). Phiếu hàng đặt trước (có "Ngày về dự kiến", hiện trên màn Lịch) do quản lí tạo.</p>`}
    </div>
  </div>`;
  const clock = setInterval(() => { const el = $('#inCreated'); if (!el || S.view !== 'inbound') { clearInterval(clock); return; } el.value = fmtAutoTime(new Date()); }, 20000);
  const rowsBox = $('#inRows');
  /* Thông tin tham khảo từ dataset kho cho 1 sản phẩm: định danh = mã + TÊN (nhãn gồm biến thể) —
     cùng mã khác tên là 2 sản phẩm khác nhau, chỉ cộng đúng dòng khớp tên; không khớp tên nào thì mới cộng theo mã thuần.
     Ưu tiên đúng kho đang chọn trên phiếu, không có thì cộng mọi kho. */
  function whInfo(code, label) {
    if (!code) return null;
    let es = S.whProducts.filter(w => w.code === code);
    if (!es.length) return null;
    if (label) {
      const nl = String(label).trim().replace(/\s+/g, ' ').toLowerCase();
      const byName = es.filter(w => String(w.name || '').trim().replace(/\s+/g, ' ').toLowerCase() === nl);
      if (byName.length) es = byName;
    }
    const sel = $('#inWh') ? $('#inWh').value : '';
    const inSel = es.filter(w => w.warehouse === sel);
    if (inSel.length) es = inSel;
    return { totalIn: es.reduce((a, e) => a + (Number(e.totalIn) || 0), 0), balance: es.reduce((a, e) => a + (Number(e.balance) || 0), 0) };
  }
  function foot() {
    $('#inCnt').textContent = S.slipLines.length + ' mã';
    const tot = S.slipLines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
    $('#inTot').textContent = (Math.round(tot * 100) / 100).toLocaleString('vi-VN');
  }
  function renderRows() {
    if (!S.slipLines.length) {
      rowsBox.innerHTML = `<tr><td colspan="6"><div class="in-empty"><span class="box">📦</span>Chưa có sản phẩm nào trong phiếu nhập<div class="sub">Gõ tên sản phẩm hoặc mã mẫu vào ô tìm kiếm phía trên</div></div></td></tr>`;
    } else {
      rowsBox.innerHTML = S.slipLines.map((l, i) => { const wi = whInfo(l.whCode, l.variant ? `${l.name} (${l.variant})` : l.name); return `<tr>
        <td>${i + 1}</td>
        <td>${esc(l.sampleCode || '')}</td>
        <td><b>${esc(l.name)}</b>${l.variant ? ' — ' + esc(l.variant) : ''}${wi ? `<div class="mut">Đã nhập tổng: ${fmtKg(wi.totalIn)} · Tồn kho hiện tại: ${fmtKg(wi.balance)}</div>` : ''}</td>
        <td><input class="in" type="number" min="0" step="0.01" value="${l.qty ?? ''}" data-q="${i}" placeholder="0"></td>
        <td><select class="in" data-u="${i}">${L.units.map(u => `<option ${u === l.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
        <td><button class="icon-btn" data-d="${i}" title="Xoá">✕</button></td></tr>`; }).join('');
      rowsBox.querySelectorAll('[data-q]').forEach(inp => inp.oninput = () => { S.slipLines[+inp.dataset.q].qty = inp.value; foot(); });
      rowsBox.querySelectorAll('[data-u]').forEach(s => s.onchange = () => { S.slipLines[+s.dataset.u].unit = s.value; });
      rowsBox.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.slipLines.splice(+b.dataset.d, 1); renderRows(); });
    }
    foot();
  }
  productPicker($('#inPick'), $('#inPickList'), { emptyMsg: 'Không tìm thấy sản phẩm trong danh mục. Danh mục gốc nằm trên POS — hãy báo quản lí thêm sản phẩm trên POS trước; sau khi POS đổ dữ liệu về Sheet và app đồng bộ lại, sản phẩm sẽ xuất hiện tại đây. App không tự tạo sản phẩm.' }, p => {
    S.slipLines.push({ key: p.key, name: p.name, variant: p.variant, sampleCode: p.sampleCode, whCode: p.sampleCode || p.sku || '', warehouse: p.warehouse, unit: 'Kg', qty: '' });
    renderRows();
  });
  $('#inWh').onchange = () => renderRows(); // đổi kho → cập nhật lại thông tin "đã nhập tổng / tồn" theo kho đang chọn
  renderRows();
  $('#inSubmit').onclick = async () => {
    if (!$('#inWh').value) return alertWarn('Chưa chọn kho hàng', 'Vui lòng chọn kho hàng trước khi tạo phiếu.');
    if (!$('#inSup').value.trim()) return alertWarn('Chưa chọn nhà cung cấp', 'Vui lòng chọn hoặc nhập tên nhà cung cấp.');
    if (!S.slipLines.length) return alertWarn('Chưa thêm sản phẩm', 'Gõ tên sản phẩm hoặc mã mẫu vào ô tìm kiếm phía trên để thêm vào phiếu nhập.');
    if (S.slipLines.some(l => !(Number(l.qty) > 0))) return alertWarn('Thiếu số lượng', 'Có dòng chưa nhập số lượng kiểm thực tế hợp lệ.');
    try {
      const expEl = $('#inExpected'); // chỉ tồn tại khi tài khoản có quyền inbound_plan (quản lí)
      const r = await post('/api/slips', { type: 'in', warehouse: $('#inWh').value, supplier: $('#inSup').value.trim(), expectedDate: expEl ? (expEl.value || '') : '', lines: S.slipLines });
      if (r.slip.writeStatus === 'written') await alertOk('Đã tạo phiếu nhập hàng', `Phiếu ${r.slip.code} đã ghi xuống Sheet.\nNgười tạo: ${r.slip.creatorName} • ${r.slip.createdAt}`);
      else await alertWarn('Đã lưu phiếu, chưa ghi được Sheet', `Phiếu ${r.slip.code} đã lưu trong app nhưng ghi Sheet lỗi: ${r.slip.writeError}\nVào Lịch sử phiếu bấm "Ghi lại" khi đã xử lí xong lỗi.`);
      go('inbound');
    } catch (e) { alertErr('Không tạo được phiếu', e.message); }
  };
};

/* ---------- Kiểm kho (MÙ) — bố cục 2 cột như Xuất, màu nhấn tím ---------- */
VIEWS.stocktake = async () => {
  const v = $('#view'); v.className = 'view';
  await loadWhProducts(true); // blind=1: server chỉ trả tên + mã của SẢN PHẨM CỦA KHO (đã từng nhập) — kiểm mù, không lộ số nào
  const L = S.boot.lists;
  const cats = [...new Set(S.whProducts.map(p => p.category).filter(Boolean))];
  const allBlind = [...S.whProducts];
  v.innerHTML = `
  <div class="in-grid">
    <div class="card">
      <div class="in-search check-search picker">
        <span class="sic">🔍</span>
        <input class="in" id="kPick" placeholder="Tìm tên sản phẩm cần kiểm..." autocomplete="off">
        <div class="picker-list hidden" id="kPickList"></div>
      </div>
      <div class="field" style="margin-top:10px"><label class="f">Lọc theo danh mục</label><select class="in" id="kCat"><option value="">Tất cả danh mục</option>${selOptions(cats)}</select></div>
      <div style="overflow-x:auto">
        <table class="tbl in-tbl">
          <thead><tr><th style="width:42px">STT</th><th>Mã SP</th><th>Mã mẫu</th><th>Tên sản phẩm</th><th>SL kiểm thực tế <span class="req">*</span></th><th style="width:50px">Xóa</th></tr></thead>
          <tbody id="kRows"></tbody>
        </table>
      </div>
      <div class="in-foot"><span>Số mặt hàng: <b id="kCnt">0 mã</b></span></div>
    </div>
    <div class="card">
      <div class="info-head"><b>Thông tin phiếu kiểm kho</b><span class="badge-check">KIỂM KHO</span></div>
      <div class="irow"><label>Kho kiểm hàng: <span class="req">*</span></label><select class="in" id="kWh">${selOptions(L.warehouses, defWh())}</select></div>
      <div class="irow"><label>Thời gian kiểm (Khóa tự động):</label><div class="locked-in"><span class="lk">🔒</span><input class="in" id="kCreated" disabled value="${fmtAutoTime(new Date())}"></div></div>
      <div class="irow"><label>Người kiểm: <span class="req">*</span></label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.name)}</span></div></div>
      <div class="rules-box-purple"><b>Quy định kiểm kho Vitot Food:</b><br>
      • Đây là <b>kiểm mù</b>: chỉ nhập số lượng kiểm thực tế tại kho — app không hiển thị tồn hệ thống khi kiểm.<br>
      • Chênh lệch (nếu có) chỉ quản lí xem được khi đối chiếu trên Sheet.</div>
      <div class="field" style="margin-top:12px"><label class="f">Ghi chú</label><textarea class="in" id="kNote" rows="2"></textarea></div>
      <button class="btn primary submit-lg" id="kSubmit">✓ Lưu phiếu kiểm kho</button>
    </div>
  </div>`;
  const clock = setInterval(() => { const el = $('#kCreated'); if (!el || S.view !== 'stocktake') { clearInterval(clock); return; } el.value = fmtAutoTime(new Date()); }, 20000);
  const rowsBox = $('#kRows');
  function renderRows() {
    $('#kCnt').textContent = S.slipLines.length + ' mã';
    if (!S.slipLines.length) {
      rowsBox.innerHTML = `<tr><td colspan="6"><div class="in-empty"><span class="box">🧮</span>Chưa có sản phẩm nào trong phiếu kiểm<div class="sub">Gõ tên sản phẩm vào ô tìm kiếm phía trên để thêm vào danh sách kiểm</div></div></td></tr>`;
    } else {
      rowsBox.innerHTML = S.slipLines.map((l, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(l.sku || '') || '—'}</td>
        <td>${esc(l.sampleDisp || l.sampleCode || '') || '—'}</td>
        <td><b>${esc(l.name)}</b>${l.variant ? ' — ' + esc(l.variant) : ''}</td>
        <td><input class="in" type="number" min="0" step="0.01" value="${l.counted ?? ''}" data-q="${i}" placeholder="Đếm thực tế"></td>
        <td><button class="icon-btn" data-d="${i}" title="Xoá">✕</button></td></tr>`).join('');
      rowsBox.querySelectorAll('[data-q]').forEach(inp => inp.oninput = () => { S.slipLines[+inp.dataset.q].counted = inp.value; });
      rowsBox.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.slipLines.splice(+b.dataset.d, 1); renderRows(); });
    }
  }
  const kOpts = { items: allBlind, itemHtml: whBlindHtml, warehouse: () => $('#kWh').value, emptyMsg: 'Không thấy sản phẩm trong kho đang chọn. Chỉ kiểm được sản phẩm kho ĐÃ TỪNG NHẬP — mã chưa nhập lần nào sẽ không có trong danh sách kiểm.' };
  productPicker($('#kPick'), $('#kPickList'), kOpts, p => {
    if (S.slipLines.some(l => l.sampleCode === p.code && l.name === p.name)) return toast('Sản phẩm đã có trong danh sách kiểm.');
    S.slipLines.push({ key: p.posKey || '', name: p.name, variant: '', sampleCode: p.code, sku: p.sku || '', sampleDisp: p.sampleCode || p.code || '', counted: '' }); renderRows();
  });
  $('#kCat').onchange = () => { const c = $('#kCat').value; kOpts.items = c ? allBlind.filter(p => p.category === c) : allBlind; };
  renderRows();
  $('#kSubmit').onclick = async () => {
    if (!$('#kWh').value) return alertWarn('Chưa chọn kho kiểm', 'Vui lòng chọn kho cần kiểm.');
    if (!S.slipLines.length) return alertWarn('Chưa chọn sản phẩm', 'Hãy chọn ít nhất 1 sản phẩm từ danh sách kho để kiểm.');
    if (S.slipLines.some(l => l.counted === '' || l.counted == null)) return alertWarn('Thiếu số đếm', 'Có sản phẩm chưa nhập số lượng đếm thực tế.');
    try {
      const r = await post('/api/slips', { type: 'check', warehouse: $('#kWh').value, note: $('#kNote').value, lines: S.slipLines });
      if (r.slip.writeStatus === 'written') await alertOk('Đã tạo phiếu kiểm kho', `Phiếu ${r.slip.code} đã ghi xuống Sheet.\nNgười kiểm: ${r.slip.creatorName} • ${r.slip.createdAt}`);
      else await alertWarn('Đã lưu phiếu, chưa ghi được Sheet', `Phiếu ${r.slip.code} đã lưu trong app nhưng ghi Sheet lỗi: ${r.slip.writeError}\nVào Lịch sử phiếu bấm "Ghi lại" khi đã xử lí xong lỗi.`);
      go('stocktake');
    } catch (e) { alertErr('Không tạo được phiếu', e.message); }
  };
};

/* ---------- Chế biến / Sơ chế (3 khối đầu vào + phân tích hiệu suất mẻ) ---------- */
const DISCARD_REASONS = ['Hàng chết / ươn', 'Vỡ nát, dập hỏng', 'Không đạt trọng lượng / kích cỡ', 'Hư hỏng do bảo quản', 'Lý do khác'];
VIEWS.processing = async () => {
  const v = $('#view'); v.className = 'view';
  await loadProducts(false); // danh mục POS — chỉ còn dùng cho picker THÀNH PHẨM khi là mã mới chưa từng nhập
  await loadWhProducts(false); // sản phẩm của kho — nguồn cho picker nguyên liệu + mặc định của picker thành phẩm
  const L = S.boot.lists;
  let ing = null, fin = null;
  v.innerHTML = `
  <div class="in-grid">
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <div class="card">
        <div class="info-head"><b>1. Nguyên liệu sống xuất chế biến</b><span class="badge-amber">ĐẦU VÀO (KG)</span></div>
        <div class="field picker"><label class="f">Chọn mặt hàng hải sản sống trong kho (chỉ mã đã từng nhập)</label>
          <input class="in" id="cbIngPick" placeholder="Gõ tên / mã để tìm trong kho…" autocomplete="off">
          <div class="picker-list hidden" id="cbIngList"></div></div>
        <div class="field"><div class="locked"><span class="lk">🔒</span><span id="cbIngName">Chưa chọn nguyên liệu</span></div></div>
        <div class="grid2">
          <div class="field" style="margin-bottom:0"><label class="f">Tổng trọng lượng xuất chế biến (Kg) <span class="req">*</span></label><input class="in" id="cbInQty" type="number" min="0" step="0.01" placeholder="0"></div>
          <div class="field" style="margin-bottom:0"><label class="f">Tồn thực tế trong kho</label><div class="locked"><span class="lk">🔒</span><span id="cbIngStock">—</span></div></div>
        </div>
      </div>
      <div class="card">
        <div class="info-head"><b>2. Thành phẩm đạt chuẩn bán ra</b><span class="badge-green">DÙNG ĐƯỢC</span></div>
        <div class="field picker"><label class="f">Chọn mã thành phẩm (VD: Cua hấp) — mặc định sản phẩm của kho; mã mới chưa từng nhập thì tìm trong danh mục POS</label>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <button class="chip active" id="cbFinSrcWh" type="button">Sản phẩm của kho</button>
            <button class="chip" id="cbFinSrcPos" type="button">Danh mục POS (mã mới)</button>
          </div>
          <input class="in" id="cbFinPick" placeholder="Gõ tên / mã để tìm…" autocomplete="off">
          <div class="picker-list hidden" id="cbFinList"></div></div>
        <div class="field"><div class="locked"><span class="lk">🔒</span><span id="cbFinName">Chưa chọn thành phẩm</span></div></div>
        <div class="grid2">
          <div class="field" style="margin-bottom:0"><label class="f">Số lượng nhập bán POS (Con/Khay/Kg)</label><input class="in" id="cbPosQty" type="number" min="0" step="0.01" placeholder="0"></div>
          <div class="field" style="margin-bottom:0"><label class="f">Tổng trọng lượng cân thực tế (Kg)</label><input class="in" id="cbUsable" type="number" min="0" step="0.01" placeholder="0"></div>
        </div>
      </div>
      <div class="card">
        <div class="info-head"><b>3. Hàng hủy / Không đạt chuẩn</b><span class="badge-red">HÀNG HỦY</span></div>
        <div class="grid2">
          <div class="field" style="margin-bottom:0"><label class="f">Trọng lượng hủy bỏ (Kg)</label><input class="in" id="cbDiscard" type="number" min="0" step="0.01" placeholder="0"></div>
          <div class="field" style="margin-bottom:0"><label class="f">Nguyên nhân hủy</label><select class="in" id="cbReason"><option value="">-- Không có hàng hủy --</option>${DISCARD_REASONS.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <div class="card">
        <div class="info-head"><b>Phân tích hiệu suất mẻ</b><span class="badge-in">TỰ ĐỘNG</span></div>
        <div class="cb-stats">
          <div class="cb-stat green"><div class="cb-pct" id="cbPctUse">0%</div><div class="cb-lbl">Dùng được</div><div class="cb-kg" id="cbKgUse">0 Kg</div></div>
          <div class="cb-stat red"><div class="cb-pct" id="cbPctDis">0%</div><div class="cb-lbl">Tỷ lệ hủy</div><div class="cb-kg" id="cbKgDis">0 Kg</div></div>
          <div class="cb-stat amber"><div class="cb-pct" id="cbPctLoss">0%</div><div class="cb-lbl">Hao hụt hấp</div><div class="cb-kg" id="cbKgLoss">0 Kg</div></div>
        </div>
        <div class="cb-bar"><span class="seg-use" id="cbBarUse"></span><span class="seg-dis" id="cbBarDis"></span><span class="seg-loss" id="cbBarLoss"></span></div>
        <p class="mut" style="margin:10px 0 0">Nhập trọng lượng đầu vào &amp; đầu ra để xem định mức. Hao hụt = đầu vào − dùng được − hủy.</p>
      </div>
      <div class="card">
        <div class="info-head"><b>Thông tin phiếu chế biến</b></div>
        <div class="irow"><label>Kho / Khu vực chế biến <span class="req">*</span></label><select class="in" id="cbWh">${selOptions(L.warehouses, defWh())}</select></div>
        <div class="irow"><label>Thời gian thực hiện</label><div class="locked-in"><span class="lk">🔒</span><input class="in" id="cbCreated" disabled value="${fmtAutoTime(new Date())}"></div></div>
        <div class="irow"><label>Nhân viên thực hiện <span class="req">*</span></label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.name)}</span></div></div>
        <div class="field"><label class="f">Ghi chú thêm (Lô hàng / NCC)</label><textarea class="in" id="cbNote" rows="2"></textarea></div>
        <button class="btn primary submit-lg" id="cbSubmit">Lưu phiếu chế biến</button>
      </div>
    </div>
  </div>`;
  const clock = setInterval(() => { const el = $('#cbCreated'); if (!el || S.view !== 'processing') { clearInterval(clock); return; } el.value = fmtAutoTime(new Date()); }, 20000);
  function analyze() {
    const inp = Number($('#cbInQty').value) || 0, use = Number($('#cbUsable').value) || 0, dis = Number($('#cbDiscard').value) || 0;
    const loss = inp - use - dis;
    const pct = x => inp > 0 ? Math.max(0, x / inp * 100) : 0;
    const pctTxt = x => pct(x).toFixed(1).replace('.', ',') + '%';
    $('#cbPctUse').textContent = pctTxt(use);
    $('#cbPctDis').textContent = pctTxt(dis);
    $('#cbPctLoss').textContent = pctTxt(loss);
    $('#cbKgUse').textContent = fmtKg(use) + ' Kg';
    $('#cbKgDis').textContent = fmtKg(dis) + ' Kg';
    $('#cbKgLoss').textContent = fmtKg(Math.max(0, loss)) + ' Kg';
    $('#cbBarUse').style.width = pct(use) + '%';
    $('#cbBarDis').style.width = pct(dis) + '%';
    $('#cbBarLoss').style.width = pct(loss) + '%';
  }
  ['cbInQty', 'cbUsable', 'cbDiscard'].forEach(id => $('#' + id).addEventListener('input', analyze));
  productPicker($('#cbIngPick'), $('#cbIngList'), { items: S.whProducts, itemHtml: whItemHtml, warehouse: () => $('#cbWh').value, emptyMsg: 'Không thấy nguyên liệu trong kho đang chọn. Nguyên liệu chỉ lấy từ sản phẩm kho ĐÃ TỪNG NHẬP — hãy tạo phiếu Nhập hàng trước.' }, p => {
    ing = p;
    $('#cbIngName').textContent = `${p.name} (${p.code || ''})`;
    $('#cbIngStock').textContent = fmtKg(Number(p.balance) || 0) + (p.unit ? ' ' + p.unit : '');
  });
  /* Thành phẩm: 2 nguồn — mặc định sản phẩm của kho; chip "Danh mục POS" khi thành phẩm là mã mới chưa từng nhập */
  let finSrc = 'wh';
  const finOpts = { items: S.whProducts, itemHtml: whItemHtml, warehouse: () => $('#cbWh').value, emptyMsg: 'Không thấy thành phẩm trong kho đang chọn. Nếu là mã MỚI chưa từng nhập, bấm chip "Danh mục POS (mã mới)" ở trên để tìm.' };
  productPicker($('#cbFinPick'), $('#cbFinList'), finOpts, p => {
    fin = finSrc === 'wh'
      ? { fromWh: true, code: p.code, name: p.name, key: '' }
      : { fromWh: false, key: p.key, name: p.name, variant: p.variant, sampleCode: p.sampleCode };
    $('#cbFinName').textContent = finSrc === 'wh' ? `${p.name} (${p.code || ''})` : `${p.name}${p.variant ? ' — ' + p.variant : ''} (${p.sampleCode || ''})`;
  });
  const setFinSrc = src => {
    finSrc = src; fin = null;
    $('#cbFinName').textContent = 'Chưa chọn thành phẩm';
    $('#cbFinSrcWh').classList.toggle('active', src === 'wh');
    $('#cbFinSrcPos').classList.toggle('active', src === 'pos');
    if (src === 'wh') { finOpts.items = S.whProducts; finOpts.itemHtml = whItemHtml; finOpts.warehouse = () => $('#cbWh').value; finOpts.emptyMsg = 'Không thấy thành phẩm trong kho đang chọn. Nếu là mã MỚI chưa từng nhập, bấm chip "Danh mục POS (mã mới)" ở trên để tìm.'; }
    else { finOpts.items = S.products; finOpts.itemHtml = null; finOpts.warehouse = undefined; finOpts.emptyMsg = 'Không tìm thấy trong danh mục POS. Danh mục gốc nằm trên POS — hãy báo quản lí thêm sản phẩm trên POS trước.'; }
  };
  $('#cbFinSrcWh').onclick = () => setFinSrc('wh');
  $('#cbFinSrcPos').onclick = () => setFinSrc('pos');
  analyze();
  $('#cbSubmit').onclick = async () => {
    if (!$('#cbWh').value) return alertWarn('Chưa chọn kho chế biến', 'Vui lòng chọn kho / khu vực chế biến.');
    if (!ing) return alertWarn('Chưa chọn nguyên liệu', 'Hãy chọn mặt hàng hải sản sống trong kho ở khối 1.');
    if (!(Number($('#cbInQty').value) > 0)) return alertWarn('Thiếu trọng lượng đầu vào', 'Hãy nhập tổng trọng lượng xuất chế biến (Kg) ở khối 1.');
    if ((Number($('#cbDiscard').value) || 0) > 0 && !$('#cbReason').value) return alertWarn('Chưa chọn nguyên nhân hủy', 'Đã nhập trọng lượng hủy bỏ — hãy chọn nguyên nhân hủy ở khối 3.');
    try {
      const r = await post('/api/slips', { type: 'process', warehouse: $('#cbWh').value, note: $('#cbNote').value.trim(), lines: [{ key: ing.posKey || '', sampleCode: ing.code || '', name: ing.name || '', inputQty: Number($('#cbInQty').value) || 0, usable: Number($('#cbUsable').value) || 0, discard: Number($('#cbDiscard').value) || 0, finishedKey: fin && !fin.fromWh ? fin.key : '', finishedSku: fin && fin.fromWh ? fin.code : '', finishedName: fin && fin.fromWh ? fin.name : '', posQty: Number($('#cbPosQty').value) || 0, reason: $('#cbReason').value }] });
      if (r.slip.writeStatus === 'written') await alertOk('Đã lưu phiếu chế biến', `Phiếu ${r.slip.code} đã ghi xuống Sheet.\nNgười thực hiện: ${r.slip.creatorName} • ${r.slip.createdAt}`);
      else await alertWarn('Đã lưu phiếu, chưa ghi được Sheet', `Phiếu ${r.slip.code} đã lưu trong app nhưng ghi Sheet lỗi: ${r.slip.writeError}\nVào Lịch sử phiếu bấm "Ghi lại" khi đã xử lí xong lỗi.`);
      go('processing');
    } catch (e) { alertErr('Không lưu được phiếu', e.message); }
  };
};

/* ---------- Đối soát đơn (quét mù, GỌN) — súng quét giữ focus; camera quét liên tục QR + mã vạch 1D ---------- */
/* Âm thanh quét: dùng 1 AudioContext DÙNG CHUNG. Trình duyệt (nhất là iOS/webview Messenger) chặn
   AudioContext tạo ngoài thao tác chạm — nên phải khởi tạo/resume ngay trong thao tác bấm nút mở
   camera / bấm Thêm / Enter (ensureAudio), sau đó beepOk chỉ việc phát. Lỗi âm thanh không được làm hỏng luồng quét. */
let audioCtx = null;
function ensureAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
  } catch {}
}
function beepOk() {
  try {
    ensureAudio();
    if (audioCtx) {
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.18, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      o.start(t0); o.stop(t0 + 0.16);
    }
  } catch {}
  try { if (navigator.vibrate) navigator.vibrate(70); } catch {}
}
VIEWS.recon = async () => {
  const v = $('#view'); v.className = 'view';
  const L = S.boot.lists;
  v.innerHTML = `<div class="card" style="padding:12px;margin-bottom:12px">
      <b>🛒 Bán hôm nay</b> <span class="mut">— hàng đã bán theo đơn POS hôm nay (tự trừ vào kho khi chốt phiên đối soát)</span>
      <div id="rSalesBody" style="margin-top:8px">Đang tải…</div>
    </div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px" id="reconGrid">
    <div class="card" style="padding:12px">
      <label class="f" style="margin-bottom:5px">Quét / nhập mã đơn hàng</label>
      <div style="display:flex;gap:7px">
        <input class="in scan-input" id="rCode" placeholder="Nhập ID đơn hàng hoặc bắn súng…" autocomplete="off" style="flex:1">
        <button class="btn primary" id="rAdd" style="height:36px">+ Thêm</button>
        <button class="btn" id="rScan" style="height:36px">📷 Quét QR / Mã vạch</button>
      </div>
      <div class="recon-video-wrap hidden" id="rVideoWrap">
        <video id="rVideo" playsinline webkit-playsinline autoplay muted disablepictureinpicture></video>
        <button class="btn danger recon-close" id="rScanClose">✕ Đóng camera</button>
      </div>
      <div style="margin-top:10px"><label class="f">Danh sách đã quét (<span id="rCount">0</span> đơn)</label><div id="rList"></div>
      <div class="mut" style="margin-top:4px">Tổng: <b id="rTotal">0</b> đơn</div></div>
    </div>
    <div class="card" style="padding:12px">
      <div class="field" style="margin-bottom:10px"><label class="f">Kho xuất hàng</label><select class="in" id="rWh">${selOptions(L.warehouses, defWh())}</select></div>
      ${lockedFields()}
      <div class="rules-box" style="padding:10px 12px"><b>Quy định đối soát Vitot Food</b><br>
      • Quét đủ 100% đơn trước khi gửi.<br>• Không nhìn trước danh sách đơn trên POS — quét theo hàng thực tế tại kho.<br>• Quét trùng sẽ được hỏi xác nhận trước khi thêm.</div>
      <button class="btn primary big" id="rSubmit" style="margin-top:12px">Xác nhận &amp; Gửi đối soát</button>
    </div>
  </div>
  <div class="card" style="margin-top:12px"><b>Các phiên đối soát gần đây</b><div id="rSessions"></div></div>
  <style>@media(max-width:860px){#reconGrid{grid-template-columns:1fr!important}}</style>`;
  const listBox = $('#rList');
  const input = $('#rCode');
  function refreshList() {
    $('#rCount').textContent = S.reconCodes.length;
    $('#rTotal').textContent = S.reconCodes.length;
    // Mã xuất hiện ≥2 lần = TRÙNG → mọi chip của mã đó nền đỏ cho dễ nhận biết
    const counts = {};
    S.reconCodes.forEach(c => counts[c] = (counts[c] || 0) + 1);
    listBox.innerHTML = S.reconCodes.map((c, i) => `<span class="recon-chip${counts[c] > 1 ? ' dup' : ''}"><span class="rc-n">${i + 1}</span><b>${esc(c)}</b><button class="rc-x" data-i="${i}" title="Xoá mã này">✕</button></span>`).join('') || '<p class="mut" style="margin:4px 0">Chưa quét đơn nào.</p>';
    listBox.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { S.reconCodes.splice(+b.dataset.i, 1); refreshList(); input.focus(); });
  }
  function focusInput() { setTimeout(() => { if (S.view === 'recon') input.focus(); }, 30); }
  /* Thêm 1 mã: trùng thì HỎI XÁC NHẬN trước (đồng ý mới thêm dòng trùng), camera tạm dừng trong lúc hỏi */
  async function handleCode(raw) {
    const c = String(raw || '').trim();
    if (!c || S.reconBusy) return;
    if (S.reconCodes.includes(c)) {
      S.reconBusy = true;
      const ok = await showConfirm('Mã đơn đã quét', `Mã đơn ${c} đã có trong danh sách đối soát.\nThêm trùng thêm một lần nữa?`);
      S.reconBusy = false;
      if (ok) { S.reconCodes.push(c); refreshList(); beepOk(); }
      focusInput();
      return;
    }
    S.reconCodes.push(c); refreshList(); beepOk(); focusInput();
  }
  function addFromInput() { ensureAudio(); const c = input.value; input.value = ''; handleCode(c); }
  $('#rAdd').onclick = addFromInput;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });
  input.addEventListener('blur', () => { setTimeout(() => { if (S.view === 'recon' && !S.reconBusy && !camOn) input.focus(); }, 250); });
  focusInput();
  /* --- Camera: BarcodeDetector nếu có; không có thì nạp ZXing (CDN) làm dự phòng --- */
  let camOn = false, camStream = null, detTimer = null, zxingReader = null, lastCam = { code: '', at: 0 };
  /* Chống iOS bật trình phát TOÀN MÀN HÌNH gốc: thẻ video phải đủ bộ thuộc tính phát nội tuyến
     (playsinline + webkit-playsinline cho iOS cũ/webview + autoplay + muted) và set cả property
     tương ứng bằng JS TRƯỚC khi play(). TUYỆT ĐỐI không dùng API toàn màn hình ở bất cứ đâu —
     hộp camera là hộp nội tuyến cao 200px (CSS .recon-video-wrap), video chỉ lấp đầy hộp đó. */
  function prepareInlineVideo(video) {
    try {
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.setAttribute('disablepictureinpicture', '');
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.disablePictureInPicture = true;
    } catch {}
  }
  async function stopCam() {
    camOn = false;
    if (detTimer) { clearInterval(detTimer); detTimer = null; }
    if (zxingReader) { try { zxingReader.reset(); } catch {} zxingReader = null; }
    if (camStream) { camStream.getTracks().forEach(x => x.stop()); camStream = null; }
    const vv = $('#rVideo');
    if (vv) { try { vv.pause(); } catch {} try { vv.srcObject = null; } catch {} }
    $('#rVideoWrap').classList.add('hidden');
  }
  function camDetect(raw) {
    const now = Date.now();
    if (raw === lastCam.code && now - lastCam.at < 4000) return; // chống lặp ngay cùng 1 mã đang chĩa vào
    lastCam = { code: raw, at: now };
    handleCode(raw);
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  $('#rScan').onclick = async () => {
    ensureAudio(); // mở khoá âm thanh ngay trong thao tác chạm (trình duyệt chặn AudioContext ngoài cử chỉ người dùng)
    if (camOn) { stopCam(); return; }
    const video = $('#rVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alertWarn('Thiết bị không hỗ trợ camera', 'Trình duyệt này không mở được camera. Bạn vẫn quét được bằng máy quét mã vạch hoặc gõ tay mã đơn.');
    try {
      if ('BarcodeDetector' in window) {
        prepareInlineVideo(video);
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = camStream;
        $('#rVideoWrap').classList.remove('hidden');
        await video.play();
        camOn = true;
        const det = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e'] });
        detTimer = setInterval(async () => {
          if (!camOn || S.reconBusy) return; // tạm dừng khi đang chờ xác nhận trùng
          try { const codes = await det.detect(video); if (codes.length && codes[0].rawValue) camDetect(codes[0].rawValue); } catch {}
        }, 400);
      } else {
        // Dự phòng ZXing (Safari/iPhone không có BarcodeDetector)
        if (!window.ZXing) await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_39]);
        zxingReader = new ZXing.BrowserMultiFormatReader(hints);
        prepareInlineVideo(video);
        $('#rVideoWrap').classList.remove('hidden');
        camOn = true;
        zxingReader.decodeFromVideoDevice(null, video, (result) => {
          if (!camOn || S.reconBusy) return;
          if (result) camDetect(result.getText());
        });
      }
    } catch (e) {
      camOn = false; stopCam();
      alertErr('Không mở được camera', 'Hãy cấp quyền camera cho trang này rồi thử lại. Bạn vẫn quét được bằng máy quét mã vạch hoặc gõ tay mã đơn.');
    }
  };
  $('#rScanClose').onclick = stopCam;
  $('#rSubmit').onclick = async () => {
    if (!$('#rWh').value) return alertWarn('Chưa chọn kho xuất hàng', 'Vui lòng chọn kho xuất hàng.');
    if (!S.reconCodes.length) return alertWarn('Chưa quét đơn nào', 'Hãy quét ít nhất 1 đơn trước khi gửi đối soát.');
    stopCam();
    try {
      const r = await post('/api/slips', { type: 'recon', warehouse: $('#rWh').value, lines: S.reconCodes.map(code => ({ code })) });
      // v39: tóm tắt TỰ TRỪ KHO của phiên — server trừ theo dòng hàng POS của từng đơn đã quét
      const d = r.deduction;
      const dTxt = d ? (d.error
        ? `\nTrừ kho tự động: KHÔNG chạy được (${d.error}) — báo quản lí kiểm tra.`
        : `\nTrừ kho tự động: đã trừ ${d.deducted} đơn${d.slipCode ? ` (phiếu xuất ${d.slipCode})` : ''} • ${d.alreadyDeducted} đơn đã trừ từ phiên trước • ${d.notDelivered} đơn chưa giao • ${d.noData} đơn chưa có dữ liệu POS • ${d.reviewLines} dòng chưa trừ được (quản lí xử lí).`) : '';
      if (r.slip.writeStatus === 'written') await alertOk('Đã gửi đối soát', `Phiên ${r.slip.code} gồm ${S.reconCodes.length} đơn đã ghi xuống Sheet.\nNgười thực hiện: ${r.slip.creatorName} • ${r.slip.createdAt}${dTxt}`);
      else await alertWarn('Đã lưu phiên, chưa ghi được Sheet', `Phiên ${r.slip.code} đã lưu trong app nhưng ghi Sheet lỗi: ${r.slip.writeError}\nVào Lịch sử phiếu bấm "Ghi lại" khi đã xử lí xong lỗi.${dTxt}`);
      go('recon');
    } catch (e) { alertErr('Không gửi được đối soát', e.message); }
  };
  const h = await api('/api/history?type=recon').catch(() => ({ slips: [] }));
  $('#rSessions').innerHTML = h.slips.length ? h.slips.map(s => `<p style="margin:8px 0"><span class="pill">${esc(s.code)}</span> ${s.lines.length} đơn • ${esc(s.warehouse)} • ${esc(s.creatorName)} • ${esc(s.createdAt)} ${wsPill(s)}</p>`).join('') : '<p class="mut">Chưa có phiên nào.</p>';
  /* v39: thẻ "Bán hôm nay" — số liệu từ /api/sales-today (đơn POS hôm nay đã khớp sản phẩm kho) */
  try {
    const st = await api('/api/sales-today');
    const sb = $('#rSalesBody');
    if (sb && S.view === 'recon') {
      sb.innerHTML = (st.items.length
        ? `<div style="overflow-x:auto"><table class="tbl"><tr><th>Sản phẩm</th><th>Đã bán (đã giao)</th><th>Chờ giao</th></tr>${st.items.map(i => `<tr><td><b>${esc(i.name)}</b>${i.unit ? `<div class="mut">${esc(i.unit)}</div>` : ''}</td><td>${fmtKg(i.qtyOut)}</td><td>${fmtKg(i.qtyPending)}</td></tr>`).join('')}</table></div>`
        : '<p class="mut" style="margin:4px 0">Hôm nay chưa ghi nhận đơn bán nào khớp với sản phẩm kho.</p>')
        + (st.unmatchedCount ? `<div class="mut" style="margin-top:6px">${st.unmatchedCount} dòng hàng chưa khớp được sản phẩm kho — quản lí sẽ xử lí khi đối soát</div>` : '');
    }
  } catch (e) { const sb = $('#rSalesBody'); if (sb) sb.innerHTML = '<p class="mut" style="margin:4px 0">Chưa tải được số bán hôm nay.</p>'; }
  refreshList();
};

/* ---------- Lịch sử phiếu: lọc Loại + Thời gian + Trạng thái ghi Sheet ---------- */
const TYPE_LBL = { in: 'Nhập hàng', out: 'Xuất hàng', check: 'Kiểm kho', process: 'Chế biến', recon: 'Đối soát đơn' };
VIEWS.history = async () => {
  const v = $('#view'); v.className = 'view';
  v.innerHTML = `<div class="card">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;flex:1;min-width:min(520px,100%)">
        <div class="field" style="width:180px;margin-bottom:0"><label class="f">Loại phiếu</label>
        <select class="in" id="hType"><option value="">Tất cả</option>${Object.entries(TYPE_LBL).map(([k, x]) => `<option value="${k}">${x}</option>`).join('')}</select></div>
        <div class="field" style="width:180px;margin-bottom:0"><label class="f">Thời gian</label>
        <select class="in" id="hTime"><option value="all">Tất cả</option><option value="today">Hôm nay</option><option value="7d">7 ngày gần nhất</option><option value="30d">30 ngày gần nhất</option><option value="month">Tháng này</option><option value="custom">Tuỳ chọn…</option></select></div>
        <span id="hCustom" class="hidden" style="display:inline-flex;gap:6px;align-items:center">
          <input class="in" type="date" id="hFrom" style="width:150px"><span class="mut">→</span><input class="in" type="date" id="hTo" style="width:150px">
        </span>
        <div class="field" style="width:190px;margin-bottom:0"><label class="f">Trạng thái ghi Sheet</label>
        <select class="in" id="hWs"><option value="">Tất cả trạng thái</option><option value="written">Đã ghi Sheet</option><option value="unwritten">Chưa ghi Sheet</option><option value="error">Ghi lỗi</option></select></div>
        <button class="btn" id="hClear">Xoá bộ lọc</button>
      </div>
      <div class="hist-total" id="hTotal"><div class="ht-num">Tổng: … phiếu</div></div>
    </div>
    <div id="hList" style="margin-top:12px">Đang tải…</div></div>`;
  function range() {
    const mode = $('#hTime').value, tk = bkkKey(0);
    if (mode === 'today') return { from: tk, to: tk };
    if (mode === '7d') return { from: bkkKey(-6), to: tk };
    if (mode === '30d') return { from: bkkKey(-29), to: tk };
    if (mode === 'month') return { from: tk.slice(0, 8) + '01', to: tk };
    if (mode === 'custom') return { from: $('#hFrom').value || '', to: $('#hTo').value || '' };
    return { from: '', to: '' };
  }
  async function load() {
    const { from, to } = range();
    const q = new URLSearchParams({ type: $('#hType').value, writeStatus: $('#hWs').value });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const r = await api('/api/history?' + q.toString());
    const slips = r.slips;
    // Ô tổng góc phải: đếm theo ĐÚNG bộ lọc hiện tại + phân rã theo loại phiếu
    const brk = Object.keys(TYPE_LBL).map(t => `${TYPE_LBL[t]} ${slips.filter(s => s.type === t).length}`).join(' · ');
    $('#hTotal').innerHTML = `<div class="ht-num">Tổng: ${slips.length} phiếu</div><div class="ht-brk">${brk}</div>`;
    $('#hList').innerHTML = slips.length ? slips.map(s => {
      let detail = '';
      if (s.type === 'check') detail = s.lines.map(l => {
        const blind = l.variance === undefined;
        return `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}${l.variant ? ' — ' + esc(l.variant) : ''}</td><td>${l.counted}</td>${blind ? '<td></td><td></td>' : `<td>${l.systemStock}</td><td>${l.variance > 0 ? '+' : ''}${l.variance} <span class="pill ${l.variance === 0 ? '' : 'warn'}">${esc(l.matchStatus)}</span></td>`}</tr>`;
      }).join('');
      else if (s.type === 'recon') detail = s.lines.map((l, i) => `<tr><td>${i + 1}</td><td colspan="3">${esc(l.code)}</td></tr>`).join('');
      else if (s.type === 'process') detail = s.lines.map(l => `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}</td><td>Vào ${l.inputQty} • Dùng được ${l.usable} (${l.usablePct}%) • Loại bỏ ${l.discard} (${l.discardPct}%) • Hao hụt ${l.loss} (${l.lossPct}%)</td></tr>`).join('');
      else detail = s.lines.map(l => `<tr><td>${esc(l.sku || '') || '—'}</td><td>${esc(l.sampleCode || '') || '—'}</td><td>${esc(l.name)}${l.variant ? ' — ' + esc(l.variant) : ''}</td><td>${l.qty} ${esc(l.unit || '')}${l.note ? ' • ' + esc(l.note) : ''}</td></tr>`).join('');
      const wsLine = s.writeStatus === 'written'
        ? `<div class="mut" style="margin-top:4px">Đã ghi lên Sheet${s.writtenAt ? ' lúc ' + esc(s.writtenAt) : ''}</div>`
        : `<div style="margin-top:6px"><span class="pill warn">${s.writeStatus === 'error' ? 'Ghi lỗi' : 'Chưa ghi Sheet'}</span> ${s.writeError ? `<span class="mut">${esc(s.writeError)}</span>` : ''}</div>`;
      // Phiếu THU GỌN kiểu accordion: mặc định chỉ 1 dòng đầu; nút Ghi lại (nếu ghi lỗi) nằm ngay
      // ở dòng đầu để bấm được không cần mở; bấm dòng đầu (trừ nút Ghi lại) mới mở chi tiết.
      const retryBtn = s.writeStatus !== 'written' ? `<button class="btn" data-retry="${s.id}" title="Ghi lại phiếu này xuống Sheet">↻ Ghi lại</button>` : '';
      return `<div class="slip-acc">
        <div class="slip-acc-head" data-acc-head>${slipLinkHTML(s.code, s.type)}<b>${TYPE_LBL[s.type]}</b>
        <span class="mut">${esc(s.warehouse || '')}</span><span class="mut">${esc(s.createdAt)}</span>
        <span class="mut">• ${esc(s.creatorName)}</span>${retryBtn}
        <span style="margin-left:auto">${wsPill(s)}</span><span class="chev">▾</span></div>
        <div class="slip-acc-body">
          <div class="mut">Người tạo: ${esc(s.creatorName)}${s.type === 'in' && s.expectedDate ? ` • Ngày về dự kiến: ${esc(s.expectedDate)}` : ''}${s.type === 'out' && s.exportType ? ` • Phân loại: ${esc(s.exportType)}` : ''}</div>
          ${arrivalLineHTML(s)}
          <table class="tbl" style="margin-top:6px">${s.type === 'check' ? '<tr><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Đếm thực tế</th><th>Tồn hệ thống</th><th>Chênh lệch</th></tr>' : s.type === 'process' ? '<tr><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Chi tiết</th></tr>' : s.type === 'recon' ? '' : '<tr><th>Mã SP</th><th>Mã mẫu</th><th>Sản phẩm</th><th>Số lượng / Ghi chú</th></tr>'}${detail}</table>
          ${wsLine}
        </div>
      </div>`;
    }).join('') : '<p class="mut">Không có phiếu nào khớp bộ lọc.</p>';
    $$('#hList [data-acc-head]').forEach(h => h.onclick = e => {
      if (e.target.closest('[data-retry]')) return; // bấm Ghi lại thì không mở/thu phiếu
      h.parentElement.classList.toggle('open');
    });
    wireSlipLinks($('#hList')); // bấm mã phiếu → mở modal chi tiết phiếu gốc (v33)
    wireArrivalButtons($('#hList'), load); // v36: xác nhận / huỷ xác nhận nhận hàng ngay trong Lịch sử
    $$('#hList [data-retry]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { const r = await post(`/api/slips/${encodeURIComponent(b.dataset.retry)}/retry-write`); await alertOk('Đã ghi lại thành công', `Phiếu ${r.slip.code} đã ghi xuống Sheet lúc ${r.slip.writtenAt}.`); load(); }
      catch (e) { alertErr('Ghi lại thất bại', e.message); load(); }
    });
  }
  $('#hType').onchange = load;
  $('#hWs').onchange = load;
  $('#hTime').onchange = () => { $('#hCustom').classList.toggle('hidden', $('#hTime').value !== 'custom'); load(); };
  $('#hFrom').onchange = load;
  $('#hTo').onchange = load;
  $('#hClear').onclick = () => { $('#hType').value = ''; $('#hTime').value = 'all'; $('#hWs').value = ''; $('#hCustom').classList.add('hidden'); load(); };
  load();
};

/* ---------- Lịch: hàng về từ phiếu nhập + sự kiện kiểu Google Calendar ---------- */
VIEWS.calendar = async () => {
  const v = $('#view'); v.className = 'view';
  let evEdit = null; // sự kiện đang sửa bằng form INLINE trong panel ngày (null = đang ở chế độ thêm mới)
  let evOpen = false; // form sự kiện đang XỔ XUỐNG (dropdown) trong panel ngày — mặc định thu gọn (v30)
  if (!S.calSel) {
    const now = new Date(); S.calY = now.getFullYear(); S.calM = now.getMonth(); S.calSel = bkkKey(0);
  }
  v.innerHTML = `<div class="card">
    <div class="cal-head">
      <button class="btn" id="calPrev">‹ Tháng trước</button>
      <b id="calTitle"></b>
      <button class="btn" id="calToday">Hôm nay</button>
      <button class="btn" id="calNext">Tháng sau ›</button>
    </div>
    <div class="cal-grid" id="calDow">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid" id="calGrid"></div>
    <div style="display:flex;gap:16px;margin-top:8px" class="mut">
      <span><span class="cal-dot arr" style="display:inline-block;vertical-align:-1px"></span> Hàng về (từ phiếu nhập)</span>
      <span><span class="cal-dot evt" style="display:inline-block;vertical-align:-1px"></span> Sự kiện</span>
    </div>
  </div>
  <div class="card" style="margin-top:12px"><b id="calDayTitle"></b><div id="calDayBody" style="margin-top:8px"></div></div>`;
  function gridRange() {
    const first = new Date(S.calY, S.calM, 1);
    const startOffset = (first.getDay() + 6) % 7; // thứ 2 là đầu tuần
    const start = new Date(S.calY, S.calM, 1 - startOffset);
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); cells.push(d); }
    const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { cells, key, from: key(cells[0]), to: key(cells[41]) };
  }
  async function load() {
    evEdit = null; evOpen = false; // đổi tháng/ngày → form sự kiện thu gọn lại, quay về chế độ thêm mới
    const { cells, key, from, to } = gridRange();
    $('#calTitle').textContent = `Tháng ${S.calM + 1}/${S.calY}`;
    try { S.calData = await api(`/api/calendar?from=${from}&to=${to}`); } catch { S.calData = { arrivals: [], events: [] }; }
    const arrByDay = {}, evByDay = {};
    for (const a of S.calData.arrivals) (arrByDay[a.date] = arrByDay[a.date] || []).push(a);
    for (const e of S.calData.events) (evByDay[e.date] = evByDay[e.date] || []).push(e);
    const tk = bkkKey(0);
    $('#calGrid').innerHTML = cells.map(d => {
      const k = key(d);
      const dayArrs = arrByDay[k] || [];
      const na = dayArrs.length, ne = (evByDay[k] || []).length;
      const maxOver = dayArrs.reduce((a, x) => Math.max(a, x.overdueDays || 0), 0); // v36: quá hạn lâu nhất trong ngày
      const dots = [];
      if (na) dots.push(`<span class="cal-dot arr"></span><span class="cal-cnt">${na} hàng về</span>`);
      if (maxOver) dots.push(`<span class="cal-dot over"></span><span class="cal-cnt over">Quá hạn ${maxOver} ngày</span>`);
      if (ne) dots.push(`<span class="cal-dot evt"></span><span class="cal-cnt">${ne} sự kiện</span>`);
      return `<button class="cal-day ${d.getMonth() !== S.calM ? 'dim' : ''} ${k === tk ? 'today' : ''} ${k === S.calSel ? 'sel' : ''}" data-day="${k}" ${d.getMonth() !== S.calM ? 'disabled' : ''}>
        <span class="dn">${d.getDate()}</span><div class="cal-dots">${dots.join('')}</div></button>`;
    }).join('');
    $$('#calGrid [data-day]').forEach(b => b.onclick = () => { S.calSel = b.dataset.day; load(); });
    renderDay();
  }
  function renderDay() {
    const k = S.calSel;
    const [y, m, d] = k.split('-');
    $('#calDayTitle').textContent = `Ngày ${d}/${m}/${y}`;
    const arrs = S.calData.arrivals.filter(a => a.date === k);
    const evs = S.calData.events.filter(e => e.date === k);
    let html = '';
    for (const a of arrs) {
      html += `<div class="cal-item"><span class="cal-tag arr">Hàng về</span>${a.overdueDays ? ` <span class="cal-tag over">Quá hạn ${a.overdueDays} ngày</span>` : ''} <b>${esc(a.code)}</b> <span class="mut">${esc(a.supplier || '')} • ${esc(a.warehouse || '')}</span>
        <div class="mut" style="margin-top:3px">${a.lines.map(l => `${esc(l.name)}: ${l.qty} ${esc(l.unit || '')}`).join(' • ') || '—'}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-arr="${esc(a.slipId)}">Xem chi tiết phiếu</button><button class="btn primary" data-arr-confirm="${esc(a.code)}">✓ Xác nhận đã nhận</button></div></div>`;
    }
    for (const e of evs) {
      html += `<div class="cal-item"><span class="cal-tag evt">Sự kiện</span> <b>${esc(e.title)}</b>${e.time ? ` <span class="mut">${esc(e.time)}</span>` : ''}
        ${e.note ? `<div class="mut" style="margin-top:3px">${esc(e.note)}</div>` : ''}
        <div class="mut" style="margin-top:3px">Người tạo: ${esc(e.creatorName || '')}</div>
        ${e.canEdit ? `<div style="margin-top:6px;display:flex;gap:6px"><button class="btn" data-ev-edit="${e.id}">Sửa</button><button class="btn danger" data-ev-del="${e.id}">Xoá</button></div>` : ''}</div>`;
    }
    if (!arrs.length && !evs.length) html += '<p class="mut">Ngày này chưa có hàng về hay sự kiện nào.</p>';
    /* Form sự kiện dạng DROPDOWN trong panel ngày (v30): chỉ MỘT nút "+ Thêm sự kiện" — bấm để xổ
       form xuống, bấm lại (hoặc nút Đóng/Huỷ sửa trong form) thì thu gọn. Không dùng hộp thoại modal. */
    const evF = evEdit;
    const formOpen = !!(evF || evOpen);
    const canManage = !!(S.calData && S.calData.canManage); // v36: chỉ người có quyền "Quản lí lịch" mới thấy nút thêm + form sự kiện
    if (canManage) html += `<button class="btn primary" id="calAddEv" style="margin-top:4px">+ Thêm sự kiện ${formOpen ? '▴' : '▾'}</button>`;
    if (canManage && formOpen) html += `<div class="cal-ev-form" id="calEvForm">
      <b>${evF ? 'Sửa sự kiện' : 'Thêm sự kiện'}</b>
      <div class="field" style="margin-top:8px"><label class="f">Tiêu đề *</label><input class="in" id="calEvTitle" placeholder="VD: Nhận hàng cua từ NCC A" value="${evF ? esc(evF.title) : ''}"></div>
      <div class="grid2">
        <div class="field"><label class="f">Ngày *</label><input class="in" type="date" id="calEvDate" value="${evF ? esc(evF.date) : k}"></div>
        <div class="field"><label class="f">Giờ (tuỳ chọn)</label><input class="in" type="time" id="calEvTime" value="${evF ? esc(evF.time || '') : ''}"></div>
      </div>
      <div class="field"><label class="f">Ghi chú</label><textarea class="in" id="calEvNote" rows="2">${evF ? esc(evF.note || '') : ''}</textarea></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="calEvSave">${evF ? 'Lưu thay đổi' : 'Lưu'}</button>
        <button class="btn" id="calEvCancel">${evF ? 'Huỷ sửa' : 'Đóng'}</button>
      </div>
    </div>`;
    $('#calDayBody').innerHTML = html;
    $$('#calDayBody [data-arr]').forEach(b => b.onclick = async () => {
      const a = arrs.find(x => x.slipId === b.dataset.arr);
      if (!a) return;
      alertInfo('Chi tiết phiếu nhập ' + a.code, `Nhà cung cấp: ${a.supplier || '—'}\nKho: ${a.warehouse || '—'}\nNgười tạo: ${a.creatorName || '—'}\nNgày về dự kiến: ${a.date}\n\nMặt hàng:\n${a.lines.map(l => `• ${l.name}: ${l.qty} ${l.unit || ''}`).join('\n') || '—'}\n\n(Chỉ xem — muốn sửa hãy vào Lịch sử phiếu / màn Nhập hàng.)`);
    });
    $$('#calDayBody [data-arr-confirm]').forEach(b => b.onclick = () => openArrConfirm(b.dataset.arrConfirm, load)); // v36
    $$('#calDayBody [data-ev-del]').forEach(b => b.onclick = async () => {
      if (!await showConfirm('Xoá sự kiện', 'Bạn chắc chắn muốn xoá sự kiện này?')) return;
      try { await api('/api/calendar-events/' + encodeURIComponent(b.dataset.evDel), { method: 'DELETE' }); toast('Đã xoá sự kiện'); load(); }
      catch (e) { alertErr('Không xoá được', e.message); }
    });
    $$('#calDayBody [data-ev-edit]').forEach(b => b.onclick = () => {
      evEdit = evs.find(x => x.id === b.dataset.evEdit) || null;
      evOpen = true; // bấm "Sửa" → form tự xổ xuống, đã điền sẵn dữ liệu
      renderDay();
      const t = $('#calEvTitle'); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
    });
    const calAddEvBtn = $('#calAddEv');
    if (calAddEvBtn) calAddEvBtn.onclick = () => {
      if (evEdit) { evEdit = null; evOpen = false; renderDay(); return; } // đang sửa mà bấm nút → huỷ sửa + thu gọn
      evOpen = !evOpen;
      renderDay();
      if (evOpen) { const t = $('#calEvTitle'); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); } }
    };
    const evSaveBtn = $('#calEvSave');
    if (evSaveBtn) evSaveBtn.onclick = async () => {
      const body = { title: $('#calEvTitle').value, date: $('#calEvDate').value, time: $('#calEvTime').value, note: $('#calEvNote').value };
      if (!body.title.trim()) return alertWarn('Chưa nhập tiêu đề', 'Hãy nhập tiêu đề sự kiện.');
      if (!body.date) return alertWarn('Chưa chọn ngày', 'Hãy chọn ngày cho sự kiện.');
      try {
        if (evEdit) await api('/api/calendar-events/' + encodeURIComponent(evEdit.id), { method: 'PUT', body: JSON.stringify(body) });
        else await post('/api/calendar-events', body);
        toast(evEdit ? 'Đã lưu sự kiện' : 'Đã thêm sự kiện');
        evEdit = null; evOpen = false; // lưu xong form tự thu gọn
        S.calSel = body.date;
        const [yy, mm] = body.date.split('-').map(Number);
        S.calY = yy; S.calM = mm - 1;
        load();
      } catch (e) { alertErr('Không lưu được sự kiện', e.message); }
    };
    const evCancelBtn = $('#calEvCancel');
    if (evCancelBtn) evCancelBtn.onclick = () => { evEdit = null; evOpen = false; renderDay(); }; // Đóng / Huỷ sửa → thu gọn form
  }
  $('#calPrev').onclick = () => { S.calM--; if (S.calM < 0) { S.calM = 11; S.calY--; } load(); };
  $('#calNext').onclick = () => { S.calM++; if (S.calM > 11) { S.calM = 0; S.calY++; } load(); };
  $('#calToday').onclick = () => { const n = new Date(); S.calY = n.getFullYear(); S.calM = n.getMonth(); S.calSel = bkkKey(0); load(); };
  load();
};

/* ---------- Cài đặt ---------- */
function acc(title, bodyHtml, open) {
  return `<div class="acc ${open ? 'open' : ''}"><button class="acc-head" type="button">${title}<span class="chev">▾</span></button><div class="acc-body"><div class="acc-body-in">${bodyHtml}</div></div></div>`;
}
VIEWS.settings = async () => {
  const v = $('#view'); v.className = 'view';
  const theme = localStorage.getItem('qk-theme') || 'system';
  let html = '';
  html += acc('👤 Tài khoản của tôi', `
    <div class="grid2">
      <div class="field"><label class="f">Tên hiển thị</label><input class="in" id="sMyName" value="${esc(S.user.name)}"></div>
      <div class="field"><label class="f">Mã PIN mới (4 số, để trống nếu không đổi)</label><input class="in" id="sMyPin" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    </div>
    <div class="field"><label class="f">Chức vụ</label><div class="locked"><span class="lk">🔒</span><span>${esc(S.user.role)}</span></div></div>
    <p class="mut">Đổi PIN ở đây sẽ tự cập nhật vào tab CẤU_HÌNH của Google Sheet (cột E).</p>
    <button class="btn primary" id="sMySave">Lưu tài khoản</button>`, true);
  html += acc('🎨 Giao diện & ngôn ngữ', `
    <div class="grid2">
      <div class="field"><label class="f">Chủ đề</label><select class="in" id="sTheme">
        <option value="light" ${theme === 'light' ? 'selected' : ''}>Sáng</option>
        <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Tối</option>
        <option value="system" ${theme === 'system' ? 'selected' : ''}>Theo hệ thống</option></select></div>
      <div class="field"><label class="f">Ngôn ngữ / Language</label><select class="in" id="sLang">
        <option value="vi" ${lang === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
        <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option></select></div>
    </div>`);
  if (S.user.admin) {
    html += acc('👥 Nhân sự & mã PIN', `<div id="sStaff">Đang tải…</div>
      <div class="grid2" style="margin-top:10px">
        <div class="field"><label class="f">Tên nhân viên mới</label><input class="in" id="sNewStaffName"></div>
        <div class="field"><label class="f">PIN (4 số)</label><input class="in" id="sNewStaffPin" maxlength="4" inputmode="numeric"></div>
      </div>
      <div class="field"><label class="f">Chức vụ</label><select class="in" id="sNewStaffRole"></select></div>
      <button class="btn primary" id="sAddStaff">+ Thêm nhân viên</button>`);
    html += acc('🏷️ Chức vụ & phân quyền', `<div class="field"><label class="f">Chọn chức vụ để sửa</label><select class="in" id="sRolePick"></select></div>
      <div id="sRoles">Đang tải…</div>
      <div class="field" style="margin-top:10px"><label class="f">Tên chức vụ mới</label><input class="in" id="sNewRoleName"></div>
      <div class="perm-grid" id="sNewRolePerms"></div>
      <button class="btn primary" id="sAddRole" style="margin-top:10px">+ Thêm chức vụ</button>`);
    html += acc('🚚 Phân loại xuất kho', `
      <p class="mut">Danh sách "Phân loại xuất kho" dùng trong form Xuất hàng. Chỉ ADMIN sửa được; nhân viên chỉ chọn từ danh sách này. Phiếu xuất đã lưu giữ nguyên nhãn phân loại cũ kể cả khi đổi tên/xoá ở đây.</p>
      <div id="sCats">Đang tải…</div>
      <div style="display:flex;gap:8px;margin-top:10px"><input class="in" id="sCatNew" placeholder="Tên phân loại mới, VD: Giao hàng tận nơi" style="flex:1"><button class="btn primary" id="sCatAdd" type="button">+ Thêm</button></div>`);
    html += acc('🏠 Kho mặc định', `
      <p class="mut">Kho được chọn sẵn mỗi khi mở các form Nhập / Xuất / Kiểm kho / Chế biến / Đối soát và màn Tra cứu tồn kho. Người dùng vẫn đổi sang kho khác cho từng phiếu được. Cài đặt được lưu trên máy chủ (tab APP_CAI_DAT của Sheet).</p>
      <div class="field"><label class="f">Kho mặc định</label><select class="in" id="sDefWh">${selOptions(S.boot.lists.warehouses, defWh())}</select></div>
      <button class="btn primary" id="sDefWhSave">Lưu kho mặc định</button>`);
    html += acc('📄 Kết nối Google Sheet (database chính)', `
      <p class="mut">Google Sheet "QUẢN LÍ KHO HÀNG VITOT" là DATABASE CHÍNH của app: tồn kho đọc từ tab TỒN_KHO_POS (POS đổ về), nhân sự/PIN ở tab CẤU_HÌNH, mọi phiếu ghi thẳng vào các tab NHẬP_HÀNG / XUẤT_HÀNG / KIỂM_KHO / CHẾ_BIẾN_SƠ_CHẾ / ĐỐI_SOÁT_ĐƠN (không cần quản lí xác nhận). App không gọi trực tiếp POS.</p>
      <p class="mut" id="sSheetMode">${S.boot.sheet && S.boot.sheet.mode === 'readwrite' ? `✅ Chế độ ĐỌC + GHI — tài khoản dịch vụ: ${esc(S.boot.sheet.saEmail || '')}` : '⚠️ Chế độ CHỈ ĐỌC — máy chủ chưa cấu hình tài khoản dịch vụ Google nên chưa ghi được phiếu. Xem mục "Cài đặt tài khoản dịch vụ" trong tài liệu triển khai.'}</p>
      <div class="field"><label class="f">Link / ID Sheet</label><input class="in" id="sSheetId" value="${esc(S.boot.sheet ? S.boot.sheet.id : '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" id="sSheetSave">Lưu &amp; đồng bộ ngay</button>
        <button class="btn" id="sSheetSync">↻ Đồng bộ lại</button>
        <button class="btn danger" id="sSheetOff">Ngắt kết nối</button>
      </div>
      <p class="mut" id="sSheetMeta">${S.boot.inventoryMeta.count ? `Đã đồng bộ ${S.boot.inventoryMeta.count} sản phẩm • ${esc(S.boot.inventoryMeta.syncedAt)}` : 'Chưa có dữ liệu tồn kho.'}</p>`);
    html += acc('🌐 Mạng công ty (tuỳ chọn)', `
      <p class="mut">Khi bật, app chỉ mở được từ các IP công cộng trong danh sách dưới đây (ví dụ IP mạng tại công ty). Người ở ngoài mạng công ty sẽ thấy trang thông báo và không đăng nhập được. Mặc định: <b>tắt</b>.</p>
      <label style="display:flex;gap:8px;align-items:center;font-weight:600;margin-bottom:12px"><input type="checkbox" id="sIpOn"> Chỉ cho phép dùng app trong mạng công ty</label>
      <div class="field"><label class="f">IP hiện tại của bạn (máy chủ nhìn thấy)</label>
        <div style="display:flex;gap:8px"><div class="locked-in" style="flex:1"><span class="lk">🔒</span><input class="in" id="sIpMine" readonly placeholder="Đang lấy…"></div><button class="btn" id="sIpUseMine" type="button">Dùng IP hiện tại của tôi</button></div></div>
      <label class="f">Danh sách IP / dải CIDR được phép</label>
      <div id="sIpList"></div>
      <div style="display:flex;gap:8px;margin-top:8px"><input class="in" id="sIpNew" placeholder="Ví dụ 113.190.10.5 hoặc 113.190.10.0/24" style="flex:1"><button class="btn" id="sIpAdd" type="button">+ Thêm</button></div>
      <button class="btn primary" id="sIpSave" style="margin-top:12px">Lưu cài đặt mạng</button>
      <p class="mut" style="margin-top:8px">Lưu ý: IP công cộng của công ty có thể thay đổi khi modem khởi động lại — nếu bị khoá ngoài, xem mục "lối thoát khẩn cấp" trong tài liệu triển khai (biến môi trường DISABLE_IP_LOCK=1).</p>`);
    html += acc('🌐 Kết nối tên miền', `
      <p class="mut">Khai báo tên miền riêng để nhân viên truy cập app qua tên miền của công ty. Tên miền <b>xelientinh247.com</b> đăng ký tại <b>TenTen</b>, nhưng DNS được quản lí tại <b>Cloudflare</b> (gói Free): TenTen chỉ còn là nơi đăng ký và trỏ nameserver — mọi bản ghi DNS sửa ở Cloudflare, không sửa ở TenTen. Mục này trong app chỉ <b>khai báo tên miền + kiểm tra trạng thái</b>; chứng chỉ HTTPS (ổ khoá xanh) do <b>Render</b> tự cấp sau khi DNS trỏ đúng.</p>
      <div class="field"><label class="f">Tên miền của app</label>
        <div style="display:flex;gap:8px"><input class="in" id="sDomName" placeholder="kho.xelientinh247.com" style="flex:1"><button class="btn primary" id="sDomSave" type="button">Lưu tên miền</button></div>
        <p class="mut" style="margin-top:6px">Gợi ý mặc định: <b id="sDomSuggest">kho.xelientinh247.com</b> — bạn sửa thành tên miền khác nếu muốn.</p></div>
      <div class="rules-box" style="margin-bottom:12px"><b>Các bước cấu hình DNS tại Cloudflare (làm 1 lần):</b><br>
      <b>Bước 0 — hoàn tất thêm tên miền vào Cloudflare:</b> nếu Cloudflare đang ở trạng thái "Finish setup", hãy vào TenTen → quản trị tên miền <b>xelientinh247.com</b> → đổi <b>Nameserver</b> sang đúng 2 nameserver Cloudflare cấp, rồi đợi Cloudflare báo tên miền <b>Active</b> (vài phút đến vài giờ).<br>
      <b>Bước 1:</b> Vào <b>Cloudflare</b> → chọn tên miền <b>xelientinh247.com</b> → menu <b>DNS → Records</b> → bấm <b>Add record</b>.<br>
      <b>Bước 2:</b> Điền bản ghi:<br>
      • <b>Type:</b> CNAME<br>
      • <b>Name:</b> <b>kho</b> (tức là kho.xelientinh247.com)<br>
      • <b>Target:</b> <b id="sDomTarget">…</b> (địa chỉ hosting Render, dạng &lt;service&gt;.onrender.com)<br>
      • <b>Proxy status:</b> chọn <b>DNS only</b> (tắt đám mây màu cam) — xem ghi chú bên dưới<br>
      • <b>TTL:</b> Auto (mặc định) → bấm <b>Save</b>.<br>
      <b>Bước 3:</b> <b>KHÔNG sửa hay xoá các bản ghi có sẵn khác</b> (MX, TXT, A…) để tránh ảnh hưởng email và các dịch vụ khác của tên miền.<br>
      <b>Bước 4:</b> Đợi DNS cập nhật (thường vài phút) rồi quay lại đây bấm "Kiểm tra kết nối". Render tự cấp HTTPS cho tên miền sau khi trỏ đúng.</div>
      <div class="rules-box" style="margin-bottom:12px"><b>Ghi chú về Proxy (đám mây cam):</b><br>
      • <b>Lần đầu hãy để DNS only (đám mây xám)</b> để Render xác thực tên miền và cấp HTTPS suôn sẻ.<br>
      • Sau khi HTTPS đã chạy ổn: Render <b>khuyến nghị vẫn giữ DNS only</b> — nếu bật proxy (đám mây cam), Cloudflare đứng giữa có thể khiến Render không tự gia hạn được chứng chỉ HTTPS và phát sinh lỗi truy cập. Chỉ bật proxy khi thật sự cần tính năng CDN/chống tấn công của Cloudflare và đã kiểm tra kỹ.<br>
      • Muốn dùng luôn <b>tên miền gốc xelientinh247.com</b>: Cloudflare có sẵn <b>CNAME Flattening</b> — tạo bản ghi CNAME với <b>Name = @</b> trỏ về cùng Target như trên, Cloudflare sẽ tự làm phẳng thành bản ghi A. Nhớ thêm cả tên miền gốc trong Render → Settings → Custom Domains.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn" id="sDomCheck" type="button">Kiểm tra kết nối</button><span id="sDomStatus" style="font-weight:700"></span></div>
      <p class="mut" id="sDomDetail" style="margin-top:8px"></p>`);
  }
  v.innerHTML = html;
  /* Accordion: mở 1 mục thì các mục khác tự thu gọn; chuột rời khỏi mục đang mở ~600ms
     hoặc bấm ra ngoài mục thì mục đang mở cũng tự thu gọn lại. */
  $$('#view .acc').forEach(accEl => {
    const head = accEl.querySelector('.acc-head');
    let leaveTimer = null;
    head.onclick = () => {
      const willOpen = !accEl.classList.contains('open');
      $$('#view .acc.open').forEach(o => { if (o !== accEl) o.classList.remove('open'); });
      accEl.classList.toggle('open', willOpen);
    };
    accEl.addEventListener('mouseenter', () => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } });
    accEl.addEventListener('mouseleave', () => {
      if (!accEl.classList.contains('open')) return;
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => accEl.classList.remove('open'), 600);
    });
  });
  if (!window.__accOutside) {
    window.__accOutside = true;
    document.addEventListener('click', e => {
      if (!e.target.closest || !e.target.isConnected) return;
      if (e.target.closest('#view .acc') || e.target.closest('#sidebar') || e.target.closest('#topbar') || e.target.closest('#modalWrap') || e.target.closest('#confirmWrap')) return;
      $$('#view .acc.open').forEach(o => o.classList.remove('open'));
    });
  }
  $('#sTheme').onchange = e => { localStorage.setItem('qk-theme', e.target.value); applyTheme(); };
  $('#sLang').onchange = e => { lang = e.target.value; localStorage.setItem('qk-lang', lang); applyI18n(); buildNav(); $('#viewTitle').textContent = t(S.view); };
  $('#sMySave').onclick = async () => {
    try { const r = await post('/api/profile', { name: $('#sMyName').value, pin: $('#sMyPin').value || undefined }); S.user = r.user; buildNav(); await alertOk('Đã lưu', 'Thông tin tài khoản đã được cập nhật (PIN mới đã ghi vào tab CẤU_HÌNH trên Sheet).'); }
    catch (e) { alertErr('Không lưu được', e.message); }
  };
  if (!S.user.admin) return;
  /* Nhân sự */
  async function loadStaff() {
    const r = await api('/api/staff'); const roles = await api('/api/roles');
    $('#sNewStaffRole').innerHTML = roles.roles.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    $('#sStaff').innerHTML = `<table class="tbl"><tr><th>Tên</th><th>PIN hiện tại</th><th>Chức vụ</th><th></th></tr>${r.staff.map(s => `<tr>
      <td><input class="in" style="height:34px" value="${esc(s.name)}" data-sn="${s.id}"></td>
      <td><input class="in" style="height:34px;width:80px" value="${esc(s.pin)}" maxlength="4" data-sp="${s.id}"></td>
      <td><select class="in" style="height:34px" data-sr="${s.id}">${roles.roles.map(x => `<option value="${x.id}" ${x.id === s.roleId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
      <td style="white-space:nowrap"><button class="btn" data-save-staff="${s.id}">Lưu</button> <button class="btn danger" data-del-staff="${s.id}">Xoá</button></td></tr>`).join('')}</table>
      <p class="mut">Cột "PIN hiện tại" chỉ ADMIN thấy (phần mềm nội bộ). Sửa PIN tại đây sẽ ghi vào tab CẤU_HÌNH trên Sheet.</p>`;
    $$('#sStaff [data-save-staff]').forEach(b => b.onclick = async () => {
      const id = b.dataset.saveStaff;
      try { await api('/api/staff/' + id, { method: 'PUT', body: JSON.stringify({ name: $(`[data-sn="${id}"]`).value, pin: $(`[data-sp="${id}"]`).value, roleId: $(`[data-sr="${id}"]`).value }) }); toast('Đã lưu nhân sự'); }
      catch (e) { alertErr('Không lưu được', e.message); }
    });
    $$('#sStaff [data-del-staff]').forEach(b => b.onclick = async () => {
      if (!await showConfirm('Xoá nhân viên', 'Xoá nhân viên này khỏi hệ thống?')) return;
      try { await api('/api/staff/' + b.dataset.delStaff, { method: 'DELETE' }); loadStaff(); loadRoles(); } catch (e) { alertErr('Không xoá được', e.message); }
    });
    loadRoles(roles);
  }
  let rolePickId = null;
  function loadRoles(pre) {
    let editingRoleId = null;
    const render = roles => {
      const mods = ['dashboard','inventory','inbound','outbound','stocktake','processing','recon','calendar','calendar_manage','inbound_plan','history'];
      if (!roles.roles.some(r => r.id === rolePickId)) rolePickId = (roles.roles[0] || {}).id || null;
      const pick = $('#sRolePick');
      pick.innerHTML = roles.roles.map(r => `<option value="${r.id}" ${r.id === rolePickId ? 'selected' : ''}>${esc(r.name)}${r.system ? ' (hệ thống)' : ''}</option>`).join('');
      pick.onchange = () => { rolePickId = pick.value; editingRoleId = null; render(roles); };
      const r = roles.roles.find(x => x.id === rolePickId);
      $('#sRoles').innerHTML = r ? `<div style="border:1px solid var(--border);border-radius:12px;padding:10px">
        ${editingRoleId === r.id
          ? `<div style="display:flex;gap:6px;align-items:center"><input class="in" style="height:34px;flex:1;min-width:0" value="${esc(r.name)}" data-rename-input="${r.id}" maxlength="60"><button class="btn" data-rename-save="${r.id}">Lưu</button><button class="btn" data-rename-cancel="1">Huỷ</button></div>`
          : `<b>${esc(r.name)}</b> ${r.system ? '<span class="pill">Hệ thống</span>' : ''}`}
        <div class="perm-grid" style="margin-top:8px">${mods.map(m => `<div class="perm-row"><span class="perm-name">${I18N.vi[m]}</span><label class="switch"><input type="checkbox" data-rp="${r.id}:${m}" ${r.id === 'role-admin' || r.perms[m] ? 'checked' : ''} ${r.id === 'role-admin' ? 'disabled' : ''}><span class="track"></span></label></div>`).join('')}</div>
        ${r.system ? `<p class="mut" style="margin:8px 0 0">Chức vụ hệ thống — không đổi tên / xoá được.${r.id === 'role-admin' ? ' ADMIN luôn có toàn quyền.' : ''}</p>` : ''}
        ${!r.system && editingRoleId !== r.id ? `<div style="display:flex;gap:6px;margin-top:8px"><button class="btn" data-rename-role="${r.id}">Đổi tên</button><button class="btn danger" data-del-role="${r.id}">Xoá chức vụ</button></div>` : ''}</div>` : '<p class="mut">Chưa có chức vụ nào.</p>';
      $$('#sRoles [data-rename-role]').forEach(b => b.onclick = () => { editingRoleId = b.dataset.renameRole; render(roles); const inp = $(`#sRoles [data-rename-input="${editingRoleId}"]`); if (inp) { inp.focus(); inp.select(); } });
      $$('#sRoles [data-rename-cancel]').forEach(b => b.onclick = () => { editingRoleId = null; render(roles); });
      $$('#sRoles [data-rename-save]').forEach(b => b.onclick = async () => {
        const id = b.dataset.renameSave; const inp = $(`#sRoles [data-rename-input="${id}"]`); const name = (inp.value || '').trim();
        if (!name) return alertWarn('Chưa nhập tên', 'Hãy nhập tên chức vụ mới.');
        try { await api('/api/roles/' + id, { method: 'PUT', body: JSON.stringify({ name }) }); editingRoleId = null; toast('Đã đổi tên chức vụ'); loadStaff(); }
        catch (e) { alertErr('Không đổi tên được', e.message); }
      });
      $$('#sRoles [data-rename-input]').forEach(inp => inp.onkeydown = e => { if (e.key === 'Enter') { const b = $(`#sRoles [data-rename-save="${inp.dataset.renameInput}"]`); if (b) b.click(); } });
      $$('#sRoles [data-rp]').forEach(c => c.onchange = async () => {
        const [rid, mod] = c.dataset.rp.split(':'); const role = roles.roles.find(x => x.id === rid);
        role.perms[mod] = c.checked;
        try { await api('/api/roles/' + rid, { method: 'PUT', body: JSON.stringify({ perms: role.perms }) }); toast('Đã cập nhật phân quyền'); } catch (e) { alertErr('Lỗi', e.message); }
      });
      $$('#sRoles [data-del-role]').forEach(b => b.onclick = async () => { if (!await showConfirm('Xoá chức vụ', 'Xoá chức vụ này?')) return; try { await api('/api/roles/' + b.dataset.delRole, { method: 'DELETE' }); rolePickId = null; loadStaff(); } catch (e) { alertErr('Không xoá được', e.message); } });
      const mods2 = ['dashboard','inventory','inbound','outbound','stocktake','processing','recon','calendar','calendar_manage','inbound_plan','history'];
      $('#sNewRolePerms').innerHTML = mods2.map(m => `<div class="perm-row"><span class="perm-name">${I18N.vi[m]}</span><label class="switch"><input type="checkbox" data-nrp="${m}"><span class="track"></span></label></div>`).join('');
    };
    if (pre) render(pre); else api('/api/roles').then(render);
  }
  loadStaff();
  $('#sAddStaff').onclick = async () => {
    if (!$('#sNewStaffName').value.trim()) return alertWarn('Chưa nhập tên', 'Hãy nhập tên nhân viên mới.');
    if (!/^\d{4}$/.test($('#sNewStaffPin').value)) return alertWarn('PIN chưa hợp lệ', 'PIN phải gồm đúng 4 chữ số.');
    try { await post('/api/staff', { name: $('#sNewStaffName').value, pin: $('#sNewStaffPin').value, roleId: $('#sNewStaffRole').value }); toast('Đã thêm nhân viên'); loadStaff(); }
    catch (e) { alertErr('Không thêm được', e.message); }
  };
  $('#sAddRole').onclick = async () => {
    if (!$('#sNewRoleName').value.trim()) return alertWarn('Chưa nhập tên chức vụ', 'Hãy nhập tên chức vụ mới.');
    const perms = {}; $$('#sNewRolePerms [data-nrp]').forEach(c => perms[c.dataset.nrp] = c.checked);
    try { await post('/api/roles', { name: $('#sNewRoleName').value, perms }); toast('Đã thêm chức vụ'); loadStaff(); }
    catch (e) { alertErr('Không thêm được', e.message); }
  };
  /* Phân loại xuất kho (ADMIN tuỳ chỉnh) */
  let catEditing = null;
  function renderCats() {
    const cats = S.boot.exportCategories || [];
    $('#sCats').innerHTML = cats.length ? cats.map((c, i) => `<div class="line-row"><div class="grow">
      ${catEditing === i ? `<input class="in" style="height:32px" value="${esc(c)}" data-cat-input="${i}" maxlength="80">` : `<b>${esc(c)}</b>`}</div>
      ${catEditing === i
        ? `<button class="btn primary" data-cat-save="${i}">Lưu</button><button class="btn" data-cat-cancel="1">Huỷ</button>`
        : `<button class="btn" data-cat-edit="${i}">Sửa</button><button class="btn danger" data-cat-del="${i}">Xoá</button>`}
      </div>`).join('') : '<p class="mut">Chưa có phân loại nào.</p>';
    $$('#sCats [data-cat-edit]').forEach(b => b.onclick = () => { catEditing = +b.dataset.catEdit; renderCats(); const inp = $(`#sCats [data-cat-input="${catEditing}"]`); if (inp) { inp.focus(); inp.select(); } });
    $$('#sCats [data-cat-cancel]').forEach(b => b.onclick = () => { catEditing = null; renderCats(); });
    $$('#sCats [data-cat-save]').forEach(b => b.onclick = async () => {
      const i = +b.dataset.catSave; const inp = $(`#sCats [data-cat-input="${i}"]`); const name = (inp.value || '').trim();
      if (!name) return alertWarn('Chưa nhập tên', 'Hãy nhập tên phân loại.');
      try { const r = await api('/api/export-categories/' + encodeURIComponent(S.boot.exportCategories[i]), { method: 'PUT', body: JSON.stringify({ name }) }); S.boot.exportCategories = r.categories; catEditing = null; renderCats(); toast('Đã đổi tên phân loại'); }
      catch (e) { alertErr('Không sửa được', e.message); }
    });
    $$('#sCats [data-cat-del]').forEach(b => b.onclick = async () => {
      const name = S.boot.exportCategories[+b.dataset.catDel];
      if (!await showConfirm('Xoá phân loại', `Xoá phân loại "${name}" khỏi danh sách?\nPhiếu xuất đã lưu vẫn giữ nguyên nhãn này.`)) return;
      try { const r = await api('/api/export-categories/' + encodeURIComponent(name), { method: 'DELETE' }); S.boot.exportCategories = r.categories; renderCats(); toast('Đã xoá phân loại'); }
      catch (e) { alertErr('Không xoá được', e.message); }
    });
  }
  api('/api/export-categories').then(r => { S.boot.exportCategories = r.categories; renderCats(); }).catch(() => { $('#sCats').innerHTML = '<p class="mut">Không tải được danh sách.</p>'; });
  $('#sCatAdd').onclick = async () => {
    const name = $('#sCatNew').value.trim();
    if (!name) return alertWarn('Chưa nhập tên', 'Hãy nhập tên phân loại mới.');
    try { const r = await post('/api/export-categories', { name }); S.boot.exportCategories = r.categories; $('#sCatNew').value = ''; renderCats(); toast('Đã thêm phân loại'); }
    catch (e) { alertErr('Không thêm được', e.message); }
  };
  $('#sDefWhSave').onclick = async () => {
    if (!$('#sDefWh').value) return alertWarn('Chưa chọn kho', 'Hãy chọn kho mặc định.');
    try { const r = await post('/api/default-warehouse', { warehouse: $('#sDefWh').value }); S.boot.defaultWarehouse = r.defaultWarehouse; await alertOk('Đã lưu kho mặc định', 'Từ giờ mọi form sẽ chọn sẵn kho: ' + r.defaultWarehouse); }
    catch (e) { alertErr('Không lưu được', e.message); }
  };
  $('#sSheetSave').onclick = async () => {
    if (!$('#sSheetId').value.trim()) return alertWarn('Chưa nhập Sheet', 'Hãy dán link hoặc ID của Sheet kho.');
    try { const r = await post('/api/sheet-config', { id: $('#sSheetId').value }); $('#sSheetMeta').textContent = `Đã đồng bộ ${r.count} sản phẩm • ${r.syncedAt}`; S.boot.inventoryMeta = { count: r.count, syncedAt: r.syncedAt, posUpdatedAt: r.posUpdatedAt || '' }; await notifySyncDone(r); }
    catch (e) { alertErr('Kết nối / đồng bộ thất bại', e.message); }
  };
  $('#sSheetSync').onclick = async () => { try { const r = await post('/api/sheet-sync'); $('#sSheetMeta').textContent = `Đã đồng bộ ${r.count} sản phẩm • ${r.syncedAt}`; S.boot.inventoryMeta = { count: r.count, syncedAt: r.syncedAt, posUpdatedAt: r.posUpdatedAt || '' }; await notifySyncDone(r); } catch (e) { alertErr('Đồng bộ thất bại', e.message); } };
  $('#sSheetOff').onclick = async () => { if (!await showConfirm('Ngắt kết nối Sheet', 'App sẽ mất toàn bộ dữ liệu hiển thị (nhân sự, phiếu, tồn kho) vì Sheet là database chính — dữ liệu trong Sheet vẫn còn nguyên. Tiếp tục?')) return; try { await api('/api/sheet-config', { method: 'DELETE' }); toast('Đã ngắt kết nối'); go('settings'); } catch (e) { alertErr('Lỗi', e.message); } };
  /* Khoá mạng công ty */
  let ipAllow = [];
  function renderIpList() {
    $('#sIpList').innerHTML = ipAllow.length ? ipAllow.map((x, i) => `<div class="line-row"><div class="grow"><b>${esc(x)}</b></div><button class="icon-btn" data-ipdel="${i}">✕</button></div>`).join('') : '<p class="mut">Chưa có IP nào trong danh sách.</p>';
    $$('#sIpList [data-ipdel]').forEach(b => b.onclick = () => { ipAllow.splice(+b.dataset.ipdel, 1); renderIpList(); });
  }
  (async () => {
    try {
      const r = await api('/api/ip-lock');
      $('#sIpOn').checked = r.enabled; ipAllow = r.allow || [];
      $('#sIpMine').value = r.currentIp; renderIpList();
    } catch { $('#sIpMine').value = '(không lấy được)'; }
  })();
  $('#sIpUseMine').onclick = async () => {
    try { const r = await api('/api/my-ip'); $('#sIpMine').value = r.ip; if (!ipAllow.includes(r.ip)) { ipAllow.push(r.ip); renderIpList(); } toast('Đã thêm IP hiện tại: ' + r.ip); }
    catch (e) { alertErr('Không lấy được IP', e.message); }
  };
  $('#sIpAdd').onclick = () => { const x = $('#sIpNew').value.trim(); if (!x) return alertWarn('Chưa nhập IP', 'Hãy nhập địa chỉ IP hoặc dải CIDR cần cho phép.'); if (!ipAllow.includes(x)) ipAllow.push(x); $('#sIpNew').value = ''; renderIpList(); };
  $('#sIpSave').onclick = async () => {
    try { const r = await post('/api/ip-lock', { enabled: $('#sIpOn').checked, allow: ipAllow }); ipAllow = r.allow; renderIpList(); await alertOk('Đã lưu cài đặt mạng', r.enabled ? 'Đã BẬT: app chỉ dùng được trong mạng công ty (các IP trong danh sách).' : 'Đã TẮT: app dùng được từ mọi mạng.'); }
    catch (e) { alertErr('Không lưu được', e.message); }
  };
  /* Kết nối tên miền (DNS quản lí tại Cloudflare; đăng ký tại TenTen) */
  (async () => {
    try {
      const r = await api('/api/domain-config');
      $('#sDomName').value = r.domain || r.suggestedDomain || '';
      $('#sDomTarget').textContent = r.hostTarget || '(địa chỉ máy chủ app)';
      if (r.suggestedDomain) $('#sDomSuggest').textContent = r.suggestedDomain;
    } catch {}
  })();
  $('#sDomSave').onclick = async () => {
    try {
      const r = await post('/api/domain-config', { domain: $('#sDomName').value });
      $('#sDomName').value = r.domain || '';
      $('#sDomTarget').textContent = r.hostTarget || '';
      await alertOk('Đã lưu tên miền', r.domain ? 'Đã khai báo tên miền: ' + r.domain + '\nHãy cấu hình DNS tại Cloudflare theo hướng dẫn trong mục này, đợi DNS cập nhật rồi bấm "Kiểm tra kết nối".' : 'Đã xoá khai báo tên miền.');
    } catch (e) { alertErr('Không lưu được', e.message); }
  };
  $('#sDomCheck').onclick = async () => {
    const st = $('#sDomStatus'), dt = $('#sDomDetail');
    st.textContent = 'Đang kiểm tra…'; st.style.color = ''; dt.textContent = '';
    try {
      const r = await post('/api/domain-check');
      st.textContent = r.status === 'connected' ? '✅ Đã kết nối' : r.status === 'unconfigured' ? '⚪ Chưa cấu hình' : '⚠️ Chưa trỏ đúng';
      st.style.color = r.status === 'connected' ? 'var(--green)' : r.status === 'unconfigured' ? 'var(--muted)' : '#e07b00';
      const res = r.resolvesTo ? [...(r.resolvesTo.cname || []).map(c => 'CNAME → ' + c), ...(r.resolvesTo.a || []).map(a => 'A → ' + a)].join('; ') : '';
      dt.textContent = (r.message || '') + (res ? `\nDNS hiện tại đọc được: ${res}` : '');
    } catch (e) { st.textContent = '⚠️ Chưa trỏ đúng'; st.style.color = '#e07b00'; dt.textContent = e.message; }
  };
};

/* ---------- Khởi động ---------- */
buildPinPad(); applyI18n();
if (S.token) { enterApp().catch(() => { S.token = ''; localStorage.removeItem('qk-token'); }); }
