'use strict';
/* TADZKIR v2 – JavaScript Vanilla, data di LocalStorage */

const K = { tasks: 'tadzkir.tasks', theme: 'tadzkir.theme', sound: 'tadzkir.sound', backup: 'tadzkir.lastBackup', audio: 'tadzkir.audio', audioName: 'tadzkir.audioName' };
const UNIT_MS = { minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const UNIT_LABEL = { minutes: 'menit', hours: 'jam', days: 'hari', weeks: 'minggu' };
const PRI = { high: '🔴 Tinggi', mid: '🟡 Sedang', low: '🟢 Rendah' };
const PRI_W = { high: 0, mid: 1, low: 2 };
const REP = { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan' };
const NAV = [['dashboard', '🏠', 'Dashboard', 'Home'], ['all', '📋', 'Semua Tugas', 'Semua'], ['reminders', '⏰', 'Pengingat', 'Ingat'],
  ['history', '🗂', 'Selesai & Terlambat', 'Riwayat'], ['settings', '⚙', 'Pengaturan', 'Atur']];
const HIST = [['all', 'Semua'], ['done', '✓ Selesai'], ['late', '⚠ Terlambat']];
const FILTERS = [['all', 'Semua'], ['open', 'Belum Selesai'], ['done', 'Selesai'], ['today', 'Hari Ini'], ['late', 'Terlambat']];
const $ = s => document.querySelector(s);
const F = id => $('#' + id);
const state = { view: 'dashboard', filter: 'all', query: '', cat: '', hist: 'all', sort: 'deadline', editId: null };
let tasks = [], formSubs = [], dragId = null, onConfirm = null;

/* ---------- Helper ---------- */
function h(tag, props = {}, ...kids) { // buat elemen DOM; teks lewat textContent (aman)
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  kids.flat().forEach(c => el.append(c));
  return el;
}
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtStamp = iso => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace('.', ':');
const deadlineTs = t => new Date(`${t.deadline}T${t.time}`).getTime();
const isOverdue = t => !t.completed && deadlineTs(t) < Date.now();
const isToday = t => t.deadline === todayISO();

function toast(msg, actionLabel, cb) { // toast; opsional dengan tombol aksi (mis. Batalkan)
  const el = h('div', { class: 'toast' }, h('span', {}, msg));
  if (actionLabel) el.append(h('button', { onclick: () => { el.remove(); cb(); } }, actionLabel));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), actionLabel ? 6000 : 2800);
}
function download(name, content, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function beep(force) { // pakai audio pilihan pengguna (jika ada), jika tidak bunyi bawaan via WebAudio
  if (!force && localStorage.getItem(K.sound) === 'off') return;
  const custom = localStorage.getItem(K.audio);
  if (custom) { try { const a = new Audio(custom); a.play().catch(() => {}); setTimeout(() => a.pause(), 8000); return; } catch { /* lanjut ke bawaan */ } }
  try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(.2, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .4);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .4); } catch { /* abaikan */ }
}
function pickAudio(file) { // simpan audio sebagai data URL di LocalStorage (maks 1 MB)
  if (!file.type.startsWith('audio/')) return toast('⚠ Pilih file audio (mp3, wav, ogg)');
  if (file.size > 1024 * 1024) return toast('⚠ Ukuran audio maksimal 1 MB');
  const r = new FileReader();
  r.onload = () => {
    try { localStorage.setItem(K.audio, r.result); localStorage.setItem(K.audioName, file.name); renderSettings(); beep(true); toast('✓ Nada notifikasi disimpan'); }
    catch { toast('⚠ Penyimpanan penuh, coba audio yang lebih kecil'); }
  };
  r.readAsDataURL(file);
}

