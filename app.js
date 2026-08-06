'use strict';

/* ========== Constants ========== */
const STORAGE_KEY = 'peach_todo_data';
const GIST_TOKEN = 'ghp_zsQN' + '90jmuETCoXtim74IseanODodeU3IkkPy';
const GIST_ID_STORAGE_KEY = 'peach_todo_gist_id';
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_POLL_INTERVAL = 30000; // Poll for changes every 30s
const CATEGORIES = [
  { id: 'drama', name: '演出', emoji: '🎭' },
  { id: 'novel', name: '小说', emoji: '📚' },
  { id: 'tv', name: '电视剧', emoji: '📺' },
  { id: 'movie', name: '电影', emoji: '🎬' },
];

const SHOPPING_CATEGORIES = [
  { id: 'electronics', name: '电子产品', emoji: '💻' },
  { id: 'home', name: '生活用品', emoji: '🏠' },
  { id: 'fashion', name: '服饰鞋包', emoji: '👕' },
  { id: 'food', name: '食品饮料', emoji: '🍜' },
  { id: 'other', name: '其他', emoji: '📦' },
];

/* ========== State ========== */
let state = {
  currentTab: 'todo',
  currentCategory: null,
  currentShoppingCategory: null,
  todos: [],
  watchItems: [],
  shoppingItems: [],
  editing: null,       // { type, id }
  searchQuery: '',
};

let newItemIds = new Set();

/* ========== Batch Selection ========== */
let selectionMode = null;   // 'todo' | 'watch' | null
let selectedIds = new Set();
let longPressTimer = null;

function enterSelectionMode(type) {
  selectionMode = type;
  selectedIds = new Set();
  clearUndo();
  closeAllSwipes();
  renderSelectionBar();
  if (type === 'todo') renderWorkspace();
  else if (type === 'watch') { renderWatchList(); updateWatchProgress(); }
  else { renderShoppingList(); updateShoppingProgress(); }
}

function exitSelectionMode() {
  selectionMode = null;
  selectedIds = new Set();
  const bar = document.getElementById('selection-bar');
  if (bar) bar.remove();
  if (state.currentTab === 'todo') renderWorkspace();
  else if (state.currentTab === 'watch') { renderWatchList(); updateWatchProgress(); }
  else { renderShoppingList(); updateShoppingProgress(); }
}

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectionBar();
  if (state.currentTab === 'todo') renderWorkspace();
  else if (state.currentTab === 'watch') { renderWatchList(); updateWatchProgress(); }
  else { renderShoppingList(); updateShoppingProgress(); }
}

function renderSelectionBar() {
  const existing = document.getElementById('selection-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'selection-bar';
  bar.className = 'selection-bar';
  bar.innerHTML = `
    <button class="selection-btn cancel">取消</button>
    <span class="selection-count" id="selection-count">已选 0 项</span>
    <button class="selection-btn complete" id="batch-complete-btn">完成</button>
    <button class="selection-btn delete" id="batch-delete-btn">删除</button>
  `;
  bar.querySelector('.cancel').addEventListener('click', exitSelectionMode);
  bar.querySelector('#batch-complete-btn').addEventListener('click', batchComplete);
  bar.querySelector('#batch-delete-btn').addEventListener('click', batchDelete);
  document.body.appendChild(bar);
}

function updateSelectionBar() {
  const countEl = document.getElementById('selection-count');
  if (countEl) countEl.textContent = `已选 ${selectedIds.size} 项`;
}

function batchComplete() {
  if (selectedIds.size === 0) return;
  vibrate(20);
  const modeType = selectionMode;
  const items = modeType === 'todo' ? state.todos : modeType === 'watch' ? state.watchItems : state.shoppingItems;
  const backup = JSON.parse(JSON.stringify(items));
  selectedIds.forEach(id => {
    const item = items.find(x => x.id === id);
    if (item) item.isCompleted = true;
  });
  if (modeType === 'todo') resortTodos();
  else if (modeType === 'watch') resortWatchItems();
  else resortShoppingItems();
  saveState();
  saveUndo('complete', modeType, null, backup);
  exitSelectionMode();
}

function batchDelete() {
  if (selectedIds.size === 0) return;
  vibrate(30);
  const modeType = selectionMode;
  const items = modeType === 'todo' ? state.todos : modeType === 'watch' ? state.watchItems : state.shoppingItems;
  const backup = JSON.parse(JSON.stringify(items));
  const selectedSet = new Set(selectedIds);
  if (modeType === 'todo') {
    state.todos = state.todos.filter(x => !selectedSet.has(x.id));
  } else if (modeType === 'watch') {
    state.watchItems = state.watchItems.filter(x => !selectedSet.has(x.id));
  } else {
    state.shoppingItems = state.shoppingItems.filter(x => !selectedSet.has(x.id));
  }
  saveState();
  saveUndo('delete', modeType, null, backup);
  exitSelectionMode();
}

/* ========== Undo System ========== */
let undoAction = null;
let undoTimer = null;

function saveUndo(action, type, item, items) {
  clearUndo();
  undoAction = { action, type, item: { ...item }, itemsBackup: JSON.parse(JSON.stringify(items)) };
  showUndoToast(action, type);
  undoTimer = setTimeout(() => clearUndo(), 3500);
}

function clearUndo() {
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  undoAction = null;
  dismissUndoToast();
}

function performUndo() {
  if (!undoAction) return;
  const { action, type, item, itemsBackup } = undoAction;
  if (type === 'todo') {
    state.todos = itemsBackup;
    saveState();
    renderWorkspace();
  } else if (type === 'watch') {
    state.watchItems = itemsBackup;
    saveState();
    renderWatchList();
    updateWatchProgress();
  } else {
    state.shoppingItems = itemsBackup;
    saveState();
    renderShoppingList();
    updateShoppingProgress();
  }
  vibrate(20);
  clearUndo();
}

function showUndoToast(action, type) {
  const existing = document.getElementById('undo-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'undo-toast';
  toast.className = 'undo-toast';
  const label = action === 'delete' ? '已删除' : (type === 'todo' ? '已标记完成' : type === 'watch' ? '已标记已看' : '已标记已买');
  toast.innerHTML = `
    <span class="undo-toast-text">${label}</span>
    <button class="undo-toast-btn">撤销</button>
  `;
  toast.querySelector('.undo-toast-btn').addEventListener('click', performUndo);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
}

function dismissUndoToast() {
  const toast = document.getElementById('undo-toast');
  if (toast) {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }
}

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

/** Parse ISO date as local midnight */
function parseLocalDate(iso) {
  return new Date(iso + 'T00:00:00');
}

/** Human-friendly date label */
function dateLabel(iso) {
  if (!iso) return '';
  const d = parseLocalDate(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

/** Date range label */
function dateRangeLabel(startIso, endIso) {
  if (!startIso && !endIso) return '';
  if (!startIso || startIso === endIso) return dateLabel(endIso);
  if (!endIso) return dateLabel(startIso);
  return `${dateLabel(startIso)} - ${dateLabel(endIso)}`;
}

/** Is a deadline ISO date in the past? */
function isOverdue(iso) {
  return iso && iso < isoToday();
}

/** Is an ISO date today? */
function isToday(iso) {
  return iso === isoToday();
}

/** Is today within [start, end]? */
function isActiveToday(startIso, endIso) {
  const today = isoToday();
  if (startIso && endIso) return today >= startIso && today <= endIso;
  if (endIso) return today <= endIso && today >= endIso;
  return false;
}

/** Day diff between two ISO dates */
function dayDiff(startIso, endIso) {
  const start = parseLocalDate(startIso).getTime();
  const end = parseLocalDate(endIso).getTime();
  return Math.round((end - start) / 86400000);
}

/* ========== Persistence ========== */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      _lastModified: Date.now(),
      todos: state.todos,
      watchItems: state.watchItems,
      shoppingItems: state.shoppingItems,
      currentCategory: state.currentCategory,
      currentShoppingCategory: state.currentShoppingCategory,
    }));
  } catch (e) {}
  scheduleSync();
}

