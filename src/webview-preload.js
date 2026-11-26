// Runs inside each chat service's page and talks to the host window:
//  - reports notification clicks, so the app can jump to that account
//  - reports incoming calls, so the app can come forward even from the tray
//  - reports the unread count services publish through navigator.setAppBadge()
//  - silences notifications and sounds while the account is muted
const { ipcRenderer, webFrame } = require('electron');

webFrame.executeJavaScript(`
  (() => {
    if (window.__chatMgr) return;
    window.__chatMgr = true;
    const post = (msg) => window.postMessage({ __chatMgr: msg }, '*');

    let muted = false;
    let ringingUntil = 0;
    window.addEventListener('message', (e) => {
      const m = e.data && e.data.__chatMgrHost;
      if (m && typeof m.muted === 'boolean') muted = m.muted;
    });

    // "Incoming voice call", "Incoming video call", Telegram's "Incoming Call",
    // "... is calling you" (Messenger, Teams), Slack huddle invites, and the
    // Arabic wording WhatsApp uses.
    const CALL_RE = /\\b(incoming|voice|video)\\s+call|\\bcalling\\b|\\bhuddle\\b|مكالمة|يتصل/i;
    const isCall = (title, opts) => {
      const o = opts || {};
      return CALL_RE.test(String(title || '') + ' ' + String(o.body || '')) || /^call_/.test(String(o.tag || ''));
    };
    const reportCall = (title, opts) => {
      ringingUntil = Date.now() + 60000;
      post({ type: 'call', title: String(title || ''), body: String((opts && opts.body) || '') });
    };

    // Calls always get through; other notifications are dropped while muted.
    // The page still gets an object that behaves like a notification.
    const standIn = (title, opts) => {
      const n = new EventTarget();
      Object.assign(n, {
        title: String(title || ''), body: (opts && opts.body) || '', tag: (opts && opts.tag) || '',
        data: opts && opts.data, onclick: null, onshow: null, onclose: null, onerror: null, close() {},
      });
      return n;
    };

    const Native = window.Notification;
    if (Native) {
      class Wrapped extends Native {
        constructor(title, opts) {
          const call = isCall(title, opts);
          if (call) reportCall(title, opts);
          else if (muted) return standIn(title, opts);
          super(title, opts);
          this.addEventListener('click', () => post({ type: 'notification-click' }));
        }
      }
      Object.defineProperty(Wrapped, 'permission', { get: () => Native.permission });
      Object.defineProperty(Wrapped, 'maxActions', { get: () => Native.maxActions });
      Wrapped.requestPermission = (...args) => Native.requestPermission(...args);
      window.Notification = Wrapped;
    }

    // Notifications shown by a service worker bypass the page, so they could not
    // be muted or clicked through to the right account.
    const SWR = window.ServiceWorkerRegistration;
    if (SWR && SWR.prototype.showNotification) {
      if (location.host === 'web.telegram.org') {
        // Telegram checks for this method and uses page notifications without it.
        delete SWR.prototype.showNotification;
      } else {
        const show = SWR.prototype.showNotification;
        SWR.prototype.showNotification = function (title, opts) {
          if (isCall(title, opts)) reportCall(title, opts);
          else if (muted) return Promise.resolve();
          return show.call(this, title, opts);
        };
      }
    }

    // Muted accounts make no sound: block audio the page starts by itself
    // (message beeps), but never call audio, a ringing call, or anything the
    // user started with a click, such as a voice message.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const userStarted = navigator.userActivation && navigator.userActivation.isActive;
      if (muted && !this.srcObject && !userStarted && Date.now() > ringingUntil) return Promise.resolve();
      return play.apply(this, args);
    };

    navigator.setAppBadge = (count) => {
      post({ type: 'badge', count: typeof count === 'number' ? count : 0 });
      return Promise.resolve();
    };
    navigator.clearAppBadge = () => {
      post({ type: 'badge', count: 0 });
      return Promise.resolve();
    };
  })();
`);

window.addEventListener('message', (e) => {
  const msg = e.data && e.data.__chatMgr;
  if (!msg) return;
  if (msg.type === 'notification-click') ipcRenderer.sendToHost('notification-click');
  if (msg.type === 'badge') ipcRenderer.sendToHost('badge', Math.max(0, msg.count | 0));
  if (msg.type === 'call') ipcRenderer.sendToHost('call', { title: msg.title, body: msg.body });
});

ipcRenderer.on('chat-mgr:muted', (_e, muted) => {
  window.postMessage({ __chatMgrHost: { muted: Boolean(muted) } }, '*');
});
