// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Replace with your Google OAuth Client ID after setting up Google Cloud project
const GOOGLE_CLIENT_ID = '1039983743372-jd8ucsoagkevsras0s9c2g3mqvk7jq6g.apps.googleusercontent.com';
const DRIVE_FILE_NAME  = 'spellbound-data.json';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata';

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentBookId  = null;
let currentEssayId = null;
let books          = [];
let highlights     = [];
let essays         = [];
let wishlist       = [];
let gapiReady      = false;
let gisReady       = false;
let tokenClient;

// ─── INDEXEDDB ────────────────────────────────────────────────────────────────
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('SpellBoundDB', 2);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books'))      d.createObjectStore('books',      { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('highlights')) d.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('essays'))     d.createObjectStore('essays',     { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('wishlist'))   d.createObjectStore('wishlist',   { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta'))       d.createObjectStore('meta',       { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(store, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbClear(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGetMeta(key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror   = () => reject(req.error);
  });
}

function dbSetMeta(key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('meta', 'readwrite');
    const req = tx.objectStore('meta').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1;
}

// ─── LOAD / SAVE LOCAL DATA ───────────────────────────────────────────────────
async function loadData() {
  books      = await dbGetAll('books');
  highlights = await dbGetAll('highlights');
  essays     = await dbGetAll('essays');
  wishlist   = await dbGetAll('wishlist');
}

async function saveAndSync() {
  await loadData();
  syncToDrive().catch(() => {});
}

// ─── GOOGLE DRIVE SYNC ────────────────────────────────────────────────────────
function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({});
    gapiReady = true;
    maybeInitSync();
  });
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope:     DRIVE_SCOPE,
    callback:  '',
  });
  gisReady = true;
  maybeInitSync();
}

function maybeInitSync() {
  if (!gapiReady || !gisReady) return;
  updateSyncStatus('Tap to sign in with Google ↗', true);
  tokenClient.callback = async resp => {
    if (resp.error) { updateSyncStatus('Tap to sign in with Google ↗', true); return; }
    await syncFromDrive();
  };
  tokenClient.requestAccessToken({ prompt: '' });
}

function signIn() {
  tokenClient.callback = async resp => {
    if (resp.error) { updateSyncStatus('Sign-in failed', true); return; }
    await syncFromDrive();
  };
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function updateSyncStatus(msg, isError) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sync-status' + (isError ? ' sync-error' : ' sync-ok');
}

async function getDriveFileId() {
  const res   = await gapi.client.request({
    path:   'https://www.googleapis.com/drive/v3/files',
    method: 'GET',
    params: { spaces: 'appDataFolder', q: `name='${DRIVE_FILE_NAME}'`, fields: 'files(id,modifiedTime)' }
  });
  const files = res.result.files;
  return files.length > 0 ? files[0] : null;
}

async function syncFromDrive() {
  updateSyncStatus('Syncing…');
  try {
    const file = await getDriveFileId();
    if (file) {
      const res  = await gapi.client.request({
        path:   `https://www.googleapis.com/drive/v3/files/${file.id}`,
        method: 'GET',
        params: { alt: 'media' }
      });
      const data = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
      await dbClear('books');
      await dbClear('highlights');
      await dbClear('essays');
      await dbClear('wishlist');
      for (const b of (data.books      || [])) await dbPut('books',      b);
      for (const h of (data.highlights || [])) await dbPut('highlights', h);
      for (const e of (data.essays     || [])) await dbPut('essays',     e);
      for (const w of (data.wishlist   || [])) await dbPut('wishlist',   w);
      if (data.waitlistOrder) await dbSetMeta('waitlist-order', data.waitlistOrder);
      await loadData();
      refreshCurrentView();
      updateSyncStatus('Synced ' + new Date().toLocaleTimeString());
    } else {
      await syncToDrive();
    }
  } catch (err) {
    updateSyncStatus('Sync failed', true);
    console.error('syncFromDrive error', err);
  }
}

