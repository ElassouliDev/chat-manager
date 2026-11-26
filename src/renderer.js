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

const tabsEl = document.getElementById('tabs');
const viewsEl = document.getElementById('views');
const menuEl = document.getElementById('menu');

let accounts = [];
let activeId = null;
let userAgent = '';
let webviewPreload = '';
const unread = {}; // id -> count
const views = {}; // id -> <webview>

const serviceOf = (acc) => SERVICES[acc.service] || SERVICES.whatsapp;

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

function renderTabs() {
  tabsEl.replaceChildren();
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
  accounts.forEach((acc, i) => {
    const svc = serviceOf(acc);
    const b = document.createElement('button');
    b.className = 'tab' + (acc.id === activeId ? ' active' : '');
    b.style.background = acc.color;
    b.title = `${acc.name} · ${svc.label}  (${mod}${i + 1})`;
    b.textContent = initials(acc.name);

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.style.background = svc.color;
    kind.innerHTML = svc.icon; // static SVG defined above
    b.appendChild(kind);

    const badge = document.createElement('span');
    badge.className = 'badge';
    const n = unread[acc.id] || 0;
    badge.textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '';
    b.appendChild(badge);

    b.onclick = () => activate(acc.id);
    b.oncontextmenu = (e) => openMenu(e, acc.id);
    tabsEl.appendChild(b);
  });
  const total = Object.values(unread).reduce((a, b) => a + b, 0);
  window.api.setBadge(total);
}

function setUnread(id, n) {
  if (unread[id] === n) return;
  unread[id] = n;
  renderTabs();
}

function createView(acc) {
  const svc = serviceOf(acc);
  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:${acc.id}`);
  wv.setAttribute('useragent', userAgent);
  wv.setAttribute('preload', webviewPreload);
  wv.setAttribute('allowpopups', '');
  wv.src = svc.url;
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
  };
  accounts.push(acc);
  await persist();
  createView(acc);
  activate(acc.id);
}

async function removeAccount(id) {
  const acc = accounts.find((a) => a.id === id);
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

let menuFor = null;
function openMenu(e, id) {
  e.preventDefault();
  menuFor = id;
  menuEl.classList.remove('hidden');
  menuEl.style.left = e.clientX + 'px';
  menuEl.style.top = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 8) + 'px';
}
function closeMenu() { menuEl.classList.add('hidden'); }
window.addEventListener('click', (e) => { if (!menuEl.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);

menuEl.addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  closeMenu();
  const idx = accounts.findIndex((a) => a.id === menuFor);
  const acc = accounts[idx];
  if (!acc) return;
  if (act === 'rename') {
    const res = await ask({ title: 'Rename account', value: acc.name, okLabel: 'Save' });
    if (res && res.value) acc.name = res.value;
  } else if (act === 'color') {
    const res = await ask({ title: 'Choose colour', colors: true, current: acc.color, okLabel: 'Save' });
    if (res && res.color) acc.color = res.color;
  } else if (act === 'reload') {
    views[acc.id]?.reload();
    return;
  } else if (act === 'up' && idx > 0) {
    [accounts[idx - 1], accounts[idx]] = [accounts[idx], accounts[idx - 1]];
  } else if (act === 'down' && idx < accounts.length - 1) {
    [accounts[idx + 1], accounts[idx]] = [accounts[idx], accounts[idx + 1]];
  } else if (act === 'remove') {
    return removeAccount(acc.id);
  }
  await persist();
  renderTabs();
});

document.getElementById('add').onclick = addAccount;
window.api.on('add-account', addAccount);
window.api.on('switch-index', (i) => accounts[i] && activate(accounts[i].id));
window.api.on('reload-current', () => activeId && views[activeId]?.reload());

// ---------- boot ----------
(async () => {
  const data = await window.api.load();
  accounts = data.accounts;
  userAgent = data.userAgent;
  webviewPreload = data.webviewPreload;
  accounts.forEach(createView);
  await persist();
  if (accounts[0]) activate(accounts[0].id);
})();
