// Runs inside each chat service's page. It reports two things to the host
// window: notification clicks (to jump to that account) and the unread count
// that services such as Telegram publish through navigator.setAppBadge().
const { ipcRenderer, webFrame } = require('electron');

webFrame.executeJavaScript(`
  (() => {
    if (window.__chatMgr) return;
    window.__chatMgr = true;
    const post = (msg) => window.postMessage({ __chatMgr: msg }, '*');

    const Native = window.Notification;
    if (Native) {
      class Wrapped extends Native {
        constructor(title, opts) {
          super(title, opts);
          this.addEventListener('click', () => post({ type: 'notification-click' }));
        }
      }
      window.Notification = Wrapped;
    }

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
});
