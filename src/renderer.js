// Each chat service the app can host. `unread` says where its unread count
// comes from: the page title ("(3) WhatsApp") or navigator.setAppBadge().
const SERVICES = {
  whatsapp: {
    label: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    color: '#25D366',
    unread: 'title',
    hint: 'scan the QR code with that phone (WhatsApp → Linked devices).',
    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Zm4.4 12.4c-.2.5-1.1 1-1.6 1-.4.1-.9.1-1.5-.1-.3-.1-.8-.3-1.4-.5-2.4-1-4-3.5-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.6-.3h.5c.1 0 .3 0 .5.4l.7 1.7c.1.1.1.3 0 .4l-.3.4-.3.3c-.1.1-.2.3-.1.5.2.3.7 1.1 1.4 1.7.9.8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.6-.8c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z"/></svg>',
  },
  telegram: {
    label: 'Telegram',
    url: 'https://web.telegram.org/a/',
    color: '#2AABEE',
    unread: 'badge',
    hint: 'scan the QR code in Telegram on your phone (Settings → Devices → Add Device), or log in with your phone number.',
    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21.4 4.3 2.9 11.4c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.8-1.4-1.4ZM8.7 14.1l9.6-6.1c.5-.3.9-.1.5.2l-8 7.3-.3 3.4-1.8-4.8Z"/></svg>',
  },
};
const COLORS = ['#25D366', '#2AABEE', '#F5A623', '#E94F64', '#9B59B6', '#1ABC9C', '#E67E22', '#607D8B'];
const BELL_OFF = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 18.7 5.3 4 4 5.3l3 3V11c0 2-1 3.6-2 4.6V17h11.7l2 2 1.3-1.3ZM12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-11c0-3-1.6-5.4-4.5-6V4a1.5 1.5 0 0 0-3 0v1c-.7.2-1.4.5-1.9.9L18 15.3V11Z"/></svg>';

