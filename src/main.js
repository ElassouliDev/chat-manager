const { app, BrowserWindow, ipcMain, session, shell, Menu, Tray, nativeImage, nativeTheme, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { SERVICES, SIGN_IN_HOSTS } = require('./services');

const APP_NAME = 'Chat Manager';
const APP_ID = 'com.local.chatmanager';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// Same data folder whether run from source or installed.
app.setName(APP_NAME);
app.setPath('userData', process.env.CHAT_MANAGER_DATA || path.join(app.getPath('appData'), APP_NAME));

// Windows only shows toast notifications for apps with an AppUserModelID,
// and it must match the installer's appId.
if (IS_WIN) app.setAppUserModelId(APP_ID);

// One copy at a time; opening it again brings the running window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

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
const osPart = IS_MAC ? 'Macintosh; Intel Mac OS X 10_15_7' : IS_WIN ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
const CHROME_UA = `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Pages that stay inside the app; any other link opens in the browser.

// What the chat pages may use: notifications, and microphone/camera for calls.
const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'media', 'mediaKeySystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection',
  'display-capture',
]);

// ---------- stored data ----------
const DATA = app.getPath('userData');
const STORE = path.join(DATA, 'accounts.json');
const SETTINGS = path.join(DATA, 'settings.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadAccounts() {
  const accounts = readJson(STORE, null);
  if (!accounts) return [{ id: 'acc-' + Date.now(), name: 'Account 1', color: '#25D366', service: 'whatsapp', mutedUntil: 0 }];
  return accounts.map((a) => ({ service: 'whatsapp', mutedUntil: 0, ...a }));
}

const settings = readJson(SETTINGS, {});
const saveSettings = () => writeJson(SETTINGS, settings);

// ---------- theme ----------
// nativeTheme drives prefers-color-scheme for our sidebar and for the
// WhatsApp and Telegram pages (when their own theme is "System default").
const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
nativeTheme.themeSource = THEMES.some((t) => t.id === settings.theme) ? settings.theme : 'system';

const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#111b21' : '#f0f2f5');

function setTheme(theme) {
  if (!THEMES.some((t) => t.id === theme)) return;
  nativeTheme.themeSource = theme;
  settings.theme = theme;
  saveSettings();
  buildMenu();
  updateTray();
  send('theme', theme);
}

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground());
});

const themeMenuItems = () =>
  THEMES.map((t) => ({
    label: t.label,
    type: 'radio',
    checked: nativeTheme.themeSource === t.id,
    click: () => setTheme(t.id),
  }));

// ---------- window ----------
let win = null;
let tray = null;
let quitting = false;
let status = { total: 0, accounts: [] }; // latest unread info from the window

// Started by "Open at login": stay in the tray until the user opens the window.
const startHidden = process.argv.includes('--hidden') || (IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin);

// Which service each account session belongs to, for the link rules below.
const serviceBySession = new Map();

function configurePartition(partition, service) {
  const ses = session.fromPartition(partition);
  serviceBySession.set(ses, SERVICES[service] || SERVICES.whatsapp);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // Screen sharing in calls. On macOS 15+ the system picker lets you choose a
  // window or screen; elsewhere the main screen is shared.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (!sources.length) return callback({});
          callback(IS_WIN ? { video: sources[0], audio: 'loopback' } : { video: sources[0] });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: windowBackground(),
    icon: IS_MAC ? undefined : path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // Closing the window only hides it. Chats keep running in the background
  // so notifications and calls still arrive; quit from the tray or menu.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (IS_WIN && tray && !settings.trayHintShown) {
      tray.displayBalloon({
        iconType: 'info',
        title: `${APP_NAME} is still running`,
        content: 'You will keep getting messages and calls. Right-click this icon to quit.',
      });
      settings.trayHintShown = true;
      saveSettings();
    }
  });
  win.on('focus', () => win.flashFrame(false));
}

function showWindow({ steal = false } = {}) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (IS_MAC && steal) app.focus({ steal: true });
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------- menus ----------
function buildMenu() {
  const switchItems = Array.from({ length: 9 }, (_, i) => ({
    label: `Account ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => send('switch-index', i),
  }));
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Account', accelerator: 'CmdOrCtrl+N', click: () => send('add-account') },
        { label: 'Reload Current Account', accelerator: 'CmdOrCtrl+R', click: () => send('reload-current') },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => win && win.hide() },
        ...(IS_MAC ? [] : [{ label: 'Quit', accelerator: 'Ctrl+Q', click: () => app.quit() }]),
      ],
    },
    { role: 'editMenu' },
    { label: 'Accounts', submenu: switchItems },
    {
      label: 'View',
      submenu: [
        { label: 'Theme', submenu: themeMenuItems() },
        { type: 'separator' },
        { role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isOpenAtLogin() {
  return app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
}

function createTray() {
  let image;
  if (IS_MAC) {
    image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    image.setTemplateImage(true);
  } else {
    image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 32, height: 32 });
  }
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  // Windows: left click opens the window; right click shows the menu.
  if (!IS_MAC) tray.on('click', () => showWindow());
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const accountItems = status.accounts.map((a) => ({
    label: `${a.name} · ${a.label}${a.unread > 0 ? `  (${a.unread})` : a.unread < 0 ? '  •' : ''}${a.muted ? '  — muted' : ''}`,
    click: () => {
      showWindow();
      send('switch-to', a.id);
    },
  }));
  const menu = Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: () => showWindow() },
    ...(accountItems.length ? [{ type: 'separator' }, ...accountItems] : []),
    { type: 'separator' },
    { label: 'Theme', submenu: themeMenuItems() },
    { label: 'Open at login', type: 'checkbox', checked: isOpenAtLogin(), click: (item) => setOpenAtLogin(item.checked) },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(status.total > 0 ? `${APP_NAME} — ${status.total} unread` : APP_NAME);
  if (IS_MAC) tray.setTitle(status.total > 0 ? String(status.total) : status.dot ? '•' : '');
}

