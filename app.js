'use strict';

/* ========== Constants ========== */
const STORAGE_KEY = 'peach_todo_data';
const CATEGORIES = [
  { id: 'drama', name: '舞剧话剧', emoji: '🎭' },
  { id: 'novel', name: '小说', emoji: '📚' },
  { id: 'tv', name: '电视剧', emoji: '📺' },
  { id: 'movie', name: '电影', emoji: '🎬' },
];

/* ========== State ========== */
let state = {
  currentTab: 'todo',
  currentCategory: 'drama',
  todos: [],
  watchItems: [],
  editing: null,       // { type, id }
  pendingDeadline: null, // ISO date string for the input bar deadline
};

let newItemIds = new Set();

/* ========== Utility ========== */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function formatDate() {
  const d = new Date();
  const days = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  return `${d.getMonth()+1}月${d.getDate()}日 ${days[d.getDay()]}`;
}

/** Return today at midnight local time as ISO date string YYYY-MM-DD */
function isoToday() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

/** Human-friendly deadline label */
function dateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
}

/** Is a deadline ISO date in the past? */
function isOverdue(iso) {
  return iso && iso < isoToday();
}

/** Is a deadline ISO date today? */
function isToday(iso) {
  return iso === isoToday();
}

/* ========== Persistence ========== */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      todos: state.todos,
      watchItems: state.watchItems,
      currentCategory: state.currentCategory,
    }));
  } catch (e) {}
}

function migrateItem(item) {
  if (item.deadline === undefined) item.deadline = null;
  if (item.note === undefined) item.note = '';
  return item;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.todos = (data.todos || []).map(migrateItem);
      state.watchItems = (data.watchItems || []).map(migrateItem);
      state.currentCategory = data.currentCategory || 'drama';
    } else {
      const today = isoToday();
      state.todos = [
        { id: uid(), title: '欢迎来到 🍑todo！', isCompleted: false, isPinned: false, order: 0, createdAt: Date.now(), deadline: null, note: '' },
        { id: uid(), title: '点击左侧圆圈完成任务', isCompleted: false, isPinned: false, order: 1, createdAt: Date.now(), deadline: null, note: '' },
        { id: uid(), title: '试试添加截止时间 ⏰', isCompleted: false, isPinned: false, order: 2, createdAt: Date.now(), deadline: today, note: '' },
      ];
      state.watchItems = [
        { id: uid(), title: '茶馆', category: 'drama', note: '北京人艺', isCompleted: false, isPinned: true, order: 0, createdAt: Date.now() },
        { id: uid(), title: '三体', category: 'novel', note: '刘慈欣', isCompleted: false, isPinned: false, order: 0, createdAt: Date.now() },
        { id: uid(), title: '繁花', category: 'tv', note: '王家卫导演', isCompleted: false, isPinned: false, order: 0, createdAt: Date.now() },
        { id: uid(), title: '沙丘2', category: 'movie', note: 'Denis Villeneuve', isCompleted: false, isPinned: false, order: 0, createdAt: Date.now() },
      ];
      saveState();
    }
  } catch (e) { console.error('loadState:', e); }
}

/* ========== Todo Operations ========== */
function addTodo(title, deadline) {
  const t = title.trim();
  if (!t) return;
  const todo = {
    id: uid(),
    title: t,
    isCompleted: false,
    isPinned: false,
    order: 0,
    createdAt: Date.now(),
    deadline: deadline || null,
    note: '',
  };
  const incomplete = state.todos.filter(x => !x.isCompleted);
  const completed = state.todos.filter(x => x.isCompleted);
  incomplete.unshift(todo);
  incomplete.forEach((x, i) => x.order = i);
  state.todos = [...incomplete, ...completed];
  newItemIds.add(todo.id);
  saveState();
  renderTodoList();
  updateProgress();
  renderGantt();
}

function toggleTodo(id) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  todo.isCompleted = !todo.isCompleted;
  resortTodos();
  saveState();
  renderTodoList();
  updateProgress();
  renderGantt();
}

function deleteTodo(id) {
  state.todos = state.todos.filter(x => x.id !== id);
  saveState();
  renderTodoList();
  updateProgress();
  renderGantt();
}

function togglePinTodo(id) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  todo.isPinned = !todo.isPinned;
  resortTodos();
  saveState();
  renderTodoList();
}

