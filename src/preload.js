const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  defaults: () => ipcRenderer.invoke('cfg:defaults'),
  saveCfg: (patch) => ipcRenderer.invoke('cfg:save', patch),
  listInbox: () => ipcRenderer.invoke('inbox:list'),
  openInbox: () => ipcRenderer.invoke('inbox:open'),
  getStats: () => ipcRenderer.invoke('stats:get'),
  deposit: (items) => ipcRenderer.invoke('inbox:deposit', items),
  setPos: (x, y) => ipcRenderer.invoke('win:setpos', x, y),
  getPos: () => ipcRenderer.invoke('win:getpos'),
  lock: (v) => ipcRenderer.invoke('win:lock', v),
  embed: () => ipcRenderer.invoke('win:embed'),
  unembed: () => ipcRenderer.invoke('win:unembed'),
  close: () => ipcRenderer.invoke('win:close'),
  pickPath: (key) => ipcRenderer.invoke('path:pick', key),
  onEmbedded: (cb) => ipcRenderer.on('win:embedded', (_e, ok) => cb(ok))
});