async function syncToDrive() {
  if (!gapiReady || !gapi.client.getToken()) return;
  try {
    const waitlistOrder = await dbGetMeta('waitlist-order') || [];
    const payload  = JSON.stringify({ books, highlights, essays, wishlist, waitlistOrder });
    const file     = await getDriveFileId();
    const method   = file ? 'PATCH' : 'POST';
    const fileId   = file ? `/${file.id}` : '';
    const metaObj  = file ? { name: DRIVE_FILE_NAME } : { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
    const boundary = 'spellbound_boundary';
    const body     = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metaObj)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
    await gapi.client.request({
      path:    `https://www.googleapis.com/upload/drive/v3/files${fileId}`,
      method,
      params:  { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    updateSyncStatus('Saved ' + new Date().toLocaleTimeString());
  } catch (err) {
    updateSyncStatus('Save failed', true);
    console.error('syncToDrive error', err);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatDate(date) {
  if (!date) return '';
  const d   = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${mon}-${d.getFullYear()}`;
}

const COVER_COLORS = {
  'Fiction':        '#7B3B3B',
  'History':        '#5C4A1E',
  'Politics':       '#2C4A6E',
  'Philosophy':     '#4A2C6E',
  'Graphic Novels': '#1E5C4A'
};
function getCoverColor(cat) { return COVER_COLORS[cat] || '#3a5a8c'; }

const MEDIUM_ICON = { kindle: '📱', audiobook: '🎧' };
function getMediumIcon(medium) { return MEDIUM_ICON[medium] || ''; }

function refreshCurrentView() {
  const active = document.querySelector('.view:not(.hidden)');
  if (!active) return;
  const id = active.id;
  if      (id === 'home-view')           loadHome();
  else if (id === 'books-view')          loadBooks();
  else if (id === 'highlights-view')     loadHighlights();
  else if (id === 'essays-view')         loadEssays();
  else if (id === 'book-detail-view'   && currentBookId)  openBook(currentBookId);
  else if (id === 'essay-detail-view'  && currentEssayId) openEssay(currentEssayId);
  else if (id === 'wishlist-view')       loadWishlist();
}

async function saveWaitlistOrder(order) {
  await dbSetMeta('waitlist-order', order);
  syncToDrive().catch(() => {});
}

function makeDraggableList(listEl, onReorder) {
  function getAfterElement(y) {
    const els = [...listEl.querySelectorAll('.home-waitlist-item:not(.dragging)')];
    return els.reduce((closest, el) => {
      const box    = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, el } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).el;
  }

  let dragging = null;

  listEl.querySelectorAll('.home-waitlist-item').forEach(item => {
    const handle = item.querySelector('.drag-handle');

    // Mouse drag (desktop)
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', e => {
      dragging = item;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      dragging = null;
      const order = [...listEl.querySelectorAll('.home-waitlist-item')].map(el => parseInt(el.dataset.id));
      await onReorder(order);
    });

    // Touch drag (mobile)
    handle.addEventListener('touchstart', () => {
      dragging = item;
      item.classList.add('dragging');
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!dragging) return;
      const after = getAfterElement(e.touches[0].clientY);
      if (after == null) listEl.appendChild(dragging);
      else listEl.insertBefore(dragging, after);
    }, { passive: false });
    handle.addEventListener('touchend', async () => {
      if (!dragging) return;
      item.classList.remove('dragging');
      dragging = null;
      const order = [...listEl.querySelectorAll('.home-waitlist-item')].map(el => parseInt(el.dataset.id));
      await onReorder(order);
    });
  });

  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragging) return;
    const after = getAfterElement(e.clientY);
    if (after == null) listEl.appendChild(dragging);
    else listEl.insertBefore(dragging, after);
  });
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function showView(view) {
  if (view !== 'book-detail')  currentBookId  = null;
  if (view !== 'essay-detail') currentEssayId = null;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(view + '-view').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.getElementById('nav-' + view);
  if (navBtn) navBtn.classList.add('active');
  if (view === 'home')       loadHome();
  if (view === 'books')      loadBooks();
  if (view === 'highlights') loadHighlights();
  if (view === 'essays')     loadEssays();
  if (view === 'wishlist')   loadWishlist();
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
async function loadHome() {
  const readingBooks     = books.filter(b => b.status === 'Reading');
  const waitlistedBooks  = books.filter(b => b.status === 'Waitlisted');
  const recentHighlights = highlights.slice(-5).reverse();

  document.getElementById('reading-books').innerHTML =
    '<h2 class="home-section-title">Currently Reading</h2>' +
    (readingBooks.length === 0
      ? '<p class="home-empty">Nothing on the go yet.</p>'
      : `<div class="home-covers">${readingBooks.map(b =>
          `<div class="book-cover" onclick="openBook(${b.id})" style="background-color:${getCoverColor(b.category)}">
            <div class="book-cover-spine"></div>
            <div class="book-cover-body">
              <h3 class="book-cover-title">${b.title}</h3>
              <p class="book-cover-category">${b.category}</p>
            </div>
            ${getMediumIcon(b.medium) ? `<span class="book-cover-medium">${getMediumIcon(b.medium)}</span>` : ''}
            ${b.rating && RATING_LABELS[b.rating] ? `<span class="book-cover-rating">${RATING_LABELS[b.rating].icon}</span>` : ''}
          </div>`).join('')}</div>`);

  document.getElementById('recent-highlights').innerHTML =
    '<h2 class="home-section-title">Recent Highlights</h2>' +
    (recentHighlights.length === 0
      ? '<p class="home-empty">No highlights saved yet.</p>'
      : recentHighlights.map(h => {
          const book = books.find(b => b.id === h.bookId);
          return `<div class="home-quote-card" onclick="openBook(${h.bookId})">
            <span class="home-quote-mark">&ldquo;</span>
            <p class="home-quote-text">${h.text}</p>
            <p class="home-quote-source">&mdash; ${book ? book.title : 'Unknown'}</p>
          </div>`;
        }).join(''));

  // Sort waitlist by saved order
  const savedOrder = await dbGetMeta('waitlist-order') || [];
  const ordered = [
    ...savedOrder.map(id => waitlistedBooks.find(b => b.id === id)).filter(Boolean),
    ...waitlistedBooks.filter(b => !savedOrder.includes(b.id))
  ];

  const waitlistContainer = document.getElementById('waitlisted-books');
  waitlistContainer.innerHTML = '<h2 class="home-section-title">Waitlisted</h2>';
  if (ordered.length === 0) {
    waitlistContainer.innerHTML += '<p class="home-empty">Nothing waiting.</p>';
  } else {
    const listEl = document.createElement('div');
    listEl.id = 'waitlisted-books-list';
    listEl.innerHTML = ordered.map(b =>
      `<div class="home-waitlist-item" data-id="${b.id}">
        <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        <div class="home-waitlist-spine" style="background-color:${getCoverColor(b.category)}"></div>
        <div class="home-waitlist-info" onclick="openBook(${b.id})">
          <span class="home-waitlist-title">${b.title}</span>
          ${b.author ? `<span class="home-waitlist-author">${b.author}</span>` : ''}
          <span class="home-waitlist-category">${b.category}</span>
        </div>
      </div>`).join('');
    waitlistContainer.appendChild(listEl);
    makeDraggableList(listEl, saveWaitlistOrder);
  }
}

// ─── BOOKS ────────────────────────────────────────────────────────────────────
function loadBooks() {
  const STATUS_ORDER   = ['Reading', 'Waitlisted', 'Paused', 'Completed'];
  const statusFilter   = document.getElementById('books-status-filter').value;
  const categoryFilter = document.getElementById('books-category-filter').value;
  let html = '';
  STATUS_ORDER.forEach(status => {
    if (statusFilter && status !== statusFilter) return;
    let group = books.filter(b => b.status === status);
    if (categoryFilter) group = group.filter(b => b.category === categoryFilter);
    if (group.length === 0) return;
    html += `
      <div class="books-group">
        <h2 class="books-group-heading">${status}<span class="books-group-count">${group.length}</span></h2>
        <div class="home-covers">
          ${group.map(b => `
            <div class="book-cover" onclick="openBook(${b.id})" style="background-color:${getCoverColor(b.category)}">
              <div class="book-cover-spine"></div>
              <div class="book-cover-body">
                <h3 class="book-cover-title">${b.title}</h3>
                <p class="book-cover-category">${b.category}</p>
              </div>
              ${getMediumIcon(b.medium) ? `<span class="book-cover-medium">${getMediumIcon(b.medium)}</span>` : ''}
              ${b.rating && RATING_LABELS[b.rating] ? `<span class="book-cover-rating">${RATING_LABELS[b.rating].icon}</span>` : ''}
              <button onclick="handleDeleteBook(${b.id}, event)" class="delete-btn book-cover-delete" title="Delete">&#128465;</button>
            </div>`).join('')}
        </div>
      </div>`;
  });
  document.getElementById('books-list').innerHTML = html || '<p class="home-empty">No books match the selected filters.</p>';
}

function openBook(id) {
  currentBookId = id;
  const book  = books.find(b => b.id === id);
  const color = getCoverColor(book.category);

  document.getElementById('book-title').innerHTML = `
    <div class="book-detail-header" style="border-left:6px solid ${color}">
      <div class="book-detail-header-top">
        <div>
          <h2 class="book-detail-title">${book.title}</h2>
          ${book.author ? `<p class="book-detail-author">${book.author}</p>` : ''}
          <div class="book-detail-pills">
            <span class="book-pill book-status-${book.status.replace(' ','-').toLowerCase()}">${book.status}</span>
            <span class="book-pill book-pill-category">${book.category}</span>
            ${getMediumIcon(book.medium) ? `<span class="book-pill book-pill-medium">${getMediumIcon(book.medium)} ${book.medium.charAt(0).toUpperCase() + book.medium.slice(1)}</span>` : ''}
            ${book.rating && RATING_LABELS[book.rating] ? `<span class="book-pill book-pill-rating">${RATING_LABELS[book.rating].icon} ${RATING_LABELS[book.rating].label}</span>` : ''}
          </div>
        </div>
        <div class="book-detail-icon-btns">
          <button class="icon-btn" onclick="showEditBookForm()" title="Edit">&#9998;</button>
          <button class="icon-btn icon-btn-delete" onclick="handleDeleteBook(currentBookId, event)" title="Delete">&#128465;</button>
        </div>
      </div>
    </div>`;

  const metaItems = [];
  if (book.dateCompleted)      metaItems.push(`<div class="book-meta-item"><span class="book-meta-label">Date Completed</span><span>${formatDate(book.dateCompleted)}</span></div>`);
  if (book.notes)              metaItems.push(`<div class="book-meta-item"><span class="book-meta-label">Notes</span><span>${book.notes}</span></div>`);
  if (book.aftertaste)         metaItems.push(`<div class="book-meta-item"><span class="book-meta-label">Aftertaste</span><span>${book.aftertaste}</span></div>`);
  if (book.favouriteCharacter) metaItems.push(`<div class="book-meta-item"><span class="book-meta-label">Favourite Character</span><span>${book.favouriteCharacter}</span></div>`);
  document.getElementById('book-metadata').innerHTML   = metaItems.length ? `<div class="book-meta-grid">${metaItems.join('')}</div>` : '';
  document.getElementById('book-reflection').innerHTML = '';

  const bookHighlights = highlights.filter(h => h.bookId === id);
  document.getElementById('highlights-list').innerHTML = bookHighlights.length === 0
    ? '<p class="home-empty" style="margin-top:1rem;">No highlights yet.</p>'
    : `<h3 class="book-highlights-heading">Highlights</h3>` + bookHighlights.map(h => `
      <div class="hl-quote-card" style="border-left-color:${color}">
        <span class="hl-quote-mark">&ldquo;</span>
        <p class="hl-quote-text">${h.text}</p>
        ${h.whyItStayed ? `<p class="hl-quote-why">${h.whyItStayed}</p>` : ''}
        ${h.date ? `<p class="hl-quote-date">${formatDate(h.date)}</p>` : ''}
        <button onclick="handleDeleteHighlight(${h.id}, event)" class="delete-btn hl-delete" title="Delete">&#128465;</button>
      </div>`).join('');

  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('book-detail-view').classList.remove('hidden');
}

// ─── GOOGLE BOOKS LOOKUP ─────────────────────────────────────────────────────
const CATEGORY_MAP = [
  [/graphic|comic|manga/i,          'Graphic Novels'],
  [/histor/i,                        'History'],
  [/politic|government/i,            'Politics'],
  [/philosoph/i,                     'Philosophy'],
  [/fiction/i,                       'Fiction'],
];

function mapCategory(googleCats) {
  if (!googleCats || googleCats.length === 0) return 'Non-Fiction';
  const joined = googleCats.join(' ');
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(joined)) return cat;
  }
  return 'Non-Fiction';
}

let _lookupTimer   = null;
let _categoryManualAdd  = false;
let _categoryManualEdit = false;

function markCategoryManual(form) {
  if (form === 'add')  _categoryManualAdd  = true;
  if (form === 'edit') _categoryManualEdit = true;
}

function debounceBookLookup(form) {
  clearTimeout(_lookupTimer);
  const titleEl = document.getElementById(form === 'add' ? 'book-title-input' : 'edit-book-title');
  const sugEl   = document.getElementById(form === 'add' ? 'add-book-suggestions' : 'edit-book-suggestions');
  const title   = titleEl.value.trim();
  if (title.length < 2) { sugEl.classList.add('hidden'); sugEl.innerHTML = ''; return; }
  sugEl.classList.remove('hidden');
  sugEl.innerHTML = '<p class="book-lookup-loading">Looking up…</p>';
  _lookupTimer = setTimeout(() => fetchGoogleBooks(title, form), 2000);
}

function triggerEditBookLookup() {
  const title = document.getElementById('edit-book-title').value.trim();
  if (!title) return;
  const sugEl = document.getElementById('edit-book-suggestions');
  sugEl.classList.remove('hidden');
  sugEl.innerHTML = '<p class="book-lookup-loading">Looking up…</p>';
  fetchGoogleBooks(title, 'edit');
}

async function fetchGoogleBooks(title, form) {
  const sugEl = document.getElementById(form === 'add' ? 'add-book-suggestions' : 'edit-book-suggestions');
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(title)}&maxResults=5&fields=items(volumeInfo(title,authors,categories,imageLinks))`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      sugEl.innerHTML = '<p class="book-lookup-loading">No results found.</p>';
      return;
    }
    renderBookSuggestions(data.items, form, sugEl);
  } catch {
    sugEl.innerHTML = '<p class="book-lookup-loading">Lookup failed.</p>';
  }
}

function renderBookSuggestions(items, form, sugEl) {
  const cards = items.map((item, i) => {
    const v       = item.volumeInfo || {};
    const title   = v.title || '';
    const author  = (v.authors || []).join(', ');
    const cat     = mapCategory(v.categories);
    const thumb   = v.imageLinks?.thumbnail?.replace('http://', 'https://') || '';
    return `<div class="book-suggestion-card" onclick="applyBookSuggestion(${i}, '${form}')">
      ${thumb ? `<img class="book-sug-thumb" src="${thumb}" alt="">` : `<div class="book-sug-thumb book-sug-thumb-placeholder"></div>`}
      <div class="book-sug-info">
        <div class="book-sug-title">${title}</div>
        ${author ? `<div class="book-sug-author">${author}</div>` : ''}
        <div class="book-sug-category">${cat}</div>
      </div>
    </div>`;
  }).join('');
  sugEl.innerHTML = cards +
    `<button type="button" class="book-sug-none" onclick="document.getElementById('${form === 'add' ? 'add' : 'edit'}-book-suggestions').classList.add('hidden')">None of these</button>`;
  // stash data for apply
  sugEl._suggestions = items.map(item => {
    const v = item.volumeInfo || {};
    return {
      title:    v.title || '',
      author:   (v.authors || []).join(', '),
      category: mapCategory(v.categories),
      coverUrl: v.imageLinks?.thumbnail?.replace('http://', 'https://') || '',
    };
  });
}

function applyBookSuggestion(index, form) {
  const sugEl = document.getElementById(form === 'add' ? 'add-book-suggestions' : 'edit-book-suggestions');
  const s     = sugEl._suggestions[index];
  if (!s) return;
  if (form === 'add') {
    document.getElementById('book-title-input').value   = s.title;
    document.getElementById('book-author-input').value  = s.author;
    if (!_categoryManualAdd) {
      document.getElementById('book-category-input').value = s.category;
      toggleAddBookFields();
    }
  } else {
    document.getElementById('edit-book-title').value      = s.title;
    document.getElementById('edit-book-author').value     = s.author;
    if (!_categoryManualEdit) {
      document.getElementById('edit-book-category').value = s.category;
      toggleCompletionFields();
    }
  }
  sugEl.classList.add('hidden');
}

// ─── ADD BOOK ─────────────────────────────────────────────────────────────────
function showAddBookForm() {
  _categoryManualAdd = false;
  document.getElementById('add-book-suggestions').classList.add('hidden');
  document.getElementById('add-book-form').classList.remove('hidden');
  document.getElementById('add-book-form').style.display = 'flex';
  toggleAddBookFields();
}

function toggleAddBookFields() {
  const status   = document.getElementById('book-status-input').value;
  const category = document.getElementById('book-category-input').value;
  document.getElementById('add-book-completion-fields').style.display = status === 'Completed' ? 'block' : 'none';
  const showFav = category === 'Fiction' || category === 'Graphic Novels';
  document.getElementById('add-book-fav-char-field').style.display = showFav ? 'block' : 'none';
}

async function addBook(event) {
  event.preventDefault();
  const book = {
    id:                 nextId(books),
    title:              document.getElementById('book-title-input').value,
    author:             document.getElementById('book-author-input').value,
    status:             document.getElementById('book-status-input').value,
    category:           document.getElementById('book-category-input').value,
    rating:             document.querySelector('#add-book-rating-group .rating-btn.active')?.dataset.value || '',
    medium:             document.querySelector('#add-book-medium-group .medium-btn.active')?.dataset.value || '',,
    dateCompleted:      document.getElementById('book-date-completed-input').value,
    notes:              document.getElementById('book-notes-input').value,
    aftertaste:         document.getElementById('book-aftertaste-input').value,
    favouriteCharacter: document.getElementById('book-fav-char-input').value,
  };
  await dbPut('books', book);
  hideForm();
  ['book-title-input','book-author-input','book-notes-input','book-aftertaste-input','book-fav-char-input','book-date-completed-input'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('book-status-input').value   = 'Reading';
  document.getElementById('book-category-input').value = 'Fiction';
  document.getElementById('add-book-completion-fields').style.display = 'none';
  document.getElementById('add-book-fav-char-field').style.display    = 'none';
  setMediumBtn('#add-book-medium-group', '');
  setRatingBtn('#add-book-rating-group', '');
  await saveAndSync();
  loadBooks();
}

// ─── EDIT BOOK ────────────────────────────────────────────────────────────────
function showEditBookForm() {
  _categoryManualEdit = false;
  const book = books.find(b => b.id === currentBookId);
  if (!book) return;
  document.getElementById('edit-book-title').value          = book.title;
  document.getElementById('edit-book-author').value         = book.author || '';
  document.getElementById('edit-book-status').value         = book.status;
  document.getElementById('edit-book-category').value       = book.category;
  document.getElementById('edit-book-notes').value          = book.notes || '';
  document.getElementById('edit-book-aftertaste').value     = book.aftertaste || '';
  document.getElementById('edit-book-fav-char').value       = book.favouriteCharacter || '';
  document.getElementById('edit-book-date-completed').value = book.dateCompleted || '';
  setMediumBtn('#edit-book-medium-group', book.medium || '');
  setRatingBtn('#edit-book-rating-group', book.rating || '');
  toggleCompletionFields();
  document.getElementById('edit-book-form').classList.remove('hidden');
  document.getElementById('edit-book-form').style.display = 'flex';
}

function toggleCompletionFields() {
  const status   = document.getElementById('edit-book-status').value;
  const category = document.getElementById('edit-book-category').value;
  document.getElementById('completion-fields').style.display = status === 'Completed' ? 'block' : 'none';
  const showFav = category === 'Fiction' || category === 'Graphic Novels';
  document.getElementById('edit-book-fav-char-field').style.display = showFav ? 'block' : 'none';
}

async function updateBook(event) {
  event.preventDefault();
  const book = {
    id:                 currentBookId,
    title:              document.getElementById('edit-book-title').value,
    author:             document.getElementById('edit-book-author').value,
    status:             document.getElementById('edit-book-status').value,
    category:           document.getElementById('edit-book-category').value,
    rating:             document.querySelector('#edit-book-rating-group .rating-btn.active')?.dataset.value || '',
    medium:             document.querySelector('#edit-book-medium-group .medium-btn.active')?.dataset.value || '',
    notes:              document.getElementById('edit-book-notes').value,
    aftertaste:         document.getElementById('edit-book-aftertaste').value,
    favouriteCharacter: document.getElementById('edit-book-fav-char').value,
    dateCompleted:      document.getElementById('edit-book-date-completed').value,
  };
  await dbPut('books', book);
  hideForm();
  await saveAndSync();
  openBook(currentBookId);
}

function handleDeleteBook(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (confirm('Delete this book and all its highlights?')) deleteBookConfirmed(id);
}

async function deleteBookConfirmed(id) {
  await dbDelete('books', id);
  const toDelete = highlights.filter(h => h.bookId === id);
  for (const h of toDelete) await dbDelete('highlights', h.id);
  await saveAndSync();
  if (currentBookId === id) showView('books');
  else loadBooks();
}

// ─── HIGHLIGHTS ───────────────────────────────────────────────────────────────
function loadHighlights() {
  const search         = (document.getElementById('highlight-search').value || '').toLowerCase();
  const categoryFilter = document.getElementById('highlight-category-filter').value;
  let filtered = highlights;
  if (categoryFilter) {
    const ids = books.filter(b => b.category === categoryFilter).map(b => b.id);
    filtered  = filtered.filter(h => ids.includes(h.bookId));
  }
  if (search) filtered = filtered.filter(h => h.text.toLowerCase().includes(search));
  const container = document.getElementById('all-highlights');
  if (filtered.length === 0) { container.innerHTML = '<p class="home-empty">No highlights match your search.</p>'; return; }
  container.innerHTML = filtered.map(h => {
    const book = books.find(b => b.id === h.bookId);
    const col  = book ? getCoverColor(book.category) : '#3a5a8c';
    return `<div class="hl-quote-card" onclick="openBook(${h.bookId})" style="border-left-color:${col}">
      <span class="hl-quote-mark">&ldquo;</span>
      <p class="hl-quote-text">${h.text}</p>
      <p class="hl-quote-source">&mdash; ${book ? book.title : 'Unknown'}${book ? ` <span class="hl-quote-category">${book.category}</span>` : ''}</p>
      ${h.whyItStayed ? `<p class="hl-quote-why">${h.whyItStayed}</p>` : ''}
      ${h.date ? `<p class="hl-quote-date">${formatDate(h.date)}</p>` : ''}
      ${h.location || h.kindleDate ? `<p class="hl-kindle-meta">${[h.location, h.kindleDate].filter(Boolean).join(' &middot; ')}</p>` : ''}
      <button onclick="handleDeleteHighlight(${h.id}, event)" class="delete-btn hl-delete" title="Delete">&#128465;</button>
    </div>`;
  }).join('');
}

function showAddHighlightForm() {
  document.getElementById('add-highlight-form').classList.remove('hidden');
  document.getElementById('add-highlight-form').style.display = 'flex';
  if (!currentBookId) {
    const select = document.getElementById('highlight-book-select');
    select.innerHTML = books.map(b => `<option value="${b.id}">${b.title}</option>`).join('');
    document.getElementById('book-choice-section').style.display   = 'block';
    document.getElementById('book-choice-existing').checked         = true;
    document.getElementById('existing-book-section').style.display = 'block';
    document.getElementById('new-book-section').style.display      = 'none';
  } else {
    document.getElementById('book-choice-section').style.display = 'none';
  }
}

function toggleBookChoice() {
  const choice = document.querySelector('input[name="bookChoice"]:checked').value;
  document.getElementById('existing-book-section').style.display = choice === 'existing' ? 'block' : 'none';
  document.getElementById('new-book-section').style.display      = choice === 'new'      ? 'block' : 'none';
}

async function addHighlight(event) {
  event.preventDefault();
  const text        = document.getElementById('highlight-text-input').value;
  const whyItStayed = document.getElementById('why-stayed-input').value;
  const date        = document.getElementById('highlight-date-input').value;
  let bookId        = currentBookId;
  const fromTab     = !currentBookId;
  if (!bookId) {
    const choice = document.querySelector('input[name="bookChoice"]:checked').value;
    if (choice === 'existing') {
      bookId = parseInt(document.getElementById('highlight-book-select').value);
    } else {
      const newBook = {
        id:       nextId(books),
        title:    document.getElementById('new-book-title').value,
        status:   document.getElementById('new-book-status').value,
        category: document.getElementById('new-book-category').value,
      };
      await dbPut('books', newBook);
      await loadData();
      bookId = newBook.id;
    }
  }
  const h = { id: nextId(highlights), text, bookId, whyItStayed, date };
  await dbPut('highlights', h);
  hideForm();
  ['highlight-text-input','why-stayed-input','highlight-date-input','new-book-title'].forEach(id => document.getElementById(id).value = '');
  await saveAndSync();
  if (fromTab) loadHighlights(); else openBook(currentBookId);
}

function handleDeleteHighlight(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (confirm('Delete this highlight?')) deleteHighlightConfirmed(id);
}

async function deleteHighlightConfirmed(id) {
  await dbDelete('highlights', id);
  await saveAndSync();
  const view = document.querySelector('.view:not(.hidden)');
  if (view.id === 'highlights-view')      loadHighlights();
  else if (view.id === 'book-detail-view') openBook(currentBookId);
  else if (view.id === 'home-view')        loadHome();
}

// ─── ESSAYS ───────────────────────────────────────────────────────────────────
function loadEssays() {
  const grid = document.getElementById('essays-grid');
  if (essays.length === 0) { grid.innerHTML = '<p class="home-empty">No essays yet.</p>'; return; }
  grid.innerHTML = essays.map(e => {
    const preview = e.content.replace(/[#*_`>\-]/g, '').substring(0, 100) + (e.content.length > 100 ? '…' : '');
    return `<div class="essay-card" onclick="openEssay(${e.id})">
      <div class="essay-card-header">
        <h3>${e.title}</h3>
        ${e.subtitle ? `<p class="essay-subtitle">${e.subtitle}</p>` : ''}
      </div>
      ${e.date ? `<p class="essay-meta">${formatDate(e.date)}</p>` : ''}
      ${e.tags ? `<p class="essay-meta essay-tags">${e.tags}</p>` : ''}
      <p class="essay-preview">${preview}</p>
      <button onclick="handleDeleteEssay(${e.id}, event)" class="delete-btn" title="Delete">&#128465;</button>
    </div>`;
  }).join('');
}

function openEssay(id) {
  currentEssayId = id;
  const essay = essays.find(e => e.id === id);
  document.getElementById('essay-detail-title').textContent = essay.title;
  const sub = document.getElementById('essay-detail-subtitle');
  sub.textContent   = essay.subtitle || '';
  sub.style.display = essay.subtitle ? 'block' : 'none';
  document.getElementById('essay-detail-date').textContent = essay.date ? formatDate(essay.date) : '';
  document.getElementById('essay-detail-tags').textContent = essay.tags || '';
  document.getElementById('essay-detail-body').innerHTML   = marked.parse(essay.content);
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('essay-detail-view').classList.remove('hidden');
}

function showAddEssayForm() {
  document.getElementById('add-essay-form').classList.remove('hidden');
  document.getElementById('add-essay-form').style.display = 'flex';
}

async function addEssay(event) {
  event.preventDefault();
  const essay = {
    id:       nextId(essays),
    title:    document.getElementById('essay-title-input').value,
    subtitle: document.getElementById('essay-subtitle-input').value,
    date:     document.getElementById('essay-date-input').value,
    tags:     document.getElementById('essay-tags-input').value,
    content:  document.getElementById('essay-content-input').value,
  };
  await dbPut('essays', essay);
  hideForm();
  ['essay-title-input','essay-subtitle-input','essay-date-input','essay-tags-input','essay-content-input'].forEach(id => document.getElementById(id).value = '');
  await saveAndSync();
  loadEssays();
}

function showEditEssayForm() {
  const essay = essays.find(e => e.id === currentEssayId);
  if (!essay) return;
  document.getElementById('edit-essay-title').value    = essay.title;
  document.getElementById('edit-essay-subtitle').value = essay.subtitle || '';
  document.getElementById('edit-essay-date').value     = essay.date || '';
  document.getElementById('edit-essay-tags').value     = essay.tags || '';
  document.getElementById('edit-essay-content').value  = essay.content;
  document.getElementById('edit-essay-form').classList.remove('hidden');
  document.getElementById('edit-essay-form').style.display = 'flex';
}

async function updateEssay(event) {
  event.preventDefault();
  const essay = {
    id:       currentEssayId,
    title:    document.getElementById('edit-essay-title').value,
    subtitle: document.getElementById('edit-essay-subtitle').value,
    date:     document.getElementById('edit-essay-date').value,
    tags:     document.getElementById('edit-essay-tags').value,
    content:  document.getElementById('edit-essay-content').value,
  };
  await dbPut('essays', essay);
  hideForm();
  await saveAndSync();
  openEssay(currentEssayId);
}

function handleDeleteEssay(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (confirm('Delete this essay?')) deleteEssayConfirmed(id);
}

async function deleteEssayConfirmed(id) {
  await dbDelete('essays', id);
  await saveAndSync();
  showView('essays');
}

function printEssay() { window.print(); }

// ─── FORMS ────────────────────────────────────────────────────────────────────
function setMediumBtn(groupSelector, value) {
  document.querySelectorAll(`${groupSelector} .medium-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

const RATING_LABELS = {
  forgot:   { icon: '\u{1F636}', label: 'Already forgot the plot' },
  rentfree: { icon: '\u{1F9E0}', label: 'Rent-free in my head' },
  wrecked:  { icon: '\u{1F525}', label: 'Wrecked me (in a good way)' },
};

function setRatingBtn(groupSelector, value) {
  document.querySelectorAll(`${groupSelector} .rating-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function toggleMediumBtn(btn) {
  const group   = btn.closest('.medium-btn-group');
  const current = group.querySelector('.medium-btn.active');
  if (current === btn) {
    btn.classList.remove('active'); // tap again to deselect
  } else {
    if (current) current.classList.remove('active');
    btn.classList.add('active');
  }
}

function hideForm() {
  document.querySelectorAll('.form').forEach(f => {
    f.classList.add('hidden');
    f.style.display = 'none';
  });
}

function initializeForms() {
  document.querySelectorAll('.form').forEach(f => {
    f.classList.add('hidden');
    f.style.display = 'none';
  });
  document.querySelectorAll('.medium-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group   = btn.closest('.medium-btn-group');
      const current = group.querySelector('.medium-btn.active');
      if (current === btn) {
        btn.classList.remove('active');
      } else {
        if (current) current.classList.remove('active');
        btn.classList.add('active');
      }
    });
  });
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group   = btn.closest('.rating-btn-group');
      const current = group.querySelector('.rating-btn.active');
      if (current === btn) {
        btn.classList.remove('active');
      } else {
        if (current) current.classList.remove('active');
        btn.classList.add('active');
      }
    });
  });
}

// ─── WISHLIST ─────────────────────────────────────────────────────────────────
function loadWishlist() {
  const CATEGORIES = ['Fiction', 'History', 'Politics', 'Philosophy', 'Graphic Novels'];
  const container  = document.getElementById('wishlist-list');
  if (wishlist.length === 0) {
    container.innerHTML = '<p class="home-empty">Nothing on your wishlist yet.</p>';
    return;
  }
  let html = '';
  CATEGORIES.forEach(cat => {
    const group = wishlist.filter(w => w.category === cat).sort((a, b) => a.title.localeCompare(b.title));
    if (group.length === 0) return;
    html += `<div class="wishlist-group">
      <h2 class="wishlist-group-heading">
        <span class="wishlist-cat-dot" style="background:${getCoverColor(cat)}"></span>
        ${cat}
      </h2>
      ${group.map(w => `
        <div class="wishlist-item" id="wishlist-item-${w.id}">
          <div class="wishlist-item-main">
            <span class="wishlist-item-title">${w.title}</span>
            ${w.author ? `<span class="wishlist-item-author">${w.author}</span>` : ''}
            ${w.note   ? `<span class="wishlist-item-note">${w.note}</span>`   : ''}
          </div>
          <div class="wishlist-item-actions">
            <button class="wishlist-move-btn" onclick="showMoveToBooks(${w.id})">&#10142; Add to Books</button>
            <button class="delete-btn" onclick="deleteWishlistItem(${w.id})">&#128465;</button>
          </div>
          <div class="wishlist-status-prompt hidden" id="wishlist-prompt-${w.id}">
            <span class="wishlist-prompt-label">Add as:</span>
            <button class="wishlist-status-btn" onclick="moveToBooks(${w.id}, 'Waitlisted')">Waitlisted</button>
            <button class="wishlist-status-btn" onclick="moveToBooks(${w.id}, 'Reading')">Reading</button>
            <button class="wishlist-cancel-btn" onclick="hideMoveToBooks(${w.id})">Cancel</button>
          </div>
        </div>`).join('')}
    </div>`;
  });
  container.innerHTML = html;
}

function showMoveToBooks(id) {
  document.querySelectorAll('.wishlist-status-prompt').forEach(el => el.classList.add('hidden'));
  document.getElementById(`wishlist-prompt-${id}`).classList.remove('hidden');
}

function hideMoveToBooks(id) {
  document.getElementById(`wishlist-prompt-${id}`).classList.add('hidden');
}

async function moveToBooks(wishlistId, status) {
  const item = wishlist.find(w => w.id === wishlistId);
  if (!item) return;
  const book = {
    id:       nextId(books),
    title:    item.title,
    category: item.category,
    status,
    notes:              '',
    aftertaste:         '',
    favouriteCharacter: item.author ? '' : '',
    dateCompleted:      '',
    medium:             '',
  };
  await dbPut('books', book);
  await dbDelete('wishlist', wishlistId);
  await saveAndSync();
  loadWishlist();
}

async function deleteWishlistItem(id) {
  if (!confirm('Remove from wishlist?')) return;
  await dbDelete('wishlist', id);
  await saveAndSync();
  loadWishlist();
}

function showAddWishlistForm() {
  document.getElementById('add-wishlist-form').classList.remove('hidden');
  document.getElementById('add-wishlist-form').style.display = 'flex';
}

async function addWishlistItem(event) {
  event.preventDefault();
  const item = {
    id:       nextId(wishlist),
    title:    document.getElementById('wishlist-title-input').value,
    category: document.getElementById('wishlist-category-input').value,
    author:   document.getElementById('wishlist-author-input').value,
    note:     document.getElementById('wishlist-note-input').value,
  };
  await dbPut('wishlist', item);
  hideForm();
  ['wishlist-title-input', 'wishlist-author-input', 'wishlist-note-input'].forEach(id => document.getElementById(id).value = '');
  await saveAndSync();
  loadWishlist();
}

// ─── BOOKCISION IMPORT ───────────────────────────────────────────────────────
function importKindleClippings() {
  document.getElementById('kindle-file-input').click();
}

function handleKindleFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let json;
    try { json = JSON.parse(e.target.result); }
    catch { alert('Could not read file. Make sure it is a valid Bookcision JSON export.'); return; }
    processKindleImport(parseBookcisionJSON(json));
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function parseBookcisionJSON(json) {
  const title  = (json.title  || '').trim();
  const author = (json.authors || '').trim();
  const clippings = [];
  for (const h of (json.highlights || [])) {
    if (h.isNoteOnly) continue;
    const text = (h.text || '').trim();
    if (!text) continue;
    const location = h.location && h.location.value ? `Location ${h.location.value}` : '';
    const note     = (h.note || '').trim();
    clippings.push({ title, author, location, kindleDate: '', text, whyItStayed: note });
  }
  return clippings;
}

// Holds pending import state while the category modal is open
let _pendingImport = null;

async function processKindleImport(clippings) {
  if (clippings.length === 0) {
    alert('No highlights found in this file.');
    return;
  }

  // Duplicate detection — exact text match
  const existingTexts = new Set(highlights.map(h => h.text.trim()));
  const dupCount = clippings.filter(c => existingTexts.has(c.text.trim())).length;
  if (dupCount > 0) {
    const ok = confirm(
      `${dupCount} of these highlight${dupCount > 1 ? 's' : ''} already exist in SpellBound.\n` +
      `Import everything anyway? Duplicates will be added as separate entries.`
    );
    if (!ok) return;
  }

  // Find which titles are new (not in books store)
  const localBooks  = [...books];
  const seenTitles  = new Map(); // lowercase title → stub book object
  const newBookStubs = [];

  for (const c of clippings) {
    const key = c.title.toLowerCase();
    if (localBooks.find(b => b.title.toLowerCase() === key)) continue;
    if (seenTitles.has(key)) continue;
    const stub = { title: c.title, author: c.author, id: null, category: '' };
    seenTitles.set(key, stub);
    newBookStubs.push(stub);
  }

  if (newBookStubs.length > 0) {
    // Show category modal — import continues in confirmCategoryModal()
    _pendingImport = { clippings, newBookStubs };
    showCategoryModal(newBookStubs);
  } else {
    await finishImport(clippings, []);
  }
}

function showCategoryModal(stubs) {
  const CATEGORIES = ['Fiction', 'History', 'Politics', 'Philosophy', 'Non-Fiction', 'Graphic Novels'];
  document.getElementById('category-modal-books').innerHTML = stubs.map((s, i) =>
    `<div class="modal-book-row">
      <div class="modal-book-title">${s.title}</div>
      ${s.author ? `<div class="modal-book-author">${s.author}</div>` : ''}
      <select class="modal-category-select" data-index="${i}">
        ${CATEGORIES.map(c => `<option value="${c}"${c === 'Non-Fiction' ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>`
  ).join('');
  document.getElementById('category-modal-overlay').classList.remove('hidden');
}

function closeCategoryModal() {
  document.getElementById('category-modal-overlay').classList.add('hidden');
  _pendingImport = null;
}

async function confirmCategoryModal() {
  if (!_pendingImport) return;
  // Read chosen categories back into stubs
  document.querySelectorAll('.modal-category-select').forEach(sel => {
    _pendingImport.newBookStubs[parseInt(sel.dataset.index)].category = sel.value;
  });
  document.getElementById('category-modal-overlay').classList.add('hidden');
  await finishImport(_pendingImport.clippings, _pendingImport.newBookStubs);
  _pendingImport = null;
}

async function finishImport(clippings, newBookStubs) {
  const localBooks    = [...books];
  const createdBooks  = [];
  const newHighlights = [];

  // Materialise stub books with real IDs
  for (const stub of newBookStubs) {
    const book = {
      id:       nextId([...localBooks, ...createdBooks]),
      title:    stub.title,
      author:   stub.author,
      status:   'Reading',
      category: stub.category,
    };
    createdBooks.push(book);
    localBooks.push(book);
  }

  for (const c of clippings) {
    const book = localBooks.find(b => b.title.toLowerCase() === c.title.toLowerCase());
    if (!book) continue;
    newHighlights.push({
      id:          nextId([...highlights, ...newHighlights]),
      text:        c.text,
      bookId:      book.id,
      whyItStayed: c.whyItStayed || '',
      date:        '',
      location:    c.location,
      kindleDate:  c.kindleDate,
    });
  }

  for (const b of createdBooks)   await dbPut('books',      b);
  for (const h of newHighlights)  await dbPut('highlights', h);
  await saveAndSync();
  await loadData();
  loadHighlights();
  alert(
    `Imported ${newHighlights.length} highlight${newHighlights.length !== 1 ? 's' : ''}` +
    (createdBooks.length ? ` and created ${createdBooks.length} new book${createdBooks.length !== 1 ? 's' : ''}.` : '.')
  );
}

// ─── VOICE INPUT ─────────────────────────────────────────────────────────────
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // silently skip unsupported browsers

  let activeRecognition = null;
  let activeBtn         = null;

  document.querySelectorAll('.form input[type="text"], .form textarea').forEach(field => {
    // Wrap field in a relative container
    const wrapper = document.createElement('div');
    wrapper.className = 'voice-field';
    field.parentNode.insertBefore(wrapper, field);
    wrapper.appendChild(field);

    // Mic button
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'mic-btn';
    btn.innerHTML = '&#127908;';
    btn.title     = 'Tap to dictate';
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      // Stop any other active recognition
      if (activeRecognition && activeBtn !== btn) {
        activeRecognition.stop();
        activeBtn.classList.remove('listening');
        activeBtn.innerHTML = '&#127908;';
      }

      // Toggle off if already listening on this field
      if (activeBtn === btn && activeRecognition) {
        activeRecognition.stop();
        return;
      }

      const recognition       = new SpeechRecognition();
      recognition.lang        = 'en-US';
      recognition.interimResults = true;
      recognition.continuous  = false;

      activeRecognition = recognition;
      activeBtn         = btn;
      btn.classList.add('listening');
      btn.innerHTML = '&#9679;';

      recognition.onresult = e => {
        let interim = '';
        let final   = '';
        for (const result of e.results) {
          if (result.isFinal) final   += result[0].transcript;
          else                interim += result[0].transcript;
        }
        field.value = final || interim;
      };

      recognition.onend = () => {
        btn.classList.remove('listening');
        btn.innerHTML     = '&#127908;';
        activeRecognition = null;
        activeBtn         = null;
      };

      recognition.onerror = () => {
        btn.classList.remove('listening');
        btn.innerHTML     = '&#127908;';
        activeRecognition = null;
        activeBtn         = null;
      };

      recognition.start();
    });
  });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
  await openDB();
  await loadData();
  initializeForms();
  initVoice();
  showView('home');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

boot();
