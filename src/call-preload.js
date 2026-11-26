const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('call', {
  onShow: (fn) => ipcRenderer.on('call:show', (_e, info) => fn(info)),
  act: (action) => ipcRenderer.send('call:action', action),
});
