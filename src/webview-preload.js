// Runs inside each WhatsApp Web view. When the user clicks a desktop
// notification, tell the host window so it can jump to that account.
const { ipcRenderer, webFrame } = require('electron');

webFrame.executeJavaScript(`
  (() => {
    const Native = window.Notification;
    if (!Native || Native.__multiWa) return;
    class Wrapped extends Native {
      constructor(title, opts) {
        super(title, opts);
        this.addEventListener('click', () => window.postMessage({ __multiWa: 'notification-click' }, '*'));
      }
    }
    Wrapped.__multiWa = true;
    window.Notification = Wrapped;
  })();
`);

window.addEventListener('message', (e) => {
  if (e.data && e.data.__multiWa === 'notification-click') ipcRenderer.sendToHost('notification-click');
});
