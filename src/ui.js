'use strict';
/* ===== per-device preferences (theme / language) ===== */
const pref = { get: (k, d) => { try { return localStorage.getItem('qm_' + k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('qm_' + k, v); } catch { } } };
const en = s => String(s ?? '').replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x660).replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 0x6F0);
const debounce = (f, ms = 90) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), ms); }; };
// always English digits while typing
document.addEventListener('input', e => {
  const el = e.target; if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) || !/^(text|search|tel|)$/.test(el.type || '')) return;
  if (/[\u0660-\u0669\u06F0-\u06F9]/.test(el.value)) { const p = el.selectionStart; el.value = en(el.value); try { el.setSelectionRange(p, p); } catch { } }
}, true);
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => typeof applyLook === 'function' && applyLook());

/* ===== toast + confirm dialog (no blocking alert/confirm: they freeze inputs in Electron) ===== */
function toast(msg, bad) {
  let h = document.getElementById('toasts'); if (!h) { h = document.createElement('div'); h.id = 'toasts'; document.body.append(h); }
  const e = document.createElement('div'); e.className = 'toast' + (bad ? ' bad' : ''); e.textContent = msg; h.append(e);
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 250); }, bad ? 4200 : 2300);
}
function ask(msg, label) {
  return new Promise(res => {
    const d = document.getElementById('dlg');
    d.innerHTML = `<div class="dlgbox"><p>${esc(msg)}</p><div class="row"><button class="btn d" id="y">${label || t('yes')}</button><button class="btn g" id="n">${t('cancel')}</button></div></div>`;
    d.classList.remove('hidden'); const done = v => { d.classList.add('hidden'); res(v); };
    d.querySelector('#y').onclick = () => done(true); d.querySelector('#n').onclick = () => done(false);
    d.onclick = e => { if (e.target === d) done(false); }; d.querySelector('#y').focus(); d._esc = () => done(false);
  });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return; const d = document.getElementById('dlg');
  if (!d.classList.contains('hidden')) d._esc && d._esc(); else if (!document.getElementById('modal').classList.contains('hidden')) closeM();
});

/* ===== advanced search: tokens (AND) + filters  type:service  code:erp  price<5000  price>=100 ===== */
const CMP = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
function parseQ(q) {
  const f = {}, toks = [];
  en(q).trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(w => {
    let m; if ((m = w.match(/^(type|code|unit):(.+)$/))) f[m[1]] = m[2];
    else if ((m = w.match(/^price(<=|>=|<|>)(\d+(\.\d+)?)$/))) (f.price = f.price || []).push([m[1], +m[2]]); else toks.push(w);
  });
  return { f, toks };
}
function searchList(list, q, hay, extra) {
  const { f, toks } = parseQ(q), out = [];
  for (const it of list) {
    if (extra && !extra(it, f)) continue;
    const h = en(hay(it)).toLowerCase(); let sc = 0, ok = true;
    for (const k of toks) { const i = h.indexOf(k); if (i < 0) { ok = false; break; } sc += i === 0 ? 3 : (h[i - 1] === ' ' ? 2 : 1); }
    if (ok) out.push([sc, it]);
  }
  return toks.length ? out.sort((a, b) => b[0] - a[0]).map(x => x[1]) : out.map(x => x[1]);
}
const prodExtra = (p, f) => {
  if (f.type && !(p.type || '').startsWith(f.type) && !t(p.type).toLowerCase().includes(f.type)) return false;
  if (f.code && !String(p.code || '').toLowerCase().includes(f.code)) return false;
  if (f.unit && !String(p.unit || '').toLowerCase().includes(f.unit)) return false;
  return (f.price || []).every(([op, v]) => CMP[op](Number(p.price) || 0, v));
};
const SRC = {
  clients: { list: () => S.clients, text: c => c.name, sub: c => [c.phone, c.email].filter(Boolean).join(' · '), hay: c => [c.name, c.phone, c.email, c.address].join(' ') },
  products: { list: () => S.products, text: p => p.name, sub: p => [p.code, t(p.type), p.unit].filter(Boolean).join(' · '), right: p => money(p.price), hay: p => [p.name, p.code, p.type, t(p.type), p.unit, p.price].join(' '), extra: prodExtra }
};