function editTodo(id, title, note, deadline) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  const t = title.trim();
  if (!t) { deleteTodo(id); return; }
  todo.title = t;
  todo.note = note || '';
  todo.deadline = deadline || null;
  saveState();
  renderTodoList();
  updateProgress();
  renderGantt();
}

function resortTodos() {
  const pinned = state.todos.filter(x => x.isPinned && !x.isCompleted);
  const incomplete = state.todos.filter(x => !x.isPinned && !x.isCompleted);
  const pinnedDone = state.todos.filter(x => x.isPinned && x.isCompleted);
  const completed = state.todos.filter(x => !x.isPinned && x.isCompleted);
  state.todos = [...pinned, ...incomplete, ...pinnedDone, ...completed];
}

function reorderTodos(fromId, toId) {
  const fromIdx = state.todos.findIndex(x => x.id === fromId);
  const toIdx = state.todos.findIndex(x => x.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = state.todos.splice(fromIdx, 1);
  state.todos.splice(toIdx, 0, moved);
  saveState();
  renderTodoList();
}

/* ========== Watch Operations ========== */
function getWatchItems() {
  return state.watchItems.filter(x => x.category === state.currentCategory);
}

function addWatchItem(title) {
  const t = title.trim();
  if (!t) return;
  const item = {
    id: uid(), title: t, category: state.currentCategory,
    note: '', isCompleted: false, isPinned: false,
    order: 0, createdAt: Date.now(),
  };
  const items = getWatchItems();
  items.unshift(item);
  items.forEach((x, i) => x.order = i);
  newItemIds.add(item.id);
  saveState();
  renderWatchList();
  updateWatchProgress();
}

function toggleWatch(id) {
  const item = state.watchItems.find(x => x.id === id);
  if (!item) return;
  item.isCompleted = !item.isCompleted;
  resortWatchItems();
  saveState();
  renderWatchList();
  updateWatchProgress();
}

function deleteWatch(id) {
  state.watchItems = state.watchItems.filter(x => x.id !== id);
  saveState();
  renderWatchList();
  updateWatchProgress();
}

function togglePinWatch(id) {
  const item = state.watchItems.find(x => x.id === id);
  if (!item) return;
  item.isPinned = !item.isPinned;
  resortWatchItems();
  saveState();
  renderWatchList();
}

function editWatch(id, title, note) {
  const item = state.watchItems.find(x => x.id === id);
  if (!item) return;
  const t = title.trim();
  if (!t) { deleteWatch(id); return; }
  item.title = t;
  item.note = note.trim();
  saveState();
  renderWatchList();
}

function resortWatchItems() {
  const cat = state.currentCategory;
  const items = state.watchItems.filter(x => x.category === cat);
  const pinned = items.filter(x => x.isPinned && !x.isCompleted);
  const incomplete = items.filter(x => !x.isPinned && !x.isCompleted);
  const pinnedDone = items.filter(x => x.isPinned && x.isCompleted);
  const completed = items.filter(x => !x.isPinned && x.isCompleted);
  const reordered = [...pinned, ...incomplete, ...pinnedDone, ...completed];
  const others = state.watchItems.filter(x => x.category !== cat);
  state.watchItems = [...others, ...reordered];
}

function reorderWatch(fromId, toId) {
  const items = getWatchItems();
  const fromIdx = items.findIndex(x => x.id === fromId);
  const toIdx = items.findIndex(x => x.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);
  const others = state.watchItems.filter(x => x.category !== state.currentCategory);
  state.watchItems = [...others, ...items];
  saveState();
  renderWatchList();
}

/* ========== Rendering: Progress ========== */
function updateProgress() {
  const total = state.todos.length;
  const done = state.todos.filter(x => x.isCompleted).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  document.getElementById('todo-progress-fill').style.width = pct + '%';
  document.getElementById('todo-stats-text').textContent = `${done} / ${total} 已完成`;
  document.getElementById('todo-stats-percent').textContent = pct + '%';
}

function updateWatchProgress() {
  const items = getWatchItems();
  const total = items.length;
  const done = items.filter(x => x.isCompleted).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  document.getElementById('watch-progress-fill').style.width = pct + '%';
  document.getElementById('watch-stats-text').textContent = `${done} / ${total} 已看`;
  document.getElementById('watch-stats-percent').textContent = pct + '%';
}

/* ========== Rendering: Gantt Chart ========== */
function renderGantt() {
  const container = document.getElementById('gantt-chart');
  const rangeEl = document.getElementById('gantt-range');
  const section = document.getElementById('gantt-section');

  // 7-day range starting today
  const today = new Date();
  today.setHours(0,0,0,0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const fmtMD = d => `${d.getMonth()+1}/${d.getDate()}`;
  rangeEl.textContent = `${fmtMD(days[0])} - ${fmtMD(days[6])}`;

  // Filter incomplete todos with deadlines
  const items = state.todos.filter(t => t.deadline && !t.isCompleted)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));

  if (items.length === 0) {
    container.innerHTML = '<div class="gantt-empty">暂无带截止日期的任务</div>';
    return;
  }

  container.innerHTML = '';

  // Day header row
  const headerRow = document.createElement('div');
  headerRow.className = 'gantt-row gantt-header-row';

  const headerLabel = document.createElement('div');
  headerLabel.className = 'gantt-row-label';
  headerRow.appendChild(headerLabel);

  const headerTimeline = document.createElement('div');
  headerTimeline.className = 'gantt-row-timeline';
  const dayNames = ['日','一','二','三','四','五','六'];
  days.forEach((d, i) => {
    const dayEl = document.createElement('div');
    dayEl.className = 'gantt-day' + (i === 0 ? ' today' : '');
    const lbl = document.createElement('div');
    lbl.className = 'gantt-day-label';
    lbl.textContent = `${fmtMD(d)} ${dayNames[d.getDay()]}`;
    dayEl.appendChild(lbl);
    headerTimeline.appendChild(dayEl);
  });
  headerRow.appendChild(headerTimeline);
  container.appendChild(headerRow);

  // Task rows
  const todayStr = isoToday();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'gantt-row';

    const label = document.createElement('div');
    label.className = 'gantt-row-label';
    label.textContent = item.title;
    label.title = item.title;
    row.appendChild(label);

    const timeline = document.createElement('div');
    timeline.className = 'gantt-row-timeline';

    days.forEach((d, i) => {
      const dayEl = document.createElement('div');
      dayEl.className = 'gantt-day' + (i === 0 ? ' today' : '');
      timeline.appendChild(dayEl);
    });

    // Position bar
    const deadlineDate = new Date(item.deadline + 'T00:00:00');
    const deadlineTime = deadlineDate.getTime();
    const todayTime = today.getTime();
    const dayMs = 86400000;

    let dayIndex;
    if (deadlineTime < todayTime) {
      dayIndex = 0;
    } else {
      dayIndex = Math.round((deadlineTime - todayTime) / dayMs);
      if (dayIndex > 6) dayIndex = 6;
    }

    const bar = document.createElement('div');
    bar.className = 'gantt-bar';
    if (item.deadline < todayStr) {
      bar.classList.add('overdue');
    } else {
      bar.classList.add('pending');
    }

    bar.style.left = (dayIndex / 7 * 100) + '%';
    bar.style.width = (100 / 7) + '%';
    bar.title = `${item.title}\n截止: ${item.deadline}`;

    timeline.appendChild(bar);
    row.appendChild(timeline);
    container.appendChild(row);
  });
}

