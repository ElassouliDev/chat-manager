// Renders the app icon to PNG files with Electron itself, so no extra
// image tools are needed. Run with: npm run icon
//   build/icon.png               macOS app icon (artwork inset on Apple's 1024 grid)
//   build/icon-win.png           Windows app icon (artwork fills the canvas)
//   src/assets/icon.png          window and Windows tray icon at runtime
//   src/assets/trayTemplate.png  macOS menu bar icon (black shape, macOS tints it)
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

// Menu bar glyph: two bubbles, the front one with three dots cut out.
function traySvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1000 1000">
  <defs>
    <mask id="dots">
      <rect width="1000" height="1000" fill="#fff"/>
      <circle cx="280" cy="555" r="52" fill="#000"/>
      <circle cx="420" cy="555" r="52" fill="#000"/>
      <circle cx="560" cy="555" r="52" fill="#000"/>
    </mask>
  </defs>
  <g fill="#000">
    <g opacity="0.55">
      <rect x="390" y="110" width="560" height="400" rx="200"/>
      <path d="M800 460 C850 545 895 585 950 605 C860 615 770 580 710 500 Z"/>
    </g>
    <g mask="url(#dots)">
      <rect x="60" y="330" width="720" height="470" rx="235"/>
      <path d="M170 730 C150 820 105 880 40 920 C185 925 285 870 340 780 Z"/>
    </g>
  </g>
</svg>`;
}

async function render(file, markup, outSize = SIZE) {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${markup}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  let img = await win.webContents.capturePage();
  if (img.getSize().width !== outSize) img = img.resize({ width: outSize, height: outSize, quality: 'best' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  win.destroy();
  console.log('wrote', path.relative(path.join(__dirname, '..'), file), img.getSize());
}

// Keep running between renders (closing the first window would otherwise quit).
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  await render(path.join(root, 'build', 'icon.png'), svg(100));
  await render(path.join(root, 'build', 'icon-win.png'), svg(0));
  await render(path.join(root, 'src', 'assets', 'icon.png'), svg(0), 256);
  await render(path.join(root, 'src', 'assets', 'trayTemplate.png'), traySvg(), 18);
  await render(path.join(root, 'src', 'assets', 'trayTemplate@2x.png'), traySvg(), 36);
  app.quit();
});