/* ===== searchable combobox with keyboard + inline "new entry" ===== */
function mountCombo(host, o) {
  const src = SRC[o.src]; host.classList.add('cb');
  host.innerHTML = `<input class="cbi" autocomplete="off" placeholder="${esc(o.placeholder || t('search'))}"><div class="dd hidden"></div>`;
  const inp = host.querySelector('input'), dd = host.querySelector('.dd'); let items = [], hi = 0;
  const cur = () => o.value ? src.list().find(x => x.id === o.value) : null;
  const setText = () => { const c = cur(); inp.value = c ? src.text(c) : ''; host.dataset.val = o.value || ''; };
  const mark = () => dd.querySelectorAll('.opt[data-i]').forEach((e, i) => { e.classList.toggle('hi', i === hi); if (i === hi) e.scrollIntoView({ block: 'nearest' }); });
  const draw = () => {
    const q = inp.value, c = cur(), all = c && q === src.text(c);
    items = (all ? src.list() : searchList(src.list(), q, src.hay, src.extra)).slice(0, 50); hi = Math.min(hi, Math.max(0, items.length - 1));
    const canNew = o.onCreate && q.trim() && !all;
    dd.innerHTML = items.map((x, i) => `<div class="opt ${i === hi ? 'hi' : ''}" data-i="${i}"><div><b>${esc(src.text(x))}</b><small>${esc(src.sub(x))}</small></div>${src.right ? `<span class="num">${esc(src.right(x))}</span>` : ''}</div>`).join('') +
      (canNew ? `<div class="opt new" data-n="1">＋ ${t('new_entry')}: <b>${esc(q.trim())}</b></div>` : '') + (!items.length && !canNew ? `<div class="opt mut">${t('empty')}</div>` : '') +
      (o.src === 'products' ? `<div class="hint">${t('adv_hint')}</div>` : '');
    dd.classList.remove('hidden');
  };
  const pick = x => { dd.classList.add('hidden'); if (o.clearOnPick) inp.value = ''; else { o.value = x.id; setText(); } o.onPick && o.onPick(x); };
  const create = () => { dd.classList.add('hidden'); o.onCreate(inp.value.trim()); };
  inp.onfocus = () => { if (cur()) inp.select(); draw(); };
  inp.oninput = () => { hi = 0; draw(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (dd.classList.contains('hidden')) draw(); hi = Math.min(items.length - 1, hi + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[hi] && !dd.classList.contains('hidden')) pick(items[hi]); else if (o.onCreate && inp.value.trim()) create(); }
    else if (e.key === 'Escape' && !dd.classList.contains('hidden')) { e.stopPropagation(); dd.classList.add('hidden'); }
  };
  inp.onblur = () => { dd.classList.add('hidden'); if (!o.clearOnPick) setText(); };
  dd.onmousedown = e => { e.preventDefault(); const r = e.target.closest('.opt'); if (!r) return; if (r.dataset.i != null) pick(items[r.dataset.i]); else if (r.dataset.n) create(); };
  if (!o.clearOnPick) setText(); return { focus: () => inp.focus() };
}