/* ---------- Data (LocalStorage) ---------- */
function getTasks() {
  try { const d = JSON.parse(localStorage.getItem(K.tasks));
    return Array.isArray(d) ? d.map(t => ({ priority: 'mid', category: '', repeat: 'none', subtasks: [], fired: [], snoozeAt: null, ...t })) : []; }
  catch { return []; }
}
function saveTasks() { localStorage.setItem(K.tasks, JSON.stringify(tasks)); }
// Tandai pengingat yang waktunya sudah lewat sebagai "terkirim" agar tugas baru tidak langsung memunculkan notifikasi lama.
function markPast(t) { t.fired = reminderTimes(t).filter(ts => ts <= Date.now()); }
function createTask(data) {
  const t = { id: Date.now() + Math.floor(Math.random() * 1000), completed: false, completedAt: null, createdAt: new Date().toISOString(), fired: [], snoozeAt: null, ...data };
  tasks.push(t); saveTasks(); return t;
}
function updateTask(id, patch) { const t = tasks.find(x => x.id === id); if (t) { Object.assign(t, patch); saveTasks(); } }
function deleteTask(id) { tasks = tasks.filter(t => t.id !== id); saveTasks(); }
function nextOccurrence(t) { // geser deadline ke jadwal berikutnya yang di masa depan
  const d = new Date(t.deadline + 'T00:00:00');
  do { if (t.repeat === 'daily') d.setDate(d.getDate() + 1); else if (t.repeat === 'weekly') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1);
    t.deadline = isoOf(d); } while (deadlineTs(t) <= Date.now());
}
function completeTask(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  if (!t.completed && t.repeat !== 'none') { // tugas berulang: jadwalkan lagi, bukan ditutup
    t.lastDone = new Date().toISOString(); nextOccurrence(t); t.subtasks.forEach(s => s.d = false); t.snoozeAt = null; markPast(t);
    saveTasks(); toast(`✓ Selesai · berikutnya ${fmtDate(t.deadline)}`); return;
  }
  t.completed = !t.completed; t.completedAt = t.completed ? new Date().toISOString() : null;
  saveTasks(); toast(t.completed ? '✓ Tugas selesai' : '↺ Tugas dibuka kembali');
}
function filterTasks(list, f) {
  return f === 'open' ? list.filter(t => !t.completed) : f === 'done' ? list.filter(t => t.completed) :
    f === 'today' ? list.filter(isToday) : f === 'late' ? list.filter(isOverdue) : list;
}
function searchTasks(list, q) { q = q.trim().toLowerCase(); return q ? list.filter(t => t.title.toLowerCase().includes(q)) : list; }