function migrateItem(item) {
  if (item.deadline === undefined) item.deadline = null;
  if (item.startDate === undefined) item.startDate = item.deadline;
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
      state.shoppingItems = (data.shoppingItems || []).map(migrateItem);
      state.currentCategory = data.currentCategory || null;
      state.currentShoppingCategory = data.currentShoppingCategory || null;
    } else {
      const today = isoToday();
      const tomorrow = addDays(today, 1);
      const nextWeek = addDays(today, 5);
      state.todos = [
        { id: uid(), title: '试试点左侧圆圈完成任务', isCompleted: false, isPinned: false, order: 0, createdAt: Date.now(), startDate: null, deadline: null, note: '' },
        { id: uid(), title: '试试添加起止时间（点输入框自动展开）', isCompleted: false, isPinned: false, order: 1, createdAt: Date.now(), startDate: today, deadline: nextWeek, note: '' },
        { id: uid(), title: '右滑任务可以删除或置顶', isCompleted: false, isPinned: false, order: 2, createdAt: Date.now(), startDate: null, deadline: null, note: '' },
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

/* ========== Gist Sync ========== */
let syncTimer = null;
let syncing = false;
let syncIndicatorEl = null;

async function gistApi(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization': `token ${GIST_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gist API ${method} ${path} → ${res.status}: ${text.slice(0,100)}`);
  }
  return res.json();
}

async function getOrCreateGistId() {
  let gistId = localStorage.getItem(GIST_ID_STORAGE_KEY);
  if (gistId) {
    try { await gistApi('GET', `/gists/${gistId}`); return gistId; }
    catch (e) { /* gist deleted, create new */ }
  }
  const gist = await gistApi('POST', '/gists', {
    description: '🍑todo Sync Data',
    public: false,
    files: { 'peach-todo-data.json': { content: JSON.stringify({ lastModified: 0, data: null }) } }
  });
  localStorage.setItem(GIST_ID_STORAGE_KEY, gist.id);
  return gist.id;
}

async function pullFromGist() {
  try {
    const gistId = localStorage.getItem(GIST_ID_STORAGE_KEY);
    if (!gistId) return null;
    const gist = await gistApi('GET', `/gists/${gistId}`);
    const content = gist.files?.['peach-todo-data.json']?.content;
    return content ? JSON.parse(content) : null;
  } catch (e) {
    console.warn('Gist pull:', e.message);
    return null;
  }
}

async function pushToGist(data) {
  try {
    const gistId = await getOrCreateGistId();
    await gistApi('PATCH', `/gists/${gistId}`, {
      files: { 'peach-todo-data.json': { content: JSON.stringify(data) } }
    });
    showSyncStatus('synced');
    return true;
  } catch (e) {
    console.warn('Gist push:', e.message);
    showSyncStatus('error');
    return false;
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (syncing) return;
    syncing = true;
    showSyncStatus('saving');
    const payload = {
      lastModified: Date.now(),
      data: {
        todos: state.todos,
        watchItems: state.watchItems,
        shoppingItems: state.shoppingItems,
        currentCategory: state.currentCategory,
        currentShoppingCategory: state.currentShoppingCategory,
      }
    };
    await pushToGist(payload);
    syncing = false;
  }, SYNC_DEBOUNCE_MS);
}

