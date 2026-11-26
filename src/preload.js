const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('accounts:load'),
  save: (accounts) => ipcRenderer.invoke('accounts:save', accounts),
  wipe: (id) => ipcRenderer.invoke('accounts:wipe', id),
  setBadge: (status) => ipcRenderer.send('badge:set', status),
  focusWindow: () => ipcRenderer.send('window:focus'),
  incomingCall: (info) => ipcRenderer.send('call:incoming', info),
  callEnded: (accountId) => ipcRenderer.send('call:ended', accountId),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  on: (channel, fn) => {
    const allowed = ['switch-index', 'switch-to', 'add-account', 'reload-current', 'theme', 'call-action'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
