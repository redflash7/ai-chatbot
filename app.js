'use strict';

const STORAGE_KEY = 'harunote:v1';

const TYPES = {
  idea: { label: '아이디어', icon: '💡' },
  memo: { label: '메모', icon: '📝' },
  diary: { label: '일기', icon: '📔' },
};

const MOODS = [
  { value: 'great', icon: '😄', label: '최고' },
  { value: 'good', icon: '🙂', label: '좋음' },
  { value: 'okay', icon: '😐', label: '보통' },
  { value: 'bad', icon: '😟', label: '별로' },
  { value: 'awful', icon: '😢', label: '힘듦' },
];

const TYPE_COLORS = { idea: 'var(--idea)', memo: 'var(--memo)', diary: 'var(--diary)' };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ---------- Storage ----------

const store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter(isValidEntry) : [];
    } catch (err) {
      console.error('기록을 불러오지 못했습니다', err);
      return [];
    }
  },
  save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch (err) {
      console.error('기록을 저장하지 못했습니다', err);
      toast('저장 실패: 브라우저 저장 공간을 확인해주세요');
      return false;
    }
  },
};

function isValidEntry(e) {
  return e && typeof e.id === 'string' && TYPES[e.type] &&
    typeof e.content === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    typeof e.createdAt === 'number' && (e.tags === undefined || Array.isArray(e.tags));
}

// ---------- State ----------

const state = {
  entries: store.load(),
  selectedDate: toISODate(new Date()),
  viewMonth: startOfMonth(new Date()),
  filter: 'all',
  query: '',
};

// ---------- Date helpers ----------

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatLongDate(iso) {
  const d = fromISODate(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function relativeDayLabel(iso) {
  const diff = Math.round((fromISODate(iso) - fromISODate(toISODate(new Date()))) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === -1) return '어제';
  if (diff === 1) return '내일';
  return diff < 0 ? `${-diff}일 전` : `${diff}일 후`;
}

// ---------- Utils ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, query) {
  const safe = escapeHTML(text);
  if (!query) return safe;
  const pattern = escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(pattern, 'gi'), (m) => `<mark>${m}</mark>`);
}