/* ========== Rendering: Category Tabs ========== */
function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (cat.id === state.currentCategory ? ' active' : '');
    btn.innerHTML = `<span class="cat-emoji">${cat.emoji}</span><span>${cat.name}</span>`;
    btn.addEventListener('click', () => {
      state.currentCategory = cat.id;
      saveState();
      renderCategoryTabs();
      renderWatchList();
      updateWatchProgress();
    });
    container.appendChild(btn);
  });
}

/* ========== Rendering: Todo List ========== */
function renderTodoList() {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';

  if (state.todos.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-emoji">🍑</div><div class="empty-text">还没有任务，添加一个吧！</div></div>';
    return;
  }

  const incomplete = state.todos.filter(x => !x.isCompleted);
  const completed = state.todos.filter(x => x.isCompleted);

  incomplete.forEach(todo => list.appendChild(createItemCard(todo, 'todo')));

  if (completed.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '已完成';
    list.appendChild(label);
    completed.forEach(todo => list.appendChild(createItemCard(todo, 'todo')));
  }
}

/* ========== Rendering: Watch List ========== */
function renderWatchList() {
  const list = document.getElementById('watch-list');
  list.innerHTML = '';

  const items = getWatchItems();
  if (items.length === 0) {
    const cat = CATEGORIES.find(c => c.id === state.currentCategory);
    list.innerHTML = `<div class="empty-state"><div class="empty-emoji">${cat?cat.emoji:'🍑'}</div><div class="empty-text">还没有${cat?cat.name:''}，添加一个吧！</div></div>`;
    return;
  }

  const incomplete = items.filter(x => !x.isCompleted);
  const completed = items.filter(x => x.isCompleted);

  incomplete.forEach(item => list.appendChild(createItemCard(item, 'watch')));
  if (completed.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '已看';
    list.appendChild(label);
    completed.forEach(item => list.appendChild(createItemCard(item, 'watch')));
  }
}

