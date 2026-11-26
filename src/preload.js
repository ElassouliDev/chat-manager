const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('accounts:load'),
  save: (accounts) => ipcRenderer.invoke('accounts:save', accounts),
  wipe: (id) => ipcRenderer.invoke('accounts:wipe', id),
  setBadge: (total) => ipcRenderer.send('badge:set', total),
  focusWindow: () => ipcRenderer.send('window:focus'),
  on: (channel, fn) => {
    const allowed = ['switch-index', 'add-account', 'reload-current'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