/* ---------- Render ---------- */
function reminderText(t) {
  if (!t.reminderEnabled) return '🔕 Tanpa pengingat';
  const n = t.reminderMode === 'once' ? 1 : t.reminderCount;
  return `🔔 ${n} pengingat · ${t.reminderMode === 'once' ? 'sekali' : 'tiap'} ${t.reminderInterval} ${UNIT_LABEL[t.reminderUnit]}`;
}
function taskCard(t) {
  const late = isOverdue(t);
  const card = h('article', { class: `card p-${t.priority}` + (t.completed ? ' done' : late ? ' late' : ''), draggable: String(state.sort === 'manual') });
  if (state.sort === 'manual') { // seret & lepas (desktop) untuk mengubah urutan
    card.addEventListener('dragstart', () => { dragId = t.id; card.classList.add('drag'); });
    card.addEventListener('dragend', () => card.classList.remove('drag'));
    card.addEventListener('dragover', e => e.preventDefault());
    card.addEventListener('drop', e => { e.preventDefault(); if (dragId === t.id) return;
      const from = tasks.findIndex(x => x.id === dragId), to = tasks.findIndex(x => x.id === t.id);
      tasks.splice(to, 0, tasks.splice(from, 1)[0]); saveTasks(); render(); });
  }
  card.append(h('div', { class: 'card-head' },
    h('button', { class: 'tick' + (t.completed ? ' on' : ''), 'aria-pressed': String(t.completed), 'aria-label': t.completed ? 'Tandai belum selesai' : 'Tandai selesai',
      onclick: () => { completeTask(t.id); render(); } }, t.completed ? '✓' : ''),
    h('h3', {}, t.title)));
  const tags = h('div', { class: 'tags' });
  if (late) tags.append(h('span', { class: 'badge' }, '⚠ Terlambat · ' + relDue(t).replace('Terlewat ', '')));
  else if (!t.completed) tags.append(h('span', { class: 'tag due' }, '⏳ ' + relDue(t)));
  tags.append(h('span', { class: 'tag pri-' + t.priority }, PRI[t.priority]));
  if (t.category) tags.append(h('span', { class: 'tag' }, '# ' + t.category));
  tags.append(h('span', { class: 'tag st' }, t.completed ? '✓ Selesai' : '○ Belum selesai'));
  card.append(tags);
  if (t.description) card.append(h('p', {}, t.description));
  card.append(h('div', { class: 'meta' }, h('span', {}, '📅 ' + fmtDate(t.deadline)), h('span', {}, '⏰ ' + t.time),
    t.repeat !== 'none' ? h('span', {}, '🔁 ' + REP[t.repeat]) : '', h('span', {}, reminderText(t))));
  if (t.subtasks.length) {
    card.append(h('div', { class: 'done-at' }, `${t.subtasks.filter(s => s.d).length}/${t.subtasks.length} subtugas`),
      h('ul', { class: 'subs' }, t.subtasks.map(s => h('li', {}, h('label', {},
        h('input', { type: 'checkbox', ...(s.d ? { checked: '' } : {}), onchange: () => { s.d = !s.d; saveTasks(); render(); } }),
        h('span', { class: s.d ? 'd' : '' }, s.t))))));
  }
  if (t.completed) card.append(h('span', { class: 'done-at' }, 'Selesai pada ' + fmtStamp(t.completedAt)));
  else if (t.lastDone) card.append(h('span', { class: 'done-at' }, 'Terakhir selesai ' + fmtStamp(t.lastDone)));
  card.append(h('div', { class: 'card-actions' },
    h('button', { class: 'btn', onclick: () => openTaskModal(t.id) }, 'Edit'),
    h('button', { class: 'btn', onclick: () => exportICS([t], t.title) }, '📅 .ics'),
    h('button', { class: 'btn', onclick: () => askDelete(t.id) }, 'Hapus')));
  return card;
}
function relDue(t) { // teks relatif: "3 jam lagi" / "Terlewat 2 hari"
  const d = deadlineTs(t) - Date.now(), a = Math.abs(d), m = Math.round(a / 6e4), hr = Math.round(a / 36e5), dy = Math.round(a / 864e5);
  if (m < 1) return 'Sekarang';
  const u = m < 60 ? `${m} menit` : hr < 24 ? `${hr} jam` : `${dy} hari`;
  return d < 0 ? `Terlewat ${u}` : `${u} lagi`;
}
function renderHero() {
  const hr = new Date().getHours(), open = tasks.filter(t => !t.completed).length, done = tasks.length - open;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('#helloTxt').textContent = `Selamat ${hr < 11 ? 'pagi' : hr < 15 ? 'siang' : hr < 18 ? 'sore' : 'malam'} 👋 · ` + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#heroTitle').textContent = !tasks.length ? 'Yuk, catat tugas pertamamu' : open ? `${open} tugas menunggumu` : 'Semua beres, kerja bagus! 🎉';
  $('#heroSub').textContent = `${tasks.filter(isOverdue).length} terlambat · ${tasks.filter(t => !t.completed && isToday(t)).length} jatuh tempo hari ini`;
  $('#ring').style.setProperty('--p', pct); $('#ringTxt').textContent = pct + '%';
}
function renderStats() {
  const open = tasks.filter(t => !t.completed).length;
  const items = [['📌', 'Total Tugas', tasks.length, ''], ['⏳', 'Belum Selesai', open, ''], ['✅', 'Selesai', tasks.length - open, ''], ['🔥', 'Hari Ini', tasks.filter(isToday).length, 'accent']];
  $('#stats').replaceChildren(...items.map(([ic, l, n, c]) => h('div', { class: 'stat ' + c }, h('i', {}, ic), h('b', {}, String(n)), h('span', {}, l))));
}
function renderCats() {
  const cats = [...new Set(tasks.map(t => t.category).filter(Boolean))].sort();
  if (state.cat && !cats.includes(state.cat)) state.cat = '';
  F('catFilter').replaceChildren(h('option', { value: '' }, 'Semua kategori'), ...cats.map(c => h('option', { value: c }, '# ' + c)));
  F('catFilter').value = state.cat;
  F('catList').replaceChildren(...cats.map(c => h('option', { value: c })));
}
function renderTasks() {
  const v = state.view;
  let list = v === 'reminders' ? tasks.filter(t => t.reminderEnabled && !t.completed) : v === 'history' ? filterTasks(tasks.filter(t => t.completed || isOverdue(t)), state.hist) : filterTasks(tasks, state.filter);
  if (state.cat) list = list.filter(t => t.category === state.cat);
  list = searchTasks(list, state.query).slice();
  const byDeadline = (a, b) => deadlineTs(a) - deadlineTs(b);
  const cmp = { deadline: byDeadline, created: (a, b) => b.createdAt.localeCompare(a.createdAt), priority: (a, b) => PRI_W[a.priority] - PRI_W[b.priority] || byDeadline(a, b) }[state.sort];
  if (cmp) list.sort((a, b) => (a.completed - b.completed) || cmp(a, b));
  if (!list.length) {
    const none = !tasks.length;
    F('list').replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'ico' }, none ? '📋' : '🔍'),
      h('h2', {}, none ? 'Belum ada tugas' : 'Tidak ada tugas yang cocok'),
      h('p', {}, none ? 'Tambahkan tugas pertamamu agar tidak terlupa.' : 'Coba ubah kata kunci atau filter.'),
      none ? h('button', { class: 'btn primary', onclick: () => openTaskModal() }, '+ Tambah Tugas') : ''));
    return;
  }
  F('list').replaceChildren(...list.map(taskCard));
}
function renderNav() {
  const mk = bottom => ([id, ic, label, short]) => h('button', { class: 'nav-btn' + (state.view === id ? ' on' : ''), 'aria-label': label,
    onclick: () => { state.view = id; render(); window.scrollTo(0, 0); } }, h('span', { class: 'i' }, ic), h('span', {}, bottom ? short : label));
  $('#sideNav').replaceChildren(...NAV.map(mk(false)));
  $('#bottomNav').replaceChildren(...NAV.map(mk(true)));
}
function render() {
  const v = state.view, st = v === 'settings';
  $('#title').textContent = NAV.find(n => n[0] === v)[2];
  $('#title').hidden = v === 'dashboard'; $('#hero').hidden = v !== 'dashboard'; F('fab').hidden = st;
  $('#stats').hidden = v !== 'dashboard'; $('#toolbar').hidden = st; $('#list').hidden = st; $('#settings').hidden = !st;
  $('#chips').hidden = !['dashboard', 'all', 'history'].includes(v);
  const hist = v === 'history', cur = hist ? state.hist : state.filter;
  $('#chips').replaceChildren(...(hist ? HIST : FILTERS).map(([id, l]) => h('button', { class: 'chip' + (cur === id ? ' on' : ''),
    onclick: () => { if (hist) state.hist = id; else state.filter = id; render(); } }, l)));
  renderNav(); renderCats(); renderHero(); renderStats(); renderTasks(); renderSettings();
}