/* ========== Deadline Badge Helper ========== */
function createDeadlineBadge(iso) {
  if (!iso) return null;
  const badge = document.createElement('div');
  badge.className = 'deadline-badge';
  if (iso < isoToday()) {
    badge.classList.add('overdue');
  } else if (iso === isoToday()) {
    badge.classList.add('today');
  }
  badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateLabel(iso)}`;
  return badge;
}

/* ========== Item Card Factory ========== */
function createItemCard(item, type) {
  const wrapper = document.createElement('div');
  wrapper.className = 'item-wrapper';
  wrapper.dataset.id = item.id;
  wrapper.dataset.type = type;

  if (newItemIds.has(item.id)) {
    wrapper.classList.add('new');
    newItemIds.delete(item.id);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const pinBtn = document.createElement('button');
  pinBtn.className = 'action-btn action-pin';
  pinBtn.innerHTML = `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-3V8a3 3 0 0 0-3-3h-5a3 3 0 0 0-3 3v6z"/></svg><span>${item.isPinned?'取消置顶':'置顶'}</span>`;
  pinBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (type==='todo') togglePinTodo(item.id);
    else togglePinWatch(item.id);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn action-delete';
  delBtn.innerHTML = `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>删除</span>`;
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    vibrate(30);
    if (type==='todo') deleteTodo(item.id);
    else deleteWatch(item.id);
  });

  actions.appendChild(pinBtn);
  actions.appendChild(delBtn);
  wrapper.appendChild(actions);

  // Card
  const card = document.createElement('div');
  card.className = 'item-card' + (item.isCompleted ? ' completed' : '');

  // Checkbox
  const checkbox = document.createElement('button');
  checkbox.className = 'checkbox' + (item.isCompleted ? ' checked' : '');
  checkbox.innerHTML = `<svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  checkbox.addEventListener('click', e => {
    e.stopPropagation();
    checkbox.classList.add('pulsing');
    vibrate(15);
    setTimeout(() => checkbox.classList.remove('pulsing'), 300);
    if (type==='todo') toggleTodo(item.id);
    else toggleWatch(item.id);
  });

  // Content
  const content = document.createElement('div');
  content.className = 'item-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'item-title';
  titleEl.textContent = item.title;
  content.appendChild(titleEl);

  // Deadline badge (todo only)
  if (type === 'todo' && item.deadline) {
    const badge = createDeadlineBadge(item.deadline);
    if (badge) content.appendChild(badge);
  }

  // Note (watch only)
  if (type === 'watch' && item.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'item-note';
    noteEl.textContent = item.note;
    content.appendChild(noteEl);
  }

  // Pin badge
  if (item.isPinned) {
    const pin = document.createElement('div');
    pin.className = 'pin-badge';
    pin.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 4V2H10v2H6v6l3 1v6l3-1 3 1v-6l3-1V4z"/></svg>`;
    card.appendChild(checkbox);
    card.appendChild(content);
    card.appendChild(pin);
  } else {
    card.appendChild(checkbox);
    card.appendChild(content);
  }

  // Drag handle
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;
  card.appendChild(handle);

  // Tap to edit
  card.addEventListener('click', e => {
    if (e.target.closest('.checkbox') || e.target.closest('.drag-handle')) return;
    if (card.dataset.swiped === 'true') { closeSwipe(card); return; }
    openEditModal(type, item.id);
  });

  wrapper.appendChild(card);

  setupSwipe(wrapper, card, type);
  setupDragReorder(wrapper, card, handle, type);

  return wrapper;
}

