'use strict';
/* Quản lí kho Vitot — bản standalone. DATABASE CHÍNH LÀ GOOGLE SHEET.
   Chỉ dùng module có sẵn của Node (không cần npm install).
   - Đọc/ghi Sheet qua Google Sheets API v4 bằng tài khoản dịch vụ (service account).
   - Chưa có tài khoản dịch vụ → chế độ CHỈ ĐỌC qua gviz (đăng nhập + tra cứu chạy, không ghi được phiếu).
   - Tồn kho + phiếu được nạp vào bộ nhớ đệm trên máy chủ để tra cứu/lịch sử chạy nhanh. */
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const TZ = 'Asia/Bangkok';
const DEFAULT_SHEET_ID = '1xx0vdFCCHpUUbMs5cq-fZ2tSqHLMbq-nfz2h7oaUybk'; // Sheet "QUẢN LÍ KHO HÀNG VITOT"
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API_BASE = (process.env.SHEETS_API_BASE || 'https://sheets.googleapis.com').replace(/\/$/, '');
const READONLY_MSG = 'Chưa cấu hình tài khoản dịch vụ Google — app đang ở chế độ chỉ đọc';

/* ---------------- Thời gian Asia/Bangkok ---------------- */
function nowParts() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return p;
}
function nowText() { const p = nowParts(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }
function nowFull() { const p = nowParts(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; }
function todayKey() { const p = nowParts(); return `${p.year}-${p.month}-${p.day}`; }
function slipCode(prefix) {
  const p = nowParts();
  return `${prefix}-${p.day}${p.month}${String(p.year).slice(2)}-${p.hour}${p.minute}`;
}
function parseDateKey(s) {
  s = String(s || '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

/* ---------------- HTTP thuần (http/https) ---------------- */
function httpRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, text: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function fetchText(url) { // theo redirect (gviz)
  const r = await httpRequest(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.status >= 300 && r.status < 400 && r.headers.location) return fetchText(r.headers.location);
  return r.text;
}

/* ---------------- Tài khoản dịch vụ Google (JWT → OAuth token) ---------------- */
function loadCreds() {
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  } catch (e) { console.error('Không đọc được credentials tài khoản dịch vụ:', e.message); }
  return null;
}
const creds = loadCreds();
const WRITABLE = !!creds;
let tokenCache = { token: '', exp: 0 };
function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function googleToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL, iat: now, exp: now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(creds.private_key))}`;
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
  const r = await httpRequest(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (r.status !== 200) throw new Error('Không lấy được token Google (kiểm tra JSON key của tài khoản dịch vụ).');
  const j = JSON.parse(r.text);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}
async function sheetsApi(method, pathPart, bodyObj) {
  const token = await googleToken();
  const r = await httpRequest(`${API_BASE}${pathPart}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : null
  });
  if (r.status === 403) throw new Error('Tài khoản dịch vụ chưa được cấp quyền trên Sheet. Hãy chia sẻ Sheet cho email tài khoản dịch vụ với quyền Editor (xem hướng dẫn triển khai).');
  if (r.status < 200 || r.status >= 300) throw new Error(`Google Sheets API lỗi ${r.status}: ${r.text.slice(0, 200)}`);
  return r.text ? JSON.parse(r.text) : {};
}
const encRange = (tab, a1) => encodeURIComponent(`'${tab}'${a1 ? '!' + a1 : ''}`);
async function apiValuesGet(sheetId, tab) {
  const j = await sheetsApi('GET', `/v4/spreadsheets/${sheetId}/values/${encRange(tab, 'A1:Z3000')}`);
  return (j.values || []).map(r => r.map(c => (c == null ? '' : String(c))));
}
async function apiValuesAppend(sheetId, tab, rows) {
  const j = await sheetsApi('POST', `/v4/spreadsheets/${sheetId}/values/${encRange(tab)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: rows });
  return j.updates || {};
}
async function apiValuesUpdate(sheetId, tab, a1, values, raw) {
  return sheetsApi('PUT', `/v4/spreadsheets/${sheetId}/values/${encRange(tab, a1)}?valueInputOption=${raw ? 'RAW' : 'USER_ENTERED'}`, { values });
}
async function apiValuesBatchUpdate(sheetId, data, raw) {
  return sheetsApi('POST', `/v4/spreadsheets/${sheetId}/values:batchUpdate`, { valueInputOption: raw ? 'RAW' : 'USER_ENTERED', data });
}
function startRowOf(updates, fallback) {
  const m = String((updates && updates.updatedRange) || '').match(/![A-Z]+(\d+):/);
  return m ? Number(m[1]) : fallback;
}

/* ---------------- Đọc Sheet qua gviz (chế độ chỉ đọc) ---------------- */
function parseGviz(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0) throw new Error('bad gviz');
  const j = JSON.parse(text.slice(start, end + 1));
  if (!j.table) throw new Error('no table');
  const cols = (j.table.cols || []).map(c => (c.label || '').trim());
  const rows = (j.table.rows || []).map(r => (r.c || []).map(cell => {
    if (!cell) return '';
    if (cell.f != null && (cell.v == null || typeof cell.v === 'object')) return String(cell.f);
    return cell.v == null ? '' : String(cell.v);
  }));
  // Chuẩn hoá: hàng đầu tiên luôn là header. Tab nào gviz đã tách header vào cols thì ghép lại.
  if (cols.some(Boolean)) return [cols, ...rows];
  return rows;
}
async function gvizRows(sheetId, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  return parseGviz(await fetchText(url));
}

/* ---------------- Trạng thái / bộ nhớ đệm ---------------- */
const MODULES = ['dashboard', 'inventory', 'inbound', 'outbound', 'stocktake', 'processing', 'recon', 'history', 'calendar'];
function systemRoles() {
  const all = {}; MODULES.forEach(m => all[m] = true);
  const staff = { inventory: true, inbound: true, outbound: true, stocktake: true, processing: true, recon: true, history: true, dashboard: false, calendar: true };
  return [
    { id: 'role-admin', name: 'ADMIN', system: true, perms: all },
    { id: 'role-kho', name: 'KHO', system: true, perms: staff }
  ];
}
const TABS = { in: 'NHẬP_HÀNG', out: 'XUẤT_HÀNG', check: 'KIỂM_KHO', process: 'CHẾ_BIẾN_SƠ_CHẾ', recon: 'ĐỐI_SOÁT_ĐƠN' };
const DEFAULT_EXPORT_CATEGORIES = ['Bán hàng', 'Chuyển kho', 'Trả nhà cung cấp', 'Hủy hàng hỏng', 'Khác'];
const SUGGESTED_DOMAIN = 'kho.xelientinh247.com'; // tên miền gợi ý mặc định (ADMIN sửa được trong Cài đặt)
const state = {
  loaded: false, loading: null,
  runtimeSheetId: '', // ADMIN đặt trong Cài đặt (ưu tiên sau env SHEET_ID)
  staff: [],            // {id, row, name, pin, roleName, active:true}
  roles: systemRoles(),
  inventory: { items: [], syncedAt: '', posUpdatedAt: '' },
  lists: { warehouses: [], suppliers: [], units: ['Kg', 'Con', 'Khay', 'Túi', 'Hộp', 'Thùng', 'Cái'] },
  slips: [],            // {id,type,code,createdAt,dateKey,creatorName,warehouse,...,lines,rowRefs:[{tab,row}],writeStatus:'written'|'pending'|'error',writtenAt,writeError,rows?}
  exportCategories: null, // null = dùng mặc định; mảng tên phân loại xuất kho (APP_CAI_DAT: export_categories)
  calendarEvents: [],   // sự kiện lịch kiểu Google Calendar (APP_CAI_DAT: calendar_events)
  settingsRows: {},     // APP_CAI_DAT: key -> số dòng
  ipLock: { enabled: false, allow: [] },
  defaultWarehouse: '', // Kho mặc định (APP_CAI_DAT: default_warehouse)
  customDomain: '',     // Tên miền riêng (APP_CAI_DAT: custom_domain)
  tabRows: {},          // tên tab -> tổng số dòng (kể cả header)
  configRows: {},       // CẤU_HÌNH: số dòng -> [A..F]
  loadError: ''
};
function currentSheetId() { return process.env.SHEET_ID || state.runtimeSheetId || DEFAULT_SHEET_ID; }
function sheetIdFrom(input) {
  const m = String(input || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input || '').trim();
}
function numVN(v) {
  let s = String(v == null ? '' : v).replace(/\s/g, '');
  if (s === '') return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function numCell(v) { const n = numVN(v); return n; }

/* ---- Xây bộ đệm từ các bảng 2D (hàng 1 = header) ---- */
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').toString().trim(); }); return o; });
}
function buildInventory(rows) {
  const objs = rowsToObjects(rows);
  const items = [];
  let lastName = '', lastWarehouse = '', posUpdatedAt = '';
  for (const o of objs) {
    const sku = o['Mã sản phẩm'] || '';
    const name = o['Tên sản phẩm'] || '';
    const variant = o['Phân loại / Thuộc tính'] || o['Phân loại'] || '';
    const sample = o['Mã mẫu'] || '';
    if (!sku && !name && !variant && !sample) continue;
    const effName = name || (variant ? lastName : (sample || lastName));
    const warehouse = o['Kho thao tác'] || lastWarehouse;
    if (name) lastName = name;
    if (o['Kho thao tác']) lastWarehouse = o['Kho thao tác'];
    if (o['Cập nhật lúc']) posUpdatedAt = o['Cập nhật lúc'];
    items.push({
      key: `${sku}|${variant}|${warehouse}|${items.length}`,
      sku, name: effName, variant, sampleCode: sample, barcode: o['Mã vạch'] || '',
      category: o['Danh mục'] || '', warehouse, supplier: o['Nhà cung cấp'] || '',
      sellable: numVN(o['Có thể bán']), stock: numVN(o['Tổng tồn kho'])
    });
  }
  return { items, posUpdatedAt };
}
function splitWarehouses(items) {
  const wh = new Set();
  for (const i of items) {
    if (!i.warehouse) continue;
    const parts = i.warehouse.split(', ');
    let cur = '';
    for (const part of parts) {
      if (part.includes(' - ') && cur) { wh.add(cur); cur = part; }
      else cur = cur ? cur + ', ' + part : part;
    }
    if (cur) wh.add(cur);
  }
  return wh;
}
function buildSlips(tables) {
  const slips = [];
  const push = (s) => { s.id = `${s.type}:${s.code}:${s.rowRefs.length ? s.rowRefs[0].row : slips.length}`; slips.push(s); };
  const group = (rows, type, fn) => {
    const map = new Map();
    rows.slice(1).forEach((r, i) => {
      const rowNum = i + 2;
      const code = String(r[0] || '').trim();
      if (!code) return;
      if (!map.has(code)) { const s = fn(r, true); s.type = type; s.code = code; s.lines = []; s.rowRefs = []; s.writeStatus = 'written'; s.writtenAt = ''; s.writeError = ''; map.set(code, s); push(s); }
      const s = map.get(code);
      const line = fn(r, false);
      if (line) s.lines.push(line);
      s.rowRefs.push({ tab: TABS[type], row: rowNum });
    });
    return map;
  };
  group(tables[TABS.in] || [], 'in', (r, head) => head
    ? { createdAt: r[3] || '', dateKey: parseDateKey(r[3]), creatorName: r[9] || '', warehouse: r[1] || '', supplier: r[2] || '', expectedDate: String(r[4] || '').trim(), expectedKey: parseDateKey(r[4]) }
    : { name: r[5] || '', sampleCode: r[6] || '', qty: numCell(r[7]), unit: r[8] || '' });
  group(tables[TABS.out] || [], 'out', (r, head) => head
    ? { createdAt: r[4] || '', dateKey: parseDateKey(r[4]), creatorName: r[10] || '', warehouse: r[1] || '', exportType: r[2] || '', recipient: r[3] || '', note: r[9] || '' }
    : { name: r[5] || '', sampleCode: r[6] || '', qty: numCell(r[7]), unit: r[8] || '', note: '' });
  group(tables[TABS.check] || [], 'check', (r, head) => head
    ? { createdAt: r[2] || '', dateKey: parseDateKey(r[2]), creatorName: r[9] || '', warehouse: r[1] || '', note: r[8] || '' }
    : (() => { const ss = numCell(r[5]), c = numCell(r[6]), v = c - ss; return { sampleCode: r[3] || '', name: r[4] || '', systemStock: ss, counted: c, variance: v, matchStatus: v === 0 ? 'Khớp' : (v > 0 ? 'Thừa' : 'Thiếu') }; })());
  group(tables[TABS.process] || [], 'process', (r, head) => head
    ? { createdAt: r[2] || '', dateKey: parseDateKey(r[2]), creatorName: r[16] || '', warehouse: r[1] || '', note: r[15] || '' }
    : (() => { const iq = numCell(r[5]), u = numCell(r[9]), d = numCell(r[10]); const loss = iq - u - d; return { name: r[4] || '', sampleCode: r[3] || '', inputQty: iq, usable: u, discard: d, loss, usablePct: iq ? +(u / iq * 100).toFixed(1) : 0, discardPct: iq ? +(d / iq * 100).toFixed(1) : 0, lossPct: iq ? +(loss / iq * 100).toFixed(1) : 0, finishedSku: r[6] || '', finishedName: r[7] || '', posQty: numCell(r[8]) }; })());
  group(tables[TABS.recon] || [], 'recon', (r, head) => head
    ? { createdAt: r[2] || '', dateKey: parseDateKey(r[2]), creatorName: r[3] || '', warehouse: r[1] || '' }
    : (/đã quét/i.test(r[7] || '') ? { code: r[4] || '', warning: r[8] || '' } : null));
  // Mới nhất lên đầu: theo thứ tự dòng trong Sheet (dòng càng dưới càng mới)
  slips.sort((a, b) => (b.rowRefs[0] ? b.rowRefs[0].row : 0) - (a.rowRefs[0] ? a.rowRefs[0].row : 0));
  return slips;
}

/* ---- Sổ kho độc lập: tồn kho do KHO tự quản, tính từ các phiếu ĐÃ GHI xuống Sheet ----
   Phát lại (replay) mọi phiếu written theo thứ tự thời gian tạo phiếu:
   Nhập +SL • Xuất −SL • Chế biến: −SL nguyên liệu, +SL thành phẩm (SL nhập bán POS)
   • Kiểm kho: ĐẶT tồn của sản phẩm = số kiểm thực tế tại thời điểm phiếu kiểm.
   KHÔNG dùng số tồn của tab TỒN_KHO_POS (đó là tồn POS — chỉ còn dùng cho danh mục/picker + Dashboard). */
function slipTimeKey(s) {
  const raw = String(s.createdAt || '');
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
  m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')} ${String(m[4] || 0).padStart(2, '0')}:${m[5] || '00'}:00`;
  return (s.dateKey || '') + ' 00:00:00';
}
function computeWarehouseStock() {
  // Chuẩn hoá mã: phiếu chế biến ghi mã SKU ở cột mã nguyên liệu/thành phẩm, phiếu nhập/xuất ghi Mã mẫu
  // → quy về 1 mã chung (Mã mẫu nếu có) qua danh mục POS để cộng đúng cùng 1 sản phẩm.
  const canon = new Map();
  for (const it of state.inventory.items) {
    const c = it.sampleCode || it.sku;
    if (!c) continue;
    if (it.sku) canon.set(it.sku, c);
    if (it.sampleCode) canon.set(it.sampleCode, c);
  }
  const canonCode = code => canon.get(code) || code || '';
  const round3 = n => Math.round(n * 1000) / 1000;
  const map = new Map();
  const entry = (wh, code, name, unit) => {
    const c = canonCode(String(code || '').trim());
    const pk = c || ('name:' + String(name || '').trim().toLowerCase());
    const k = (wh || '') + '\u0001' + pk;
    let e = map.get(k);
    if (!e) { e = { warehouse: wh || '', code: c, name: String(name || '').trim(), unit: unit || '', stock: 0 }; map.set(k, e); }
    if (name) e.name = String(name).trim();
    if (unit) e.unit = unit;
    return e;
  };
  // state.slips đang xếp mới→cũ; đảo lại thành cũ→mới rồi sort ổn định theo thời gian tạo phiếu
  const slips = state.slips.filter(s => s.writeStatus === 'written').slice().reverse();
  slips.sort((a, b) => { const ka = slipTimeKey(a), kb = slipTimeKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
  for (const s of slips) {
    const wh = s.warehouse || '';
    if (s.type === 'in') for (const l of s.lines || []) { const e = entry(wh, l.sampleCode, l.name, l.unit); e.stock = round3(e.stock + (Number(l.qty) || 0)); }
    else if (s.type === 'out') for (const l of s.lines || []) { const e = entry(wh, l.sampleCode, l.name, l.unit); e.stock = round3(e.stock - (Number(l.qty) || 0)); }
    else if (s.type === 'check') for (const l of s.lines || []) { const e = entry(wh, l.sampleCode, l.name, ''); e.stock = Number(l.counted) || 0; }
    else if (s.type === 'process') for (const l of s.lines || []) {
      const inp = entry(wh, l.sampleCode, l.name, ''); inp.stock = round3(inp.stock - (Number(l.inputQty) || 0));
      if (l.finishedSku || l.finishedName) { const fin = entry(wh, l.finishedSku, l.finishedName, ''); fin.stock = round3(fin.stock + (Number(l.posQty) || 0)); }
    }
  }
  return [...map.values()];
}

async function readAllTables(sheetId) {
  const names = ['TỒN_KHO_POS', 'CẤU_HÌNH', TABS.in, TABS.out, TABS.check, TABS.process, TABS.recon, 'APP_CAI_DAT'];
  const tables = {};
  if (WRITABLE) {
    const meta = await sheetsApi('GET', `/v4/spreadsheets/${sheetId}`);
    const titles = (meta.sheets || []).map(s => s.properties.title);
    if (!titles.includes('APP_CAI_DAT')) {
      await sheetsApi('POST', `/v4/spreadsheets/${sheetId}:batchUpdate`, { requests: [{ addSheet: { properties: { title: 'APP_CAI_DAT' } } }] });
      await apiValuesAppend(sheetId, 'APP_CAI_DAT', [['Khóa', 'Giá trị']]);
      tables['APP_CAI_DAT'] = [['Khóa', 'Giá trị']];
    }
    for (const n of names) {
      if (tables[n]) continue;
      tables[n] = titles.includes(n) || n === 'APP_CAI_DAT' ? await apiValuesGet(sheetId, n) : [];
    }
  } else {
    for (const n of names) {
      try { tables[n] = await gvizRows(sheetId, n); }
      catch { tables[n] = []; if (n === 'TỒN_KHO_POS') throw new Error('Không đọc được tab TỒN_KHO_POS. Hãy kiểm tra Sheet đã bật chia sẻ "Bất kỳ ai có liên kết đều xem được" và đúng Sheet ID.'); }
    }
  }
  return tables;
}

async function loadCache(followPointer) {
  const sheetId = currentSheetId();
  const tables = await readAllTables(sheetId);
  for (const [k, v] of Object.entries(tables)) state.tabRows[k] = v.length;
  // APP_CAI_DAT → settings / phân loại xuất / sự kiện lịch / phiếu chờ ghi
  const settings = {}; state.settingsRows = {};
  (tables['APP_CAI_DAT'] || []).forEach((r, i) => {
    const k = String(r[0] || '').trim(); if (!k || i === 0) return;
    state.settingsRows[k] = i + 1;
    settings[k] = r[1] == null ? '' : String(r[1]);
  });
  state.exportCategories = null;
  if (settings.export_categories) {
    try { const arr = JSON.parse(settings.export_categories); if (Array.isArray(arr)) state.exportCategories = arr.map(x => String(x || '').trim()).filter(Boolean); } catch {}
  }
  state.calendarEvents = [];
  if (settings.calendar_events) {
    try { const arr = JSON.parse(settings.calendar_events); if (Array.isArray(arr)) state.calendarEvents = arr.filter(e => e && e.id && e.date); } catch {}
  }
  let pendingSlips = [];
  if (settings.pending_slips) {
    try { const arr = JSON.parse(settings.pending_slips); if (Array.isArray(arr)) pendingSlips = arr.filter(s => s && s.code && Array.isArray(s.rows)); } catch {}
  }
  if (settings.ip_lock) { try { const j = JSON.parse(settings.ip_lock); state.ipLock = { enabled: !!j.enabled, allow: Array.isArray(j.allow) ? j.allow : [] }; } catch {} }
  state.defaultWarehouse = String(settings.default_warehouse || '').trim() || 'Hà Nội - 263 Hoàng Văn Thái, Thanh Xuân';
  state.customDomain = String(settings.custom_domain || '').trim().toLowerCase();
  // Theo con trỏ sheet_id (ADMIN từng đổi Sheet) — chỉ theo 1 lần, env/runtime đặt tay thắng
  if (followPointer && settings.sheet_id && settings.sheet_id !== sheetId && !process.env.SHEET_ID && !state.runtimeSheetId) {
    state.runtimeSheetId = settings.sheet_id;
    return loadCache(false);
  }
  // Chức vụ tuỳ chỉnh
  state.roles = systemRoles();
  if (settings.roles_json) {
    try {
      const custom = JSON.parse(settings.roles_json);
      if (Array.isArray(custom)) for (const r of custom) {
        if (!r || !r.name || state.roles.some(x => x.name === r.name)) continue;
        const perms = {}; MODULES.forEach(m => perms[m] = !!(r.perms || {})[m]);
        state.roles.push({ id: r.id || ('role-x-' + state.roles.length), name: r.name, system: false, perms });
      }
    } catch {}
  }
  // CẤU_HÌNH → nhân sự + danh sách phụ
  state.configRows = {};
  state.staff = [];
  const cfgRows = tables['CẤU_HÌNH'] || [];
  cfgRows.forEach((r, i) => { state.configRows[i + 1] = r; });
  const extraWh = [], extraSup = [], units = [];
  cfgRows.slice(1).forEach((r, i) => {
    const rowNum = i + 2;
    if (r[0] && String(r[0]).trim()) extraWh.push(String(r[0]).trim());
    if (r[2] && String(r[2]).trim()) extraSup.push(String(r[2]).trim());
    if (r[3] && String(r[3]).trim() && !units.includes(String(r[3]).trim())) units.push(String(r[3]).trim());
    const name = String(r[1] || '').trim();
    if (name) {
      let pin = String(r[4] == null ? '' : r[4]).trim();
      state.staff.push({ id: 'staff-r' + rowNum, row: rowNum, name, pin, roleName: String(r[5] || 'KHO').trim() || 'KHO', active: true });
    }
  });
  // Tồn kho + danh sách kho/NCC
  const inv = buildInventory(tables['TỒN_KHO_POS'] || []);
  state.inventory = { items: inv.items, syncedAt: nowText(), posUpdatedAt: inv.posUpdatedAt };
  const wh = splitWarehouses(inv.items);
  extraWh.forEach(x => wh.add(x));
  const sup = new Set(inv.items.map(i => i.supplier).filter(Boolean));
  extraSup.forEach(x => sup.add(x));
  state.lists = { warehouses: [...wh], suppliers: [...sup], units: units.length ? units : ['Kg', 'Con', 'Khay', 'Túi', 'Hộp', 'Thùng', 'Cái'] };
  // Phiếu: phiếu đọc từ Sheet = đã ghi; phiếu chờ ghi/ghi lỗi (pending_slips) được ghép lên đầu
  state.slips = buildSlips(tables);
  for (const ps of pendingSlips) {
    if (state.slips.some(s => s.code === ps.code && s.type === ps.type)) continue; // đã có trong Sheet → coi như đã ghi
    state.slips.unshift(ps);
  }
  state.loaded = true; state.loadError = '';
}
async function ensureCache() {
  if (state.loaded) return;
  if (state.loading) return state.loading;
  state.loading = loadCache(true).catch(e => { state.loadError = e.message; throw e; }).finally(() => { state.loading = null; });
  return state.loading;
}
async function reloadCache() { state.loaded = false; await ensureCache(); }

/* ---- Ghi 1 khóa vào APP_CAI_DAT ---- */
async function setSetting(key, value) {
  if (!WRITABLE) return; // chỉ đọc: giữ trong bộ nhớ
  const sheetId = currentSheetId();
  const row = state.settingsRows[key];
  if (row) await apiValuesUpdate(sheetId, 'APP_CAI_DAT', `B${row}`, [[value]], true);
  else {
    const upd = await apiValuesAppend(sheetId, 'APP_CAI_DAT', [[key, value]]);
    state.settingsRows[key] = startRowOf(upd, (state.tabRows['APP_CAI_DAT'] || 1) + 1);
    state.tabRows['APP_CAI_DAT'] = (state.tabRows['APP_CAI_DAT'] || 1) + 1;
  }
}
async function persistRoles() {
  const custom = state.roles.filter(r => !r.system).map(r => ({ id: r.id, name: r.name, perms: r.perms }));
  await setSetting('roles_json', JSON.stringify(custom));
}
function exportCategories() { return (state.exportCategories && state.exportCategories.length) ? state.exportCategories : DEFAULT_EXPORT_CATEGORIES; }
async function persistExportCategories() { await setSetting('export_categories', JSON.stringify(exportCategories())); }
async function persistCalendarEvents() { await setSetting('calendar_events', JSON.stringify(state.calendarEvents)); }
/* Phiếu chưa ghi được xuống Sheet (ghi lỗi / đang chờ) được lưu ở APP_CAI_DAT để ghi lại sau, kể cả sau khi app khởi động lại */
async function persistPendingSlips() {
  const pending = state.slips.filter(s => s.writeStatus !== 'written')
    .map(s => ({ ...s, rowRefs: [] }));
  try { await setSetting('pending_slips', JSON.stringify(pending)); } catch {}
}
function requireWritable() { if (!WRITABLE) throw new Error(READONLY_MSG); }

/* ---------------- Khoá mạng công ty (tuỳ chọn) ---------------- */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  let ip = xff ? String(xff).split(',')[0].trim() : (req.socket.remoteAddress || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) { const v = Number(p); if (!Number.isInteger(v) || v < 0 || v > 255) return null; n = n * 256 + v; }
  return n >>> 0;
}
function ipAllowed(ip, allow) {
  for (const entry of allow || []) {
    const e = String(entry).trim();
    if (!e) continue;
    if (e === ip) return true;
    if (e.includes('/')) {
      const [base, bitsStr] = e.split('/');
      const bits = Number(bitsStr);
      const a = ipv4ToInt(ip), b = ipv4ToInt(base);
      if (a != null && b != null && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        if ((a & mask) === (b & mask)) return true;
      }
    }
  }
  return false;
}
function ipLockActive() {
  if (process.env.DISABLE_IP_LOCK === '1') return false;
  return !!(state.ipLock && state.ipLock.enabled);
}
const BLOCK_PAGE = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VITOT FOOD — Ngoài mạng công ty</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f2f4f3;color:#14231a}
.card{max-width:420px;width:100%;background:#fff;border-radius:24px;box-shadow:0 4px 8px rgba(16,60,35,.06),0 20px 48px rgba(16,60,35,.16);overflow:hidden;text-align:center}
.head{background:linear-gradient(135deg,#0b2239,#16324f);color:#fff;font-weight:700;letter-spacing:.6px;font-size:13.5px;padding:13px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ffc233;box-shadow:0 0 0 3px rgba(255,194,51,.25);margin-right:8px;vertical-align:1px}
.body{padding:26px 24px 24px}.logo{width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#34c759,#0e7a3d);color:#fff;font-size:26px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.icon{width:84px;height:84px;border-radius:50%;background:#fdf0e0;color:#f59e0b;box-shadow:0 0 0 7px rgba(245,158,11,.14);font-size:40px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
h1{font-size:19px;margin:0 0 8px}p{color:#6b7a70;line-height:1.55;margin:0}</style></head>
<body><div class="card"><div class="head"><span class="dot"></span>VITOT FOOD • THÔNG BÁO</div><div class="body">
<div class="logo">V</div><div class="icon">!</div>
<h1>Ứng dụng chỉ hoạt động trong mạng công ty</h1>
<p>Thiết bị của bạn đang ở ngoài mạng nội bộ của Vitot Food nên không thể truy cập Quản lí kho Vitot.<br><br>Vui lòng kết nối Wi-Fi/mạng tại công ty rồi thử lại. Nếu bạn đang ở công ty mà vẫn thấy thông báo này, hãy báo quản trị viên kiểm tra danh sách IP được phép.</p>
</div></div></body></html>`;

/* ---------------- Phiên đăng nhập + phân quyền ---------------- */
const sessions = new Map(); // token -> staffId
function roleOf(staff) { return state.roles.find(r => r.name === staff.roleName) || state.roles[1]; }
function isAdmin(staff) { return staff.roleName === 'ADMIN'; }
function adminCount() { return state.staff.filter(x => x.active && x.roleName === 'ADMIN').length; }
function permsOf(staff) { const r = roleOf(staff); return isAdmin(staff) ? Object.fromEntries(MODULES.map(m => [m, true])) : r.perms; }
function publicUser(staff) { const r = roleOf(staff); return { id: staff.id, name: staff.name, role: r.name, roleId: r.id, admin: isAdmin(staff), perms: permsOf(staff) }; }
function pinMatches(stored, input) {
  const s = String(stored || '').trim(), i = String(input || '').trim();
  if (!s) return false;
  if (s === i) return true;
  if (/^\d+$/.test(s) && s.length < 4 && s.padStart(4, '0') === i) return true; // PIN lưu dạng số bị mất số 0 đầu
  return false;
}

/* ---------------- HTTP helpers ---------------- */
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function auth(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sid = sessions.get(t);
  if (!sid) return null;
  return state.staff.find(s => s.id === sid && s.active) || null;
}
function needAdmin(req, res) {
  const u = auth(req);
  if (!u) { send(res, 401, { error: 'Chưa đăng nhập.' }); return null; }
  if (!isAdmin(u)) { send(res, 403, { error: 'Chỉ ADMIN mới có quyền này.' }); return null; }
  return u;
}

/* ---------------- Tạo phiếu → ghi xuống Sheet ---------------- */
const PREFIX = { in: 'NH', out: 'XH', check: 'KK', process: 'CB', recon: 'DS' };
function stripBlind(slip, viewer) {
  const copy = JSON.parse(JSON.stringify(slip));
  delete copy.rowRefs;
  delete copy.rows;
  if (!isAdmin(viewer)) {
    if (copy.type === 'check') for (const l of copy.lines || []) { delete l.systemStock; delete l.variance; delete l.matchStatus; }
    if (copy.type === 'recon') for (const l of copy.lines || []) delete l.warning;
  }
  return copy;
}
function productLabel(l, item) {
  const name = l.name || (item ? item.name : '');
  const variant = l.variant || (item ? item.variant : '');
  return variant ? `${name} (${variant})` : name;
}
async function createSlip(user, body) {
  requireWritable();
  const type = body.type;
  if (!PREFIX[type]) throw new Error('Loại phiếu không hợp lệ.');
  const permMap = { in: 'inbound', out: 'outbound', check: 'stocktake', process: 'processing', recon: 'recon' };
  if (!isAdmin(user) && !permsOf(user)[permMap[type]]) throw new Error('Tài khoản của bạn không có quyền tạo phiếu này.');
  const linesIn = Array.isArray(body.lines) ? body.lines : [];
  if (!linesIn.length) throw new Error('Chưa có sản phẩm/dòng nào trong phiếu.');
  const code = slipCode(PREFIX[type]);
  const dt = nowFull();
  const slip = {
    id: '', type, code, createdAt: nowText(), dateKey: todayKey(),
    creatorId: user.id, creatorName: user.name, // ghim từ phiên đăng nhập, không nhận từ client
    warehouse: body.warehouse || '', supplier: body.supplier || '',
    reason: body.reason || '', recipient: body.recipient || '', note: body.note || '',
    exportType: body.exportType || '', category: body.category || '',
    checker: '', expectedDate: '', expectedKey: '', // chỉ dùng cho phiếu nhập: Người kiểm (cột J) + Ngày về dự kiến (cột E) tab NHẬP_HÀNG
    lines: [], writeStatus: 'pending', writtenAt: '', writeError: '', rowRefs: [], rows: []
  };
  const rows = [];
  const itemOf = l => state.inventory.items.find(i => i.key === l.key);
  if (type === 'in') {
    // Người kiểm: lấy từ form nếu là nhân viên đang hoạt động, không hợp lệ thì ghim người đăng nhập.
    // Người TẠO phiếu (creatorName) vẫn luôn ghim theo phiên đăng nhập ở trên, không đổi.
    const checkerName = String(body.checker || '').trim();
    slip.checker = state.staff.some(s => s.active && s.name === checkerName) ? checkerName : user.name;
    slip.expectedDate = String(body.expectedDate || '').trim();
    slip.expectedKey = parseDateKey(slip.expectedDate);
    for (const l of linesIn) {
      const item = itemOf(l);
      const line = { key: l.key || '', name: l.name || (item ? item.name : ''), variant: l.variant || (item ? item.variant : ''), sampleCode: item ? item.sampleCode : (l.sampleCode || ''), qty: Number(l.qty) || 0, unit: l.unit || '' };
      slip.lines.push(line);
      rows.push([code, slip.warehouse, slip.supplier, dt, slip.expectedDate, productLabel(line, item), line.sampleCode, line.qty, line.unit, slip.checker, '']);
    }
  } else if (type === 'out') {
    for (const l of linesIn) {
      const item = itemOf(l);
      const line = { key: l.key || '', name: l.name || (item ? item.name : ''), variant: l.variant || (item ? item.variant : ''), sampleCode: item ? item.sampleCode : (l.sampleCode || ''), qty: Number(l.qty) || 0, unit: l.unit || '', note: String(l.note || '').trim() };
      slip.lines.push(line);
      rows.push([code, slip.warehouse, slip.exportType, slip.recipient, dt, productLabel(line, item), line.sampleCode, line.qty, line.unit, line.note || slip.note, user.name, '', '', '']);
    }
  } else if (type === 'check') {
    for (const l of linesIn) {
      const item = itemOf(l);
      const systemStock = item ? item.stock : 0;
      const counted = Number(l.counted) || 0;
      const variance = counted - systemStock;
      const matchStatus = variance === 0 ? 'Khớp' : (variance > 0 ? 'Thừa' : 'Thiếu');
      slip.lines.push({ key: l.key || '', name: l.name || (item ? item.name : ''), variant: l.variant || (item ? item.variant : ''), sampleCode: item ? item.sampleCode : (l.sampleCode || ''), counted, systemStock, variance, matchStatus });
      const statusText = variance === 0 ? '✅ Khớp' : `⚠️ ${matchStatus} ${variance > 0 ? '+' : ''}${variance}`;
      rows.push([code, slip.warehouse, dt, slip.lines[slip.lines.length - 1].sampleCode, productLabel(l, item), systemStock, counted, variance, slip.note, user.name, statusText, '', '']);
    }
  } else if (type === 'process') {
    for (const l of linesIn) {
      const item = itemOf(l);
      const inputQty = Number(l.inputQty) || 0, usable = Number(l.usable) || 0, discard = Number(l.discard) || 0;
      const loss = inputQty - usable - discard;
      // Thành phẩm: ghi vào 3 cột G/H/I của tab CHẾ_BIẾN_SƠ_CHẾ (trước đây để trống)
      const finItem = l.finishedKey ? state.inventory.items.find(i => i.key === l.finishedKey) : null;
      const finishedSku = finItem ? (finItem.sku || finItem.sampleCode || '') : '';
      const finishedName = finItem ? productLabel({ name: finItem.name, variant: finItem.variant }, null) : '';
      const posQty = Number(l.posQty) || 0;
      const reason = String(l.reason || '').trim();
      // Cột P "Lý do hủy / Ghi chú" chứa cả lý do hủy + ghi chú của phiếu
      const noteCell = [reason ? 'Lý do hủy: ' + reason : '', slip.note].filter(Boolean).join(' • ');
      const line = { key: l.key || '', name: l.name || (item ? item.name : ''), variant: l.variant || (item ? item.variant : ''), sampleCode: item ? item.sampleCode : '', unit: l.unit || '', inputQty, usable, discard, loss, usablePct: inputQty ? +(usable / inputQty * 100).toFixed(1) : 0, discardPct: inputQty ? +(discard / inputQty * 100).toFixed(1) : 0, lossPct: inputQty ? +(loss / inputQty * 100).toFixed(1) : 0, finishedSku, finishedName, posQty, reason };
      slip.lines.push(line);
      rows.push([code, slip.warehouse, dt, item ? (item.sku || item.sampleCode) : (l.sampleCode || ''), productLabel(line, item), inputQty, finishedSku, finishedName, posQty ? posQty : '', usable, discard, loss, line.usablePct, line.discardPct, line.lossPct, noteCell, user.name, '']);
    }
  } else if (type === 'recon') {
    // Cho phép quét TRÙNG: mỗi lượt quét là 1 dòng (client đã hỏi xác nhận trước khi thêm dòng trùng)
    for (const l of linesIn) { const c = String(l.code || '').trim(); if (c) slip.lines.push({ code: c, warning: '' }); }
    if (!slip.lines.length) throw new Error('Chưa quét đơn nào.');
    for (const l of slip.lines) rows.push([code, slip.warehouse, dt, user.name, l.code, '', '', 'Đã quét xuất kho', '']);
  }
  slip.rows = rows;
  slip.id = `${type}:${code}:local-${Date.now()}`;
  state.slips.unshift(slip);
  await writeSlipToSheet(slip); // ghi thẳng xuống Sheet; lỗi thì giữ trạng thái "error" để ghi lại, không làm mất phiếu
  return stripBlind(slip, user);
}

/* Ghi (lại) 1 phiếu xuống tab Sheet tương ứng; cập nhật trạng thái ghi trên phiếu */
async function writeSlipToSheet(slip) {
  const tab = TABS[slip.type];
  try {
    const upd = await apiValuesAppend(currentSheetId(), tab, slip.rows || []);
    const start = startRowOf(upd, (state.tabRows[tab] || 1) + 1);
    slip.rowRefs = (slip.rows || []).map((_, i) => ({ tab, row: start + i }));
    state.tabRows[tab] = (state.tabRows[tab] || 1) + (slip.rows || []).length;
    slip.id = `${slip.type}:${slip.code}:${start}`;
    slip.writeStatus = 'written'; slip.writtenAt = nowText(); slip.writeError = '';
  } catch (e) {
    slip.writeStatus = 'error'; slip.writeError = e.message || 'Không ghi được xuống Sheet.';
  }
  await persistPendingSlips();
  return slip;
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  try { await ensureCache(); }
  catch (e) { return send(res, 500, { error: 'Không đọc được Google Sheet: ' + e.message }); }

  if (p === '/api/login' && method === 'POST') {
    const { pin } = await readBody(req);
    const staff = state.staff.find(s => s.active && pinMatches(s.pin, pin));
    if (!staff) return send(res, 401, { error: 'Mã PIN không đúng. Vui lòng thử lại.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, staff.id);
    return send(res, 200, { token, user: publicUser(staff) });
  }
  const user = auth(req);
  if (!user) return send(res, 401, { error: 'Chưa đăng nhập.' });

  if (p === '/api/me') return send(res, 200, { user: publicUser(user) });
  if (p === '/api/logout' && method === 'POST') { sessions.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, '')); return send(res, 200, { ok: true }); }

  if (p === '/api/bootstrap') {
    const out = {
      user: publicUser(user), lists: state.lists, roles: state.roles.map(r => ({ id: r.id, name: r.name, system: r.system })),
      defaultWarehouse: state.defaultWarehouse, exportCategories: exportCategories(),
      staffNames: state.staff.filter(s => s.active).map(s => s.name),
      inventoryMeta: { count: state.inventory.items.length, syncedAt: state.inventory.syncedAt, posUpdatedAt: state.inventory.posUpdatedAt }
    };
    if (isAdmin(user)) out.sheet = { id: currentSheetId(), connected: true, mode: WRITABLE ? 'readwrite' : 'readonly', saEmail: creds ? creds.client_email : '' };
    return send(res, 200, out);
  }

  if (p === '/api/lists') return send(res, 200, { lists: state.lists });

  if (p === '/api/products') {
    const blind = url.searchParams.get('blind') === '1';
    const items = state.inventory.items.map(i => blind
      ? { key: i.key, name: i.name, variant: i.variant, sampleCode: i.sampleCode, warehouse: i.warehouse, category: i.category }
      : { key: i.key, sku: i.sku, name: i.name, variant: i.variant, sampleCode: i.sampleCode, barcode: i.barcode, category: i.category, warehouse: i.warehouse, supplier: i.supplier, sellable: i.sellable, stock: i.stock });
    return send(res, 200, { items });
  }

  if (p === '/api/inventory') {
    // Tra cứu tồn kho theo SỔ KHO ĐỘC LẬP (tính từ phiếu đã ghi Sheet) — KHÔNG dùng tồn POS.
    // Danh mục POS (TỒN_KHO_POS) chỉ còn phục vụ picker chọn sản phẩm qua /api/products.
    if (!permsOf(user).inventory && !isAdmin(user)) return send(res, 403, { error: 'Không có quyền tra cứu tồn kho.' });
    const wh = url.searchParams.get('warehouse') || '';
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const filter = url.searchParams.get('filter') || 'all';
    let items = computeWarehouseStock();
    const inWh = wh ? items.filter(i => (i.warehouse || '').includes(wh)) : items;
    const counts = { all: inWh.length, available: inWh.filter(i => i.stock > 0).length, out: inWh.filter(i => i.stock <= 0).length };
    items = inWh;
    if (filter === 'available') items = items.filter(i => i.stock > 0);
    if (filter === 'out') items = items.filter(i => i.stock <= 0);
    if (q) items = items.filter(i => (i.name + ' ' + i.code + ' ' + i.warehouse).toLowerCase().includes(q));
    items.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const size = 100;
    return send(res, 200, { counts, total: items.length, page, items: items.slice((page - 1) * size, page * size), syncedAt: state.inventory.syncedAt, source: 'warehouse-ledger' });
  }

  if (p === '/api/dashboard') {
    if (!isAdmin(user)) return send(res, 403, { error: 'Chỉ ADMIN mới xem được Dashboard.' });
    const items = state.inventory.items;
    const tk = todayKey();
    // Bộ lọc thời gian chung: from/to dạng YYYY-MM-DD (mặc định: hôm nay)
    let from = url.searchParams.get('from') || tk;
    let to = url.searchParams.get('to') || tk;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = tk;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = tk;
    if (from > to) return send(res, 400, { error: 'Khoảng ngày không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' });
    const inRange = s => (s.dateKey || '') >= from && (s.dateKey || '') <= to;
    const ranged = state.slips.filter(inRange);
    const byType = t => ranged.filter(s => s.type === t).length;
    // Biểu đồ theo từng ngày trong kỳ
    const chart = [];
    {
      const start = new Date(from + 'T00:00:00+07:00'), end = new Date(to + 'T00:00:00+07:00');
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
        const pp = {}; parts.forEach(x => pp[x.type] = x.value);
        const key = `${pp.year}-${pp.month}-${pp.day}`;
        chart.push({ day: `${pp.day}/${pp.month}`, key, in: ranged.filter(s => s.dateKey === key && s.type === 'in').length, out: ranged.filter(s => s.dateKey === key && s.type === 'out').length });
      }
    }
    // Hiệu suất chế biến trong kỳ: cộng dồn mọi dòng của phiếu chế biến
    const proc = { batches: 0, inputKg: 0, usableKg: 0, wasteKg: 0, lossKg: 0 };
    for (const s of ranged.filter(s => s.type === 'process')) {
      proc.batches++;
      for (const l of s.lines || []) { proc.inputKg += Number(l.inputQty) || 0; proc.usableKg += Number(l.usable) || 0; proc.wasteKg += Number(l.discard) || 0; proc.lossKg += Number(l.loss) || 0; }
    }
    const pct = x => proc.inputKg > 0 ? +(x / proc.inputKg * 100).toFixed(1) : 0;
    const cheBienStats = { batches: proc.batches, inputKg: proc.inputKg, sellableKg: proc.usableKg, sellablePct: pct(proc.usableKg), wasteKg: proc.wasteKg, wastePct: pct(proc.wasteKg), lossKg: proc.lossKg, lossPct: pct(proc.lossKg) };
    // Đối soát trong kỳ: tổng dòng quét + lượt quét trùng (tổng dòng − số mã khác nhau, cộng theo từng phiên)
    let reconScanned = 0, reconDuplicates = 0;
    for (const s of ranged.filter(s => s.type === 'recon')) {
      const codes = (s.lines || []).map(l => l.code);
      reconScanned += codes.length;
      reconDuplicates += codes.length - new Set(codes).size;
    }
    return send(res, 200, {
      period: { from, to },
      totalProducts: items.length,
      totalStock: items.reduce((a, i) => a + i.stock, 0),
      outOfStock: items.filter(i => i.stock <= 0).length,
      lowStockList: items.filter(i => i.stock > 0 && i.stock <= 5).slice(0, 10),
      outList: items.filter(i => i.stock <= 0).slice(0, 10),
      slipsInPeriod: ranged.length,
      byType: { in: byType('in'), out: byType('out'), check: byType('check'), process: byType('process'), recon: byType('recon') },
      written: ranged.filter(s => s.writeStatus === 'written').length,
      reconWarnings: ranged.filter(s => s.type === 'check' && s.lines.some(l => l.variance !== 0)).length,
      cheBienStats, reconScanned, reconDuplicates,
      recent: state.slips.slice(0, 8).map(s => stripBlind(s, user)), chart
    });
  }

  if (p === '/api/slips' && method === 'POST') {
    const body = await readBody(req);
    try { const slip = await createSlip(user, body); return send(res, 200, { slip }); }
    catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
  }
  if (p === '/api/history') {
    if (!permsOf(user).history && !isAdmin(user)) return send(res, 403, { error: 'Không có quyền xem lịch sử.' });
    const type = url.searchParams.get('type') || '';
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const ws = url.searchParams.get('writeStatus') || '';
    let slips = state.slips;
    if (type) slips = slips.filter(s => s.type === type);
    if (from) slips = slips.filter(s => (s.dateKey || '') >= from);
    if (to) slips = slips.filter(s => (s.dateKey || '') <= to);
    if (ws === 'written') slips = slips.filter(s => s.writeStatus === 'written');
    if (ws === 'unwritten') slips = slips.filter(s => s.writeStatus !== 'written');
    if (ws === 'error') slips = slips.filter(s => s.writeStatus === 'error');
    return send(res, 200, { slips: slips.slice(0, 300).map(s => stripBlind(s, user)) });
  }
  const retryMatch = p.match(/^\/api\/slips\/(.+)\/retry-write$/);
  if (retryMatch && method === 'POST') {
    const slip = state.slips.find(s => s.id === decodeURIComponent(retryMatch[1]));
    if (!slip) return send(res, 404, { error: 'Không tìm thấy phiếu.' });
    if (slip.writeStatus === 'written') return send(res, 200, { slip: stripBlind(slip, user) });
    try {
      requireWritable();
      if (!slip.rows || !slip.rows.length) return send(res, 400, { error: 'Phiếu này không còn dữ liệu dòng để ghi lại. Hãy tải lại dữ liệu từ Sheet.' });
      await writeSlipToSheet(slip);
      if (slip.writeStatus !== 'written') return send(res, 400, { error: 'Ghi lại vẫn lỗi: ' + slip.writeError });
      return send(res, 200, { slip: stripBlind(slip, user) });
    } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
  }

  /* ---- Phân loại xuất kho (ADMIN tuỳ chỉnh, lưu APP_CAI_DAT) ---- */
  if (p === '/api/export-categories') {
    if (method === 'GET') return send(res, 200, { categories: exportCategories() });
    if (!needAdmin(req, res)) return;
    if (method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!name) return send(res, 400, { error: 'Chưa nhập tên phân loại.' });
      const list = exportCategories();
      if (list.some(x => x.toLowerCase() === name.toLowerCase())) return send(res, 400, { error: 'Phân loại này đã có trong danh sách.' });
      list.push(name);
      state.exportCategories = list;
      try { await persistExportCategories(); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { categories: list });
    }
  }
  const catMatch = p.match(/^\/api\/export-categories\/(.+)$/);
  if (catMatch) {
    if (!needAdmin(req, res)) return;
    const oldName = decodeURIComponent(catMatch[1]);
    const list = exportCategories();
    const idx = list.indexOf(oldName);
    if (idx < 0) return send(res, 404, { error: 'Không tìm thấy phân loại.' });
    if (method === 'PUT') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!name) return send(res, 400, { error: 'Chưa nhập tên phân loại.' });
      if (list.some((x, i) => i !== idx && x.toLowerCase() === name.toLowerCase())) return send(res, 400, { error: 'Tên phân loại đã tồn tại.' });
      list[idx] = name; state.exportCategories = list;
      try { await persistExportCategories(); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { categories: list });
    }
    if (method === 'DELETE') {
      list.splice(idx, 1); state.exportCategories = list;
      try { await persistExportCategories(); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { categories: list });
    }
  }

  /* ---- Lịch: hàng về (từ phiếu nhập có Ngày về dự kiến) + sự kiện kiểu Google Calendar ---- */
  if (p === '/api/calendar' && method === 'GET') {
    if (!permsOf(user).calendar && !isAdmin(user)) return send(res, 403, { error: 'Không có quyền xem lịch.' });
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const arrivals = state.slips.filter(s => s.type === 'in' && s.expectedKey)
      .filter(s => (!from || s.expectedKey >= from) && (!to || s.expectedKey <= to))
      .map(s => ({ slipId: s.id, code: s.code, date: s.expectedKey, warehouse: s.warehouse || '', supplier: s.supplier || '', creatorName: s.creatorName || '', lines: (s.lines || []).map(l => ({ name: l.name, qty: l.qty, unit: l.unit })) }));
    const events = state.calendarEvents
      .filter(e => (!from || e.date >= from) && (!to || e.date <= to))
      .map(e => ({ ...e, canEdit: isAdmin(user) || e.creatorId === user.id }));
    return send(res, 200, { arrivals, events });
  }
  if (p === '/api/calendar-events' && method === 'POST') {
    if (!permsOf(user).calendar && !isAdmin(user)) return send(res, 403, { error: 'Không có quyền thêm sự kiện.' });
    const b = await readBody(req);
    const title = String(b.title || '').trim();
    const date = String(b.date || '').trim();
    if (!title) return send(res, 400, { error: 'Chưa nhập tiêu đề sự kiện.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Ngày sự kiện không hợp lệ.' });
    const ev = { id: 'ev-' + crypto.randomBytes(6).toString('hex'), title, date, time: String(b.time || '').trim(), note: String(b.note || '').trim(), creatorId: user.id, creatorName: user.name, createdAt: nowText() };
    state.calendarEvents.push(ev);
    try { await persistCalendarEvents(); } catch (e) { state.calendarEvents = state.calendarEvents.filter(x => x.id !== ev.id); return send(res, 400, { error: e.message }); }
    return send(res, 200, { event: { ...ev, canEdit: true } });
  }
  const evMatch = p.match(/^\/api\/calendar-events\/(.+)$/);
  if (evMatch) {
    const ev = state.calendarEvents.find(x => x.id === decodeURIComponent(evMatch[1]));
    if (!ev) return send(res, 404, { error: 'Không tìm thấy sự kiện.' });
    if (!isAdmin(user) && ev.creatorId !== user.id) return send(res, 403, { error: 'Chỉ người tạo sự kiện hoặc ADMIN mới sửa/xoá được sự kiện này.' });
    if (method === 'PUT') {
      const b = await readBody(req);
      const title = String(b.title || '').trim();
      const date = String(b.date || '').trim();
      if (!title) return send(res, 400, { error: 'Chưa nhập tiêu đề sự kiện.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Ngày sự kiện không hợp lệ.' });
      Object.assign(ev, { title, date, time: String(b.time || '').trim(), note: String(b.note || '').trim() });
      try { await persistCalendarEvents(); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { event: { ...ev, canEdit: true } });
    }
    if (method === 'DELETE') {
      state.calendarEvents = state.calendarEvents.filter(x => x.id !== ev.id);
      try { await persistCalendarEvents(); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { ok: true });
    }
  }

  if (p === '/api/profile' && method === 'POST') {
    const body = await readBody(req);
    try {
      requireWritable();
      const newName = body.name ? String(body.name).trim() : user.name;
      let newPin = user.pin;
      if (body.pin) {
        if (!/^\d{4}$/.test(String(body.pin))) return send(res, 400, { error: 'PIN phải gồm đúng 4 chữ số.' });
        if (state.staff.some(s => s.id !== user.id && pinMatches(s.pin, body.pin))) return send(res, 400, { error: 'PIN này đã có người dùng.' });
        newPin = String(body.pin);
      }
      const data = [];
      if (newName !== user.name) data.push({ range: `'CẤU_HÌNH'!B${user.row}`, values: [[newName]] });
      if (newPin !== user.pin) data.push({ range: `'CẤU_HÌNH'!E${user.row}`, values: [[newPin]] });
      if (data.length) await apiValuesBatchUpdate(currentSheetId(), data, true);
      user.name = newName; user.pin = newPin;
      return send(res, 200, { user: publicUser(user) });
    } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
  }

  /* ---- ADMIN: kho mặc định ---- */
  if (p === '/api/default-warehouse' && method === 'POST') {
    if (!needAdmin(req, res)) return;
    const b = await readBody(req);
    const wh = String(b.warehouse || '').trim();
    if (!wh) return send(res, 400, { error: 'Chưa chọn kho mặc định.' });
    state.defaultWarehouse = wh;
    try { await setSetting('default_warehouse', wh); } catch (e) { /* chỉ đọc: giữ trong bộ nhớ */ }
    return send(res, 200, { ok: true, defaultWarehouse: wh });
  }

  /* ---- ADMIN: khoá mạng công ty ---- */
  if (p === '/api/my-ip') {
    if (!needAdmin(req, res)) return;
    return send(res, 200, { ip: clientIp(req) });
  }
  if (p === '/api/ip-lock') {
    if (!needAdmin(req, res)) return;
    if (method === 'GET') return send(res, 200, { enabled: !!state.ipLock.enabled, allow: state.ipLock.allow || [], currentIp: clientIp(req) });
    if (method === 'POST') {
      const b = await readBody(req);
      const allow = Array.isArray(b.allow) ? [...new Set(b.allow.map(x => String(x).trim()).filter(Boolean))] : (state.ipLock.allow || []);
      const enabled = typeof b.enabled === 'boolean' ? b.enabled : !!state.ipLock.enabled;
      if (enabled && !ipAllowed(clientIp(req), allow)) {
        return send(res, 400, { error: `Không thể bật: IP hiện tại của bạn (${clientIp(req)}) chưa có trong danh sách được phép. Hãy bấm "Dùng IP hiện tại của tôi" để thêm vào trước, nếu không bạn sẽ tự khoá mình ở ngoài.` });
      }
      state.ipLock = { enabled, allow };
      try { await setSetting('ip_lock', JSON.stringify(state.ipLock)); } catch (e) { /* chỉ đọc: giữ trong bộ nhớ */ }
      return send(res, 200, { ok: true, enabled, allow, currentIp: clientIp(req) });
    }
  }

  /* ---- ADMIN: kết nối tên miền riêng (tự cấu hình trong app; DNS thật sửa ở nhà đăng ký — TenTen) ---- */
  if (p === '/api/domain-config') {
    if (!needAdmin(req, res)) return;
    const hostTarget = String(process.env.HOST_TARGET || req.headers.host || '').trim();
    if (method === 'GET') return send(res, 200, { domain: state.customDomain, suggestedDomain: SUGGESTED_DOMAIN, hostTarget });
    if (method === 'POST') {
      const b = await readBody(req);
      const d = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (d && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
        return send(res, 400, { error: 'Tên miền chưa đúng định dạng. Ví dụ đúng: kho.vitot.vn' });
      }
      state.customDomain = d;
      try { await setSetting('custom_domain', d); } catch (e) { /* chỉ đọc: giữ trong bộ nhớ */ }
      return send(res, 200, { ok: true, domain: d, hostTarget });
    }
  }
  if (p === '/api/domain-check' && method === 'POST') {
    if (!needAdmin(req, res)) return;
    const d = state.customDomain;
    const targetRaw = String(process.env.HOST_TARGET || req.headers.host || '').trim();
    const target = targetRaw.split(':')[0].toLowerCase();
    if (!d) return send(res, 200, { status: 'unconfigured', message: 'Chưa cấu hình tên miền. Hãy nhập tên miền (gợi ý: ' + SUGGESTED_DOMAIN + ') và bấm Lưu trước.', domain: '', target });
    const norm = s => String(s || '').toLowerCase().replace(/\.$/, '');
    // Kiểm tra DNS thật qua DNS-over-HTTPS (Google), dự phòng bộ phân giải hệ thống
    const dohBase = (process.env.DOH_URL || 'https://dns.google/resolve').replace(/\/$/, '');
    async function resolveAll(name) {
      const out = { cname: [], a: [] };
      try {
        for (const [type, key] of [['CNAME', 'cname'], ['A', 'a']]) {
          const r = await httpRequest(`${dohBase}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/dns-json' } });
          const j = JSON.parse(r.text);
          for (const ans of j.Answer || []) {
            if (ans.type === 5) out.cname.push(norm(ans.data));
            if (ans.type === 1) out.a.push(String(ans.data).trim());
          }
        }
        return out;
      } catch { /* rơi xuống bộ phân giải hệ thống bên dưới */ }
      try { out.cname = (await dns.resolveCname(name)).map(norm); } catch {}
      try { out.a = await dns.resolve4(name); } catch {}
      return out;
    }
    const mine = await resolveAll(d);
    const targetRes = /^[a-z0-9.-]+$/.test(target) && !/^\d+\.\d+\.\d+\.\d+$/.test(target) ? await resolveAll(target) : { cname: [], a: /^\d+\.\d+\.\d+\.\d+$/.test(target) ? [target] : [] };
    const viaOwnHost = norm((req.headers.host || '').split(':')[0]) === d;
    const cnameHit = mine.cname.some(c => c === norm(target));
    const aHit = mine.a.some(ip => targetRes.a.includes(ip));
    if (viaOwnHost || cnameHit || aHit) {
      return send(res, 200, { status: 'connected', message: viaOwnHost ? 'Đã kết nối — bạn đang truy cập app qua chính tên miền này.' : 'Đã kết nối — DNS của tên miền đã trỏ đúng về máy chủ app.', domain: d, target, resolvesTo: mine });
    }
    if (mine.cname.length || mine.a.length) {
      return send(res, 200, { status: 'wrong', message: `Chưa trỏ đúng — DNS hiện tại của ${d}: ${[...mine.cname.map(c => 'CNAME → ' + c), ...mine.a.map(ip => 'A → ' + ip)].join('; ')}. Cần trỏ CNAME về: ${target}.`, domain: d, target, resolvesTo: mine });
    }
    return send(res, 200, { status: 'wrong', message: `Chưa trỏ đúng — chưa đọc được bản ghi DNS nào của ${d}. Hãy tạo bản ghi CNAME (Name: ${d.split('.')[0]}) tại Cloudflare (DNS → Records) trỏ về: ${target}, để Proxy status = DNS only, rồi đợi DNS cập nhật (vài phút đến vài giờ) và kiểm tra lại.`, domain: d, target, resolvesTo: mine });
  }

  /* ---- ADMIN: nhân sự / chức vụ (ghi về CẤU_HÌNH + APP_CAI_DAT) ---- */
  if (p === '/api/staff') {
    if (!needAdmin(req, res)) return;
    if (method === 'GET') return send(res, 200, { staff: state.staff.map(s => ({ id: s.id, name: s.name, pin: s.pin, roleId: roleOf(s).id, role: roleOf(s).name, active: s.active })) });
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !/^\d{4}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'Cần tên và PIN 4 chữ số.' });
      if (state.staff.some(s => pinMatches(s.pin, b.pin))) return send(res, 400, { error: 'PIN này đã có người dùng.' });
      try {
        requireWritable();
        const roleName = (state.roles.find(r => r.id === b.roleId) || state.roles[1]).name;
        const name = String(b.name).trim(), pin = String(b.pin);
        // Ưu tiên ghi vào dòng trống sẵn có trong CẤU_HÌNH (giữ nguyên cột ĐVT), hết dòng trống mới thêm dòng mới
        let targetRow = 0;
        for (let r = 2; r <= (state.tabRows['CẤU_HÌNH'] || 1); r++) {
          const row = state.configRows[r] || [];
          if (!String(row[1] || '').trim() && !String(row[4] || '').trim() && !String(row[5] || '').trim()) { targetRow = r; break; }
        }
        if (targetRow) {
          await apiValuesBatchUpdate(currentSheetId(), [
            { range: `'CẤU_HÌNH'!B${targetRow}`, values: [[name]] },
            { range: `'CẤU_HÌNH'!E${targetRow}:F${targetRow}`, values: [[pin, roleName]] }
          ], true);
        } else {
          const upd = await apiValuesAppend(currentSheetId(), 'CẤU_HÌNH', [['', name, '', '', pin, roleName]]);
          targetRow = startRowOf(upd, (state.tabRows['CẤU_HÌNH'] || 1) + 1);
          state.tabRows['CẤU_HÌNH'] = (state.tabRows['CẤU_HÌNH'] || 1) + 1;
        }
        const s = { id: 'staff-r' + targetRow, row: targetRow, name, pin, roleName, active: true };
        state.staff.push(s);
        return send(res, 200, { staff: s });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
  }
  const staffMatch = p.match(/^\/api\/staff\/([\w-]+)$/);
  if (staffMatch) {
    if (!needAdmin(req, res)) return;
    const s = state.staff.find(x => x.id === staffMatch[1]);
    if (!s) return send(res, 404, { error: 'Không tìm thấy nhân sự.' });
    if (method === 'PUT') {
      const b = await readBody(req);
      try {
        requireWritable();
        const newName = b.name ? String(b.name).trim() : s.name;
        let newPin = s.pin;
        if (b.pin) { if (!/^\d{4}$/.test(String(b.pin))) return send(res, 400, { error: 'PIN phải gồm 4 chữ số.' }); if (state.staff.some(x => x.id !== s.id && pinMatches(x.pin, b.pin))) return send(res, 400, { error: 'PIN trùng.' }); newPin = String(b.pin); }
        const newRole = b.roleId ? (state.roles.find(r => r.id === b.roleId) || roleOf(s)).name : s.roleName;
        if (s.roleName === 'ADMIN' && newRole !== 'ADMIN' && adminCount() <= 1) {
          return send(res, 400, { error: 'Không thể đổi chức vụ của ADMIN cuối cùng. Hệ thống phải luôn có ít nhất 1 ADMIN — hãy phong 1 nhân viên khác làm ADMIN trước.' });
        }
        const data = [];
        if (newName !== s.name) data.push({ range: `'CẤU_HÌNH'!B${s.row}`, values: [[newName]] });
        if (newPin !== s.pin || newRole !== s.roleName) data.push({ range: `'CẤU_HÌNH'!E${s.row}:F${s.row}`, values: [[newPin, newRole]] });
        if (data.length) await apiValuesBatchUpdate(currentSheetId(), data, true);
        s.name = newName; s.pin = newPin; s.roleName = newRole;
        return send(res, 200, { staff: s });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
    if (method === 'DELETE') {
      if (s.roleName === 'ADMIN' && adminCount() <= 1) return send(res, 400, { error: 'Không thể xoá ADMIN cuối cùng của hệ thống. Hãy phong 1 nhân viên khác làm ADMIN trước khi xoá.' });
      try {
        requireWritable();
        await apiValuesBatchUpdate(currentSheetId(), [
          { range: `'CẤU_HÌNH'!B${s.row}`, values: [['']] },
          { range: `'CẤU_HÌNH'!E${s.row}:F${s.row}`, values: [['', '']] }
        ], true);
        state.staff = state.staff.filter(x => x.id !== s.id);
        for (const [t, sid] of sessions) if (sid === s.id) sessions.delete(t);
        return send(res, 200, { ok: true });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
  }
  if (p === '/api/roles') {
    if (!needAdmin(req, res)) return;
    if (method === 'GET') return send(res, 200, { roles: state.roles });
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name) return send(res, 400, { error: 'Cần tên chức vụ.' });
      if (state.roles.some(r => r.name === String(b.name).trim())) return send(res, 400, { error: 'Tên chức vụ đã tồn tại.' });
      try {
        requireWritable();
        const r = { id: 'role-x' + crypto.randomBytes(4).toString('hex'), name: String(b.name).trim(), system: false, perms: {} };
        MODULES.forEach(m => r.perms[m] = !!((b.perms || {})[m]));
        state.roles.push(r);
        await persistRoles();
        return send(res, 200, { role: r });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
  }
  const roleMatch = p.match(/^\/api\/roles\/([\w-]+)$/);
  if (roleMatch) {
    if (!needAdmin(req, res)) return;
    const r = state.roles.find(x => x.id === roleMatch[1]);
    if (!r) return send(res, 404, { error: 'Không tìm thấy chức vụ.' });
    if (method === 'PUT') {
      const b = await readBody(req);
      try {
        requireWritable();
        if (b.perms && r.name !== 'ADMIN') { MODULES.forEach(m => r.perms[m] = !!b.perms[m]); }
        if (!r.system && b.name && String(b.name).trim() !== r.name) {
          const newName = String(b.name).trim();
          if (state.roles.some(x => x.id !== r.id && x.name === newName)) return send(res, 400, { error: 'Tên chức vụ đã tồn tại.' });
          const affected = state.staff.filter(s => s.roleName === r.name);
          if (affected.length) await apiValuesBatchUpdate(currentSheetId(), affected.map(s => ({ range: `'CẤU_HÌNH'!F${s.row}`, values: [[newName]] })), true);
          affected.forEach(s => s.roleName = newName);
          r.name = newName;
        }
        await persistRoles();
        return send(res, 200, { role: r });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
    if (method === 'DELETE') {
      if (r.system) return send(res, 400, { error: 'Không xoá được chức vụ hệ thống.' });
      if (state.staff.some(s => s.roleName === r.name)) return send(res, 400, { error: 'Chức vụ đang có người dùng, không xoá được.' });
      try {
        requireWritable();
        state.roles = state.roles.filter(x => x.id !== r.id);
        await persistRoles();
        return send(res, 200, { ok: true });
      } catch (e) { return send(res, e.message === READONLY_MSG ? 403 : 400, { error: e.message }); }
    }
  }

  /* ---- ADMIN: kết nối Sheet / đồng bộ ---- */
  if (p === '/api/sheet-config') {
    if (!needAdmin(req, res)) return;
    if (method === 'GET') return send(res, 200, { id: currentSheetId(), connected: true, mode: WRITABLE ? 'readwrite' : 'readonly', saEmail: creds ? creds.client_email : '', syncedAt: state.inventory.syncedAt, count: state.inventory.items.length });
    if (method === 'POST') {
      const b = await readBody(req);
      const id = sheetIdFrom(b.id || b.link || '');
      if (!id) return send(res, 400, { error: 'Chưa nhập link/ID Sheet.' });
      try {
        state.runtimeSheetId = id;
        state.loaded = false;
        await ensureCache();
        if (WRITABLE) { try { await setSetting('sheet_id', id); } catch {} }
        return send(res, 200, { ok: true, count: state.inventory.items.length, syncedAt: state.inventory.syncedAt });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (method === 'DELETE') {
      try { if (WRITABLE) await setSetting('sheet_id', ''); } catch {}
      state.runtimeSheetId = '';
      state.loaded = false;
      state.staff = []; state.slips = []; state.inventory = { items: [], syncedAt: '', posUpdatedAt: '' };
      return send(res, 200, { ok: true });
    }
  }
  if (p === '/api/sheet-sync' && method === 'POST') {
    if (!needAdmin(req, res)) return;
    try { await reloadCache(); return send(res, 200, { ok: true, count: state.inventory.items.length, syncedAt: state.inventory.syncedAt, posUpdatedAt: state.inventory.posUpdatedAt }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  return send(res, 404, { error: 'Không tìm thấy API.' });
}

/* ---------------- Static + khởi động ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Nạp cài đặt (gồm khoá IP) từ Sheet trước khi kiểm tra — lỗi đọc Sheet thì dùng giá trị đã biết/mặc định tắt
  try { await ensureCache(); } catch {}
  if (ipLockActive() && !ipAllowed(clientIp(req), state.ipLock.allow)) {
    if (url.pathname.startsWith('/api/')) return send(res, 403, { error: 'Ứng dụng chỉ hoạt động trong mạng công ty. IP hiện tại của bạn không nằm trong danh sách được phép.' });
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(BLOCK_PAGE);
  }
  if (url.pathname.startsWith('/api/')) { try { await api(req, res, url); } catch (e) { send(res, 500, { error: 'Lỗi máy chủ: ' + e.message }); } return; }
  let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
server.listen(PORT, () => console.log(`Quan li kho Vitot dang chay tai http://localhost:${PORT} | Che do: ${WRITABLE ? 'DOC + GHI Google Sheet (tai khoan dich vu: ' + creds.client_email + ')' : 'CHI DOC (chua co tai khoan dich vu)'}`));