/* ---------- Tema ---------- */
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('#metaTheme').content = dark ? '#0B1312' : '#0E7C66';
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
  $('#setTheme').textContent = dark ? 'Beralih ke Terang' : 'Beralih ke Gelap';
}
function toggleTheme() { const d = !document.documentElement.classList.contains('dark'); localStorage.setItem(K.theme, d ? 'dark' : 'light'); applyTheme(d); }

/* ---------- Modal tambah/edit ---------- */
function setErr(id, msg) { document.querySelector(`.err[data-for="${id}"]`).textContent = msg || ''; F(id).classList.toggle('bad', !!msg); }
function syncRemindUI() {
  const once = F('fMode').value === 'once';
  F('remindBox').hidden = !F('fRemind').checked; F('countRow').hidden = once; F('customWrap').hidden = F('fCount').value !== 'custom';
  const n = once ? 1 : (F('fCount').value === 'custom' ? F('fCustom').value : F('fCount').value);
  F('remindHint').textContent = `Kamu akan diingatkan ${n}× — mulai ${F('fInterval').value || '?'} ${UNIT_LABEL[F('fUnit').value]} sebelum deadline${n > 1 ? ', dengan jarak yang sama' : ''}.`;
}
function renderFormSubs() {
  F('fSubList').replaceChildren(...formSubs.map((s, i) => h('li', {}, h('span', {}, s.t),
    h('button', { type: 'button', 'aria-label': 'Hapus subtugas', onclick: () => { formSubs.splice(i, 1); renderFormSubs(); } }, '✕'))));
}
function addSub() { const v = F('fSubIn').value.trim(); if (v) { formSubs.push({ t: v, d: false }); F('fSubIn').value = ''; renderFormSubs(); } F('fSubIn').focus(); }
function openTaskModal(id = null) {
  state.editId = id;
  const t = id ? tasks.find(x => x.id === id) : null;
  $('#modalTitle').textContent = t ? 'Edit Tugas' : 'Tambah Tugas';
  F('fTitle').value = t ? t.title : ''; F('fDesc').value = t ? t.description : '';
  F('fDate').value = t ? t.deadline : todayISO(); F('fTime').value = t ? t.time : '';
  F('fPri').value = t ? t.priority : 'mid'; F('fCat').value = t ? t.category : ''; F('fRepeat').value = t ? t.repeat : 'none';
  formSubs = t ? t.subtasks.map(s => ({ ...s })) : []; renderFormSubs();
  F('fRemind').checked = t ? t.reminderEnabled : true; F('fMode').value = t ? t.reminderMode || 'repeat' : 'repeat';
  const c = String(t ? t.reminderCount : 3);
  F('fCount').value = ['1', '2', '3', '4', '5'].includes(c) ? c : 'custom'; F('fCustom').value = F('fCount').value === 'custom' ? c : 6;
  F('fInterval').value = t ? t.reminderInterval : 2; F('fUnit').value = t ? t.reminderUnit : 'hours';
  ['fTitle', 'fDate', 'fTime', 'fCustom', 'fInterval'].forEach(i => setErr(i, ''));
  syncRemindUI(); $('#taskModal').hidden = false; F('fTitle').focus();
}
const closeTaskModal = () => { $('#taskModal').hidden = true; };
function submitTask(e) {
  e.preventDefault();
  const title = F('fTitle').value.trim(), on = F('fRemind').checked; let ok = true;
  const bad = (id, m) => { setErr(id, m); ok = false; };
  ['fTitle', 'fDate', 'fTime', 'fCustom', 'fInterval'].forEach(i => setErr(i, ''));
  if (!title) bad('fTitle', 'Judul tugas wajib diisi.');
  if (!F('fDate').value) bad('fDate', 'Tanggal wajib diisi.');
  if (!F('fTime').value) bad('fTime', 'Waktu wajib diisi.');
  const count = F('fCount').value === 'custom' ? Number(F('fCustom').value) : Number(F('fCount').value), interval = Number(F('fInterval').value);
  if (on) {
    if (F('fMode').value === 'repeat' && (!Number.isInteger(count) || count < 1 || count > 50)) bad('fCustom', 'Isi angka 1–50.');
    if (!Number.isInteger(interval) || interval < 1 || interval > 999) bad('fInterval', 'Isi angka 1–999.');
  }
  if (!ok) return;
  const data = { title, description: F('fDesc').value.trim(), deadline: F('fDate').value, time: F('fTime').value,
    priority: F('fPri').value, category: F('fCat').value.trim().slice(0, 30), repeat: F('fRepeat').value, subtasks: formSubs.map(s => ({ ...s })),
    reminderEnabled: on, reminderMode: F('fMode').value, reminderCount: count || 1, reminderInterval: interval || 1, reminderUnit: F('fUnit').value, snoozeAt: null };
  let t;
  if (state.editId) { updateTask(state.editId, data); t = tasks.find(x => x.id === state.editId); toast('✓ Tugas berhasil diperbarui'); }
  else { t = createTask(data); toast('✓ Tugas berhasil ditambahkan'); }
  markPast(t); saveTasks();
  if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(renderSettings);
  closeTaskModal(); render();
}