function parseTags(s) {
  const tags = s.split(/[,，]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  return [...new Set(tags)];
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Mutations ----------

function persist() {
  store.save(state.entries);
  render();
}

function addEntry(data) {
  const now = Date.now();
  state.entries.push({ id: uid(), pinned: false, createdAt: now, updatedAt: now, ...data });
  persist();
}

function updateEntry(id, patch) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  Object.assign(entry, patch, { updatedAt: Date.now() });
  persist();
}

function deleteEntry(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  persist();
}

// ---------- Queries ----------

function matchesQuery(e, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (needle.startsWith('#')) {
    const tag = needle.slice(1);
    return (e.tags || []).some((t) => t.toLowerCase() === tag);
  }
  return [e.title || '', e.content, ...(e.tags || [])].some((s) => s.toLowerCase().includes(needle));
}

function visibleEntries() {
  const q = state.query.trim();
  return state.entries
    .filter((e) => state.filter === 'all' || e.type === state.filter)
    .filter((e) => (q ? matchesQuery(e, q) : e.date === state.selectedDate))
    .sort((a, b) => {
      if (q && a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (!q && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
}

// ---------- Rendering ----------

function render() {
  renderCalendar();
  renderHeader();
  renderList();
  renderStats();
}

function renderCalendar() {
  const month = state.viewMonth;
  $('#calTitle').textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;

  const byDate = new Map();
  for (const e of state.entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, new Set());
    byDate.get(e.date).add(e.type);
  }

  const today = toISODate(new Date());
  const start = new Date(month);
  start.setDate(1 - month.getDay());

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISODate(d);
    const classes = ['cal-day'];
    if (d.getMonth() !== month.getMonth()) classes.push('other');
    if (iso === today) classes.push('today');
    if (iso === state.selectedDate && !state.query.trim()) classes.push('selected');
    const types = byDate.get(iso);
    const dots = types
      ? `<span class="dots">${['idea', 'memo', 'diary'].filter((t) => types.has(t))
          .map((t) => `<i style="background:${TYPE_COLORS[t]}"></i>`).join('')}</span>`
      : '';
    cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${iso}" aria-label="${formatLongDate(iso)}">${d.getDate()}${dots}</button>`);
  }
  $('#calDays').innerHTML = cells.join('');
}

function renderHeader() {
  const q = state.query.trim();
  const composer = $('#composer');
  if (q) {
    $('#dayTitle').textContent = `"${q}" 검색 결과`;
    $('#daySub').textContent = `${visibleEntries().length}개의 기록`;
    composer.hidden = true;
  } else {
    $('#dayTitle').textContent = formatLongDate(state.selectedDate);
    $('#daySub').textContent = relativeDayLabel(state.selectedDate);
    composer.hidden = false;
  }
}

function renderEntry(e, q) {
  const t = TYPES[e.type];
  const mood = e.type === 'diary' && e.mood ? MOODS.find((m) => m.value === e.mood) : null;
  const tags = (e.tags || []).map((tag) => `<button type="button" class="tag" data-tag="${escapeHTML(tag)}">#${highlight(tag, q)}</button>`).join('');
  const edited = e.updatedAt - e.createdAt > 1000 ? ' · 수정됨' : '';
  return `
    <article class="entry" data-type="${e.type}" data-id="${e.id}">
      <div class="entry-head">
        <span class="type">${t.icon} ${t.label}</span>
        ${mood ? `<span title="${mood.label}">${mood.icon}</span>` : ''}
        <span>${formatTime(e.createdAt)}${edited}</span>
        <div class="actions">
          <button type="button" class="pin ${e.pinned ? 'pinned' : ''}" data-action="pin" title="${e.pinned ? '고정 해제' : '상단 고정'}">${e.pinned ? '★' : '☆'}</button>
          <button type="button" data-action="edit" title="수정">수정</button>
          <button type="button" class="del" data-action="delete" title="삭제">삭제</button>
        </div>
      </div>
      ${e.title ? `<h3>${highlight(e.title, q)}</h3>` : ''}
      <p class="content">${highlight(e.content, q)}</p>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </article>`;
}

function renderList() {
  const q = state.query.trim();
  const items = visibleEntries();
  const list = $('#list');

  if (!items.length) {
    list.innerHTML = q
      ? '<div class="empty">검색 결과가 없습니다.</div>'
      : '<div class="empty">이 날의 기록이 아직 없어요.<br>위 입력창에 오늘의 생각을 남겨보세요.</div>';
    return;
  }

  if (!q) {
    list.innerHTML = items.map((e) => renderEntry(e)).join('');
    return;
  }

  // 검색 결과는 날짜별로 묶어서 보여준다
  let html = '';
  let lastDate = null;
  const highlightTerm = q.startsWith('#') ? q.slice(1) : q;
  for (const e of items) {
    if (e.date !== lastDate) {
      html += `<button type="button" class="group-label link-btn" data-goto="${e.date}">${formatLongDate(e.date)}</button>`;
      lastDate = e.date;
    }
    html += renderEntry(e, highlightTerm);
  }
  list.innerHTML = html;
}

function renderStats() {
  const counts = { idea: 0, memo: 0, diary: 0 };
  for (const e of state.entries) counts[e.type]++;
  $('#stats').innerHTML = Object.entries(TYPES)
    .map(([k, t]) => `<div class="stat"><b>${counts[k]}</b><span>${t.icon} ${t.label}</span></div>`)
    .join('');
}

// ---------- Mood pickers ----------

function setupMoodPicker(form) {
  const container = $('.moods', form);
  container.innerHTML = MOODS.map((m) =>
    `<button type="button" class="mood" data-mood="${m.value}" title="${m.label}" aria-label="${m.label}">${m.icon}</button>`).join('');
  container.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.mood');
    if (!btn) return;
    const active = btn.classList.contains('active');
    $$('.mood', container).forEach((b) => b.classList.remove('active'));
    if (!active) btn.classList.add('active');
  });
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'type') syncMoodVisibility(form);
  });
}

function syncMoodVisibility(form) {
  $('.mood-row', form).hidden = form.elements.type.value !== 'diary';
}

function getMood(form) {
  if (form.elements.type.value !== 'diary') return null;
  return $('.mood.active', form)?.dataset.mood || null;
}

function setMood(form, value) {
  $$('.mood', form).forEach((b) => b.classList.toggle('active', b.dataset.mood === value));
}

// ---------- Events ----------

function goToDate(iso) {
  state.selectedDate = iso;
  state.viewMonth = startOfMonth(fromISODate(iso));
  state.query = '';
  $('#search').value = '';
  render();
}

