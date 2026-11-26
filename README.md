# Multi WhatsApp

A desktop app (Mac and Windows) that runs several WhatsApp accounts at the same time.
Each account runs in its own isolated WhatsApp Web session, so logins never mix.

## Run it

```bash
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download
npm start
```

## Use it

- **+** in the sidebar (or Cmd/Ctrl+N) adds an account. Scan the QR code with that account's phone.
- Click an icon, or press Cmd/Ctrl+1 to 9, to switch accounts.
- Green badges show unread counts per account; the total appears on the Dock/taskbar.
- Clicking a desktop notification jumps to the right account.
- Right-click an icon to rename, recolour, reload, reorder, or remove (log out) an account.

## Build installers

```bash
npm run dist:mac   # dist/Multi WhatsApp-1.0.0-arm64.dmg
npm run dist:win   # dist/Multi WhatsApp Setup 1.0.0.exe
```

Builds are unsigned. On Mac, right-click the app and choose **Open** the first time.
On Windows, choose **More info → Run anyway** in SmartScreen.

## Disclaimer

This is an independent project and is not affiliated with or endorsed by WhatsApp or Meta.
It simply loads the official WhatsApp Web (https://web.whatsapp.com) in separate sessions.
