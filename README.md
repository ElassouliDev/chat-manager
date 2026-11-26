<p align="center"><img src="build/icon.png" width="128" alt="Chat Manager icon" /></p>

# Chat Manager

A desktop app (Mac and Windows) that runs several **WhatsApp** and **Telegram** accounts at the same time.
Each account runs in its own isolated web session, so logins never mix.

## Run it

```bash
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download
npm start
```

## Use it

- **+** in the sidebar (or Cmd/Ctrl+N) adds an account. Pick **WhatsApp** or **Telegram**, then scan the QR code with that account's phone:
  - WhatsApp: **Linked devices → Link a device**
  - Telegram: **Settings → Devices → Add Device** (or log in with your phone number)
- Click an icon, or press Cmd/Ctrl+1 to 9, to switch accounts. A small marker on each icon shows which service it is.
- Badges show unread counts per account; the total appears on the Dock/taskbar.
- Clicking a desktop notification jumps to the right account.
- Right-click an icon to rename, recolour, reload, reorder, or remove (log out) an account.

Upgrading from **Multi WhatsApp**: your accounts and logins are carried over automatically on first launch.

## Build installers

```bash
npm run dist:mac   # dist/Chat-Manager-<version>-arm64.dmg
npm run dist:win   # dist/Chat-Manager-Setup-<version>.exe
npm run icon       # re-render build/icon.png and build/icon-win.png
```

Builds are unsigned. On Mac, right-click the app and choose **Open** the first time.
On Windows, choose **More info → Run anyway** in SmartScreen.

## Disclaimer

This is an independent project and is not affiliated with or endorsed by WhatsApp, Meta, or Telegram.
It loads the official web apps (https://web.whatsapp.com and https://web.telegram.org) in separate sessions.

## License

[MIT](LICENSE)