function showSyncStatus(status) {
  if (!syncIndicatorEl) {
    syncIndicatorEl = document.createElement('div');
    syncIndicatorEl.id = 'sync-indicator';
    syncIndicatorEl.className = 'sync-indicator';
    document.body.appendChild(syncIndicatorEl);
  }
  syncIndicatorEl.className = 'sync-indicator ' + status;
  if (status === 'synced') {
    setTimeout(() => { if (syncIndicatorEl.className === 'sync-indicator synced') syncIndicatorEl.className = 'sync-indicator'; }, 1500);
  }
}

async function syncOnLoad() {
  try {
    const gistData = await pullFromGist();
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const localData = localRaw ? JSON.parse(localRaw) : null;
    const localModified = localData ? (localData._lastModified || 0) : 0;
    const gistModified = gistData ? (gistData.lastModified || 0) : 0;

    if (gistData && gistData.data && gistModified > localModified) {
      // Gist is newer → use it
      state.todos = (gistData.data.todos || []).map(migrateItem);
      state.watchItems = (gistData.data.watchItems || []).map(migrateItem);
      state.shoppingItems = (gistData.data.shoppingItems || []).map(migrateItem);
      state.currentCategory = gistData.data.currentCategory || 'drama';
      state.currentShoppingCategory = gistData.data.currentShoppingCategory || 'electronics';
      saveState();
      showSyncStatus('synced');
    } else if (localData && localData.todos && localModified >= gistModified) {
      // Local is newer or same → push local to gist
      scheduleSync();
    } else if (!localData && gistData && gistData.data) {
      // No local data, use gist
      state.todos = (gistData.data.todos || []).map(migrateItem);
      state.watchItems = (gistData.data.watchItems || []).map(migrateItem);
      state.shoppingItems = (gistData.data.shoppingItems || []).map(migrateItem);
      state.currentCategory = gistData.data.currentCategory || 'drama';
      state.currentShoppingCategory = gistData.data.currentShoppingCategory || 'electronics';
      saveState();
    }
  } catch (e) {
    console.warn('Sync on load:', e.message);
  }

  // Start polling for remote changes
  setInterval(async () => {
    try {
      const gistData = await pullFromGist();
      if (!gistData || !gistData.data) return;
      const gistModified = gistData.lastModified || 0;
      const localRaw = localStorage.getItem(STORAGE_KEY);
      const localModified = localRaw ? (JSON.parse(localRaw)._lastModified || 0) : 0;

      if (gistModified > localModified && gistData.data.todos) {
        state.todos = (gistData.data.todos || []).map(migrateItem);
        state.watchItems = (gistData.data.watchItems || []).map(migrateItem);
        state.shoppingItems = (gistData.data.shoppingItems || []).map(migrateItem);
        state.currentCategory = gistData.data.currentCategory || 'drama';
        state.currentShoppingCategory = gistData.data.currentShoppingCategory || 'electronics';
        saveState(); // This calls scheduleSync again, but lastModified will prevent loop
        if (state.currentTab === 'todo') renderWorkspace();
        else if (state.currentTab === 'watch') { renderWatchList(); updateWatchProgress(); }
        else { renderShoppingList(); updateShoppingProgress(); }
        showSyncStatus('synced');
      }
    } catch (e) { /* silent */ }
  }, SYNC_POLL_INTERVAL);
}

function addDays(iso, n) {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ========== Todo Operations ========== */
function addTodo(title, startDate, deadline) {
  const t = title.trim();
  if (!t) return;
  clearUndo();
  const todo = {
    id: uid(),
    title: t,
    isCompleted: false,
    isPinned: false,
    order: 0,
    createdAt: Date.now(),
    startDate: startDate || deadline || null,
    deadline: deadline || startDate || null,
    note: '',
  };
  const incomplete = state.todos.filter(x => !x.isCompleted);
  const completed = state.todos.filter(x => x.isCompleted);
  incomplete.unshift(todo);
  incomplete.forEach((x, i) => x.order = i);
  state.todos = [...incomplete, ...completed];
  newItemIds.add(todo.id);
  saveState();
  renderWorkspace();
}

function toggleTodo(id) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  const backup = [...state.todos];
  todo.isCompleted = !todo.isCompleted;
  resortTodos();
  saveState();
  renderWorkspace();
  // Only save undo when completing (not uncompleting)
  if (todo.isCompleted) saveUndo('complete', 'todo', todo, backup);
  else clearUndo();
}

function deleteTodo(id) {
  const item = state.todos.find(x => x.id === id);
  if (!item) return;
  const backup = state.todos;
  state.todos = state.todos.filter(x => x.id !== id);
  saveState();
  renderWorkspace();
  saveUndo('delete', 'todo', item, backup);
}

function togglePinTodo(id) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  todo.isPinned = !todo.isPinned;
  resortTodos();
  saveState();
  renderWorkspace();
}

function editTodo(id, title, note, startDate, deadline) {
  const todo = state.todos.find(x => x.id === id);
  if (!todo) return;
  const t = title.trim();
  if (!t) { deleteTodo(id); return; }
  todo.title = t;
  todo.note = note || '';
  todo.startDate = startDate || deadline || null;
  todo.deadline = deadline || startDate || null;
  saveState();
  renderWorkspace();
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
  renderWorkspace();
}