/* ========== Swipe to Reveal Actions ========== */
let swipedOpenCard = null;

function closeSwipe(card) {
  if (!card) return;
  card.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
  card.style.transform = '';
  card.dataset.swiped = 'false';
  if (swipedOpenCard === card) swipedOpenCard = null;
}

function closeAllSwipes() {
  if (swipedOpenCard) closeSwipe(swipedOpenCard);
}

function setupSwipe(wrapper, card, type) {
  const ACTION_WIDTH = 144;
  let startX=0, startY=0, currentX=0, isDragging=false, isSwiping=false;

  card.addEventListener('touchstart', e => {
    if (e.target.closest('.drag-handle')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    isDragging = true;
    isSwiping = false;
    card.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (!isDragging) return;
    if (e.target.closest('.drag-handle')) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!isSwiping) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isSwiping = true;
        if (swipedOpenCard && swipedOpenCard !== card) closeSwipe(swipedOpenCard);
      } else if (Math.abs(dy) > 8) { isDragging = false; return; }
    }
    if (isSwiping) {
      e.preventDefault();
      const baseOffset = card.dataset.swiped === 'true' ? -ACTION_WIDTH : 0;
      currentX = Math.min(0, Math.max(-ACTION_WIDTH, baseOffset + dx));
      card.style.transform = `translateX(${currentX}px)`;
    }
  }, { passive: false });

  card.addEventListener('touchend', () => {
    if (!isSwiping) { isDragging = false; return; }
    isDragging = false; isSwiping = false;
    card.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    if (currentX < -ACTION_WIDTH/2) {
      card.style.transform = `translateX(${-ACTION_WIDTH}px)`;
      card.dataset.swiped = 'true';
      swipedOpenCard = card;
    } else {
      card.style.transform = '';
      card.dataset.swiped = 'false';
      if (swipedOpenCard === card) swipedOpenCard = null;
    }
    currentX = 0;
  });
}

/* ========== Drag to Reorder ========== */
function setupDragReorder(wrapper, card, handle, type) {
  let startY=0, currentY=0, isDragging=false, listItems=[], itemHeight=0;

  handle.addEventListener('touchstart', e => {
    e.preventDefault(); e.stopPropagation();
    isDragging = true;
    startY = e.touches[0].clientY;
    itemHeight = wrapper.getBoundingClientRect().height;
    closeAllSwipes();
    card.classList.add('dragging');
    vibrate(20);
    const list = wrapper.parentElement;
    listItems = Array.from(list.querySelectorAll('.item-wrapper')).filter(w => w !== wrapper);
    card.style.transition = 'none';
  }, { passive: false });

  handle.addEventListener('touchmove', e => {
    if (!isDragging) return;
    e.preventDefault(); e.stopPropagation();
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    card.style.transform = `translateY(${deltaY}px)`;
    const cardRect = card.getBoundingClientRect();
    const cardCenter = cardRect.top + cardRect.height/2;
    listItems.forEach(sibling => {
      const sibRect = sibling.getBoundingClientRect();
      const sibCenter = sibRect.top + sibRect.height/2;
      const parent = wrapper.parentElement;
      if (deltaY > 0 && cardCenter > sibCenter && sibling.getBoundingClientRect().top < cardRect.top) {
        parent.insertBefore(sibling, wrapper);
        listItems = Array.from(parent.querySelectorAll('.item-wrapper')).filter(w => w !== wrapper);
      } else if (deltaY < 0 && cardCenter < sibCenter && sibling.getBoundingClientRect().top > cardRect.top) {
        parent.insertBefore(wrapper, sibling);
        listItems = Array.from(parent.querySelectorAll('.item-wrapper')).filter(w => w !== wrapper);
      }
    });
  }, { passive: false });

  handle.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove('dragging');
    card.style.transition = '';
    card.style.transform = '';
    const list = wrapper.parentElement;
    const allWrappers = Array.from(list.querySelectorAll('.item-wrapper'));
    if (type === 'todo') {
      const newOrder = [];
      allWrappers.forEach(w => {
        const t = state.todos.find(x => x.id === w.dataset.id);
        if (t) newOrder.push(t);
      });
      if (newOrder.length > 0) state.todos = newOrder;
    } else {
      const catItems = [];
      allWrappers.forEach(w => {
        const it = state.watchItems.find(x => x.id === w.dataset.id);
        if (it) catItems.push(it);
      });
      const others = state.watchItems.filter(x => x.category !== state.currentCategory);
      state.watchItems = [...others, ...catItems];
    }
    saveState();
    vibrate(15);
    if (type === 'todo') renderTodoList();
    else renderWatchList();
  });

  handle.addEventListener('touchcancel', () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove('dragging');
    card.style.transition = '';
    card.style.transform = '';
  });
}

