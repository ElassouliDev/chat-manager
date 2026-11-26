const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('accounts:load'),
  save: (accounts) => ipcRenderer.invoke('accounts:save', accounts),
  wipe: (id) => ipcRenderer.invoke('accounts:wipe', id),
  setBadge: (status) => ipcRenderer.send('badge:set', status),
  focusWindow: () => ipcRenderer.send('window:focus'),
  incomingCall: () => ipcRenderer.send('call:incoming'),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  on: (channel, fn) => {
    const allowed = ['switch-index', 'switch-to', 'add-account', 'reload-current', 'theme'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