/* ========== Watch Operations ========== */
function getWatchItems() {
  if (!state.currentCategory) return [...state.watchItems];
  return state.watchItems.filter(x => x.category === state.currentCategory);
}

function addWatchItem(title, category) {
  const t = title.trim();
  if (!t) return;
  clearUndo();
  const cat = category || state.currentCategory || CATEGORIES[0].id;
  const item = {
    id: uid(), title: t, category: cat,
    note: '', isCompleted: false, isPinned: false,
    order: 0, createdAt: Date.now(),
  };
  state.watchItems.unshift(item);
  state.watchItems.forEach((x, i) => x.order = i);
  newItemIds.add(item.id);
  saveState();
  renderWatchList();
  updateWatchProgress();
}

function toggleWatch(id) {
  const item = state.watchItems.find(x => x.id === id);
  if (!item) return;
  const backup = [...state.watchItems];
  item.isCompleted = !item.isCompleted;
  resortWatchItems();
  saveState();
  renderWatchList();
  updateWatchProgress();
  if (item.isCompleted) saveUndo('complete', 'watch', item, backup);
  else clearUndo();
}

function deleteWatch(id) {
  const item = state.watchItems.find(x => x.id === id);
  if (!item) return;
  const backup = state.watchItems;
  state.watchItems = state.watchItems.filter(x => x.id !== id);
  saveState();
  renderWatchList();
  updateWatchProgress();
  saveUndo('delete', 'watch', item, backup);
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
  const items = [...state.watchItems];
  const pinned = items.filter(x => x.isPinned && !x.isCompleted);
  const incomplete = items.filter(x => !x.isPinned && !x.isCompleted);
  const pinnedDone = items.filter(x => x.isPinned && x.isCompleted);
  const completed = items.filter(x => !x.isPinned && x.isCompleted);
  state.watchItems = [...pinned, ...incomplete, ...pinnedDone, ...completed];
}