/* ========== Edit Modal ========== */
function openEditModal(type, id) {
  const items = type === 'todo' ? state.todos : state.watchItems;
  const item = items.find(x => x.id === id);
  if (!item) return;

  state.editing = { type, id };
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-title-input').value = item.title;
  document.getElementById('edit-note-input').value = item.note || '';

  // Deadline for todo
  const deadlineRow = document.getElementById('modal-deadline-row');
  const deadlineInput = document.getElementById('modal-deadline-input');
  if (type === 'todo') {
    deadlineRow.style.display = 'flex';
    deadlineInput.value = item.deadline || '';
  } else {
    deadlineRow.style.display = 'none';
    deadlineInput.value = '';
  }

  const noteInput = document.getElementById('edit-note-input');
  if (type === 'watch') {
    noteInput.style.display = '';
  } else {
    noteInput.style.display = 'none';
  }

  modal.classList.add('show');
  setTimeout(() => document.getElementById('edit-title-input').focus(), 300);
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('show');
  state.editing = null;
}

function saveEditModal() {
  if (!state.editing) return;
  const title = document.getElementById('edit-title-input').value;
  const note = document.getElementById('edit-note-input').value;
  const deadline = document.getElementById('modal-deadline-input').value || null;
  const { type, id } = state.editing;
  if (type === 'todo') editTodo(id, title, note, deadline);
  else editWatch(id, title, note);
  closeEditModal();
}

function deleteFromEditModal() {
  if (!state.editing) return;
  const { type, id } = state.editing;
  if (type === 'todo') deleteTodo(id);
  else deleteWatch(id);
  closeEditModal();
}

/* ========== Data Export / Import ========== */
function exportData() {
  try {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      todos: state.todos,
      watchItems: state.watchItems,
      currentCategory: state.currentCategory,
    };
    const blob = new Blob([JSON.stringify(data,null,2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peach-todo-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    vibrate(20);
    showToast('数据已导出！');
  } catch (e) { showToast('导出失败，请重试'); }
}

function importData(file) {
  try {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.todos || !data.watchItems) { showToast('文件格式不正确'); return; }
        const existingCount = state.todos.length + state.watchItems.length;
        const importCount = data.todos.length + data.watchItems.length;
        if (existingCount > 0 && importCount > 0) {
          if (!confirm(`当前有 ${existingCount} 条数据。导入的备份有 ${importCount} 条数据，将覆盖当前数据。确认导入？`)) return;
        }
        state.todos = (data.todos || []).map(migrateItem);
        state.watchItems = (data.watchItems || []).map(migrateItem);
        state.currentCategory = data.currentCategory || 'drama';
        saveState();
        renderTodoList();
        renderWatchList();
        renderGantt();
        updateProgress();
        updateWatchProgress();
        vibrate(30);
        showToast(`已导入 ${importCount} 条数据！`);
      } catch (err) { showToast('文件解析失败，请检查文件格式'); }
    };
    reader.readAsText(file);
  } catch (e) { showToast('导入失败，请重试'); }
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2000);
}

/* ========== Settings Menu ========== */
function toggleSettingsMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('settings-menu');
  const isOpen = menu.classList.contains('show');
  closeAllSwipes();
  if (isOpen) { menu.classList.remove('show'); }
  else { menu.classList.add('show'); }
}

/* ========== Tab Switching ========== */
function switchTab(tab) {
  state.currentTab = tab;
  closeAllSwipes();
  document.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === tab + '-page'));
  if (tab === 'todo') updateProgress();
  else updateWatchProgress();
}

