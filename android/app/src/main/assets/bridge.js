// Injected at the start of every page in every account (Android).
// Android's WebView has no web notifications, so this provides one that hands
// each notification to the app, which shows it as a real Android notification.
// It also reports unread badges and presses Answer / Decline for calls.
(function () {
  if (window.__chatMgr) return;
  window.__chatMgr = true;
  var bridge = window.ChatManagerBridge;
  if (!bridge) return;
  function send(msg) {
    try { bridge.postMessage(JSON.stringify(msg)); } catch (e) { /* page is closing */ }
  }

  // "Incoming voice call", "Incoming video call", Telegram's "Incoming Call",
  // "... is calling you", Slack huddles, and WhatsApp's Arabic wording.
  var CALL_RE = /\b(incoming|voice|video)\s+call|\bcalling\b|\bhuddle\b|مكالمة|يتصل/i;
  function isCall(title, opts) {
    var o = opts || {};
    return CALL_RE.test(String(title || '') + ' ' + String(o.body || '')) || /^call_/.test(String(o.tag || ''));
  }

  var seq = 0;
  var live = {};

  function ChatNotification(title, opts) {
    var target = new EventTarget();
    var o = opts || {};
    var id = ++seq;
    var call = isCall(title, o);
    var n = Object.assign(target, {
      title: String(title || ''), body: String(o.body || ''), tag: String(o.tag || ''), data: o.data,
      icon: o.icon || '', onclick: null, onshow: null, onclose: null, onerror: null,
      close: function () {
        if (!live[id]) return;
        delete live[id];
        send({ type: call ? 'call-ended' : 'notify-close', id: id });
      },
    });
    live[id] = n;
    send({ type: call ? 'call' : 'notify', id: id, title: n.title, body: n.body });
    setTimeout(function () {
      var e = new Event('show');
      n.dispatchEvent(e);
      if (typeof n.onshow === 'function') n.onshow(e);
    }, 0);
    return n;
  }
  Object.defineProperty(ChatNotification, 'permission', { get: function () { return 'granted'; } });
  ChatNotification.maxActions = 0;
  ChatNotification.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  window.Notification = ChatNotification;

  // The app calls this when you tap a notification, so the page opens that chat.
  window.__chatMgrClick = function (id) {
    var n = live[id];
    if (!n) return;
    var e = new Event('click');
    n.dispatchEvent(e);
    if (typeof n.onclick === 'function') n.onclick(e);
  };

  // Pages also ask the Permissions API whether notifications are allowed.
  if (navigator.permissions && navigator.permissions.query) {
    var query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (desc) {
      if (desc && desc.name === 'notifications') {
        return Promise.resolve({ state: 'granted', status: 'granted', onchange: null,
          addEventListener: function () {}, removeEventListener: function () {} });
      }
      return query(desc);
    };
  }

  // Service-worker notifications never reach the app, so route them through the page.
  if (window.ServiceWorkerRegistration) {
    var proto = window.ServiceWorkerRegistration.prototype;
    if (location.host === 'web.telegram.org') {
      delete proto.showNotification; // Telegram then uses page notifications
    } else {
      proto.showNotification = function (title, opts) {
        ChatNotification(title, opts);
        return Promise.resolve();
      };
    }
  }

  navigator.setAppBadge = function (count) {
    send({ type: 'badge', count: typeof count === 'number' ? count : 0 });
    return Promise.resolve();
  };
  navigator.clearAppBadge = function () {
    send({ type: 'badge', count: 0 });
    return Promise.resolve();
  };

  // Answer / Decline from the call notification: press the service's own button.
  var BUTTONS = {
    answer: /^(accept|answer|join|pick up|قبول|رد|الرد|انضمام)\b/i,
    decline: /^(decline|reject|ignore|dismiss call|end call|hang up|رفض|تجاهل|إنهاء)\b/i,
  };
  window.__chatMgrCallAction = function (action) {
    var re = BUTTONS[action];
    if (!re) return;
    var started = Date.now();
    (function tryPress() {
      var els = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        if (re.test(label) && el.getClientRects().length > 0) {
          el.click();
          send({ type: 'call-action-result', action: action, pressed: true });
          return;
        }
      }
      if (Date.now() - started < 4000) setTimeout(tryPress, 250);
      else send({ type: 'call-action-result', action: action, pressed: false });
    })();
  };
})();
