<p align="center"><img src="build/icon.png" width="128" alt="Chat Manager icon" /></p>

# Chat Manager

A desktop app (Mac and Windows) and Android app that runs several accounts of **WhatsApp**, **Telegram**, **Microsoft Teams**, **Slack**, **Messenger**, **Facebook**, **Instagram**, **LinkedIn**, **X (Twitter)**, **Discord**, **Gmail**, **Google Chat**, and **Outlook** at the same time.
Each account runs in its own isolated web session, so logins never mix.

## Run it

```bash
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download
npm start
```

## Use it

- **+** in the sidebar (or Cmd/Ctrl+N) adds an account. Pick a service, then sign in:
  - WhatsApp: **Linked devices → Link a device**
  - Telegram: **Settings → Devices → Add Device** (or log in with your phone number)
  - Teams: your Microsoft work, school, or personal account. Company sign-in pages open inside the app. The first start can take up to a minute while Teams loads.
  - Slack: your workspace, including Google, Apple, or company sign-in.
  - Messenger, Facebook, Instagram, LinkedIn, X, Discord: your usual login. "Continue with Google/Apple" opens a small sign-in window inside the app.
  - Gmail, Google Chat: your Google account (Gmail or Google Workspace).
  - Outlook: your Microsoft work, school, or personal account (Outlook.com, Hotmail, Live).
  - Links to other websites open in your normal browser.
- Click an icon, or press Cmd/Ctrl+1 to 9, to switch accounts. A small marker on each icon shows which service it is.
- **Drag an icon** up or down to reorder the sidebar (or right-click → Move up / down / to top / to bottom).
- Badges show unread counts per account; the total appears on the Dock/taskbar and in the tray.
- Clicking a desktop notification jumps to the right account.
- Hover an icon and click **×** to remove (log out) that account.
- Right-click an icon to rename, recolour, **mute** (1 hour, 8 hours, 1 day, or until you unmute), reload, or reorder it.
  A muted account shows no notifications and plays no sounds, and its unread count is left out of the total. Calls still come through.
- Switch between **System**, **Light**, and **Dark** with the button at the bottom of the sidebar, or from **View → Theme** or the tray menu.
  WhatsApp and Telegram follow along when their own theme setting is "System default".

### Runs in the background

- Closing the window keeps Chat Manager running in the tray (Windows) or menu bar (Mac), so notifications and calls still arrive. Quit from the tray menu, **Cmd+Q** on Mac, or **Ctrl+Q** on Windows.
- An incoming call shows a **call popup** in the corner of the screen, like the WhatsApp and Telegram desktop apps, even while Chat Manager is hidden. **Answer** opens the account and accepts the call; **Decline** rejects it without opening the app; clicking the caller opens the account; **×** hides the popup while the call keeps ringing. Call windows that a service opens separately (for example Messenger calls) stay inside the app.
- Turn on **Open at login** in the tray menu to start Chat Manager quietly in the background when you sign in.

Upgrading from **Multi WhatsApp**: your accounts and logins are carried over automatically on first launch.

## Build installers

```bash
npm run dist:mac   # dist/Chat-Manager-<version>-arm64.dmg
npm run dist:win   # dist/Chat-Manager-Setup-<version>.exe
npm run icon       # re-render build/icon.png and build/icon-win.png
```

Builds are unsigned. On Mac, right-click the app and choose **Open** the first time.
On Windows, choose **More info → Run anyway** in SmartScreen.

## Android app

The `android/` folder holds a native Android version (Android 8 and newer) with the same 13 services.

- Account icons run along the top; tap to switch, long-press to rename, mute, reorder, reload, or remove.
- Each account has its own WebView profile, so logins stay separate.
- Messages arrive as Android notifications. Incoming calls ring with **Answer** and **Decline** (full screen on the lock screen); Answer opens the account and accepts, Decline rejects without opening the app.
- A quiet "Chat Manager is running" notification keeps chats connected in the background. Use Back or Home to leave the app; swiping it away from Recent apps stops it.
- WhatsApp on a phone: in WhatsApp on the phone you want to add, go to **Linked devices → Link a device → Link with phone number instead**, then type the code shown in Chat Manager.

Build it (needs Android Studio's SDK and Java 17):

```bash
cd android
gradle assembleRelease   # app/build/outputs/apk/release/app-release.apk
```

Release builds are signed with the key in `~/.android/chat-manager-release.properties` when it exists (keep that key safe: updates only install over a build signed with the same key), otherwise with the debug key.

## Disclaimer

This is an independent project and is not affiliated with or endorsed by any of the services it hosts (WhatsApp, Meta, Telegram, Microsoft, Slack, LinkedIn, X, Discord, or Google).
It loads each service's official website in its own separate session.

## License

[MIT](LICENSE)