/* ========== Deadline Input Bar ========== */
function showDeadlineRow() {
  document.getElementById('deadline-row').classList.add('visible');
}

function hideDeadlineRow() {
  // Only hide if input is empty and no deadline selected
  const input = document.getElementById('todo-input');
  const deadlineInput = document.getElementById('deadline-input');
  if (!input.value.trim() && !deadlineInput.value) {
    document.getElementById('deadline-row').classList.remove('visible');
  }
}

function updateDeadlineClear() {
  const input = document.getElementById('deadline-input');
  const clearBtn = document.getElementById('deadline-clear');
  if (input.value) {
    clearBtn.classList.add('active');
  } else {
    clearBtn.classList.remove('active');
  }
}

/* ========== Event Listeners ========== */
function setupEventListeners() {
  // Tab bar
  document.querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // ---- Todo input ----
  const todoInput = document.getElementById('todo-input');
  const todoAddBtn = document.getElementById('todo-add-btn');
  const deadlineRow = document.getElementById('deadline-row');
  const deadlineInput = document.getElementById('deadline-input');
  const deadlineClear = document.getElementById('deadline-clear');

  todoInput.addEventListener('input', () => {
    const hasText = todoInput.value.trim().length > 0;
    todoAddBtn.classList.toggle('active', hasText);
    if (hasText) showDeadlineRow();
  });

  todoInput.addEventListener('focus', () => {
    if (todoInput.value.trim().length > 0) showDeadlineRow();
  });

  todoInput.addEventListener('blur', () => {
    setTimeout(() => hideDeadlineRow(), 150);
  });

  deadlineInput.addEventListener('change', updateDeadlineClear);
  deadlineInput.addEventListener('input', updateDeadlineClear);

  deadlineClear.addEventListener('click', () => {
    deadlineInput.value = '';
    updateDeadlineClear();
  });

  function submitTodo() {
    const title = todoInput.value.trim();
    if (!title) return;
    const deadline = deadlineInput.value || null;
    addTodo(title, deadline);
    todoInput.value = '';
    deadlineInput.value = '';
    todoAddBtn.classList.remove('active');
    deadlineRow.classList.remove('visible');
    updateDeadlineClear();
  }

  todoAddBtn.addEventListener('click', submitTodo);
  todoInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitTodo(); }
  });

  // ---- Watch input ----
  const watchInput = document.getElementById('watch-input');
  const watchAddBtn = document.getElementById('watch-add-btn');

  watchInput.addEventListener('input', () => {
    watchAddBtn.classList.toggle('active', watchInput.value.trim().length > 0);
  });

  function submitWatch() {
    addWatchItem(watchInput.value);
    watchInput.value = '';
    watchAddBtn.classList.remove('active');
  }

  watchAddBtn.addEventListener('click', submitWatch);
  watchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitWatch(); }
  });

  // ---- Modal ----
  document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);
  document.getElementById('edit-save-btn').addEventListener('click', saveEditModal);
  document.getElementById('edit-delete-btn').addEventListener('click', deleteFromEditModal);
  document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEditModal();
  });

  // ---- Global ----
  document.addEventListener('click', e => {
    if (!e.target.closest('.item-card') && !e.target.closest('.item-actions')) closeAllSwipes();
    if (!e.target.closest('.settings-btn') && !e.target.closest('.settings-menu')) {
      document.getElementById('settings-menu').classList.remove('show');
    }
  });

  // ---- Settings ----
  document.getElementById('todo-settings-btn').addEventListener('click', toggleSettingsMenu);
  document.getElementById('watch-settings-btn').addEventListener('click', toggleSettingsMenu);
  document.getElementById('export-data-btn').addEventListener('click', () => {
    exportData();
    document.getElementById('settings-menu').classList.remove('show');
  });
  document.getElementById('import-data-btn').addEventListener('click', () => {
    document.getElementById('settings-menu').classList.remove('show');
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  // Prevent double-tap zoom
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

/* ========== PWA Service Worker ========== */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ========== Init ========== */
function init() {
  loadState();
  document.getElementById('todo-date').textContent = formatDate();
  renderCategoryTabs();
  renderTodoList();
  renderWatchList();
  renderGantt();
  updateProgress();
  updateWatchProgress();
  setupEventListeners();
  registerSW();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
