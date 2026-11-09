'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const SECTIONS = ['analysis', 'requests', 'clients', 'products', 'users'];
const DEF = () => ({
  clients: [], products: [], quotes: [], requests: [],
  company: { name: '', taxId: '', phone: '', email: '', address: '', logo: 'T' },
  settings: { tax: 14, currency: 'EGP', theme: 'light', lang: 'ar', stats: true, hidden: {} }
});
let S = DEF(), page = 'quotes', filter = 'All', q = '';
const L = () => pref.get('lang', 'ar'), t = k => (I18N[L()][k] ?? k);
const money = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + S.settings.currency;
let saveT; let TOKEN = null, ME = null, CFG = null, lastJ = '', syncT;
const call = async (op, body) => {
  const r = await window.api.rpc(op, TOKEN, body);
  if (r.error) { if (r.status === 401 && TOKEN) { TOKEN = null; ME = null; boot(); } throw new Error(r.error); }
  return r.data;
};
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => call('save', S).then(() => { lastJ = JSON.stringify(S); }).catch(e => toast(t(e.message), true)), 300); };
const byId = (arr, id) => arr.find(x => x.id === id);
const qTotals = x => { const sub = x.items.reduce((a, i) => a + i.qty * i.price, 0), tax = sub * (x.tax / 100); return { sub, tax, total: sub + tax }; };
const reqStatus = r => r.status === 'Open' && r.due && r.due < today() ? 'Overdue' : r.status;