function bindEvents() {
  const composer = $('#composer');
  setupMoodPicker(composer);

  composer.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = composer.elements;
    const content = f.content.value.trim();
    if (!content) return;
    addEntry({
      type: f.type.value,
      date: state.selectedDate,
      title: f.title.value.trim(),
      content,
      tags: parseTags(f.tags.value),
      mood: getMood(composer),
    });
    const keepType = f.type.value;
    composer.reset();
    f.type.value = keepType;
    setMood(composer, null);
    syncMoodVisibility(composer);
    f.content.focus();
    toast('저장했어요');
  });

  composer.elements.content.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') composer.requestSubmit();
  });

  $('#calDays').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-date]');
    if (btn) goToDate(btn.dataset.date);
  });

  $('#prevMonth').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#nextMonth').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $('#todayBtn').addEventListener('click', () => goToDate(toISODate(new Date())));

  $('#search').addEventListener('input', (ev) => {
    state.query = ev.target.value;
    render();
  });

  $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    render();
  }));

  $('#list').addEventListener('click', (ev) => {
    const goto = ev.target.closest('[data-goto]');
    if (goto) return goToDate(goto.dataset.goto);

    const tag = ev.target.closest('[data-tag]');
    if (tag) {
      state.query = `#${tag.dataset.tag}`;
      $('#search').value = state.query;
      return render();
    }

    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.entry').dataset.id;
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;

    if (btn.dataset.action === 'pin') updateEntry(id, { pinned: !entry.pinned });
    if (btn.dataset.action === 'edit') openEditor(entry);
    if (btn.dataset.action === 'delete' && confirm('이 기록을 삭제할까요?')) {
      deleteEntry(id);
      toast('삭제했어요');
    }
  });

  bindEditor();
  bindBackup();
}

// ---------- Editor dialog ----------

let editingId = null;

function openEditor(entry) {
  const dialog = $('#editDialog');
  const form = $('#editForm');
  editingId = entry.id;
  form.elements.type.value = entry.type;
  form.elements.date.value = entry.date;
  form.elements.title.value = entry.title || '';
  form.elements.content.value = entry.content;
  form.elements.tags.value = (entry.tags || []).join(', ');
  setMood(form, entry.mood);
  syncMoodVisibility(form);
  dialog.showModal();
  form.elements.content.focus();
}

function bindEditor() {
  const dialog = $('#editDialog');
  const form = $('#editForm');
  setupMoodPicker(form);

  $('#editCancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', (ev) => {
    const f = form.elements;
    const content = f.content.value.trim();
    if (!editingId || !content || !f.date.value) {
      ev.preventDefault();
      return;
    }
    updateEntry(editingId, {
      type: f.type.value,
      date: f.date.value,
      title: f.title.value.trim(),
      content,
      tags: parseTags(f.tags.value),
      mood: getMood(form),
    });
    editingId = null;
    toast('수정했어요');
  });

  dialog.addEventListener('close', () => { editingId = null; });
}

// ---------- Backup ----------

function bindBackup() {
  $('#exportBtn').addEventListener('click', () => {
    const payload = { app: 'harunote', version: 1, exportedAt: new Date().toISOString(), entries: state.entries };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `harunote-backup-${toISODate(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('백업 파일을 내려받았어요');
  });

  $('#importInput').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.entries || []).filter(isValidEntry);
      if (!incoming.length) return toast('불러올 기록이 없습니다');

      // 같은 id는 더 최근에 수정된 쪽을 남긴다
      const byId = new Map(state.entries.map((e) => [e.id, e]));
      let added = 0;
      for (const e of incoming) {
        const cur = byId.get(e.id);
        if (!cur) added++;
        if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(e.id, e);
      }
      state.entries = [...byId.values()];
      persist();
      toast(`${incoming.length}개 기록을 불러왔어요 (새 기록 ${added}개)`);
    } catch (err) {
      console.error(err);
      toast('백업 파일을 읽지 못했습니다');
    }
  });
}

// ---------- Cross-tab sync ----------

window.addEventListener('storage', (ev) => {
  if (ev.key !== STORAGE_KEY) return;
  state.entries = store.load();
  render();
});

// ---------- PWA ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
}

// 브라우저가 저장 공간 부족 시 기록을 지우지 않도록 영구 저장을 요청한다
navigator.storage?.persist?.().catch(() => {});

bindEvents();
render();