// "Muted until" values: 0 = not muted, -1 = until unmuted, otherwise a time.
const MUTE_FOREVER = -1;
const MUTE_OPTIONS = [
  { label: 'Mute for 1 hour', ms: 60 * 60 * 1000 },
  { label: 'Mute for 8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: 'Mute for 1 day', ms: 24 * 60 * 60 * 1000 },
  { label: 'Mute until I unmute', ms: MUTE_FOREVER },
];

const tabsEl = document.getElementById('tabs');
const viewsEl = document.getElementById('views');
const menuEl = document.getElementById('menu');

let accounts = [];
let activeId = null;
let userAgent = '';
let webviewPreload = '';
let platform = '';
const unread = {}; // id -> count
const views = {}; // id -> <webview>

const serviceOf = (acc) => SERVICES[acc.service] || SERVICES.whatsapp;
const isMuted = (acc) => acc.mutedUntil === MUTE_FOREVER || acc.mutedUntil > Date.now();

function mutedLabel(acc) {
  if (acc.mutedUntil === MUTE_FOREVER) return 'Muted until you unmute';
  const t = new Date(acc.mutedUntil);
  const sameDay = t.toDateString() === new Date().toDateString();
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Muted until ${sameDay ? time : t.toLocaleDateString([], { weekday: 'short' }) + ' ' + time}`;
}

// ---------- dialogs ----------
const dlg = document.getElementById('dlg');
function ask({ title, text = '', value = null, colors = false, current = null, services = false, okLabel = 'OK', danger = false }) {
  const input = document.getElementById('dlg-input');
  const colorsEl = document.getElementById('dlg-colors');
  const servicesEl = document.getElementById('dlg-services');
  const textEl = document.getElementById('dlg-text');
  const ok = document.getElementById('dlg-ok');
  document.getElementById('dlg-title').textContent = title;
  textEl.textContent = text;
  ok.textContent = okLabel;
  ok.classList.toggle('danger-btn', danger);
  input.style.display = value === null ? 'none' : '';
  input.value = value ?? '';

  let picked = current;
  const paintColors = () => [...colorsEl.children].forEach((x) => x.classList.toggle('sel', x.dataset.color === picked));
  colorsEl.replaceChildren();
  colorsEl.style.display = colors ? '' : 'none';
  if (colors) {
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.color = c;
      b.style.background = c;
      b.onclick = () => { picked = c; paintColors(); };
      colorsEl.appendChild(b);
    });
    paintColors();
  }

  let service = 'whatsapp';
  servicesEl.replaceChildren();
  servicesEl.style.display = services ? '' : 'none';
  if (services) {
    const paintServices = () => {
      [...servicesEl.children].forEach((x) => x.classList.toggle('sel', x.dataset.service === service));
      textEl.textContent = `Give it a name, then ${SERVICES[service].hint}`;
    };
    Object.entries(SERVICES).forEach(([key, s]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.service = key;
      b.style.setProperty('--svc', s.color);
      b.innerHTML = s.icon; // static SVG defined above
      b.append(s.label);
      b.onclick = () => {
        // Follow the service colour unless the user already chose another.
        if (picked === SERVICES[service].color) { picked = s.color; paintColors(); }
        service = key;
        paintServices();
      };
      servicesEl.appendChild(b);
    });
    paintServices();
  }

  return new Promise((resolve) => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve({ value: input.value.trim(), color: picked, service });
    };
    dlg.returnValue = '';
    dlg.showModal();
    if (value !== null) input.select();
    else ok.focus();
  });
}

// ---------- persistence ----------
const persist = () => window.api.save(accounts);

// ---------- rendering ----------
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Windows has no taskbar badge, so draw the unread count for an overlay icon.
function overlayImage(total) {
  if (platform !== 'win32' || total <= 0) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#E53935';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${total > 99 ? 13 : total > 9 ? 17 : 21}px Segoe UI, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(total > 99 ? '99+' : String(total), 16, 17);
  return c.toDataURL('image/png');
}

function renderTabs() {
  tabsEl.replaceChildren();
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
  accounts.forEach((acc, i) => {
    const svc = serviceOf(acc);
    const muted = isMuted(acc);
    const b = document.createElement('div');
    b.className = 'tab' + (acc.id === activeId ? ' active' : '') + (muted ? ' muted' : '');
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    b.style.background = acc.color;
    b.title = `${acc.name} · ${svc.label}  (${mod}${i + 1})${muted ? '\n' + mutedLabel(acc) : ''}`;
    b.append(initials(acc.name));

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.style.background = svc.color;
    kind.innerHTML = svc.icon; // static SVG defined above
    b.appendChild(kind);

    if (muted) {
      const m = document.createElement('span');
      m.className = 'mute-mark';
      m.innerHTML = BELL_OFF; // static SVG defined above
      b.appendChild(m);
    }

    const badge = document.createElement('span');
    badge.className = 'badge';
    const n = unread[acc.id] || 0;
    badge.textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '';
    b.appendChild(badge);

    const close = document.createElement('button');
    close.className = 'close';
    close.title = `Remove ${acc.name}`;
    close.textContent = '×';
    close.onclick = (e) => {
      e.stopPropagation();
      removeAccount(acc.id);
    };
    b.appendChild(close);

    b.onclick = () => activate(acc.id);
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') activate(acc.id); };
    b.oncontextmenu = (e) => openMenu(e, acc.id);
    tabsEl.appendChild(b);
  });

  // Muted accounts don't add to the Dock/taskbar/tray count.
  const total = accounts.reduce((sum, a) => sum + (isMuted(a) ? 0 : unread[a.id] || 0), 0);
  window.api.setBadge({
    total,
    overlay: overlayImage(total),
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, label: serviceOf(a).label, unread: unread[a.id] || 0, muted: isMuted(a),
    })),
  });
}

function setUnread(id, n) {
  if (unread[id] === n) return;
  unread[id] = n;
  renderTabs();
}

function sendMuteState(acc) {
  try { views[acc.id]?.send('chat-mgr:muted', isMuted(acc)); } catch {}
}

function createView(acc) {
  const svc = serviceOf(acc);
  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:${acc.id}`);
  wv.setAttribute('useragent', userAgent);
  wv.setAttribute('preload', webviewPreload);
  wv.setAttribute('allowpopups', '');
  wv.src = svc.url;
  wv.addEventListener('dom-ready', () => sendMuteState(acc));
  if (svc.unread === 'title') {
    wv.addEventListener('page-title-updated', (e) => {
      const m = /^\((\d+)\)/.exec(e.title);
      setUnread(acc.id, m ? parseInt(m[1], 10) : 0);
    });
  }
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'notification-click') {
      window.api.focusWindow();
      activate(acc.id);
    } else if (e.channel === 'badge' && svc.unread === 'badge') {
      setUnread(acc.id, e.args[0] || 0);
    } else if (e.channel === 'call') {
      activate(acc.id);
      window.api.incomingCall();
    }
  });
  viewsEl.appendChild(wv);
  views[acc.id] = wv;
}

function activate(id) {
  if (!views[id]) return;
  activeId = id;
  Object.entries(views).forEach(([vid, wv]) => wv.classList.toggle('active', vid === id));
  renderTabs();
  try { views[id].focus(); } catch {}
}

// ---------- account actions ----------
async function addAccount() {
  const res = await ask({
    title: 'Add account',
    value: `Account ${accounts.length + 1}`,
    services: true,
    colors: true,
    current: SERVICES.whatsapp.color,
    okLabel: 'Add',
  });
  if (!res) return;
  const acc = {
    id: 'acc-' + Date.now(),
    name: res.value || `Account ${accounts.length + 1}`,
    color: res.color,
    service: res.service,
    mutedUntil: 0,
  };
  accounts.push(acc);
  await persist();
  createView(acc);
  activate(acc.id);
}

async function removeAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;
  const res = await ask({
    title: `Remove "${acc.name}"?`,
    text: `This logs this ${serviceOf(acc).label} account out of Chat Manager and deletes its local data. Your chats stay on your phone.`,
    okLabel: 'Remove',
    danger: true,
  });
  if (!res) return;
  views[id]?.remove();
  delete views[id];
  delete unread[id];
  accounts = accounts.filter((a) => a.id !== id);
  await window.api.wipe(id);
  await persist();
  if (activeId === id) activeId = accounts[0]?.id ?? null;
  if (activeId) activate(activeId);
  else renderTabs();
}