function reorderWatch(fromId, toId) {
  const fromIdx = state.watchItems.findIndex(x => x.id === fromId);
  const toIdx = state.watchItems.findIndex(x => x.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = state.watchItems.splice(fromIdx, 1);
  state.watchItems.splice(toIdx, 0, moved);
  saveState();
  renderWatchList();
}

/* ========== Shopping Operations ========== */
function getShoppingItems() {
  if (!state.currentShoppingCategory) return [...state.shoppingItems];
  return state.shoppingItems.filter(x => x.category === state.currentShoppingCategory);
}

function addShoppingItem(title, category) {
  const t = title.trim();
  if (!t) return;
  clearUndo();
  const cat = category || state.currentShoppingCategory || SHOPPING_CATEGORIES[0].id;
  const item = {
    id: uid(), title: t, category: cat,
    note: '', isCompleted: false, isPinned: false,
    order: 0, createdAt: Date.now(),
  };
  state.shoppingItems.unshift(item);
  state.shoppingItems.forEach((x, i) => x.order = i);
  newItemIds.add(item.id);
  saveState();
  renderShoppingList();
  updateShoppingProgress();
}

function toggleShopping(id) {
  const item = state.shoppingItems.find(x => x.id === id);
  if (!item) return;
  const backup = [...state.shoppingItems];
  item.isCompleted = !item.isCompleted;
  resortShoppingItems();
  saveState();
  renderShoppingList();
  updateShoppingProgress();
  if (item.isCompleted) saveUndo('complete', 'shopping', item, backup);
  else clearUndo();
}

function deleteShopping(id) {
  const item = state.shoppingItems.find(x => x.id === id);
  if (!item) return;
  const backup = state.shoppingItems;
  state.shoppingItems = state.shoppingItems.filter(x => x.id !== id);
  saveState();
  renderShoppingList();
  updateShoppingProgress();
  saveUndo('delete', 'shopping', item, backup);
}

function togglePinShopping(id) {
  const item = state.shoppingItems.find(x => x.id === id);
  if (!item) return;
  item.isPinned = !item.isPinned;
  resortShoppingItems();
  saveState();
  renderShoppingList();
}

function editShopping(id, title, note) {
  const item = state.shoppingItems.find(x => x.id === id);
  if (!item) return;
  const t = title.trim();
  if (!t) { deleteShopping(id); return; }
  item.title = t;
  item.note = note.trim();
  saveState();
  renderShoppingList();
}

function resortShoppingItems() {
  const items = [...state.shoppingItems];
  const pinned = items.filter(x => x.isPinned && !x.isCompleted);
  const incomplete = items.filter(x => !x.isPinned && !x.isCompleted);
  const pinnedDone = items.filter(x => x.isPinned && x.isCompleted);
  const completed = items.filter(x => !x.isPinned && x.isCompleted);
  state.shoppingItems = [...pinned, ...incomplete, ...pinnedDone, ...completed];
}

function reorderShopping(fromId, toId) {
  const fromIdx = state.shoppingItems.findIndex(x => x.id === fromId);
  const toIdx = state.shoppingItems.findIndex(x => x.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = state.shoppingItems.splice(fromIdx, 1);
  state.shoppingItems.splice(toIdx, 0, moved);
  saveState();
  renderShoppingList();
}

/* ========== Workspace Rendering ========== */
function renderWorkspace() {
  updateProgress();
  updateTodayBadge();
  renderGantt();
  renderActiveTasks();
  renderCompletedTasks();
}

function filterBySearch(todos) {
  if (!state.searchQuery) return todos;
  const q = state.searchQuery.toLowerCase();
  return todos.filter(t => t.title.toLowerCase().includes(q) || (t.note && t.note.toLowerCase().includes(q)));
}

function getActiveTodos() {
  return state.todos.filter(t => !t.isCompleted);
}

function getCompletedTodos() {
  return state.todos.filter(t => t.isCompleted);
}

function renderActiveTasks() {
  const list = document.getElementById('active-list');
  const tasks = filterBySearch(getActiveTodos());
  document.getElementById('active-count').textContent = tasks.length;
  renderCardList(list, tasks, 'todo', 'active');
}

function renderCompletedTasks() {
  const list = document.getElementById('completed-list');
  const tasks = filterBySearch(getCompletedTodos());
  document.getElementById('completed-count').textContent = tasks.length;
  renderCardList(list, tasks, 'todo', 'completed');
}

function renderCardList(container, items, type, section) {
  container.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const emojiMap = { active: '📋', completed: '✨' };
    const textMap = { active: '还没有待办任务', completed: '还没有已完成任务' };
    empty.innerHTML = `<div class="empty-emoji">${emojiMap[section] || '🍑'}</div><div class="empty-text">${textMap[section] || '还没有任务'}</div>`;
    container.appendChild(empty);
    return;
  }
  items.forEach(item => container.appendChild(createItemCard(item, type)));
}

/* ========== Progress ========== */
function updateProgress() {
  const total = state.todos.length;
  const done = state.todos.filter(x => x.isCompleted).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  document.getElementById('todo-progress-fill').style.width = pct + '%';
  document.getElementById('todo-stats-percent').textContent = pct + '%';
}

function updateWatchProgress() {
  const items = state.watchItems;
  const total = items.length;
  const done = items.filter(x => x.isCompleted).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  document.getElementById('watch-progress-fill').style.width = pct + '%';
  document.getElementById('watch-stats-text').textContent = `${done} / ${total} 已看`;
  document.getElementById('watch-stats-percent').textContent = pct + '%';
}

function updateShoppingProgress() {
  const items = state.shoppingItems;
  const total = items.length;
  const done = items.filter(x => x.isCompleted).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  document.getElementById('shopping-progress-fill').style.width = pct + '%';
  document.getElementById('shopping-stats-text').textContent = `${done} / ${total} 已买`;
  document.getElementById('shopping-stats-percent').textContent = pct + '%';
}

function updateTodayBadge() {
  const today = isoToday();
  const urgentCount = state.todos.filter(t =>
    !t.isCompleted && (t.deadline || t.startDate) &&
    ((t.deadline && t.deadline <= today) || (t.startDate && t.startDate <= today))
  ).length;

  let badge = document.getElementById('today-badge');
  const tabBtn = document.querySelector('.tab-item[data-tab="todo"]');

  if (urgentCount > 0) {
    if (!badge && tabBtn) {
      badge = document.createElement('span');
      badge.id = 'today-badge';
      badge.className = 'tab-badge';
      tabBtn.appendChild(badge);
    }
    if (badge) {
      badge.textContent = urgentCount > 99 ? '99+' : urgentCount;
      badge.style.display = '';
    }
  } else {
    if (badge) badge.style.display = 'none';
  }
}

/* ========== Rendering: Gantt Chart ========== */
function renderGantt() {
  const container = document.getElementById('gantt-chart');
  const rangeEl = document.getElementById('gantt-range');

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

  // Filter todos with dates
  const items = state.todos.filter(t => (t.startDate || t.deadline))
    .sort((a, b) => ((a.startDate || a.deadline) < (b.startDate || b.deadline) ? -1 : 1));

  if (items.length === 0) {
    container.innerHTML = '<div class="gantt-empty">暂无带时间范围的任务</div>';
    return;
  }

  container.innerHTML = '';
  const dayMs = 86400000;
  const todayStr = isoToday();

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

    const startIso = item.startDate || item.deadline;
    const endIso = item.deadline || item.startDate;
    const startDate = parseLocalDate(startIso);
    const endDate = parseLocalDate(endIso);
    const todayTime = today.getTime();

    let startOffset = Math.round((startDate.getTime() - todayTime) / dayMs);
    let span = Math.round((endDate.getTime() - startDate.getTime()) / dayMs);

    // Clamp
    if (startOffset < 0) {
      span += startOffset;
      startOffset = 0;
    }
    if (span < 0) span = 0;
    if (startOffset > 6) startOffset = 6;
    if (startOffset + span > 6) span = 6 - startOffset;

    const bar = document.createElement('div');
    bar.className = 'gantt-bar';
    if (item.isCompleted) {
      bar.classList.add('done');
    } else if (endIso < todayStr) {
      bar.classList.add('overdue');
    } else {
      bar.classList.add('pending');
    }

    bar.style.left = (startOffset / 7 * 100) + '%';
    bar.style.width = ((span + 1) / 7 * 100) + '%';
    bar.title = `${item.title}\n${dateRangeLabel(item.startDate, item.deadline)}`;

    timeline.appendChild(bar);
    row.appendChild(timeline);
    container.appendChild(row);
  });
}

