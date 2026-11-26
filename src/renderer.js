const WA_URL = 'https://web.whatsapp.com/';
const COLORS = ['#25D366', '#34B7F1', '#F5A623', '#E94F64', '#9B59B6', '#1ABC9C', '#E67E22', '#607D8B'];

const tabsEl = document.getElementById('tabs');
const viewsEl = document.getElementById('views');
const menuEl = document.getElementById('menu');

let accounts = [];
let activeId = null;
let userAgent = '';
let webviewPreload = '';
const unread = {}; // id -> count
const views = {}; // id -> <webview>

// ---------- dialogs ----------
const dlg = document.getElementById('dlg');
function ask({ title, text = '', value = null, colors = false, current = null, okLabel = 'OK', danger = false }) {
  const input = document.getElementById('dlg-input');
  const colorsEl = document.getElementById('dlg-colors');
  const ok = document.getElementById('dlg-ok');
  document.getElementById('dlg-title').textContent = title;
  document.getElementById('dlg-text').textContent = text;
  ok.textContent = okLabel;
  ok.classList.toggle('danger-btn', danger);
  input.style.display = value === null ? 'none' : '';
  input.value = value ?? '';
  let picked = current;
  colorsEl.innerHTML = '';
  colorsEl.style.display = colors ? '' : 'none';
  if (colors) {
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.classList.toggle('sel', c === picked);
      b.onclick = () => {
        picked = c;
        [...colorsEl.children].forEach((x) => x.classList.toggle('sel', x === b));
      };
      colorsEl.appendChild(b);
    });
  }
  return new Promise((resolve) => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve({ value: input.value.trim(), color: picked });
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
  tabsEl.innerHTML = '';
  accounts.forEach((acc, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (acc.id === activeId ? ' active' : '');
    b.style.background = acc.color;
    b.title = `${acc.name}  (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}${i + 1})`;
    b.textContent = initials(acc.name);
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

function createView(acc) {
  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:${acc.id}`);
  wv.setAttribute('useragent', userAgent);
  wv.setAttribute('preload', webviewPreload);
  wv.setAttribute('allowpopups', '');
  wv.src = WA_URL;
  wv.addEventListener('page-title-updated', (e) => {
    const m = /^\((\d+)\)/.exec(e.title);
    const n = m ? parseInt(m[1], 10) : 0;
    if (unread[acc.id] !== n) {
      unread[acc.id] = n;
      renderTabs();
    }
  });
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'notification-click') {
      window.api.focusWindow();
      activate(acc.id);
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
    title: 'Add WhatsApp account',
    text: 'Give it a name, then scan the QR code with the phone for that account.',
    value: `Account ${accounts.length + 1}`,
    colors: true,
    current: COLORS[accounts.length % COLORS.length],
    okLabel: 'Add',
  });
  if (!res) return;
  const acc = { id: 'acc-' + Date.now(), name: res.value || `Account ${accounts.length + 1}`, color: res.color };
  accounts.push(acc);
  await persist();
  createView(acc);
  activate(acc.id);
}

async function removeAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  const res = await ask({
    title: `Remove "${acc.name}"?`,
    text: 'This logs the account out of this app and deletes its local data. Your chats stay on your phone.',
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
  const { innerHeight } = window;
  menuEl.style.left = e.clientX + 'px';
  menuEl.style.top = Math.min(e.clientY, innerHeight - menuEl.offsetHeight - 8) + 'px';
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
