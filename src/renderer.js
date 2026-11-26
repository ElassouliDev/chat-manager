// SERVICES and SIGN_IN_HOSTS come from services.js, loaded before this file.
const COLORS = ['#25D366', '#2AABEE', '#5B5FC7', '#0A66C2', '#E1306C', '#F5A623', '#1ABC9C', '#607D8B'];
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
const unread = {}; // id -> count shown (-1 = unread without a count, shown as a dot)
const unreadBySource = {}; // id -> { title, badge }
const views = {}; // id -> <webview>

const serviceOf = (acc) => SERVICES[acc.service] || SERVICES.whatsapp;
const serviceName = (acc) => serviceOf(acc).fullName || serviceOf(acc).label;
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
function overlayImage(total, dot) {
  if (platform !== 'win32' || (total <= 0 && !dot)) return null;
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
  if (total > 0) g.fillText(total > 99 ? '99+' : String(total), 16, 17);
  else {
    g.beginPath();
    g.arc(16, 16, 6, 0, Math.PI * 2);
    g.fill();
  }
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
    b.title = `${acc.name} · ${serviceName(acc)}  (${mod}${i + 1})${muted ? '\n' + mutedLabel(acc) : ''}\nDrag to reorder`;
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
    badge.classList.toggle('dot', n < 0);
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
    makeDraggable(b, acc.id);
    tabsEl.appendChild(b);
  });

  // Muted accounts don't add to the Dock/taskbar/tray count. Unread dots
  // (no count) show a dot there only when nothing has a real count.
  const counted = accounts.filter((a) => !isMuted(a));
  const total = counted.reduce((sum, a) => sum + Math.max(0, unread[a.id] || 0), 0);
  const dot = total === 0 && counted.some((a) => unread[a.id] < 0);
  window.api.setBadge({
    total,
    dot,
    overlay: overlayImage(total, dot),
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, label: serviceName(a), unread: unread[a.id] || 0, muted: isMuted(a),
    })),
  });
}

// ---------- drag to reorder ----------
let draggingId = null;

function clearDropMarks() {
  tabsEl.querySelectorAll('.drop-before, .drop-after').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
}

function makeDraggable(tab, id) {
  tab.draggable = true;
  tab.addEventListener('dragstart', (e) => {
    draggingId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    requestAnimationFrame(() => tab.classList.add('dragging'));
  });
  tab.addEventListener('dragend', () => {
    draggingId = null;
    tab.classList.remove('dragging');
    clearDropMarks();
  });
  tab.addEventListener('dragover', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = tab.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    tab.classList.add(after ? 'drop-after' : 'drop-before');
  });
  tab.addEventListener('drop', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.stopPropagation();
    moveAccount(draggingId, id, tab.classList.contains('drop-after'));
  });
}

// Dropping below the last icon moves the account to the end.
tabsEl.addEventListener('dragover', (e) => {
  if (!draggingId) return;
  e.preventDefault();
});
tabsEl.addEventListener('drop', (e) => {
  if (!draggingId || e.target !== tabsEl) return;
  e.preventDefault();
  moveAccount(draggingId, accounts[accounts.length - 1].id, true);
});

async function moveAccount(fromId, toId, after) {
  const moving = accounts.find((a) => a.id === fromId);
  if (!moving || fromId === toId) return;
  const rest = accounts.filter((a) => a.id !== fromId);
  const at = rest.findIndex((a) => a.id === toId);
  rest.splice(after ? at + 1 : at, 0, moving);
  accounts = rest;
  draggingId = null;
  clearDropMarks();
  await persist();
  renderTabs();
}

// Combine the title and app-badge counts: a real count wins over a dot.
function setUnread(id, source, n) {
  const src = (unreadBySource[id] = { ...unreadBySource[id], [source]: n });
  const values = Object.values(src);
  const best = Math.max(0, ...values);
  const next = best > 0 ? best : values.includes(-1) ? -1 : 0;
  if (unread[id] === next) return;
  unread[id] = next;
  renderTabs();
}

function unreadFromTitle(svc, title) {
  const m = (svc.titleCount || /^\((\d+)\)/).exec(title);
  if (m) return parseInt(m[1], 10);
  return svc.titleDot && svc.titleDot.test(title) ? -1 : 0;
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
  if (svc.signIn) {
    wv.addEventListener('did-navigate', (e) => {
      if (svc.signIn.when.test(e.url)) wv.loadURL(svc.signIn.url);
    });
  }
  if (svc.reloadOn) {
    let retries = 0;
    wv.addEventListener('console-message', (e) => {
      if (svc.reloadOn.test(e.message) && retries < 3) {
        retries += 1;
        setTimeout(() => wv.reload(), 1500);
      }
    });
    wv.addEventListener('did-navigate', (e) => {
      if (!/^https:\/\/teams\./.test(e.url)) retries = 0;
    });
  }
  if (svc.unread.includes('title')) {
    wv.addEventListener('page-title-updated', (e) => {
      setUnread(acc.id, 'title', unreadFromTitle(svc, e.title));
    });
  }
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'notification-click') {
      window.api.focusWindow();
      activate(acc.id);
    } else if (e.channel === 'badge' && svc.unread.includes('badge')) {
      setUnread(acc.id, 'badge', e.args[0] || 0);
    } else if (e.channel === 'call') {
      // Show the call popup; the app itself stays where it is until you answer.
      const { title, body } = e.args[0] || {};
      window.api.incomingCall({ accountId: acc.id, name: acc.name, color: acc.color, service: acc.service, title, body });
    } else if (e.channel === 'call-ended') {
      window.api.callEnded(acc.id);
    } else if (e.channel === 'call-action-result' && !e.args[0]?.pressed) {
      // The service's own Answer/Decline button wasn't found: show the call so you can handle it.
      activate(acc.id);
      window.api.focusWindow();
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
    text: `This logs this ${serviceName(acc)} account out of Chat Manager and deletes its local data. ${serviceOf(acc).keeps}`,
    okLabel: 'Remove',
    danger: true,
  });
  if (!res) return;
  views[id]?.remove();
  delete views[id];
  delete unread[id];
  delete unreadBySource[id];
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
  if (idx > 0) items.push(menuButton('Move to top', () => moveAccount(acc.id, accounts[0].id, false)));
  if (idx < accounts.length - 1) items.push(menuButton('Move to bottom', () => moveAccount(acc.id, accounts[accounts.length - 1].id, true)));
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

// Enter in the dialog presses the main button (Add / Save / Remove): Cancel
// is a plain button, so it is not the form's default. Esc still cancels.
document.getElementById('dlg-cancel').onclick = () => dlg.close('cancel');

document.getElementById('add').onclick = addAccount;
window.api.on('add-account', addAccount);
window.api.on('switch-index', (i) => accounts[i] && activate(accounts[i].id));
window.api.on('switch-to', (id) => activate(id));
// Answer / Decline / Open from the call popup.
window.api.on('call-action', ({ accountId, action }) => {
  if (!views[accountId]) return;
  if (action === 'answer' || action === 'open') activate(accountId);
  if (action === 'answer' || action === 'decline') {
    try { views[accountId].send('chat-mgr:call-action', action); } catch {}
  }
});
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
