// 成片计数仪 - 桌面应用主进程
// 能力：桌面嵌入(WorkerW 图标层) / 拖动 / 锁定位置 / 基础数据配置 / 投递文件落地
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// 本机 GPU 进程崩溃（RTX 2060 SUPER + 驱动），关闭硬件加速走软件渲染
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

// ---------- 配置 ----------
const APP_DIR = path.join(__dirname, '..');
const CFG_DIR = path.join(app.getPath('appData'), 'VideoCounterDesktop');
const CFG_FILE = path.join(CFG_DIR, 'config.json');

// 统计工具目录（video-counter）探测：打包后 APP_DIR 不再指向源码树，需要多候选
function detectToolDir() {
  const cands = [
    path.join(APP_DIR, '..', 'video-counter'),
    path.join(app.getPath('userData'), '..', '..', 'WorkBuddy', 'tools', 'video-counter'),
    'C:\\Users\\aurora\\WorkBuddy\\2026-10-26-18-12-57\\tools\\video-counter'
  ];
  for (const c of cands) {
    try { if (fs.existsSync(path.join(c, 'data', 'state.json'))) return path.resolve(c); } catch (e) {}
  }
  return path.resolve(cands[0]);
}
const DEFAULT_CFG = {
  inbox: path.join(app.getPath('desktop'), '剪辑成片投递'),
  archiveRoot: 'G:\\小杜工作文件\\工作量统计',
  toolDir: detectToolDir(),
  lines: ['生殖', '胸外', '其他'],
  processTime: '14:00',
  autoProcess: true,
  window: { x: null, y: null, w: 460, h: 660, opacity: 1, locked: false, alwaysOnTop: false, embedded: true }
};
function deepMerge(base, over) {
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}
function loadCfg() {
  try { return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CFG)), JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); }
  catch (e) { return JSON.parse(JSON.stringify(DEFAULT_CFG)); }
}
function saveCfg(c) {
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2), 'utf8');
}
let cfg = loadCfg();

// ---------- 状态文件（批次明细） ----------
function toolStateFile() { return path.join(cfg.toolDir, 'data', 'state.json'); }
function toolInboxState() { return path.join(cfg.toolDir, 'data', 'inbox-state.json'); }
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }

const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
function listInbox() {
  const dir = cfg.inbox;
  const res = { dir, files: [], newFiles: [] };
  if (!fs.existsSync(dir)) return res;
  const done = new Set(readJSON(toolInboxState(), { processed: [] }).processed.map(x => x.name));
  const files = fs.readdirSync(dir)
    .filter(n => IMG_EXT.test(n) && !n.startsWith('.') && !n.startsWith('~$'))
    .map(n => {
      const full = path.join(dir, n);
      let st = { size: 0, mtime: new Date() };
      try { st = fs.statSync(full); } catch (e) {}
      return { name: n, path: full, size: st.size, mtime: st.mtime.toISOString(), processed: done.has(n) };
    })
    .sort((a, b) => a.mtime.localeCompare(b.mtime));
  res.files = files;
  res.newFiles = files.filter(f => !f.processed);
  return res;
}
function computeStats() {
  const state = readJSON(toolStateFile(), { batches: [] });
  let shots = 0, total = 0;
  for (const b of state.batches) {
    shots += b.shots.length;
    if (b.status === 'void') continue;
    for (const s of b.shots) total += s.count;
  }
  return { shots, total };
}

// ---------- native helper（常驻 PowerShell） ----------
// 职责仅限：把窗口挂到桌面 WorkerW 图标层 / 把窗口放到指定屏幕坐标。
// 坐标约定：JS 侧维护权威的屏幕物理坐标，helper 只做「设置到某屏幕坐标」。
let helper = null;
function helperScript() {
  // helper 脚本独立成文件，便于维护与语法检查
  let s = fs.readFileSync(path.join(__dirname, 'helper.ps1'), 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}
function startHelper() {
  if (helper) return helper;
  try {
    const { spawn } = require('child_process');
    fs.mkdirSync(CFG_DIR, { recursive: true });
    const scriptPath = path.join(CFG_DIR, 'helper.ps1');
    // 必须带 UTF-8 BOM：PowerShell 5.1 无 BOM 时按 GBK 解析，中文注释会破坏语法
    fs.writeFileSync(scriptPath, '\uFEFF' + helperScript(), 'utf8');
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => {
      try { fs.appendFileSync(path.join(CFG_DIR, 'helper.err.log'), '[stderr] ' + d); } catch (e) {}
    });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', () => {});
    p.on('error', (err) => {
      try { fs.appendFileSync(path.join(CFG_DIR, 'helper.err.log'), '[error] ' + (err && err.message) + '\n'); } catch (e) {}
      helper = null;
    });
    p.on('exit', (code) => {
      try { fs.appendFileSync(path.join(CFG_DIR, 'helper.err.log'), `[exit ${code}]\n`); } catch (e) {}
      helper = null;
    });
    helper = p;
    return p;
  } catch (e) {
    try { fs.appendFileSync(path.join(CFG_DIR, 'helper.err.log'), '[start-catch] ' + (e && e.stack || e) + '\n'); } catch (e2) {}
    helper = null; return null;
  }
}