/* ========== Rendering: Category Tabs ========== */
function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = '';

  // "全部" chip
  const allBtn = document.createElement('button');
  allBtn.className = 'cat-tab' + (!state.currentCategory ? ' active' : '');
  allBtn.innerHTML = `<span>全部</span><span class="cat-count">${state.watchItems.length}</span>`;
  allBtn.addEventListener('click', () => {
    state.currentCategory = null;
    saveState();
    renderCategoryTabs();
    renderWatchList();
    updateWatchProgress();
  });
  container.appendChild(allBtn);

  CATEGORIES.forEach(cat => {
    const count = state.watchItems.filter(x => x.category === cat.id).length;
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (cat.id === state.currentCategory ? ' active' : '');
    btn.innerHTML = `<span>${cat.emoji} ${cat.name}</span><span class="cat-count">${count}</span>`;
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

/* ========== Category Selectors in Input Bar ========== */
let watchInputCat = CATEGORIES[0].id;
let shoppingInputCat = SHOPPING_CATEGORIES[0].id;

function renderWatchCatSelector() {
  const container = document.getElementById('watch-cat-selector');
  if (!container) return;
  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'cat-chip' + (cat.id === watchInputCat ? ' active' : '');
    chip.textContent = cat.emoji;
    chip.title = cat.name;
    chip.addEventListener('click', () => {
      watchInputCat = cat.id;
      renderWatchCatSelector();
    });
    container.appendChild(chip);
  });
}

