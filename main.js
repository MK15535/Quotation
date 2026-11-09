const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http'), dgram = require('dgram'), os = require('os'), crypto = require('crypto');
const U = f => path.join(app.getPath('userData'), f);
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wj = (f, d) => fs.writeFileSync(f, JSON.stringify(d));
const cfg = () => rj(U('config.json'), null);
const DISCO_PORT = 4748;
app.commandLine.appendSwitch('lang', 'en-US'); // English digits everywhere (date pickers etc.)

/* ===== core: one store, one dispatcher used by IPC (local) and HTTP (network) ===== */
const store = () => rj(U('store.json'), { users: [], data: null });
const put = s => wj(U('store.json'), s);
const hash = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const pub = u => ({ id: u.id, name: u.name, username: u.username, role: u.role });
const sessions = new Map();
const fail = (m, status = 400) => Object.assign(new Error(m), { status });
function mkUser(b, role) {
  if (!b.username || !b.password || String(b.password).length < 4) throw fail('invalid_user');
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: crypto.randomUUID(), name: b.name || b.username, username: String(b.username).trim(), salt, hash: hash(b.password, salt), role };
}
function handle(op, token, b) {
  const s = store();
  if (op === 'status') return { app: 'QM', hasUsers: s.users.length > 0, name: (cfg() || {}).name };
  if (op === 'setup') { if (s.users.length) throw fail('exists', 403); s.users.push(mkUser(b, 'admin')); put(s); return true; }
  if (op === 'login') {
    const u = s.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
    if (!u || hash(b.password || '', u.salt) !== u.hash) throw fail('bad_login', 401);
    const tk = crypto.randomBytes(24).toString('hex'); sessions.set(tk, u.id); return { token: tk, user: pub(u) };
  }
  const me = s.users.find(u => u.id === sessions.get(token));
  if (!me) throw fail('unauthorized', 401);
  const admin = () => { if (me.role !== 'admin') throw fail('forbidden', 403); };
  switch (op) {
    case 'logout': sessions.delete(token); return true;
    case 'load': return s.data;
    case 'save': s.data = b; put(s); return true;
    case 'users': return s.users.map(pub);
    case 'adduser':
      admin(); if (s.users.some(u => u.username.toLowerCase() === String(b.username).toLowerCase())) throw fail('dup_user');
      s.users.push(mkUser(b, b.role === 'admin' ? 'admin' : 'user')); put(s); return true;
    case 'deluser':
      admin(); if (b.id === me.id) throw fail('self_del');
      s.users = s.users.filter(u => u.id !== b.id); put(s); return true;
  }
  throw fail('unknown_op');
}
function remote(base, op, token, body) {
  return new Promise((res, rej) => {
    const r = http.request(new URL('/api/' + op, base), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, s => {
      let d = ''; s.on('data', c => d += c); s.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(Object.assign(new Error(j.error), { status: s.statusCode })) : res(j.data); } catch { rej(new Error('bad_response')); } });
    });
    r.on('error', rej); r.setTimeout(8000, () => r.destroy(new Error('timeout')));
    r.end(JSON.stringify(body || {}));
  });
}

/* ===== network server (server mode): HTTP API + UDP discovery ===== */
let httpSrv = null, udpSrv = null, srvErr = null;
function stopServer() { try { httpSrv && httpSrv.close(); } catch { } try { udpSrv && udpSrv.close(); } catch { } httpSrv = udpSrv = null; }
function startServer() {
  stopServer(); srvErr = null; const c = cfg(); if (!c || c.mode !== 'server') return;
  httpSrv = http.createServer((req, res) => {
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = ''; req.on('data', d => { body += d; if (body.length > 25e6) req.destroy(); });
    req.on('end', () => {
      try {
        const op = (req.url.match(/^\/api\/(\w+)/) || [])[1]; if (!op || req.method !== 'POST') return send(404, { error: 'not_found' });
        const tk = (req.headers.authorization || '').replace('Bearer ', '');
        send(200, { data: handle(op, tk, body ? JSON.parse(body) : {}) });
      } catch (e) { send(e.status || 500, { error: e.message }); }
    });
  });
  httpSrv.on('error', e => { srvErr = e.message; });
  httpSrv.listen(c.port || 4747, '0.0.0.0');
  udpSrv = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpSrv.on('error', e => { srvErr = srvErr || e.message; });
  udpSrv.on('message', (m, r) => { if (String(m) === 'QM_DISCOVER') udpSrv.send(JSON.stringify({ app: 'QM', name: c.name, port: c.port || 4747 }), r.port, r.address); });
  udpSrv.bind(DISCO_PORT);
}
const ips = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal);
function scan() {
  return new Promise(res => {
    const found = {}, s = dgram.createSocket('udp4');
    s.on('error', () => res([]));
    s.on('message', (m, r) => { try { const j = JSON.parse(m); if (j.app === 'QM') found[r.address + ':' + j.port] = { ip: r.address, port: j.port, name: j.name }; } catch { } });
    s.bind(0, () => {
      s.setBroadcast(true);
      const targets = new Set(['255.255.255.255']);
      ips().forEach(i => { const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number); targets.add(a.map((x, k) => (x | (~m[k] & 255))).join('.')); });
      targets.forEach(t => s.send('QM_DISCOVER', DISCO_PORT, t, () => { }));
      setTimeout(() => { try { s.close(); } catch { } res(Object.values(found)); }, 1800);
    });
  });
}
const safe = async f => { try { return { data: await f() }; } catch (e) { return { error: e.message, status: e.status }; } };
ipcMain.handle('rpc', (_, op, token, body) => safe(async () => {
  const c = cfg(); return c && c.mode === 'client' ? remote(c.url, op, token, body) : handle(op, token, body);
}));
ipcMain.handle('cfg:get', () => cfg());
ipcMain.handle('cfg:set', (_, c) => { if (c) wj(U('config.json'), c); else try { fs.unlinkSync(U('config.json')); } catch { } startServer(); return true; });
ipcMain.handle('net:info', () => ({ ips: ips().map(i => i.address), running: !!httpSrv && !srvErr, error: srvErr }));
ipcMain.handle('net:scan', () => scan());
ipcMain.handle('net:test', (_, url) => safe(() => remote(url, 'status')));
ipcMain.handle('pdf:save', async (e, name) => {
  const r = await dialog.showSaveDialog({ defaultPath: name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, await BrowserWindow.fromWebContents(e.sender).webContents.printToPDF({ printBackground: true, pageSize: 'A4' })); return true;
});
ipcMain.handle('excel:import', async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: 'Excel/CSV', extensions: ['xlsx', 'xls', 'csv'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const XLSX = require('xlsx'), wb = XLSX.readFile(r.filePaths[0]), sheets = {};
  wb.SheetNames.forEach(n => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false }); if (rows.length) sheets[n] = rows; });
  return { file: path.basename(r.filePaths[0]), sheets };
});
app.whenReady().then(() => {
  startServer();
  const w = new BrowserWindow({ width: 1366, height: 820, minWidth: 360, backgroundColor: '#0f172a', autoHideMenuBar: true, title: 'Quotation Management', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  w.loadFile('src/index.html');
});
app.on('window-all-closed', () => app.quit());
module.exports = { handle, remote, scan };
