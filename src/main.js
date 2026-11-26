const { app, BrowserWindow, ipcMain, session, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_NAME = 'Chat Manager';

// Same data folder whether run from source or installed.
app.setName(APP_NAME);
app.setPath('userData', process.env.CHAT_MANAGER_DATA || path.join(app.getPath('appData'), APP_NAME));

// Earlier versions were called "Multi WhatsApp". Carry their accounts and
// logged-in sessions over so nobody has to scan QR codes again.
function migrateFromOldName() {
  const target = app.getPath('userData');
  if (fs.existsSync(path.join(target, 'accounts.json'))) return;
  for (const old of ['Multi WhatsApp', 'multi-whatsapp']) {
    const src = path.join(app.getPath('appData'), old);
    if (!fs.existsSync(path.join(src, 'accounts.json'))) continue;
    try {
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(path.join(src, 'accounts.json'), path.join(target, 'accounts.json'));
      if (fs.existsSync(path.join(src, 'Partitions'))) {
        fs.cpSync(path.join(src, 'Partitions'), path.join(target, 'Partitions'), {
          recursive: true,
          filter: (p) => !/Singleton|\.lock$|LOCK$/.test(path.basename(p)),
        });
      }
    } catch (err) {
      console.error('Migration from', src, 'failed:', err);
    }
    return;
  }
}
migrateFromOldName();

// Some services refuse unknown browsers, so present ourselves as the
// real Chrome version that Electron ships with.
const osPart =
  process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
const CHROME_UA = `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Pages that stay inside the app; any other link opens in the browser.
const IN_APP_HOSTS = new Set(['web.whatsapp.com', 'web.telegram.org']);

const STORE = path.join(app.getPath('userData'), 'accounts.json');

function loadAccounts() {
  try {
    const accounts = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return accounts.map((a) => ({ service: 'whatsapp', ...a }));
  } catch {
    return [{ id: 'acc-' + Date.now(), name: 'Account 1', color: '#25D366', service: 'whatsapp' }];
  }
}

function saveAccounts(accounts) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(accounts, null, 2));
}

let win;

function configurePartition(partition) {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#111b21',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  buildMenu();
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function buildMenu() {
  const switchItems = Array.from({ length: 9 }, (_, i) => ({
    label: `Account ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => send('switch-index', i),
  }));
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Account', accelerator: 'CmdOrCtrl+N', click: () => send('add-account') },
        { label: 'Reload Current Account', accelerator: 'CmdOrCtrl+R', click: () => send('reload-current') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { label: 'Accounts', submenu: switchItems },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isInApp(url) {
  try {
    return IN_APP_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

// Links clicked inside a chat open in the default browser.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => {
    if (!isInApp(url)) {
      ev.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
});

ipcMain.handle('accounts:load', () => {
  const accounts = loadAccounts();
  accounts.forEach((a) => configurePartition(`persist:${a.id}`));
  return {
    accounts,
    userAgent: CHROME_UA,
    webviewPreload: pathToFileURL(path.join(__dirname, 'webview-preload.js')).href,
  };
});

ipcMain.handle('accounts:save', (_e, accounts) => {
  accounts.forEach((a) => configurePartition(`persist:${a.id}`));
  saveAccounts(accounts);
});

ipcMain.handle('accounts:wipe', async (_e, id) => {
  // Log the removed account out for good by deleting its stored session.
  await session.fromPartition(`persist:${id}`).clearStorageData();
});

ipcMain.on('badge:set', (_e, total) => {
  if (process.platform === 'darwin') app.dock.setBadge(total > 0 ? String(total) : '');
  else app.setBadgeCount(total);
  if (win) win.setTitle(total > 0 ? `(${total}) ${APP_NAME}` : APP_NAME);
  if (process.platform === 'win32' && win && total > 0 && !win.isFocused()) win.flashFrame(true);
});

ipcMain.on('window:focus', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  // Installed builds take their icon from the app bundle; this covers `npm start`.
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (process.platform === 'darwin' && !app.isPackaged && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else win.show();
});