function applyState(d) {
  const b = DEF(); S = { ...b, ...d, company: { ...b.company, ...d.company }, settings: { ...b.settings, ...d.settings } }; delete S.users;
}
async function loadData() {
  const d = await call('load');
  if (d) applyState(d); else { S = DEF(); seed(); await call('save', S); }
  lastJ = JSON.stringify(S);
}
function seed() {
  S.clients.push({ id: 'c1', name: 'Al-Nile Contracting', phone: '0100 000 0000', email: 'info@nile.example', address: 'Cairo' });
  S.products.push({ id: 'p1', code: 'ERP-1', name: 'ERP License', type: 'service', unit: 'year', price: 96000 });
}
/* ---------- screens: setup wizard / first admin / login ---------- */
function screen(html, bind) {
  applyLook(); $('#side').style.display = 'none';
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#main').innerHTML = `<div class="tools"><button class="btn g s" id="stl">${dark ? '☀️' : '🌙'}</button><button class="btn g s" id="sll">${L() === 'ar' ? 'EN' : 'عربي'}</button></div><div class="scr"><div style="text-align:center;margin-bottom:18px"><img src="logo.png" width="84" alt=""><h1 style="margin:8px 0 0">Quotation Management</h1></div>${html}</div>`;
  $('#stl').onclick = () => { pref.set('theme', dark ? 'light' : 'dark'); boot(); };
  $('#sll').onclick = () => { pref.set('lang', L() === 'ar' ? 'en' : 'ar'); boot(); };
  bind && bind();
}
async function boot() {
  clearInterval(syncT); CFG = await window.api.cfg();
  if (!CFG) return wizard();
  let st; try { st = await call('status'); } catch (e) { return connError(); }
  if (!st.hasUsers) return firstAdmin();
  if (!TOKEN) return loginScreen();
  try { await loadData(); } catch (e) { return connError(); }
  render(); startSync();
}
function connError() {
  screen(`<div class="card alert">${t('srv_err')}: ${esc(CFG.url || '')}</div><div class="row"><button class="btn" id="rt">${t('retry')}</button><button class="btn g" id="cm">${t('change_mode')}</button></div>`, () => {
    $('#rt').onclick = boot; $('#cm').onclick = async () => { await window.api.setCfg(null); TOKEN = null; boot(); };
  });
}
function wizard() {
  const w = window.__w || (window.__w = { mode: 'standalone', name: 'QM-Server', port: 4747, url: '', found: null });
  screen(`<h2>${t('setup_title')}</h2>` + ['standalone', 'server', 'client'].map(m => `<label class="card" style="cursor:pointer;display:block;color:var(--tx)"><input type="radio" name="m" value="${m}" style="width:auto" ${w.mode === m ? 'checked' : ''}> <b>${t('m_' + m)}</b><div style="color:var(--mut);font-size:13px">${t('d_' + m)}</div></label>`).join('') +
    (w.mode === 'server' ? `<div class="card"><div class="cols"><div><label>${t('dev_name')}</label><input id="wn" value="${esc(w.name)}"></div><div><label>${t('port')}</label><input id="wp" type="number" value="${w.port}"></div></div><div style="color:var(--mut);font-size:12px;margin-top:8px">${t('fw')}</div></div>` : '') +
    (w.mode === 'client' ? `<div class="card"><button class="btn g" id="sc">${t('scan')}</button>` + (w.found ? (w.found.length ? w.found.map(f => `<label style="color:var(--tx)"><input type="radio" name="f" value="http://${f.ip}:${f.port}" style="width:auto" ${w.url === 'http://' + f.ip + ':' + f.port ? 'checked' : ''}> ${esc(f.name)} — ${f.ip}:${f.port}</label>`).join('') : `<p>${t('none_found')}</p>`) : '') + `<label>${t('manual')}</label><input id="wu" dir="ltr" value="${esc(w.url)}"></div>` : '') +
    `<div class="row"><button class="btn" id="go">${t('cont')}</button></div>`, () => {
    const keep = () => { w.name = $('#wn')?.value ?? w.name; w.port = Number($('#wp')?.value || w.port); w.url = $('#wu')?.value ?? w.url; };
    document.querySelectorAll('[name=m]').forEach(r => r.onchange = () => { keep(); w.mode = r.value; wizard(); });
    document.querySelectorAll('[name=f]').forEach(r => r.onchange = () => { w.url = r.value; $('#wu').value = r.value; });
    if ($('#sc')) $('#sc').onclick = async () => { keep(); $('#sc').disabled = true; w.found = await window.api.scan(); if (w.found.length === 1) w.url = `http://${w.found[0].ip}:${w.found[0].port}`; wizard(); };
    $('#go').onclick = async () => {
      keep(); const c = { mode: w.mode };
      if (w.mode === 'server') { c.name = w.name || 'QM-Server'; c.port = w.port || 4747; }
      if (w.mode === 'client') {
        let u = (w.url || '').trim(); if (!u) return $('#wu').focus();
        if (!/^https?:\/\//.test(u)) u = 'http://' + u; if (!/:\d+$/.test(u)) u += ':4747'; c.url = u;
        const r = await window.api.test(u); if (r.error) return toast(t('srv_err') + ': ' + r.error, true);
      }
      await window.api.setCfg(c); boot();
    };
  });
}
function firstAdmin() {
  screen(`<h2>${t('create_admin')}</h2><div class="card"><label>${t('full_name')}</label><input id="fn"><label>${t('username')}</label><input id="un" dir="ltr"><label>${t('password')}</label><input id="pw" type="password" dir="ltr"><div class="row" style="margin-top:14px"><button class="btn" id="ok">${t('save')}</button></div></div>`, () => {
    $('#ok').onclick = async () => { try { await call('setup', { name: $('#fn').value, username: $('#un').value, password: $('#pw').value }); await doLogin($('#un').value, $('#pw').value); } catch (e) { toast(t(e.message), true); } };
  });
}
async function doLogin(u, p) { const r = await call('login', { username: u, password: p }); TOKEN = r.token; ME = r.user; boot(); }
function loginScreen() {
  screen(`<div class="card"><h2>${t('login')}</h2><label>${t('username')}</label><input id="un" dir="ltr" autofocus><label>${t('password')}</label><input id="pw" type="password" dir="ltr"><div class="row" style="margin-top:14px"><button class="btn" id="ok">${t('login')}</button></div></div>`, () => {
    const go = async () => { try { await doLogin($('#un').value, $('#pw').value); } catch (e) { toast(t(e.message), true); } };
    $('#ok').onclick = go; $('#pw').onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
/* live refresh so every device sees the shared data */
function startSync() {
  clearInterval(syncT);
  if (CFG.mode === 'standalone') return;
  syncT = setInterval(async () => {
    if (!TOKEN || !$('#modal').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    try { const d = await call('load'); if (d && JSON.stringify(d) !== lastJ && !saveT) { applyState(d); lastJ = JSON.stringify(S); render(); } } catch { }
  }, 8000);
}
const ICON = { quotes: '📄', analysis: '📊', requests: '📥', clients: '👥', products: '📦', users: '🔑', admin: '🏢', settings: '⚙️' };
function applyLook() {
  const th = pref.get('theme', 'auto'), dark = th === 'dark' || (th === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.lang = L(); document.documentElement.dir = L() === 'ar' ? 'rtl' : 'ltr';
}
function render() {
  applyLook();
  const hidden = S.settings.hidden, dark = document.documentElement.dataset.theme === 'dark';
  if (hidden[page]) page = 'quotes';
  const nav = ['quotes', 'analysis', 'requests', 'clients', 'products', 'users', 'admin'].filter(k => !hidden[k]);
  const overdue = S.requests.filter(r => reqStatus(r) === 'Overdue').length;
  const item = (k, label, extra = '') => `<div class="nav ${page === k ? 'on' : ''}" data-p="${k}" title="${esc(label)}"><i>${ICON[k]}</i><span>${label}</span>${extra}</div>`;
  $('#side').style.display = '';
  $('#side').innerHTML = `<div class="brand"><img src="logo.png" width="36" alt=""><span>Quotation<small>Management</small></span></div>` +
    nav.map(k => item(k, t(k), k === 'requests' && overdue ? `<b class="badge Overdue">${overdue}</b>` : '')).join('') +
    `<div class="sp"></div><div class="nav" id="tg" title="${t(dark ? 'light' : 'dark')}"><i>${dark ? '☀️' : '🌙'}</i><span>${t(dark ? 'light' : 'dark')}</span></div><div class="nav" id="lgt"><i>🌐</i><span>${L() === 'ar' ? 'English' : 'العربية'}</span></div>` +
    item('settings', t('settings')) + `<div class="nav" id="lo" title="${t('logout')}"><i>⎋</i><span>${esc(ME?.name)} · ${t('logout')}</span></div>`;
  $('#side').querySelectorAll('.nav[data-p]').forEach(n => n.onclick = () => { if (page !== n.dataset.p) { q = ''; filter = 'All'; } page = n.dataset.p; render(); });
  $('#tg').onclick = () => { pref.set('theme', dark ? 'light' : 'dark'); render(); };
  $('#lgt').onclick = () => { pref.set('lang', L() === 'ar' ? 'en' : 'ar'); window.__users = null; render(); };
  $('#lo').onclick = async () => { try { await call('logout'); } catch { } TOKEN = ME = null; window.__users = null; boot(); };
  $('#main').innerHTML = pages[page]();
  (binders[page] || (() => { }))();
}
const table = (heads, rows) => `<div class="tbl card"><table><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${rows.length ? rows.join('') : `<tr><td colspan="${heads.length}">${t('empty')}</td></tr>`}</table></div>`;
const stat = (l, v) => `<div class="card stat"><span>${l}</span><b>${v}</b></div>`;
const badge = s => `<span class="badge ${s}">${t(s)}</span>`;
const nextNo = () => `QT-${new Date().getFullYear()}-${String(S.quotes.length + 1).padStart(4, '0')}`;

/* ---------- generic modal ---------- */
function modal(html, bind) {
  const m = $('#modal'), was = m.classList.contains('hidden'); m.onkeydown = null; m.classList.toggle('anim', was);
  m.innerHTML = `<div>${html}</div>`; m.classList.remove('hidden'); bind && bind(m); m.onclick = e => { if (e.target === m) closeM(); };
}
const closeM = () => $('#modal').classList.add('hidden');
const fields = key => key === 'clients' ? [{ k: 'name', l: 'name' }, { k: 'phone', l: 'phone' }, { k: 'email', l: 'email' }, { k: 'address', l: 'address' }] :
  [{ k: 'code', l: 'code' }, { k: 'name', l: 'name' }, { k: 'type', l: 'type', opts: [['product', t('product')], ['service', t('service')]] }, { k: 'unit', l: 'unit' }, { k: 'price', l: 'price', type: 'number' }];
function formModal(title, flds, val, onSave, onCancel) {
  modal(`<h2>${title}</h2>` + flds.map(f => `<label>${t(f.l)}</label>` + (f.combo ? `<div data-k="${f.k}" data-combo="${f.combo}" data-val="${esc(val[f.k] || '')}"></div>` : f.opts ?
    `<select data-k="${f.k}">${f.opts.map(o => `<option value="${o[0]}" ${val[f.k] === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>` :
    `<input data-k="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'min="0" step="any"' : ''} value="${esc(val[f.k])}">`)).join('') +
    `<div class="row" style="margin-top:14px"><button class="btn" id="ok">${t('save')}</button><button class="btn g" id="no">${t('cancel')}</button></div>`, m => {
      m.querySelectorAll('[data-combo]').forEach(h => mountCombo(h, { src: h.dataset.combo, value: h.dataset.val, onPick: x => h.dataset.val = x.id }));
      m.querySelector('#no').onclick = onCancel || closeM;
      const save = () => {
        const o = { ...val };
        m.querySelectorAll('[data-k]').forEach(i => { const k = i.dataset.k; o[k] = i.dataset.combo ? i.dataset.val : i.type === 'number' ? Number(i.value) : (k === 'phone' || k === 'code') ? en(i.value) : i.value; });
        if (flds.some(f => f.k === 'name') && !String(o.name || '').trim()) return toast(t('name_req'), true);
        const cf = flds.find(f => f.combo); if (cf && !o[cf.k]) return toast(t('pick_client'), true);
        const r = onSave(o); if (r !== 'keep') { closeM(); render(); } persist();
      };
      m.querySelector('#ok').onclick = save;
      m.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.classList.contains('cbi')) { e.preventDefault(); save(); } };
      setTimeout(() => m.querySelector('input[data-k],[data-combo] input')?.focus(), 40);
    });
}
function quickCreate(key, text, after) {
  formModal(t(key === 'clients' ? 'new_client' : 'new_item'), fields(key), key === 'clients' ? { name: text } : { name: text, type: 'product' },
    o => { const r = { ...o, id: uid() }; S[key].push(r); after(r); return 'keep'; }, () => after(null));
}
function crud(key, cols) {
  const rows = () => {
    const all = searchList(S[key], q, SRC[key].hay, SRC[key].extra), shown = all.slice(0, 200);
    return table([...cols.map(c => t(c.l)), ''], shown.map(r => `<tr>${cols.map(c => `<td class="${c.k === 'price' || c.k === 'phone' || c.k === 'code' ? 'num' : ''}">${esc(c.f ? c.f(r) : r[c.k])}</td>`).join('')}<td class="act"><button class="btn g s" data-e="${r.id}">✎</button> <button class="btn d s" data-d="${r.id}">✕</button></td></tr>`)) +
      (all.length > 200 ? `<div class="mut" style="padding:6px">${t('showing')} 200 / ${all.length}</div>` : '');
  };
  const bindRows = () => {
    document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { const r = byId(S[key], b.dataset.e); formModal(t('edit'), fields(key), r, o => Object.assign(r, o)); });
    document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (await ask(t('confirm'))) { S[key] = S[key].filter(r => r.id !== b.dataset.d); persist(); render(); } });
  };
  return {
    html: `<div class="row"><button class="btn" id="add">+ ${t('new_entry')}</button><button class="btn g" id="imp">⬆ ${t('import_x')}</button><input class="grow" id="srch" placeholder="${key === 'products' ? t('adv_hint') : t('search')}" value="${esc(q)}"></div><div id="tw">${rows()}</div>`,
    bind() {
      $('#add').onclick = () => formModal(t('new_entry'), fields(key), key === 'products' ? { type: 'product' } : {}, o => S[key].push({ ...o, id: uid() }));
      $('#imp').onclick = () => pickExcel(key);
      $('#srch').oninput = debounce(() => { q = $('#srch').value; $('#tw').innerHTML = rows(); bindRows(); });
      bindRows();
    }
  };
}
/* ---------- Excel auto-detection of columns ---------- */
const ALIAS = {
  name: ['name', 'اسم', 'الاسم', 'العميل', 'client', 'customer', 'الصنف', 'item', 'product', 'المنتج', 'البيان'],
  phone: ['phone', 'tel', 'mobile', 'هاتف', 'تليفون', 'موبايل', 'الهاتف', 'جوال'], email: ['email', 'mail', 'بريد', 'ايميل', 'إيميل', 'البريد'],
  address: ['address', 'عنوان', 'العنوان'], code: ['code', 'sku', 'كود', 'الكود', 'رقم الصنف'], price: ['price', 'سعر', 'السعر', 'unit price', 'التكلفة'],
  unit: ['unit', 'وحدة', 'الوحدة'], type: ['type', 'نوع', 'النوع']
};
/* ---------- pages ---------- */
const pages = {}, binders = {};
const qRows = () => {
  const all = searchList(S.quotes.slice().reverse().filter(x => filter === 'All' || x.status === filter), q, x => [x.no, byId(S.clients, x.clientId)?.name, x.subject, x.date, t(x.status)].join(' ')), shown = all.slice(0, 200);
  return table([t('no'), t('client'), t('subject'), t('date'), t('total'), t('status')], shown.map(x => `<tr class="click" data-v="${x.id}"><td class="num">${x.no}</td><td>${esc(byId(S.clients, x.clientId)?.name)}</td><td>${esc(x.subject)}</td><td class="num">${x.date}</td><td class="num">${money(qTotals(x).total)}</td><td>${badge(x.status)}</td></tr>`)) + (all.length > 200 ? `<div class="mut" style="padding:6px">${t('showing')} 200 / ${all.length}</div>` : '');
};
pages.quotes = () => {
  const qs = S.quotes, acc = qs.filter(x => x.status === 'Accepted').length, dec = qs.filter(x => x.status === 'Declined');
  const open = qs.filter(x => x.status === 'New' || x.status === 'Sent').reduce((a, x) => a + qTotals(x).total, 0), lost = dec.reduce((a, x) => a + qTotals(x).total, 0);
  const od = S.requests.filter(r => reqStatus(r) === 'Overdue');
  return `<h1>${t('quotes')}</h1>` + (S.settings.stats ? `<div class="grid">${stat(t('total_q'), qs.length)}${stat(t('open_val'), money(open))}${S.settings.hidden.analysis ? '' : stat(t('acc_rate'), (qs.length ? Math.round(acc / qs.length * 100) : 0) + '%') + stat(t('lost'), money(lost))}</div>` : '') +
    (od.length && !S.settings.hidden.requests ? `<div class="card alert">⚠ ${od.length} ${t('overdue_n')}</div>` : '') +
    `<div class="row"><button class="btn" id="nq">+ ${t('new_quote')}</button><input class="grow" id="srch" placeholder="${t('search')}" value="${esc(q)}">` +
    ['All', 'New', 'Sent', 'Accepted', 'Declined'].map(s => `<button class="btn ${filter === s ? '' : 'g'} s" data-f="${s}">${t(s)}</button>`).join('') + `</div><div id="tw">${qRows()}</div>`;
};
binders.quotes = () => {
  $('#nq').onclick = () => quoteModal({ id: uid(), no: nextNo(), clientId: '', subject: '', date: today(), valid: '', tax: S.settings.tax, items: [], notes: '', status: 'New' }, true);
  const bindQ = () => document.querySelectorAll('[data-v]').forEach(r => r.onclick = () => viewQuote(byId(S.quotes, r.dataset.v)));
  $('#srch').oninput = debounce(() => { q = $('#srch').value; $('#tw').innerHTML = qRows(); bindQ(); });
  document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
  bindQ();
};
function quoteModal(x, isNew, keep) {
  const draft = keep || JSON.parse(JSON.stringify(x));
  modal(`<h2>${draft.no}</h2><div class="cols"><div><label>${t('client')}</label><div id="qc"></div></div><div><label>${t('subject')}</label><input id="qs" value="${esc(draft.subject)}"></div>
    <div><label>${t('date')}</label><input type="date" id="qd" value="${draft.date}"></div><div><label>${t('valid')}</label><input type="date" id="qv" value="${draft.valid}"></div>
    <div><label>${t('tax_rate')}</label><input type="number" min="0" step="any" id="qt" value="${draft.tax}"></div></div><label>${t('items')}</label><div id="its"></div>
    <div class="row" style="margin-top:8px"><div class="grow" id="ip"></div><button class="btn g s" id="qa">+ ${t('free_line')}</button></div>
    <label>${t('notes')}</label><textarea id="qn" rows="2">${esc(draft.notes)}</textarea><h3 id="tot"></h3>
    <div class="row"><button class="btn" id="ok">${t('save')}</button><button class="btn g" id="no">${t('cancel')}</button></div>`, m => {
    const its = m.querySelector('#its'), tot = () => m.querySelector('#tot').textContent = `${t('grand')}: ${money(qTotals(draft).total)}`;
    const pull = () => { draft.subject = m.querySelector('#qs').value; draft.date = m.querySelector('#qd').value; draft.valid = m.querySelector('#qv').value; draft.tax = Number(m.querySelector('#qt').value) || 0; draft.notes = m.querySelector('#qn').value; };
    const drawItems = () => {
      its.innerHTML = draft.items.map((i, n) => `<div class="row it"><input class="grow" data-i="${n}" data-f="desc" value="${esc(i.desc)}" placeholder="${t('desc')}"><input style="width:80px" type="number" min="0" step="any" data-i="${n}" data-f="qty" value="${i.qty}"><input style="width:120px" type="number" min="0" step="any" data-i="${n}" data-f="price" value="${i.price}"><b class="lt num">${money(i.qty * i.price)}</b><button class="btn d s" data-x="${n}">✕</button></div>`).join('');
      tot();
    };
    its.oninput = e => { const d = e.target.dataset; if (d.i == null) return; const it = draft.items[d.i]; it[d.f] = d.f === 'desc' ? e.target.value : Number(e.target.value) || 0; if (d.f !== 'desc') e.target.closest('.it').querySelector('.lt').textContent = money(it.qty * it.price); tot(); };
    its.onclick = e => { const b = e.target.closest('[data-x]'); if (b) { draft.items.splice(b.dataset.x, 1); drawItems(); } };
    m.querySelector('#qt').oninput = e => { draft.tax = Number(e.target.value) || 0; tot(); };
    const reopen = () => quoteModal(x, isNew, draft);
    mountCombo(m.querySelector('#qc'), { src: 'clients', value: draft.clientId, placeholder: t('search'), onPick: c => draft.clientId = c.id, onCreate: text => { pull(); quickCreate('clients', text, r => { if (r) draft.clientId = r.id; reopen(); }); } });
    mountCombo(m.querySelector('#ip'), { src: 'products', placeholder: t('adv_hint'), clearOnPick: true,
      onPick: p => { draft.items.push({ desc: p.name, qty: 1, price: p.price }); drawItems(); its.lastElementChild?.querySelector('[data-f=qty]').select(); },
      onCreate: text => { pull(); quickCreate('products', text, r => { if (r) draft.items.push({ desc: r.name, qty: 1, price: r.price }); reopen(); }); } });
    m.querySelector('#qa').onclick = () => { draft.items.push({ desc: '', qty: 1, price: 0 }); drawItems(); its.lastElementChild.querySelector('[data-f=desc]').focus(); };
    m.querySelector('#no').onclick = closeM;
    m.querySelector('#ok').onclick = () => {
      pull(); if (!draft.clientId) return toast(t('pick_client'), true); if (!draft.items.length) return toast(t('no_items'), true);
      if (isNew) S.quotes.push(draft); else Object.assign(byId(S.quotes, x.id), draft); closeM(); persist(); render(); toast(t('saved'));
    };
    drawItems(); if (!draft.clientId) setTimeout(() => m.querySelector('#qc input').focus(), 40);
  });
}
function viewQuote(x) {
  const c = byId(S.clients, x.clientId), tt = qTotals(x);
  modal(`<h2>${x.no} ${badge(x.status)}</h2><p>${esc(c?.name)} — ${esc(x.subject)}</p>` +
    table([t('desc'), t('qty'), t('price'), t('total')], x.items.map(i => `<tr><td>${esc(i.desc)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`)) +
    `<p>${t('subtotal')}: ${money(tt.sub)} | ${t('tax')} (${x.tax}%): ${money(tt.tax)}</p><h3>${t('grand')}: ${money(tt.total)}</h3>` + (x.reason ? `<p>${t('reason')}: ${esc(x.reason)}</p>` : '') +
    `<div class="row">${x.status === 'New' ? `<button class="btn" id="s">${t('send')}</button>` : ''}${x.status === 'Sent' ? `<button class="btn" id="a">${t('accept')}</button><button class="btn d" id="d">${t('decline')}</button>` : ''}
    <button class="btn g" id="e">${t('edit')}</button><button class="btn g" id="p">${t('print')}</button><button class="btn g" id="f">${t('pdf')}</button><button class="btn d" id="x">${t('del')}</button><button class="btn g" id="c">${t('close')}</button></div>`, m => {
    const set = s => { x.status = s; persist(); closeM(); render(); };
    m.querySelector('#c').onclick = closeM; m.querySelector('#e').onclick = () => quoteModal(x, false);
    m.querySelector('#x').onclick = async () => { if (await ask(t('confirm'))) { S.quotes = S.quotes.filter(v => v !== x); persist(); closeM(); render(); } };
    m.querySelector('#p').onclick = () => { fillPrint(x); window.print(); };
    m.querySelector('#f').onclick = async () => { fillPrint(x); if (await window.api.savePdf(x.no)) toast(t('saved_pdf')); };
    if (m.querySelector('#s')) m.querySelector('#s').onclick = () => set('Sent');
    if (m.querySelector('#a')) m.querySelector('#a').onclick = () => set('Accepted');
    if (m.querySelector('#d')) m.querySelector('#d').onclick = () => {
      modal(`<h2>${t('reason')}</h2><input id="r"><div class="row" style="margin-top:12px"><button class="btn d" id="ok">${t('decline')}</button><button class="btn g" id="no">${t('cancel')}</button></div>`, mm => {
        mm.querySelector('#no').onclick = closeM;
        mm.querySelector('#ok').onclick = () => { const r = mm.querySelector('#r').value.trim(); if (!r) return mm.querySelector('#r').focus(); x.reason = r; set('Declined'); };
      });
    };
  });
}
function fillPrint(x) {
  const co = S.company, c = byId(S.clients, x.clientId), tt = qTotals(x);
  $('#print').innerHTML = `<div style="display:flex;justify-content:space-between;border-bottom:3px solid #10b981;padding-bottom:10px"><div><h1>${esc(co.name)}</h1><div>${esc(co.address)}<br>${esc(co.phone)} ${esc(co.email)}<br>${esc(co.taxId)}</div></div><div style="font-size:40px;font-weight:700">${esc(co.logo)}</div></div>
  <h2>${t('quotes')} ${x.no}</h2><p>${t('date')}: ${x.date} ${x.valid ? '| ' + t('valid') + ': ' + x.valid : ''}<br>${t('client')}: ${esc(c?.name)} ${esc(c?.phone)}<br>${t('subject')}: ${esc(x.subject)}</p>` +
    table([t('desc'), t('qty'), t('price'), t('total')], x.items.map(i => `<tr><td>${esc(i.desc)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`)) +
    `<p>${t('subtotal')}: ${money(tt.sub)}<br>${t('tax')} (${x.tax}%): ${money(tt.tax)}</p><h3>${t('grand')}: ${money(tt.total)}</h3><p>${esc(x.notes)}</p>`;
}
pages.analysis = () => {
  const dec = S.quotes.filter(x => x.status === 'Declined'), lost = dec.reduce((a, x) => a + qTotals(x).total, 0), R = {};
  dec.forEach(x => { const r = (x.reason || '-').trim(); (R[r] = R[r] || { n: 0, v: 0 }); R[r].n++; R[r].v += qTotals(x).total; });
  const rs = Object.entries(R).sort((a, b) => b[1].n - a[1].n), max = Math.max(1, ...rs.map(r => r[1].n)), maxV = Math.max(1, ...rs.map(r => r[1].v));
  return `<h1>${t('analysis')}</h1><div class="grid">${stat(t('dec_rate'), (S.quotes.length ? Math.round(dec.length / S.quotes.length * 100) : 0) + '%')}${stat(t('lost'), money(lost))}${stat(t('Declined'), dec.length)}</div>
  <div class="cols"><div class="card"><h3>${t('top_reasons')}</h3>${rs.map(([r, d]) => `<div>${esc(r)} (${d.n})</div><div class="bar"><i style="width:${d.n / max * 100}%"></i></div>`).join('') || t('empty')}</div>
  <div class="card"><h3>${t('lost_by')}</h3>${rs.map(([r, d]) => `<div>${esc(r)} — ${money(d.v)}</div><div class="bar"><i style="width:${d.v / maxV * 100}%;background:var(--wrn)"></i></div>`).join('') || t('empty')}</div></div>`;
};
for (const k of ['clients', 'products']) {
  pages[k] = () => `<h1>${t(k)}</h1>` + mk(k).html; binders[k] = () => mk(k).bind();
}
function mk(k) { // rebuild per render so labels follow language
  return k === 'clients' ? crud('clients', [{ k: 'name', l: 'name' }, { k: 'phone', l: 'phone' }, { k: 'email', l: 'email' }, { k: 'address', l: 'address' }]) :
    crud('products', [{ k: 'code', l: 'code' }, { k: 'name', l: 'name' }, { k: 'type', l: 'type', f: r => t(r.type) }, { k: 'unit', l: 'unit' }, { k: 'price', l: 'price', f: r => money(r.price) }]);
}
pages.users = () => {
  const adm = ME?.role === 'admin', us = window.__users || [];
  return `<h1>${t('users')}</h1>` + (adm ? `<div class="row"><button class="btn" id="add">+ ${t('add_user')}</button></div>` : '') +
    table([t('name'), t('username'), t('role'), ''], us.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${t(u.role + '_role')}</td><td>${adm && u.id !== ME.id ? `<button class="btn d s" data-d="${u.id}">✕</button>` : ''}</td></tr>`));
};
binders.users = async () => {
  if (!window.__users) { try { window.__users = await call('users'); } catch { window.__users = []; } return render(); }
  const done = () => { window.__users = null; render(); }, bad = e => toast(t(e.message), true);
  if ($('#add')) $('#add').onclick = () => formModal(t('add_user'), [{ k: 'name', l: 'full_name' }, { k: 'username', l: 'username' }, { k: 'password', l: 'password', type: 'password' }, { k: 'role', l: 'role', opts: [['user', t('user_role')], ['admin', t('admin_role')]] }], { role: 'user' }, o => call('adduser', o).then(done).catch(bad));
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (await ask(t('confirm'))) call('deluser', { id: b.dataset.d }).then(done).catch(bad); });
};
pages.requests = () => `<h1>${t('requests')}</h1><div class="row"><button class="btn" id="add">+ ${t('save')}</button></div>` +
  table([t('client'), t('subject'), t('due'), t('status'), ''], S.requests.map(r => `<tr><td>${esc(byId(S.clients, r.clientId)?.name)}</td><td>${esc(r.subject)}</td><td>${r.due}</td><td>${badge(reqStatus(r))}</td><td>${r.status === 'Open' ? `<button class="btn s" data-cv="${r.id}">${t('convert')}</button>` : ''} <button class="btn d s" data-d="${r.id}">✕</button></td></tr>`));
binders.requests = () => {
  const F = [{ k: 'clientId', l: 'client', combo: 'clients' }, { k: 'subject', l: 'subject' }, { k: 'due', l: 'due', type: 'date' }];
  $('#add').onclick = () => formModal(t('requests'), F, { due: today() }, o => S.requests.push({ ...o, id: uid(), status: 'Open' }));
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (await ask(t('confirm'))) { S.requests = S.requests.filter(r => r.id !== b.dataset.d); persist(); render(); } });
  document.querySelectorAll('[data-cv]').forEach(b => b.onclick = () => { // one-click convert: client auto-selected
    const r = byId(S.requests, b.dataset.cv); r.status = 'Done'; persist(); page = 'quotes';
    render(); quoteModal({ id: uid(), no: nextNo(), clientId: r.clientId, subject: r.subject, date: today(), valid: '', tax: S.settings.tax, items: [], notes: '', status: 'New' }, true);
  });
};
pages.admin = () => `<h1>${t('admin')}</h1><div class="card"><div class="cols">` + [['name', 'company'], ['taxId', 'tax_id'], ['phone', 'phone'], ['email', 'email'], ['address', 'address'], ['logo', 'logo']].map(([k, l]) => `<div><label>${t(l)}</label><input data-co="${k}" value="${esc(S.company[k])}"></div>`).join('') + `</div></div>`;
binders.admin = () => document.querySelectorAll('[data-co]').forEach(i => i.oninput = () => { S.company[i.dataset.co] = i.value; persist(); });
pages.settings = () => {
  const st = S.settings, sc = window.__cfg || { mode: 'local' };
  return `<h1>${t('settings')}</h1><div class="card"><h3>${t('ui')}</h3><div class="cols"><div><label>${t('lang')}</label><select id="lg"><option value="ar" ${L() === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${L() === 'en' ? 'selected' : ''}>English</option></select></div>
  <div><label>${t('theme')}</label><select id="th">${['auto', 'light', 'dark'].map(v => `<option value="${v}" ${pref.get('theme', 'auto') === v ? 'selected' : ''}>${t(v)}</option>`).join('')}</select></div>
  <div><label>${t('tax_rate')}</label><input id="tx" type="number" value="${st.tax}"></div><div><label>${t('currency')}</label><input id="cu" value="${esc(st.currency)}"></div></div>
  <label><input type="checkbox" id="sst" ${st.stats ? 'checked' : ''} style="width:auto"> ${t('show_stats')}</label></div>
  <div class="card"><h3>${t('sections')}</h3>${SECTIONS.map(k => `<label><input type="checkbox" data-sec="${k}" style="width:auto" ${st.hidden[k] ? '' : 'checked'}> ${t(k)}</label>`).join('')}</div>
  <div class="card"><h3>${t('conn')}</h3><p>${t('mode')}: <b>${t('m_' + CFG.mode)}</b></p>${CFG.mode === 'server' ? `<p>${t('server_addr')}:<br>${(window.__net?.ips || []).map(i => `<code dir="ltr">http://${i}:${CFG.port}</code>`).join('<br>')}</p><p>${window.__net?.running ? '● ' + t('running') : '⚠ ' + esc(window.__net?.error || '')}</p>` : ''}${CFG.mode === 'client' ? `<p dir="ltr">${esc(CFG.url)}</p>` : ''}<button class="btn g" id="cm">${t('change_mode')}</button></div>`;
};
binders.settings = async () => {
  if (!window.__net) { window.__net = await window.api.netInfo(); return render(); }
  const st = S.settings, on = (id, ev, f) => { const e = $(id); if (e) e[ev] = f; };
  on('#lg', 'onchange', e => { pref.set('lang', e.target.value); window.__users = null; render(); }); on('#th', 'onchange', e => { pref.set('theme', e.target.value); render(); });
  on('#tx', 'oninput', e => { st.tax = Number(e.target.value); persist(); }); on('#cu', 'oninput', e => { st.currency = e.target.value; persist(); });
  on('#sst', 'onchange', e => { st.stats = e.target.checked; persist(); });
  document.querySelectorAll('[data-sec]').forEach(c => c.onchange = () => { st.hidden[c.dataset.sec] = !c.checked; persist(); render(); });
  on('#cm', 'onclick', async () => { if (!(await ask(t('confirm')))) return; try { await call('logout'); } catch { } await window.api.setCfg(null); TOKEN = ME = null; window.__w = null; window.__net = null; boot(); });
};
boot();