async function setMute(acc, ms) {
  acc.mutedUntil = ms === 0 ? 0 : ms === MUTE_FOREVER ? MUTE_FOREVER : Date.now() + ms;
  sendMuteState(acc);
  await persist();
  renderTabs();
}

// Timed mutes end by themselves.
setInterval(() => {
  const expired = accounts.filter((a) => a.mutedUntil > 0 && a.mutedUntil <= Date.now());
  expired.forEach((a) => setMute(a, 0));
}, 30 * 1000);

// ---------- right-click menu ----------
let menuFor = null;

function menuButton(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = () => {
    closeMenu();
    onClick();
  };
  return b;
}

function openMenu(e, id) {
  e.preventDefault();
  const idx = accounts.findIndex((a) => a.id === id);
  const acc = accounts[idx];
  if (!acc) return;
  menuFor = id;
  const items = [
    menuButton('Rename', async () => {
      const res = await ask({ title: 'Rename account', value: acc.name, okLabel: 'Save' });
      if (res && res.value) { acc.name = res.value; await persist(); renderTabs(); }
    }),
    menuButton('Change colour', async () => {
      const res = await ask({ title: 'Choose colour', colors: true, current: acc.color, okLabel: 'Save' });
      if (res && res.color) { acc.color = res.color; await persist(); renderTabs(); }
    }),
    document.createElement('hr'),
  ];
  if (isMuted(acc)) {
    const note = document.createElement('div');
    note.className = 'menu-note';
    note.textContent = mutedLabel(acc);
    items.push(note, menuButton('Unmute notifications', () => setMute(acc, 0)));
  } else {
    MUTE_OPTIONS.forEach((o) => items.push(menuButton(o.label, () => setMute(acc, o.ms))));
  }
  items.push(
    document.createElement('hr'),
    menuButton('Reload', () => views[acc.id]?.reload()),
  );
  if (idx > 0) {
    items.push(menuButton('Move up', async () => {
      [accounts[idx - 1], accounts[idx]] = [accounts[idx], accounts[idx - 1]];
      await persist();
      renderTabs();
    }));
  }
  if (idx < accounts.length - 1) {
    items.push(menuButton('Move down', async () => {
      [accounts[idx + 1], accounts[idx]] = [accounts[idx], accounts[idx + 1]];
      await persist();
      renderTabs();
    }));
  }
  items.push(document.createElement('hr'), menuButton('Remove & log out', () => removeAccount(acc.id), 'danger'));
  menuEl.replaceChildren(...items);
  menuEl.classList.remove('hidden');
  menuEl.style.left = e.clientX + 'px';
  menuEl.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 8)) + 'px';
}

function closeMenu() {
  menuEl.classList.add('hidden');
  menuFor = null;
}
window.addEventListener('click', (e) => { if (menuFor && !menuEl.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------- theme ----------
const THEME_ICONS = {
  system: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2v16a8 8 0 0 1 0-16Z"/></svg>',
  light: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5 1 3h-2l1-3Zm0 20-1-3h2l-1 3ZM2 12l3-1v2l-3-1Zm20 0-3 1v-2l3 1ZM4.9 4.9l2.8 1.4-1.4 1.4-1.4-2.8Zm14.2 14.2-2.8-1.4 1.4-1.4 1.4 2.8Zm0-14.2-1.4 2.8-1.4-1.4 2.8-1.4ZM4.9 19.1l1.4-2.8 1.4 1.4-2.8 1.4Z"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.7 14.6A8.5 8.5 0 0 1 9.4 3.3 9 9 0 1 0 20.7 14.6Z"/></svg>',
};
const THEME_NAMES = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_ORDER = ['system', 'light', 'dark'];
const themeBtn = document.getElementById('theme');
let theme = 'system';

function showTheme(next) {
  theme = THEME_ORDER.includes(next) ? next : 'system';
  const after = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  themeBtn.innerHTML = THEME_ICONS[theme]; // static SVG defined above
  themeBtn.title = `Theme: ${THEME_NAMES[theme]} — click for ${THEME_NAMES[after]}`;
  themeBtn.setAttribute('aria-label', themeBtn.title);
}

themeBtn.onclick = () => {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  showTheme(next);
  window.api.setTheme(next);
};
window.api.on('theme', showTheme);

document.getElementById('add').onclick = addAccount;
window.api.on('add-account', addAccount);
window.api.on('switch-index', (i) => accounts[i] && activate(accounts[i].id));
window.api.on('switch-to', (id) => activate(id));
window.api.on('reload-current', () => activeId && views[activeId]?.reload());

// ---------- boot ----------
(async () => {
  const data = await window.api.load();
  accounts = data.accounts;
  userAgent = data.userAgent;
  webviewPreload = data.webviewPreload;
  platform = data.platform;
  showTheme(data.theme);
  accounts.forEach(createView);
  await persist();
  if (accounts[0]) activate(accounts[0].id);
})();
