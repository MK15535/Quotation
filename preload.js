const { contextBridge, ipcRenderer: i } = require('electron');
contextBridge.exposeInMainWorld('api', {
  rpc: (op, token, body) => i.invoke('rpc', op, token, body),
  cfg: () => i.invoke('cfg:get'), setCfg: c => i.invoke('cfg:set', c),
  netInfo: () => i.invoke('net:info'), scan: () => i.invoke('net:scan'), test: u => i.invoke('net:test', u),
  savePdf: n => i.invoke('pdf:save', n), importExcel: () => i.invoke('excel:import')
});