/* ---------- Hapus (konfirmasi + undo) ---------- */
function confirmDialog(text, yes, cb) { $('#confirmText').textContent = text; $('#confirmYes').textContent = yes; onConfirm = cb; $('#confirmModal').hidden = false; }
function askDelete(id) {
  confirmDialog('Apakah kamu yakin ingin menghapus tugas ini?', 'Hapus', () => {
    const idx = tasks.findIndex(t => t.id === id), backup = tasks[idx];
    deleteTask(id); render();
    toast('✓ Tugas dihapus', 'Batalkan', () => { tasks.splice(Math.min(idx, tasks.length), 0, backup); saveTasks(); render(); toast('↺ Tugas dikembalikan'); });
  });
}

/* ---------- Pengingat, notifikasi, snooze ---------- */
function reminderOffsets(t) { // jarak tiap pengingat sebelum deadline (ms), dari yang terjauh
  const step = t.reminderInterval * UNIT_MS[t.reminderUnit], n = t.reminderMode === 'once' ? 1 : t.reminderCount;
  return Array.from({ length: n }, (_, i) => (n - i) * step);
}
const reminderTimes = t => t.reminderEnabled ? reminderOffsets(t).map(o => deadlineTs(t) - o) : [];
async function notify(t, late) {
  const body = `${late ? 'Tugas terlewat' : 'Jangan lupa mengerjakan'}: ${t.title}`;
  toast('🔔 ' + body, 'Tunda 10 mnt', () => snooze(t.id)); beep();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'assets/icon.png', badge: 'assets/logo.png', data: { id: t.id }, actions: [{ action: 'snooze', title: 'Tunda 10 menit' }] };
  try { const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) reg.showNotification('🔔 TADZKIR', opts); else new Notification('🔔 TADZKIR', { body, icon: opts.icon }); } catch { /* abaikan */ }
}
function snooze(id) {
  const t = tasks.find(x => x.id === Number(id)); if (!t) return;
  t.snoozeAt = Date.now() + 10 * 6e4; saveTasks(); toast('⏱ Diingatkan lagi 10 menit lagi');
}
function checkReminders() { // dipanggil tiap 30 dtk, saat dibuka, dan saat tab aktif lagi
  const now = Date.now(); let changed = false;
  tasks.forEach(t => {
    if (t.completed) return;
    const due = reminderTimes(t).filter(ts => ts <= now && !t.fired.includes(ts));
    const snoozed = t.snoozeAt && t.snoozeAt <= now;
    if (!due.length && !snoozed) return;
    t.fired.push(...due); t.snoozeAt = null; changed = true; notify(t, deadlineTs(t) < now);
  });
  if (changed) { saveTasks(); render(); }
}