let helperBuf = '';
let helperSeq = 0;
function helperCmd(obj, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const p = startHelper();
    if (!p) return resolve(null);
    const id = ++helperSeq;
    const req = Object.assign({ id }, obj);
    let done = false;
    const onData = (d) => {
      helperBuf += d;
      let idx;
      while ((idx = helperBuf.indexOf('\n')) >= 0) {
        const line = helperBuf.slice(0, idx).trim();
        helperBuf = helperBuf.slice(idx + 1);
        const parts = line.split(' ');
        if ((parts[0] === 'OK' || parts[0] === 'ERR') && parts[1] === String(id)) {
          done = true;
          p.stdout.off('data', onData);
          resolve(line);
          return;
        }
      }
    };
    p.stdout.on('data', onData);
    try { p.stdin.write(JSON.stringify(req) + '\n'); } catch (e) { return resolve(null); }
    setTimeout(() => { if (!done) { done = true; p.stdout.off('data', onData); resolve(null); } }, timeoutMs);
  });
}

// ---------- 窗口位置 ----------
// 权威坐标保存在 JS（屏幕物理像素）；native 只负责执行「放到某坐标」
let curPos = null;
function hwndStr() {
  if (!win || win.isDestroyed()) return null;
  const h = win.getNativeWindowHandle();
  if (!h) return null;
  try {
    if (h.length >= 8) return h.readBigUInt64LE(0).toString();
    return h.readUInt32LE(0).toString();
  } catch (e) { return null; }
}

// DIP（Electron 坐标）→ 屏幕物理像素
function dipToScreen(x, y) {
  try {
    const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
    return { x: Math.round(x * d.scaleFactor), y: Math.round(y * d.scaleFactor) };
  } catch (e) { return { x: Math.round(x), y: Math.round(y) }; }
}
function screenToDip(x, y) {
  try {
    const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
    return { x: x / d.scaleFactor, y: y / d.scaleFactor };
  } catch (e) { return { x, y }; }
}

// 设置窗口到指定 DIP 屏幕坐标
// 窗口保持顶层（不 SetParent），坐标完全交给 Electron 原生 API，精度 100% 正确
async function setWindowDipPos(dipX, dipY) {
  if (cfg && cfg.window.locked) return false;
  const x = Math.round(dipX), y = Math.round(dipY);
  try {
    win.setPosition(x, y);
    curPos = { x, y };
    saveWindowBounds();
    return true;
  } catch (e) { return false; }
}

// 嵌入到桌面层：把窗口在 Z 序上钉到桌面壁纸/图标层正上方（所有应用窗口之下）
let pinTimer = null;
async function pinToDesktopLayer() {
  const hwnd = hwndStr();
  if (!hwnd) return false;
  const r = await helperCmd({ cmd: 'pin', hwnd });
  return !!(r && r.startsWith('OK'));
}
async function embedToDesktop() {
  const hwnd = hwndStr();
  if (!hwnd) return false;
  let phys = curPos;
  if (!phys) {
    const b = win.getBounds();
    phys = { x: b.x, y: b.y };
  }
  const r = await helperCmd({ cmd: 'embed', hwnd, x: phys.x, y: phys.y });
  const ok = !!(r && r.startsWith('OK'));
  if (ok) {
    curPos = phys; saveWindowBounds();
    startPinTimer();
  }
  return ok;
}
function startPinTimer() {
  if (pinTimer) return;
  // Chromium 在 show/activate 时会把窗口提到 Z 序顶部，
  // 所以定时 + 失焦时都要重新钉回桌面层
  pinTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !cfg.window.embedded) return;
    if (win.isFocused()) return;
    pinToDesktopLayer();
  }, 2000);
}
async function unembedFromDesktop() {
  const hwnd = hwndStr();
  if (!hwnd) return false;
  const r = await helperCmd({ cmd: 'unembed', hwnd });
  const ok = !!(r && r.startsWith('OK'));
  if (pinTimer) { clearInterval(pinTimer); pinTimer = null; }
  if (ok) {
    const g = await helperCmd({ cmd: 'getpos', hwnd });
    if (g && g.startsWith('OK')) {
      const p = g.split(' ').map(Number);
      curPos = { x: p[2], y: p[3] };
    }
  }
  return ok;
}

