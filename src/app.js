const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let cfg = null;
let drag = null;
let embedded = false;

// ---------- 工具 ----------
function toast(msg) {
  const t = $('#toast');
  $('#toastMsg').textContent = msg;
  t.hidden = false;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.hidden = true, 260); }, 2400);
}
function tick() {
  const d = new Date();
  $('#gclock').textContent = d.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
}
tick(); setInterval(tick, 1000);

// ---------- 拖动 ----------
// 记录「鼠标起点」与「窗口起点」，mousemove 时算出窗口目标屏幕坐标上报主进程。
// 用绝对坐标而非增量，避免 native 坐标系换算误差累积。
const ghead = $('#ghead');
ghead.addEventListener('mousedown', async (e) => {
  if (e.target.classList.contains('ibtn')) return;
  if (cfg && cfg.window.locked) { toast('位置已锁定，先在设置里解锁'); return; }
  e.preventDefault();
  const pos = await window.api.getPos();
  drag = { mx: e.screenX, my: e.screenY, bx: pos.x, by: pos.y };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.mx, dy = e.screenY - drag.my;
  if (dx === 0 && dy === 0) return;
  window.api.setPos(drag.bx + dx, drag.by + dy);
});
window.addEventListener('mouseup', () => { drag = null; });
// ---------- 投放 ----------
function toDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result); fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
async function deposit(files) {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) { toast('没有图片'); return; }
  const items = [];
  for (const f of list) items.push({ name: f.name, dataUrl: await toDataUrl(f) });
  try {
    const r = await window.api.deposit(items);
    $('#dropNum').textContent = r.saved.length;
    toast(`已投放 ${r.saved.length} 张，等待 ${cfg.processTime} 自动处理`);
    refresh();
  } catch (e) { toast('投放失败：' + e.message); }
}
const drop = $('#drop');
drop.addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { deposit(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) deposit(e.dataTransfer.files); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
window.addEventListener('paste', e => {
  const files = [];
  for (const it of (e.clipboardData?.items || [])) {
    if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(new File([f], `clipboard-${Date.now()}.png`, { type: f.type })); }
  }
  if (files.length) deposit(files);
});

// ---------- 列表 ----------
function renderFiles(data) {
  $('#inboxCnt').textContent = `${data.newFiles.length} 待处理 / ${data.files.length} 总计`;
  const box = $('#flist');
  if (!data.files.length) {
    box.innerHTML = `<div class="fempty">投递箱为空<br>把截图拖进上面的投放口</div>`;
    return;
  }
  box.innerHTML = data.files.slice().reverse().slice(0, 30).map(f => `
    <div class="fitem">
      <span class="badge ${f.processed ? 'ok' : 'warn'}">${f.processed ? '已处理' : '待处理'}</span>
      <span class="fn">${f.name}</span>
    </div>`).join('');
}

// ---------- 刷新 ----------
async function refresh() {
  try {
    const [st, ib] = await Promise.all([window.api.getStats(), window.api.listInbox()]);
    $('#grandTotal').textContent = st.total;
    $('#grandShots').textContent = st.shots;
    renderFiles(ib);
    $('#footTip').textContent = `每天 ${cfg.processTime} 自动处理`;
  } catch (e) {}
}

// ---------- 设置面板 ----------
function openPanel() {
  $('#cfgInbox').value = cfg.inbox;
  $('#cfgArchive').value = cfg.archiveRoot;
  $('#cfgTime').value = cfg.processTime;
  $('#cfgLines').value = (cfg.lines || []).join(', ');
  $('#cfgAuto').checked = !!cfg.autoProcess;
  $('#cfgLock').checked = !!cfg.window.locked;
  $('#cfgTop').checked = !!cfg.window.alwaysOnTop;
  $('#cfgEmbed').checked = cfg.window.embedded !== false;
  $('#cfgOpacity').value = cfg.window.opacity ?? 1;
  $('#cfgW').value = cfg.window.w;
  $('#cfgH').value = cfg.window.h;
  $('#panel').hidden = false;
}
$('#btnSet').addEventListener('click', openPanel);
$('#btnCancel').addEventListener('click', () => { $('#panel').hidden = true; });
$('#pickInbox').addEventListener('click', async () => {
  const p = await window.api.pickPath('inbox'); if (p) $('#cfgInbox').value = p;
});
$('#pickArchive').addEventListener('click', async () => {
  const p = await window.api.pickPath('archive'); if (p) $('#cfgArchive').value = p;
});
$('#btnSave').addEventListener('click', async () => {
  const lines = $('#cfgLines').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const patch = {
    inbox: $('#cfgInbox').value.trim(),
    archiveRoot: $('#cfgArchive').value.trim(),
    processTime: $('#cfgTime').value || '14:00',
    lines: lines.length ? lines : ['生殖', '胸外', '其他'],
    autoProcess: $('#cfgAuto').checked,
    window: {
      locked: $('#cfgLock').checked,
      alwaysOnTop: $('#cfgTop').checked,
      embedded: $('#cfgEmbed').checked,
      opacity: Number($('#cfgOpacity').value),
      w: Number($('#cfgW').value) || cfg.window.w,
      h: Number($('#cfgH').value) || cfg.window.h
    }
  };
  cfg = await window.api.saveCfg(patch);
  $('#panel').hidden = true;
  $('#panelNote').textContent = '';
  toast('设置已保存');
  refresh();
});
$('#btnReset').addEventListener('click', async () => {
  const d = await window.api.defaults();
  cfg = await window.api.saveCfg({
    inbox: d.inbox, archiveRoot: d.archiveRoot, lines: d.lines,
    processTime: d.processTime, autoProcess: d.autoProcess,
    window: { w: d.window.w, h: d.window.h, opacity: 1 }
  });
  openPanel();
  toast('已恢复默认值（保存后生效）');
});
$('#btnEmbedNow').addEventListener('click', async () => {
  const ok = await window.api.embed();
  toast(ok ? '已嵌入桌面层' : '嵌入失败（可能不支持）');
});
$('#btnUnembed').addEventListener('click', async () => {
  const ok = await window.api.unembed();
  toast(ok ? '已取消嵌入' : '操作失败');
});

// ---------- 锁定 / 关闭 ----------
$('#btnLock').addEventListener('click', async () => {
  const locked = await window.api.lock(!cfg.window.locked);
  cfg.window.locked = locked;
  $('#btnLock').textContent = locked ? '🔒' : '🔓';
  $('#btnLock').classList.toggle('on', locked);
  toast(locked ? '位置已锁定' : '位置已解锁');
});
$('#btnClose').addEventListener('click', () => window.api.close());

// ---------- 启动 ----------
(async function init() {
  cfg = await window.api.getCfg();
  $('#btnLock').textContent = cfg.window.locked ? '🔒' : '🔓';
  $('#btnLock').classList.toggle('on', !!cfg.window.locked);
  window.api.onEmbedded(ok => {
    embedded = ok;
    $('#footTip').textContent = ok ? `每天 ${cfg.processTime} · 已嵌入桌面` : `每天 ${cfg.processTime} 自动处理`;
  });
  refresh();
  setInterval(refresh, 15000);
})();