/* ---------- Kalender (.ics) ---------- */
const icsDT = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n');
function icsEvent(t) {
  const s = new Date(`${t.deadline}T${t.time}`), e = new Date(s.getTime() + 30 * 6e4);
  const L = ['BEGIN:VEVENT', `UID:${t.id}@tadzkir`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
    `DTSTART:${icsDT(s)}`, `DTEND:${icsDT(e)}`, `SUMMARY:${icsEsc(t.title)}`];
  if (t.description) L.push(`DESCRIPTION:${icsEsc(t.description)}`);
  if (t.repeat !== 'none') L.push('RRULE:FREQ=' + t.repeat.toUpperCase());
  if (t.reminderEnabled) reminderOffsets(t).forEach(o => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t.title)}`, `TRIGGER:-PT${Math.round(o / 6e4)}M`, 'END:VALARM'));
  return [...L, 'END:VEVENT'];
}
function exportICS(list, name = 'tadzkir') {
  if (!list.length) return toast('⚠ Tidak ada tugas aktif untuk diekspor');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TADZKIR//ID', ...list.flatMap(icsEvent), 'END:VCALENDAR'];
  download(name.replace(/[^\w-]+/g, '_') + '.ics', lines.join('\r\n'), 'text/calendar'); toast('✓ File kalender diunduh');
}

/* ---------- Pengaturan, export, import ---------- */
function renderSettings() {
  $('#notifState').textContent = !('Notification' in window) ? 'Browser ini tidak mendukung notifikasi.' :
    { granted: 'Aktif.', denied: 'Diblokir. Izinkan lewat pengaturan situs di browser.', default: 'Belum diaktifkan.' }[Notification.permission];
  $('#setNotif').hidden = !('Notification' in window) || Notification.permission !== 'default';
  $('#audioState').textContent = localStorage.getItem(K.audio) ? 'Nada kustom: ' + (localStorage.getItem(K.audioName) || 'audio') : 'Nada bawaan aplikasi.';
  $('#audioReset').hidden = !localStorage.getItem(K.audio);
  $('#setSound').textContent = localStorage.getItem(K.sound) === 'off' ? 'Suara: Mati' : 'Suara: Aktif';
}
function exportData() {
  download(`tadzkir-${todayISO()}.json`, JSON.stringify(tasks, null, 2), 'application/json');
  localStorage.setItem(K.backup, String(Date.now())); toast('✓ Data diekspor');
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const arr = JSON.parse(r.result); if (!Array.isArray(arr)) throw 0; let n = 0;
      arr.forEach(x => {
        if (!x || typeof x.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.deadline) || !/^\d{2}:\d{2}$/.test(x.time)) return;
        const num = (v, max) => Math.min(max, Math.max(1, parseInt(v) || 1));
        const t = createTask({ title: x.title.slice(0, 120), description: String(x.description || '').slice(0, 500), deadline: x.deadline, time: x.time,
          priority: PRI[x.priority] ? x.priority : 'mid', category: String(x.category || '').slice(0, 30), repeat: REP[x.repeat] ? x.repeat : 'none',
          subtasks: Array.isArray(x.subtasks) ? x.subtasks.slice(0, 30).map(s => ({ t: String(s.t || '').slice(0, 80), d: !!s.d })).filter(s => s.t) : [],
          reminderEnabled: !!x.reminderEnabled, reminderMode: x.reminderMode === 'once' ? 'once' : 'repeat', reminderCount: num(x.reminderCount, 50),
          reminderInterval: num(x.reminderInterval, 999), reminderUnit: UNIT_MS[x.reminderUnit] ? x.reminderUnit : 'hours' });
        if (x.completed) { t.completed = true; t.completedAt = x.completedAt || new Date().toISOString(); }
        n++;
      });
      saveTasks(); render(); toast(`✓ ${n} tugas diimpor`);
    } catch { toast('⚠ File JSON tidak valid'); }
  };
  r.readAsText(file);
}

/* ---------- Aksesibilitas modal ---------- */
function trapFocus(e) { // Tab tetap berputar di dalam modal yang terbuka
  const ov = [...document.querySelectorAll('.overlay')].find(o => !o.hidden); if (!ov) return;
  const els = [...ov.querySelectorAll('input:not([hidden]),select,textarea,button')].filter(el => el.offsetParent !== null && !el.disabled);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- Inisialisasi ---------- */
function init() {
  tasks = getTasks();
  const saved = localStorage.getItem(K.theme);
  applyTheme(saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  $('#themeBtn').onclick = $('#setTheme').onclick = toggleTheme;
  $('#addBtn').onclick = F('fab').onclick = () => openTaskModal();
  $('#search').oninput = e => { state.query = e.target.value; renderTasks(); };
  F('catFilter').onchange = e => { state.cat = e.target.value; renderTasks(); };
  F('sort').onchange = e => { state.sort = e.target.value; renderTasks(); };
  $('#taskForm').onsubmit = submitTask; $('#cancelBtn').onclick = closeTaskModal;
  F('fSubAdd').onclick = addSub; F('fSubIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } };
  ['fRemind', 'fMode', 'fCount', 'fUnit'].forEach(i => F(i).addEventListener('change', syncRemindUI));
  ['fInterval', 'fCustom'].forEach(i => F(i).addEventListener('input', syncRemindUI));
  $('#confirmNo').onclick = () => { $('#confirmModal').hidden = true; };
  $('#confirmYes').onclick = () => { $('#confirmModal').hidden = true; onConfirm && onConfirm(); };
  document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.hidden = true; }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach(o => o.hidden = true);
    if (e.key === 'Tab') trapFocus(e);
  });
  $('#setNotif').onclick = () => Notification.requestPermission().then(() => { renderSettings(); toast('Izin notifikasi diperbarui'); });
  $('#setSound').onclick = () => { localStorage.setItem(K.sound, localStorage.getItem(K.sound) === 'off' ? 'on' : 'off'); beep(); renderSettings(); };
  $('#audioPick').onclick = () => $('#audioFile').click();
  $('#audioFile').onchange = e => { if (e.target.files[0]) pickAudio(e.target.files[0]); e.target.value = ''; };
  $('#audioTest').onclick = () => beep(true);
  $('#audioReset').onclick = () => { localStorage.removeItem(K.audio); localStorage.removeItem(K.audioName); renderSettings(); toast('↺ Kembali ke nada bawaan'); };
  $('#icsBtn').onclick = () => exportICS(tasks.filter(t => !t.completed));
  $('#exportBtn').onclick = exportData;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };
  $('#wipeBtn').onclick = () => confirmDialog('Hapus SEMUA tugas? Tindakan ini tidak bisa dibatalkan.', 'Hapus semua', () => { tasks = []; saveTasks(); toast('✓ Semua tugas dihapus'); render(); });

  // Snooze dari notifikasi (aplikasi sudah terbuka atau dibuka lewat ?snooze=ID)
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.snooze) snooze(e.data.snooze); });
  const sn = new URLSearchParams(location.search).get('snooze');
  if (sn) { snooze(sn); history.replaceState(null, '', location.pathname); }

  render(); checkReminders(); setInterval(checkReminders, 30000);
  setInterval(() => { if (!document.hidden && ![...document.querySelectorAll('.overlay')].some(o => !o.hidden)) render(); }, 60000); // segarkan teks "x jam lagi"
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); render(); } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});

  // Ingatkan backup tiap 14 hari (LocalStorage bisa hilang jika cache dibersihkan)
  const last = Number(localStorage.getItem(K.backup));
  if (!last) localStorage.setItem(K.backup, String(Date.now()));
  else if (tasks.length && Date.now() - last > 14 * 864e5) setTimeout(() => toast('💾 Sudah 2 minggu belum backup', 'Export', exportData), 1500);
}
init();
