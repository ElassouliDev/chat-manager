// Renders the app icon to PNG files with Electron itself, so no extra
// image tools are needed. Run with: npm run icon
//   build/icon.png      macOS (artwork inset on Apple's 1024 grid)
//   build/icon-win.png  Windows (artwork fills the canvas)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;

function svg(margin) {
  const s = SIZE - margin * 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2EDB72"/>
      <stop offset="1" stop-color="#1E96E0"/>
    </linearGradient>
    <linearGradient id="dot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#21C46B"/>
      <stop offset="1" stop-color="#2390D6"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="${margin ? 14 : 0}" stdDeviation="${margin ? 18 : 0}" flood-opacity="0.28"/>
    </filter>
  </defs>
  <g transform="translate(${margin} ${margin}) scale(${s / 1000})">
    <rect width="1000" height="1000" rx="225" fill="url(#bg)"${margin ? ' filter="url(#shadow)"' : ''}/>
    <!-- back bubble -->
    <g fill="#fff" opacity="0.5">
      <rect x="400" y="200" width="420" height="310" rx="155"/>
      <path d="M720 470 C760 540 800 575 845 590 C770 600 700 570 650 510 Z"/>
    </g>
    <!-- front bubble -->
    <g fill="#fff">
      <rect x="180" y="350" width="500" height="370" rx="185"/>
      <path d="M260 660 C240 740 205 785 155 815 C260 815 335 780 380 710 Z"/>
    </g>
    <circle cx="320" cy="535" r="40" fill="url(#dot)"/>
    <circle cx="430" cy="535" r="40" fill="url(#dot)"/>
    <circle cx="540" cy="535" r="40" fill="url(#dot)"/>
  </g>
</svg>`;
}

async function render(file, margin) {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg(margin)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  let img = await win.webContents.capturePage();
  if (img.getSize().width !== SIZE) img = img.resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  win.destroy();
  console.log('wrote', file, img.getSize());
}

// Keep running between renders (closing the first window would otherwise quit).
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  await render(path.join(root, 'build', 'icon.png'), 100);
  await render(path.join(root, 'build', 'icon-win.png'), 0);
  app.quit();
});