// ---------- chat pages ----------
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};
const onHost = (url, hosts) => {
  const host = hostOf(url);
  return hosts.some((h) => host === h || host.endsWith('.' + h));
};

// A page may stay inside the app when it belongs to the account's own service
// or is a common sign-in page. Services with company sign-in (sso) may go anywhere.
function staysInApp(svc, url) {
  if (!svc || svc.sso) return true;
  return onHost(url, [...(svc.hosts || []), ...SIGN_IN_HOSTS]);
}

// Sign-in popups ("Continue with Google", Microsoft login) open in a small
// window inside the app, in the account's own session.
const isSignInPopup = (url) => onHost(url, SIGN_IN_HOSTS);

// A service's own windows (call windows such as Messenger's, "open in new
// window" for a mail or chat) also stay inside the app, in the same session.
const isOwnWindow = (svc, url) => url === 'about:blank' || Boolean(svc && onHost(url, svc.hosts || []));

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'window') {
    // Keep background accounts fully awake so their messages and calls arrive on time.
    contents.on('will-attach-webview', (_ev, webPreferences) => {
      webPreferences.backgroundThrottling = false;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
    });
    // Windows opened from a chat (sign-in, calls) send further links to the browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    return;
  }
  if (contents.getType() !== 'webview') return;
  const svc = () => serviceBySession.get(contents.session);

  // Links that open a new window go to the default browser, except sign-in
  // popups and the service's own windows (calls, pop-outs).
  contents.setWindowOpenHandler(({ url }) => {
    if (isSignInPopup(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } };
    }
    if (isOwnWindow(svc(), url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 720, autoHideMenuBar: true } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Links that would take the account to another site open in the browser instead.
  contents.on('will-navigate', (ev, url) => {
    if (!staysInApp(svc(), url)) {
      ev.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
});

// ---------- messages from the window ----------
ipcMain.handle('accounts:load', () => {
  const accounts = loadAccounts();
  accounts.forEach((a) => configurePartition(`persist:${a.id}`, a.service));
  return {
    accounts,
    platform: process.platform,
    theme: nativeTheme.themeSource,
    userAgent: CHROME_UA,
    webviewPreload: pathToFileURL(path.join(__dirname, 'webview-preload.js')).href,
  };
});

ipcMain.handle('accounts:save', (_e, accounts) => {
  accounts.forEach((a) => configurePartition(`persist:${a.id}`, a.service));
  writeJson(STORE, accounts);
});

ipcMain.handle('accounts:wipe', async (_e, id) => {
  // Log the removed account out for good by deleting its stored session.
  await session.fromPartition(`persist:${id}`).clearStorageData();
});

ipcMain.on('badge:set', (_e, next) => {
  status = next;
  const { total, dot } = next;
  if (IS_MAC) app.dock.setBadge(total > 0 ? String(total) : dot ? '•' : '');
  else app.setBadgeCount(total);
  if (IS_WIN && win) {
    // The Windows taskbar has no badge API, so draw the count as an overlay.
    const overlay = next.overlay ? nativeImage.createFromDataURL(next.overlay) : null;
    win.setOverlayIcon(overlay, total > 0 ? `${total} unread` : '');
    if (total > 0 && !win.isFocused()) win.flashFrame(true);
  }
  if (win) win.setTitle(total > 0 ? `(${total}) ${APP_NAME}` : APP_NAME);
  updateTray();
});

ipcMain.on('window:focus', () => showWindow());
ipcMain.on('theme:set', (_e, theme) => setTheme(theme));

// ---------- incoming-call popup ----------
// A small always-on-top window in the corner of the screen, like the WhatsApp
// and Telegram desktop apps. It appears without taking focus, even while the
// main window is hidden in the tray.
const CALL_POPUP = { width: 372, height: 162, margin: 12, timeoutMs: 60 * 1000 };
let callWin = null;
let currentCall = null;
let callTimer = null;

function placeCallPopup() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const x = workArea.x + workArea.width - CALL_POPUP.width - CALL_POPUP.margin;
  // Top-right on Mac (below the menu bar), bottom-right on Windows (above the taskbar).
  const y = IS_MAC ? workArea.y + CALL_POPUP.margin : workArea.y + workArea.height - CALL_POPUP.height - CALL_POPUP.margin;
  callWin.setBounds({ x, y, width: CALL_POPUP.width, height: CALL_POPUP.height });
}

function showCallPopup(info) {
  currentCall = info;
  if (!callWin || callWin.isDestroyed()) {
    callWin = new BrowserWindow({
      // On macOS a "panel" floats without waking the app, so a hidden main
      // window stays hidden while the popup shows.
      ...(IS_MAC ? { type: 'panel' } : {}),
      width: CALL_POPUP.width,
      height: CALL_POPUP.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Incoming call',
      webPreferences: { preload: path.join(__dirname, 'call-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    callWin.setAlwaysOnTop(true, 'screen-saver');
    if (IS_MAC) callWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    callWin.on('closed', () => {
      callWin = null;
    });
    callWin.loadFile(path.join(__dirname, 'call.html'));
  }
  placeCallPopup();
  const deliver = () => callWin && !callWin.isDestroyed() && callWin.webContents.send('call:show', info);
  if (callWin.webContents.isLoading()) callWin.webContents.once('did-finish-load', deliver);
  else deliver();
  callWin.showInactive();
  if (IS_MAC) app.dock.bounce('critical');
  if (IS_WIN && win) win.flashFrame(true);
  clearTimeout(callTimer);
  callTimer = setTimeout(hideCallPopup, CALL_POPUP.timeoutMs);
}

function hideCallPopup() {
  clearTimeout(callTimer);
  currentCall = null;
  if (callWin && !callWin.isDestroyed()) callWin.hide();
}

// An account is ringing.
ipcMain.on('call:incoming', (_e, info) => showCallPopup(info));

// The service closed its call notification (answered, declined or missed).
ipcMain.on('call:ended', (_e, accountId) => {
  if (currentCall && currentCall.accountId === accountId) hideCallPopup();
});

// Buttons in the popup.
ipcMain.on('call:action', (_e, action) => {
  const call = currentCall;
  hideCallPopup();
  if (!call) return;
  if (action === 'answer' || action === 'open') {
    showWindow({ steal: true });
    send('call-action', { accountId: call.accountId, action });
  } else if (action === 'decline') {
    send('call-action', { accountId: call.accountId, action });
  }
});

// ---------- app lifecycle ----------
app.on('second-instance', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  // Installed builds take their icon from the app bundle; this covers `npm start`.
  const devIcon = path.join(__dirname, 'assets', 'icon.png');
  if (IS_MAC && !app.isPackaged && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  buildMenu();
  createWindow();
  createTray();
});

app.on('activate', () => {
  if (win) showWindow();
});