// ---------- 窗口 ----------
let win = null;
function createWindow() {
  const w = cfg.window;
  const bounds = screen.getPrimaryDisplay().workArea;
  // 校验保存的坐标是否落在任一屏幕内，失效则回落到主屏居中
  let dipX = w.x, dipY = w.y;
  const onScreen = (x, y) => screen.getAllDisplays().some(d =>
    x >= d.bounds.x - 40 && x <= d.bounds.x + d.bounds.width - 40 &&
    y >= d.bounds.y - 40 && y <= d.bounds.y + d.bounds.height - 40);
  if (dipX === null || dipX === undefined || dipY === null || dipY === undefined || !onScreen(dipX, dipY)) {
    dipX = Math.round(bounds.x + (bounds.width - w.w) / 2);
    dipY = Math.round(bounds.y + 80);
  }

  win = new BrowserWindow({
    x: dipX, y: dipY, width: w.w, height: w.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: w.alwaysOnTop,
    hasShadow: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));

  // 首次显示后嵌入桌面层
  win.once('ready-to-show', () => {
    setTimeout(async () => {
      curPos = { x: dipX, y: dipY };
      if (cfg.window.embedded) {
        const ok = await embedToDesktop();
        win.webContents.send('win:embedded', ok);
        if (ok) win.setAlwaysOnTop(cfg.window.alwaysOnTop);
      }
      saveWindowBounds();
    }, 600);
  });

  win.on('closed', () => { win = null; });
  // 失焦后立即回钉桌面层（Chromium 会把窗口提到 Z 序顶部）
  win.on('blur', () => {
    if (cfg.window.embedded && win && !win.isDestroyed()) setTimeout(() => pinToDesktopLayer(), 150);
  });
}

function saveWindowBounds() {
  if (!win || win.isDestroyed()) return;
  if (SELFTEST) return;   // 自检期间不写回窗口几何，避免污染真实配置
  try {
    const b = win.getBounds();
    cfg.window.w = b.width; cfg.window.h = b.height;
    if (curPos) {
      // 只持久化落在屏幕范围内的坐标，避免异常坐标污染配置
      if (onAnyScreen(curPos.x, curPos.y)) {
        cfg.window.x = Math.round(curPos.x); cfg.window.y = Math.round(curPos.y);
      }
    }
    saveCfg(cfg);
  } catch (e) {}
}

// 坐标是否落在任一显示器范围内
function onAnyScreen(x, y) {
  try {
    return screen.getAllDisplays().some(d =>
      x >= d.bounds.x - 40 && x <= d.bounds.x + d.bounds.width - 40 &&
      y >= d.bounds.y - 40 && y <= d.bounds.y + d.bounds.height - 40);
  } catch (e) { return false; }
}