/* ===== Excel import: choose sheet, target (clients / items) and which column feeds which field ===== */
const TARGETS = { clients: ['name', 'phone', 'email', 'address'], products: ['code', 'name', 'type', 'unit', 'price'] };
const normH = h => String(h).trim().toLowerCase();
function autoMap(headers, target) {
  const map = {}, used = new Set(), bad = target === 'clients' ? ['item', 'product', 'الصنف', 'المنتج', 'البيان'] : ['client', 'customer', 'العميل'];
  for (const f of TARGETS[target]) {
    const al = ALIAS[f].filter(a => f !== 'name' || !bad.includes(a));
    const h = headers.find(h => !used.has(h) && al.includes(normH(h))) || headers.find(h => !used.has(h) && al.some(a => normH(h).includes(a)));
    if (h !== undefined) { map[f] = h; used.add(h); }
  }
  return map;
}
async function pickExcel(pre) {
  const file = await window.api.importExcel(); if (!file) return;
  if (!file.sheets || !Object.keys(file.sheets).length) return toast(t('empty'), true);
  const names = Object.keys(file.sheets); const st = { sheet: names[0], target: pre || 'clients', map: {}, skip: true, defType: 'product' };
  const heads = () => Object.keys((file.sheets[st.sheet] || [])[0] || {});
  const detect = () => { const h = heads(); if (!pre) { const a = autoMap(h, 'clients'), b = autoMap(h, 'products'); st.target = Object.keys(b).length > Object.keys(a).length ? 'products' : 'clients'; } st.map = autoMap(h, st.target); };
  detect();
  const build = () => {
    const ex = st.target === 'clients' ? S.clients : S.products, key = r => (st.target === 'products' && r.code ? r.code : r.name).toLowerCase();
    const seen = new Set(ex.map(key)), recs = []; let dups = 0;
    for (const row of file.sheets[st.sheet]) {
      const r = {};
      for (const f of TARGETS[st.target]) {
        const c = st.map[f]; if (c === undefined || c === '') continue; const v = row[c];
        r[f] = f === 'price' ? (Number(en(v).replace(/[^\d.]/g, '')) || 0) : f === 'phone' || f === 'code' ? en(v).trim() : f === 'type' ? (/serv|خدم/i.test(v) ? 'service' : 'product') : String(v).trim();
      }
      if (!r.name) continue;
      if (st.target === 'products') { r.type = r.type || st.defType; r.unit = r.unit || ''; r.code = r.code || ''; r.price = r.price || 0; }
      const k = key(r); if (st.skip && seen.has(k)) { dups++; continue; } seen.add(k); recs.push(r);
    }
    return { recs, dups };
  };
  const draw = () => {
    const h = heads(), { recs, dups } = build(), F = TARGETS[st.target];
    modal(`<h2>${t('imp_title')} — ${esc(file.file)}</h2>` +
      (names.length > 1 ? `<label>${t('sheet')}</label><select id="sh">${names.map(n => `<option ${n === st.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '') +
      `<label>${t('import_as')}</label><div class="row">${['clients', 'products'].map(k => `<label class="chip ${st.target === k ? 'on' : ''}"><input type="radio" name="tg" value="${k}" ${st.target === k ? 'checked' : ''} hidden>${t(k)}</label>`).join('')}</div>` +
      `<label>${t('map_cols')}</label><div class="cols">${F.map(f => `<div><small>${t(f)}${f === 'name' ? ' *' : ''}</small><select data-f="${f}"><option value="">— ${t('skip_col')} —</option>${h.map(x => `<option value="${esc(x)}" ${st.map[f] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`).join('')}</div>` +
      (st.target === 'products' && !st.map.type ? `<label>${t('default_type')}</label><select id="dt"><option value="product" ${st.defType === 'product' ? 'selected' : ''}>${t('product')}</option><option value="service" ${st.defType === 'service' ? 'selected' : ''}>${t('service')}</option></select>` : '') +
      `<label><input type="checkbox" id="sk" ${st.skip ? 'checked' : ''} style="width:auto"> ${t('skip_dups')}</label>` +
      `<label>${t('preview')}</label><div class="tbl">${recs.length ? `<table><tr>${F.filter(f => st.map[f]).map(f => `<th>${t(f)}</th>`).join('')}</tr>${recs.slice(0, 5).map(r => `<tr>${F.filter(f => st.map[f]).map(f => `<td class="num">${esc(f === 'price' ? r[f] : f === 'type' ? t(r[f]) : r[f])}</td>`).join('')}</tr>`).join('')}</table>` : `<p class="mut">${st.map.name ? t('empty') : t('no_name_col')}</p>`}</div>` +
      `<p><b>${recs.length}</b> ${t('will_import')}${dups ? ` · ${dups} ${t('dups')}` : ''}</p><div class="row"><button class="btn" id="go" ${recs.length ? '' : 'disabled'}>${t('import_btn')}</button><button class="btn g" id="no">${t('cancel')}</button></div>`, m => {
      m.querySelector('#no').onclick = closeM;
      if (m.querySelector('#sh')) m.querySelector('#sh').onchange = e => { st.sheet = e.target.value; detect(); draw(); };
      m.querySelectorAll('[name=tg]').forEach(r => r.onchange = () => { st.target = r.value; st.map = autoMap(heads(), st.target); draw(); });
      m.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { st.map[s.dataset.f] = s.value; draw(); });
      if (m.querySelector('#dt')) m.querySelector('#dt').onchange = e => { st.defType = e.target.value; draw(); };
      m.querySelector('#sk').onchange = e => { st.skip = e.target.checked; draw(); };
      m.querySelector('#go').onclick = () => { recs.forEach(r => S[st.target].push({ ...r, id: uid() })); persist(); closeM(); render(); toast(`${t('imported')} ${recs.length} ${t('rows')}${dups ? ` (${dups} ${t('dups')})` : ''}`); };
    });
  };
  draw();
}