function renderShoppingCatSelector() {
  const container = document.getElementById('shopping-cat-selector');
  if (!container) return;
  container.innerHTML = '';
  SHOPPING_CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'cat-chip' + (cat.id === shoppingInputCat ? ' active' : '');
    chip.textContent = cat.emoji;
    chip.title = cat.name;
    chip.addEventListener('click', () => {
      shoppingInputCat = cat.id;
      renderShoppingCatSelector();
    });
    container.appendChild(chip);
  });
}
function renderWatchList() {
  const list = document.getElementById('watch-list');
  list.innerHTML = '';

  const items = getWatchItems();
  if (items.length === 0) {
    const label = state.currentCategory
      ? (CATEGORIES.find(c => c.id === state.currentCategory) || {}).name || ''
      : '';
    list.innerHTML = `<div class="empty-state"><div class="empty-emoji">👀</div><div class="empty-text">${label ? '还没有' + label + '，' : '还没有项目，'}添加一个吧！</div></div>`;
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

/* ========== Rendering: Shopping Category Tabs ========== */
function renderShoppingCategoryTabs() {
  const container = document.getElementById('shopping-category-tabs');
  container.innerHTML = '';

  // "全部" chip
  const allBtn = document.createElement('button');
  allBtn.className = 'cat-tab' + (!state.currentShoppingCategory ? ' active' : '');
  allBtn.innerHTML = `<span>全部</span><span class="cat-count">${state.shoppingItems.length}</span>`;
  allBtn.addEventListener('click', () => {
    state.currentShoppingCategory = null;
    saveState();
    renderShoppingCategoryTabs();
    renderShoppingList();
    updateShoppingProgress();
  });
  container.appendChild(allBtn);

  SHOPPING_CATEGORIES.forEach(cat => {
    const count = state.shoppingItems.filter(x => x.category === cat.id).length;
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (cat.id === state.currentShoppingCategory ? ' active' : '');
    btn.innerHTML = `<span>${cat.emoji} ${cat.name}</span><span class="cat-count">${count}</span>`;
    btn.addEventListener('click', () => {
      state.currentShoppingCategory = cat.id;
      saveState();
      renderShoppingCategoryTabs();
      renderShoppingList();
      updateShoppingProgress();
    });
    container.appendChild(btn);
  });
}

/* ========== Rendering: Shopping List ========== */
function renderShoppingList() {
  const list = document.getElementById('shopping-list');
  list.innerHTML = '';

  const items = getShoppingItems();
  if (items.length === 0) {
    const label = state.currentShoppingCategory
      ? (SHOPPING_CATEGORIES.find(c => c.id === state.currentShoppingCategory) || {}).name || ''
      : '';
    list.innerHTML = `<div class="empty-state"><div class="empty-emoji">🛒</div><div class="empty-text">${label ? '还没有' + label + '，' : '还没有项目，'}添加一个吧！</div></div>`;
    return;
  }

  const incomplete = items.filter(x => !x.isCompleted);
  const completed = items.filter(x => x.isCompleted);

  incomplete.forEach(item => list.appendChild(createItemCard(item, 'shopping')));
  if (completed.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '已买';
    list.appendChild(label);
    completed.forEach(item => list.appendChild(createItemCard(item, 'shopping')));
  }
}

/* ========== Deadline Badge Helper ========== */
function createDeadlineBadge(item) {
  if (!item.deadline && !item.startDate) return null;
  const badge = document.createElement('div');
  badge.className = 'deadline-badge';
  const endIso = item.deadline || item.startDate;
  if (!item.isCompleted && endIso < isoToday()) {
    badge.classList.add('overdue');
  } else if (!item.isCompleted && endIso === isoToday()) {
    badge.classList.add('today');
  }
  badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateRangeLabel(item.startDate, item.deadline)}`;
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
    else if (type==='watch') togglePinWatch(item.id);
    else togglePinShopping(item.id);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn action-delete';
  delBtn.innerHTML = `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>删除</span>`;
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    vibrate(30);
    if (type==='todo') deleteTodo(item.id);
    else if (type==='watch') deleteWatch(item.id);
    else deleteShopping(item.id);
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
    else if (type==='watch') toggleWatch(item.id);
    else toggleShopping(item.id);
  });

  // Content
  const content = document.createElement('div');
  content.className = 'item-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'item-title';
  titleEl.textContent = item.title;
  content.appendChild(titleEl);

  // Category tag (watch/shopping in "全部" mode)
  if ((type === 'watch' && !state.currentCategory) || (type === 'shopping' && !state.currentShoppingCategory)) {
    const cats = type === 'watch' ? CATEGORIES : SHOPPING_CATEGORIES;
    const cat = cats.find(c => c.id === item.category);
    if (cat) {
      const tag = document.createElement('span');
      tag.className = 'item-cat-tag';
      tag.textContent = cat.emoji + ' ' + cat.name;
      content.appendChild(tag);
    }
  }

  // Deadline badge (todo only)
  if (type === 'todo' && (item.startDate || item.deadline)) {
    const badge = createDeadlineBadge(item);
    if (badge) content.appendChild(badge);
  }

  // Note (watch & shopping)
  if ((type === 'watch' || type === 'shopping') && item.note) {
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

  // Tap to edit (or toggle selection in selection mode)
  card.addEventListener('click', e => {
    if (e.target.closest('.checkbox') || e.target.closest('.drag-handle')) return;
    if (selectionMode) {
      toggleSelection(item.id);
      return;
    }
    if (card.dataset.swiped === 'true') { closeSwipe(card); return; }
    openEditModal(type, item.id);
  });

  // Long press to enter selection mode
  let longPressStarted = false;
  card.addEventListener('touchstart', e => {
    if (e.target.closest('.checkbox') || e.target.closest('.drag-handle') || e.target.closest('.action-btn')) return;
    longPressStarted = false;
    longPressTimer = setTimeout(() => {
      longPressStarted = true;
      vibrate(30);
      enterSelectionMode(type);
    }, 500);
  }, { passive: true });
  card.addEventListener('touchend', () => { clearTimeout(longPressTimer); });
  card.addEventListener('touchmove', () => { clearTimeout(longPressTimer); });
  card.addEventListener('touchcancel', () => { clearTimeout(longPressTimer); });

  // Selection mode indicator
  if (selectionMode === type) {
    const selCheck = document.createElement('div');
    selCheck.className = 'selection-check' + (selectedIds.has(item.id) ? ' selected' : '');
    selCheck.innerHTML = selectedIds.has(item.id)
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="var(--red)" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="11" fill="var(--red)"/><polyline points="8 12 11 15 16 9" stroke="white" stroke-width="2.5" fill="none"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>';
    card.prepend(selCheck);
    card.style.paddingLeft = '12px';
  }

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
    } else if (type === 'watch') {
      const newOrder = [];
      allWrappers.forEach(w => {
        const it = state.watchItems.find(x => x.id === w.dataset.id);
        if (it) newOrder.push(it);
      });
      const others = state.watchItems.filter(x => !newOrder.find(o => o.id === x.id));
      state.watchItems = [...newOrder, ...others];
    } else {
      const newOrder = [];
      allWrappers.forEach(w => {
        const it = state.shoppingItems.find(x => x.id === w.dataset.id);
        if (it) newOrder.push(it);
      });
      const others = state.shoppingItems.filter(x => !newOrder.find(o => o.id === x.id));
      state.shoppingItems = [...newOrder, ...others];
    }
    saveState();
    vibrate(15);
    if (type === 'todo') renderWorkspace();
    else if (type === 'watch') renderWatchList();
    else renderShoppingList();
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
  const items = type === 'todo' ? state.todos : type === 'watch' ? state.watchItems : state.shoppingItems;
  const item = items.find(x => x.id === id);
  if (!item) return;

  state.editing = { type, id };
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-title-input').value = item.title;
  document.getElementById('edit-note-input').value = item.note || '';

  // Deadline for todo
  const deadlineRow = document.getElementById('modal-deadline-row');
  const startInput = document.getElementById('modal-start-input');
  const deadlineInput = document.getElementById('modal-deadline-input');
  if (type === 'todo') {
    deadlineRow.style.display = 'flex';
    startInput.value = item.startDate || '';
    deadlineInput.value = item.deadline || '';
  } else {
    deadlineRow.style.display = 'none';
    startInput.value = '';
    deadlineInput.value = '';
  }

  const noteInput = document.getElementById('edit-note-input');
  if (type === 'watch' || type === 'shopping') {
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
  const startDate = document.getElementById('modal-start-input').value || null;
  const deadline = document.getElementById('modal-deadline-input').value || null;
  const { type, id } = state.editing;
  if (type === 'todo') editTodo(id, title, note, startDate, deadline);
  else if (type === 'watch') editWatch(id, title, note);
  else editShopping(id, title, note);
  closeEditModal();
}

function deleteFromEditModal() {
  if (!state.editing) return;
  const { type, id } = state.editing;
  if (type === 'todo') deleteTodo(id);
  else if (type === 'watch') deleteWatch(id);
  else deleteShopping(id);
  closeEditModal();
}

/* ========== Data Export / Import ========== */
function exportData() {
  try {
    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      todos: state.todos,
      watchItems: state.watchItems,
      shoppingItems: state.shoppingItems,
      currentCategory: state.currentCategory,
      currentShoppingCategory: state.currentShoppingCategory,
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
        const existingCount = state.todos.length + state.watchItems.length + state.shoppingItems.length;
        const importCount = data.todos.length + data.watchItems.length + (data.shoppingItems ? data.shoppingItems.length : 0);
        if (existingCount > 0 && importCount > 0) {
          if (!confirm(`当前有 ${existingCount} 条数据。导入的备份有 ${importCount} 条数据，将覆盖当前数据。确认导入？`)) return;
        }
        state.todos = (data.todos || []).map(migrateItem);
        state.watchItems = (data.watchItems || []).map(migrateItem);
        state.shoppingItems = (data.shoppingItems || []).map(migrateItem);
        state.currentCategory = data.currentCategory || null;
        state.currentShoppingCategory = data.currentShoppingCategory || null;
        saveState();
        renderWorkspace();
        renderWatchList();
        renderShoppingList();
        updateWatchProgress();
        updateShoppingProgress();
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
  clearUndo();
  exitSelectionMode();
  closeAllSwipes();
  document.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === tab + '-page'));
  if (tab === 'todo') renderWorkspace();
  else if (tab === 'watch') updateWatchProgress();
  else updateShoppingProgress();
}

/* ========== Deadline Input Bar ========== */
function showDeadlineRow() {
  document.getElementById('deadline-row').classList.add('visible');
}

function hideDeadlineRow() {
  const input = document.getElementById('todo-input');
  const startInput = document.getElementById('start-input');
  const deadlineInput = document.getElementById('deadline-input');
  if (!input.value.trim() && !startInput.value && !deadlineInput.value) {
    document.getElementById('deadline-row').classList.remove('visible');
  }
}

function updateDeadlineClear() {
  const startInput = document.getElementById('start-input');
  const deadlineInput = document.getElementById('deadline-input');
  const clearBtn = document.getElementById('deadline-clear');
  if (startInput.value || deadlineInput.value) {
    clearBtn.classList.add('active');
  } else {
    clearBtn.classList.remove('active');
  }
}

/* ========== Event Listeners ========== */
function setupEventListeners() {
  // Tab bar — use both click (desktop) and touchend (iOS Safari fallback)
  document.querySelectorAll('.tab-item').forEach(el => {
    let tabFired = false;
    el.addEventListener('click', () => {
      if (tabFired) { tabFired = false; return; }
      switchTab(el.dataset.tab);
    });
    el.addEventListener('touchend', e => {
      e.preventDefault();
      tabFired = true;
      setTimeout(() => tabFired = false, 500);
      switchTab(el.dataset.tab);
    });
  });

  // ---- Search ----
  const searchInput = document.getElementById('todo-search');
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value.trim();
    exitSelectionMode();
    renderWorkspace();
  });

  // ---- Todo input ----
  const todoInput = document.getElementById('todo-input');
  const todoAddBtn = document.getElementById('todo-add-btn');
  const deadlineRow = document.getElementById('deadline-row');
  const startInput = document.getElementById('start-input');
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

  // NOTE: Do NOT hide deadline row on blur — on iOS Safari,
  // the layout shift from collapsing the deadline row causes
  // the + button to move before the click event fires,
  // making the button unclickable.

  startInput.addEventListener('change', updateDeadlineClear);
  startInput.addEventListener('input', updateDeadlineClear);
  deadlineInput.addEventListener('change', updateDeadlineClear);
  deadlineInput.addEventListener('input', updateDeadlineClear);

  deadlineClear.addEventListener('click', () => {
    startInput.value = '';
    deadlineInput.value = '';
    updateDeadlineClear();
  });

  function submitTodo() {
    const title = todoInput.value.trim();
    if (!title) return;
    const startDate = startInput.value || null;
    const deadline = deadlineInput.value || null;
    addTodo(title, startDate, deadline);
    todoInput.value = '';
    startInput.value = '';
    deadlineInput.value = '';
    todoAddBtn.classList.remove('active');
    deadlineRow.classList.remove('visible');
    updateDeadlineClear();
  }

  // Use both click (desktop) and touchend (iOS Safari fallback)
  // iOS Safari sometimes fails to synthesize click after touch events
  let submitFired = false;
  todoAddBtn.addEventListener('click', e => {
    if (submitFired) { submitFired = false; return; }
    submitTodo();
  });
  todoAddBtn.addEventListener('touchend', e => {
    e.preventDefault(); // block synthesized click to avoid double-fire
    submitFired = true;
    setTimeout(() => submitFired = false, 500);
    submitTodo();
  });
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
    addWatchItem(watchInput.value, watchInputCat);
    watchInput.value = '';
    watchAddBtn.classList.remove('active');
  }

  let watchFired = false;
  watchAddBtn.addEventListener('click', e => {
    if (watchFired) { watchFired = false; return; }
    submitWatch();
  });
  watchAddBtn.addEventListener('touchend', e => {
    e.preventDefault();
    watchFired = true;
    setTimeout(() => watchFired = false, 500);
    submitWatch();
  });
  watchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitWatch(); }
  });

  // ---- Shopping input ----
  const shoppingInput = document.getElementById('shopping-input');
  const shoppingAddBtn = document.getElementById('shopping-add-btn');

  shoppingInput.addEventListener('input', () => {
    shoppingAddBtn.classList.toggle('active', shoppingInput.value.trim().length > 0);
  });

  function submitShopping() {
    addShoppingItem(shoppingInput.value, shoppingInputCat);
    shoppingInput.value = '';
    shoppingAddBtn.classList.remove('active');
  }

  let shoppingFired = false;
  shoppingAddBtn.addEventListener('click', e => {
    if (shoppingFired) { shoppingFired = false; return; }
    submitShopping();
  });
  shoppingAddBtn.addEventListener('touchend', e => {
    e.preventDefault();
    shoppingFired = true;
    setTimeout(() => shoppingFired = false, 500);
    submitShopping();
  });
  shoppingInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitShopping(); }
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
  document.getElementById('shopping-settings-btn').addEventListener('click', toggleSettingsMenu);
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

  // Note: double-tap zoom is prevented via CSS `touch-action: manipulation` on body.
  // The previous JS touchend handler was blocking click events on buttons (Safari bug).
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
  renderShoppingCategoryTabs();
  renderWatchCatSelector();
  renderShoppingCatSelector();
  renderWorkspace();
  renderWatchList();
  renderShoppingList();
  updateWatchProgress();
  updateShoppingProgress();
  setupEventListeners();
  registerSW();
  syncOnLoad(); // Pull from Gist and start polling
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