// ---------- IPC ----------
ipcMain.handle('cfg:get', () => cfg);
ipcMain.handle('cfg:defaults', () => JSON.parse(JSON.stringify(DEFAULT_CFG)));
ipcMain.handle('cfg:save', async (_e, patch) => {
  const wasEmbedded = cfg.window.embedded;
  cfg = deepMerge(cfg, patch || {});
  saveCfg(cfg);
  if (win && !win.isDestroyed()) {
    const pw = patch.window || {};
    if (pw.opacity !== undefined) { try { win.setOpacity(pw.opacity); } catch (e) {} }
    if (pw.alwaysOnTop !== undefined) win.setAlwaysOnTop(pw.alwaysOnTop);
    if (pw.w !== undefined || pw.h !== undefined) {
      const b = win.getBounds();
      const nw = pw.w || b.width, nh = pw.h || b.height;
      try { win.setBounds({ x: b.x, y: b.y, width: nw, height: nh }); } catch (e) {}
    }
    if (pw.embedded !== undefined && pw.embedded !== wasEmbedded) {
      if (cfg.window.embedded) await embedToDesktop();
      else await unembedFromDesktop();
    }
    saveWindowBounds();
  }
  return cfg;
});
ipcMain.handle('inbox:list', () => listInbox());
ipcMain.handle('inbox:open', () => {
  fs.mkdirSync(cfg.inbox, { recursive: true });
  shell.openPath(cfg.inbox);
  return true;
});
ipcMain.handle('stats:get', () => computeStats());
// 拖动：渲染层上报屏幕 DIP 坐标，主进程换算物理像素后交给 native
ipcMain.handle('win:setpos', async (_e, dipX, dipY) => {
  if (!win || win.isDestroyed() || cfg.window.locked) return false;
  return await setWindowDipPos(dipX, dipY);
});
ipcMain.handle('win:getpos', () => {
  if (curPos) return { x: Math.round(curPos.x), y: Math.round(curPos.y) };
  try { const b = win.getBounds(); return { x: b.x, y: b.y }; }
  catch (e) { return { x: 0, y: 0 }; }
});
ipcMain.handle('win:lock', (_e, locked) => {
  cfg.window.locked = !!locked;
  saveCfg(cfg);
  return cfg.window.locked;
});
ipcMain.handle('win:embed', async () => await embedToDesktop());
ipcMain.handle('win:unembed', async () => await unembedFromDesktop());
ipcMain.handle('win:close', () => { app.quit(); });
ipcMain.handle('path:pick', async (_e, key) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

// ---------- 投递 ----------
async function depositItems(items) {
  fs.mkdirSync(cfg.inbox, { recursive: true });
  const saved = [];
  for (const it of items || []) {
    const mm = /^data:image\/(\w+);base64,(.*)$/s.exec(it.dataUrl || '');
    if (!mm) continue;
    const ext = mm[1] === 'jpeg' ? 'jpg' : mm[1];
    let base = (it.name || 'screenshot').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'screenshot';
    let fname = `${base}.${ext}`, i = 1;
    while (fs.existsSync(path.join(cfg.inbox, fname))) { fname = `${base}_${i}.${ext}`; i++; }
    await fsp.writeFile(path.join(cfg.inbox, fname), Buffer.from(mm[2], 'base64'));
    saved.push({ name: fname, path: path.join(cfg.inbox, fname) });
  }
  return { saved, dir: cfg.inbox };
}
ipcMain.handle('inbox:deposit', async (_e, items) => await depositItems(items));

// ---------- 单实例 ----------
// 启动/退出追踪日志（排查打包版秒退）
const TRACE_FILE = path.join(process.env.TEMP || 'C:\\Users\\aurora\\AppData\\Local\\Temp', 'vc-app-trace.log');
function trace(m) {
  try { fs.appendFileSync(TRACE_FILE, `[${new Date().toISOString()}] ${m}\n`); } catch (e) {}
}
trace('boot, argv=' + JSON.stringify(process.argv));
process.on('uncaughtException', (e) => { trace('uncaughtException: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { trace('unhandledRejection: ' + (e && e.stack || e)); });
app.on('quit', (e, code) => trace('app quit, code=' + code));

trace('boot, argv=' + JSON.stringify(process.argv));
const gotLock = app.requestSingleInstanceLock();
trace('singleInstanceLock=' + gotLock);
if (!gotLock) { app.quit(); }
app.on('second-instance', () => {
  trace('second-instance');
  if (win) { if (win.isMinimized()) win.restore(); win.show(); }
});

app.whenReady().then(() => {
  trace('ready');
  createWindow();
  trace('window created');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  if (process.env.VC_SELFTEST) runSelfTest();
}).catch(e => trace('whenReady error: ' + (e && e.stack || e)));
app.on('window-all-closed', () => { trace('window-all-closed'); app.quit(); });
app.on('child-process-gone', (e) => trace('child gone: ' + JSON.stringify(e)));

// ---------- 自检 ----------
let SELFTEST = false;
async function runSelfTest() {
  SELFTEST = true;
  const out = { steps: [] };
  const tracePath = path.join(app.getPath('temp'), 'vc-selftest-trace.txt');
  const trace = (m) => { try { fs.appendFileSync(tracePath, m + '\n'); } catch (e) {} };
  const log = (k, v) => {
    out.steps.push({ step: k, ok: true, info: String(v) });
    trace('OK   ' + k + ' | ' + v);
    try { fs.writeFileSync(path.join(app.getPath('temp'), 'vc-selftest.json'), JSON.stringify(out, null, 2), 'utf8'); } catch (e) {}
  };
  const fail = (k, e) => {
    out.steps.push({ step: k, ok: false, info: String(e && e.message || e) });
    trace('FAIL ' + k + ' | ' + (e && e.message || e));
  };
  trace('--- selftest start ---');
  try {
    await new Promise(r => setTimeout(r, 2500));
    const hwnd = hwndStr();
    out.hwnd = hwnd;

    const b0 = win.getBounds();
    log('electron-bounds-initial', JSON.stringify(b0));
    const disp = screen.getPrimaryDisplay();
    log('display', JSON.stringify({ b: disp.bounds, s: disp.scaleFactor }));

    const g0 = await helperCmd({ cmd: 'getpos', hwnd });
    log('native-getpos-before', g0);
    if (!g0) {
      // helper 无响应：把 helper 脚本内容与 stderr 抓出来定位
      const hp = path.join(CFG_DIR, 'helper.ps1');
      log('helper-script-exists', fs.existsSync(hp));
      log('helper-script-head', fs.existsSync(hp) ? fs.readFileSync(hp, 'utf8').slice(0, 400).replace(/\n/g, ' | ') : 'n/a');
      log('helper-proc', helper ? 'alive' : 'null');
    }

    const vf = await helperCmd({ cmd: 'verify', hwnd });
    log('verify-desktop-layer', vf);

    // 绝对定位测试：+40,+25 DIP（Electron 原生坐标，期望精确匹配）
    const p0 = g0.split(' ').map(Number);
    const bx0 = win.getBounds();
    await setWindowDipPos(bx0.x + 40, bx0.y + 25);
    await new Promise(r => setTimeout(r, 300));
    const g1 = await helperCmd({ cmd: 'getpos', hwnd });
    log('native-getpos-after-move', g1);
    const p1 = g1.split(' ').map(Number);
    const bx1 = win.getBounds();
    log('electron-delta', JSON.stringify({ dx: bx1.x - bx0.x, dy: bx1.y - bx0.y }));
    log('native-delta', JSON.stringify({ dx: p1[2] - p0[2], dy: p1[3] - p0[3] }));

    // 统计
    const st = computeStats();
    out.stats = st;
    log('stats', JSON.stringify(st));

    // 投递落地测试：写入一张 1x1 PNG 到投递箱
    const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const dep = await depositItems([{ name: '__selftest__.png', dataUrl: testPng }]);
    log('deposit', JSON.stringify(dep.saved));
    const inboxList = listInbox();
    log('inbox-after-deposit', JSON.stringify({ dir: inboxList.dir, count: inboxList.files.length, has: inboxList.files.some(f => f.name === '__selftest__.png') }));
    // 清理测试文件
    try { fs.unlinkSync(path.join(cfg.inbox, '__selftest__.png')); } catch (e) {}

    // 锁定测试（临时改内存态，不污染真实配置）
    const prevLocked = cfg.window.locked;
    cfg.window.locked = true;
    const lockedMove = await setWindowDipPos(bx1.x + 100, bx1.y + 100);
    const stillThere = win.getBounds();
    cfg.window.locked = prevLocked;
    log('lock-blocks-move', JSON.stringify({ apiReturned: lockedMove, dx: stillThere.x - bx1.x, dy: stillThere.y - bx1.y }));

    // 界面截图
    const img = await win.webContents.capturePage();
    const shotPath = path.join(app.getPath('temp'), 'vc-selftest-ui.png');
    fs.writeFileSync(shotPath, img.toPNG());
    out.screenshot = shotPath;
    log('screenshot', shotPath);
  } catch (e) { fail('exception', e); }
  trace('--- selftest end ---');
  fs.writeFileSync(path.join(app.getPath('temp'), 'vc-selftest.json'), JSON.stringify(out, null, 2), 'utf8');
  setTimeout(() => app.quit(), 400);
}
