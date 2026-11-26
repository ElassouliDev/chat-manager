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
    let callSeq = 0;
    const reportCall = (title, opts) => {
      ringingUntil = Date.now() + 60000;
      const id = ++callSeq;
      post({ type: 'call', id, title: String(title || ''), body: String((opts && opts.body) || '') });
      return id;
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
          const callId = call ? reportCall(title, opts) : 0;
          if (!call && muted) return standIn(title, opts);
          super(title, opts);
          this.addEventListener('click', () => post({ type: 'notification-click' }));
          if (call) {
            // Services close the call notification when the call is answered,
            // declined, or missed: that is our signal to close the call popup.
            const close = this.close.bind(this);
            this.close = () => {
              ringingUntil = 0;
              post({ type: 'call-ended', id: callId });
              close();
            };
          }
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
  if (msg.type === 'call') ipcRenderer.sendToHost('call', { id: msg.id, title: msg.title, body: msg.body });
  if (msg.type === 'call-ended') ipcRenderer.sendToHost('call-ended', { id: msg.id });
});

ipcRenderer.on('chat-mgr:muted', (_e, muted) => {
  window.postMessage({ __chatMgrHost: { muted: Boolean(muted) } }, '*');
});

// Answer or Decline from the call popup: press the service's own button.
// Labels cover WhatsApp, Telegram, Teams, Messenger, Slack and Discord in
// English and Arabic. If no button turns up within a few seconds, the window
// shows the account so the call can be handled there.
const CALL_BUTTONS = {
  answer: /^(accept|answer|join|pick up|قبول|رد|الرد|انضمام)\b/i,
  decline: /^(decline|reject|ignore|dismiss call|end call|hang up|رفض|تجاهل|إنهاء)\b/i,
};

function findCallButton(action) {
  const re = CALL_BUTTONS[action];
  const candidates = document.querySelectorAll('button, [role="button"]');
  for (const el of candidates) {
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    if (re.test(label) && el.getClientRects().length > 0) return el;
  }
  return null;
}

ipcRenderer.on('chat-mgr:call-action', (_e, action) => {
  if (!CALL_BUTTONS[action]) return;
  const started = Date.now();
  const tryPress = () => {
    const el = findCallButton(action);
    if (el) {
      el.click();
      ipcRenderer.sendToHost('call-action-result', { action, pressed: true });
    } else if (Date.now() - started < 4000) {
      setTimeout(tryPress, 250);
    } else {
      ipcRenderer.sendToHost('call-action-result', { action, pressed: false });
    }
  };
  tryPress();
});
