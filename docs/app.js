// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Replace with your Google OAuth Client ID after setting up Google Cloud project
const GOOGLE_CLIENT_ID = '1039983743372-jd8ucsoagkevsras0s9c2g3mqvk7jq6g.apps.googleusercontent.com';
const DRIVE_FILE_NAME  = 'spellbound-data.json';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata';
const GMAIL_SCOPE      = 'https://www.googleapis.com/auth/gmail.compose';

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentBookId      = null;
let currentEssayId     = null;
let currentHighlightId = null;
let dogEaredId         = null;
let books              = [];
let highlights         = [];
let essays             = [];
let _essayTagFilter    = '';
let _essaySort         = 'date-desc'; // session-only
let wishlist           = [];
let challenges         = [];
let gapiReady      = false;
let gisReady       = false;
let tokenClient;

// ─── INDEXEDDB ────────────────────────────────────────────────────────────────
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('SpellBoundDB', 4);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books'))         d.createObjectStore('books',         { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('highlights'))    d.createObjectStore('highlights',    { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('essays'))        d.createObjectStore('essays',        { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('wishlist'))      d.createObjectStore('wishlist',      { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta'))          d.createObjectStore('meta',          { keyPath: 'key' });
      if (!d.objectStoreNames.contains('challenges'))    d.createObjectStore('challenges',    { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('essay_drafts')) d.createObjectStore('essay_drafts',  { keyPath: 'id', autoIncrement: true });
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

// ─── ESSAY DRAFT HELPERS ──────────────────────────────────────────────────────
// Only one in-progress draft is allowed at a time. These helpers manage it.

async function dbGetActiveDraft() {
  const all = await dbGetAll('essay_drafts');
  return all.length > 0 ? all[0] : null;
}

async function dbSaveDraft(draft) {
  draft.updated_at = new Date().toISOString();
  if (!draft.created_at) draft.created_at = draft.updated_at;
  return dbPut('essay_drafts', draft);
}

async function dbDeleteDraft(id) {
  return dbDelete('essay_drafts', id);
}

function newDraftTemplate() {
  return {
    // id assigned by IndexedDB on first save
    step:  2,
    stage: 1,

    excerpt:      '',
    feeling_tag:  '',

    open_notes:    [],
    expand_notes:  [],
    focus_note:    '',
    deepen_notes:  [],
    edge_note:     '',

    compiled_thought:        '',
    compiled_thought_thread: [],

    research_categories: [],
    research_results:    [],
    attached_research:   [],
    research_thread:     [],

    format:  '',
    outline: [],

    draft_sections: [],
    section_threads: {},

    finalized_draft: '',
    finalize_thread: [],

    title:         '',
    title_thread:  [],

    subtitle:         '',
    subtitle_thread:  [],

    tags:        [],
    tags_thread: [],

    created_at:  null,
    updated_at:  null
  };
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
  challenges = await dbGetAll('challenges');
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
    scope:     `${DRIVE_SCOPE} ${GMAIL_SCOPE}`,
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
    gapi.client.setToken({ access_token: resp.access_token });
    await syncFromDrive();
  };
  tokenClient.requestAccessToken({ prompt: '' });
}

function signIn() {
  tokenClient.callback = async resp => {
    if (resp.error) { updateSyncStatus('Sign-in failed', true); return; }
    gapi.client.setToken({ access_token: resp.access_token });
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
      await dbClear('challenges');
      await dbClear('essay_drafts');
      for (const b of (data.books         || [])) await dbPut('books',         b);
      for (const h of (data.highlights    || [])) await dbPut('highlights',    h);
      for (const e of (data.essays        || [])) await dbPut('essays',        e);
      for (const w of (data.wishlist      || [])) await dbPut('wishlist',      w);
      for (const c of (data.challenges    || [])) await dbPut('challenges',    c);
      for (const d of (data.essay_drafts  || [])) await dbPut('essay_drafts',  d);
      if (data.waitlistOrder) await dbSetMeta('waitlist-order', data.waitlistOrder);
      if (data.wishlistOrder) await dbSetMeta('wishlist-order', data.wishlistOrder);
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
    const wishlistOrder = await dbGetMeta('wishlist-order') || [];
    const essay_drafts  = await dbGetAll('essay_drafts');
    const payload  = JSON.stringify({ books, highlights, essays, wishlist, challenges, waitlistOrder, wishlistOrder, essay_drafts });
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
  const d = new Date(date + 'T00:00:00'); // avoid timezone shift
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const COVER_COLORS = {
  'Fiction':        '#C47A90',  /* warm rose-pink    */
  'History':        '#C4A96A',  /* warm sand         */
  'Politics':       '#6B9CB8',  /* muted sky blue    */
  'Philosophy':     '#9B8AB8',  /* pale lavender     */
  'Graphic Novels': '#78A882'   /* sage green        */
};
function getCoverColor(cat) { return COVER_COLORS[cat] || '#7A8FA6'; }

const MEDIUM_ICON = {
  kindle:    '<i class="ph-bold ph-device-mobile"></i>',
  audiobook: '<i class="ph-bold ph-headphones"></i>'
};
function getMediumIcon(medium) { return MEDIUM_ICON[medium] || ''; }

function refreshCurrentView() {
  const active = document.querySelector('.view:not(.hidden)');
  if (!active) return;
  const id = active.id;
  if      (id === 'home-view')             loadHome();
  else if (id === 'books-view')            loadBooks();
  else if (id === 'highlights-view')       loadHighlights();
  else if (id === 'essays-view')           loadEssays();
  else if (id === 'book-detail-view'     && currentBookId)      openBook(currentBookId);
  else if (id === 'essay-detail-view'    && currentEssayId)     openEssay(currentEssayId);
  else if (id === 'highlight-detail-view'&& currentHighlightId) openHighlightDetail(currentHighlightId);
  else if (id === 'wishlist-view')         loadWishlist();
  else if (id === 'sprint-view')           loadSprint();
}

async function saveWaitlistOrder(order) {
  await dbSetMeta('waitlist-order', order);
  syncToDrive().catch(() => {});
}

async function saveWishlistOrder(order) {
  await dbSetMeta('wishlist-order', order);
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
  if (view !== 'book-detail')      currentBookId      = null;
  if (view !== 'essay-detail')     currentEssayId     = null;
  if (view !== 'highlight-detail') currentHighlightId = null;
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
  if (view === 'sprint')     loadSprint();
  if (view === 'settings')   loadSettings();
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
const SPELL = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
function spellNum(n) { return SPELL[n] ?? n; }

async function loadHome() {
  const readingBooks    = books.filter(b => b.status === 'Reading');
  const waitlistedBooks = books.filter(b => b.status === 'Waitlisted');

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const n        = readingBooks.length;
  const pick     = arr => arr[Math.floor(Math.random() * arr.length)];
  const heroMsg  = n === 0
    ? pick([
        'Books don\'t read themselves. Allegedly.',
        'Your TBR pile is judging you.',
        'No books in progress. Bold strategy.',
        'The shelf awaits. Patiently. Resentfully.',
      ])
    : n === 1
    ? pick([
        'Just the one. Suspicious.',
        'One book. Focused or indecisive? We\'ll never know.',
        'Flying solo. Respect.',
        'Single-book mode. Rare. Impressive.',
      ])
    : pick([
        `Juggling ${spellNum(n)} books. Very on-brand.`,
        `${spellNum(n)[0].toUpperCase() + spellNum(n).slice(1)} books in progress. Commitment can sometimes be complicated.`,
        `${spellNum(n)[0].toUpperCase() + spellNum(n).slice(1)} books. You love a good plot twist — including in your reading list.`,
        `${spellNum(n)[0].toUpperCase() + spellNum(n).slice(1)} books open. Make sure you're doing them both justice!`,
      ]);
  document.getElementById('home-hero').innerHTML =
    `<p class="home-hero-greeting">${greeting}</p><p class="home-hero-message">${heroMsg}</p>`;

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
          </div>`).join('')}</div>` +
        renderStaleNudges(readingBooks));

  renderDogEared();

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

function renderStaleNudges(readingBooks) {
  const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;
  const now      = Date.now();
  const stale    = readingBooks.filter(b => {
    const lastEdit      = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    const lastHighlight = highlights
      .filter(h => h.bookId === b.id && h.savedAt)
      .reduce((max, h) => Math.max(max, new Date(h.savedAt).getTime()), 0);
    const lastActivity  = Math.max(lastEdit, lastHighlight);
    return lastActivity === 0 || (now - lastActivity) > TEN_DAYS;
  });
  if (stale.length === 0) return '';

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  let message, arrowStyle = '';

  if (stale.length === 1) {
    const b   = stale[0];
    const idx = readingBooks.indexOf(b);
    const n   = readingBooks.length;
    const pct = ((idx + 0.5) / n * 100).toFixed(1);
    arrowStyle = `style="--arrow-left: calc(${pct}% - 6px)"`;
    message = pick([
      `📚 If <em>${b.title}</em> were a library book, you'd owe a fine by now!`,
      `📚 Still reading <em>${b.title}</em>? No judgment. Actually, maybe a little bit.`,
    ]);
  } else {
    message = pick([
      '📚 Both books haven\'t heard from you in a while. They\'re starting to talk.',
      '📚 Two books in progress, zero recent activity. The plot thickens — just not for you.',
    ]);
  }

  return `<div class="stale-nudge${stale.length === 1 ? ' stale-nudge--arrow' : ''}" ${arrowStyle} onclick="this.remove()" title="Dismiss">
    <span class="stale-nudge-text">${message}</span>
    <span class="stale-nudge-dismiss">✕</span>
  </div>`;
}

function renderDogEared(excludeId) {
  const container = document.getElementById('dog-eared');
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const hasSavedAt   = highlights.some(h => h.savedAt);
  const hasRecent    = highlights.some(h => h.savedAt && new Date(h.savedAt).getTime() > sevenDaysAgo);
  const showEmpty    = highlights.length === 0 || (hasSavedAt && !hasRecent);

  const heading = `
    <div class="dog-eared-header">
      <h2 class="home-section-title">The pages you've dog&#8209;eared</h2>
      ${!showEmpty ? `<button class="dog-eared-refresh" onclick="refreshDogEared()" title="Show another">&#8635;</button>` : ''}
    </div>`;

  if (showEmpty) {
    container.innerHTML = heading + `
      <div class="dog-eared-empty">
        <p class="dog-eared-empty-quote">&ldquo;There is no friend as loyal as a book.<br>And you didn&rsquo;t save a single thing it said? 💔&rdquo;</p>
        <button class="dog-eared-add-btn" onclick="showAddHighlightForm()">Add Highlight</button>
      </div>`;
    return;
  }

  const pool = excludeId ? highlights.filter(h => h.id !== excludeId) : highlights;
  const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : highlights[0];
  dogEaredId   = pick.id;
  const book   = books.find(b => b.id === pick.bookId);
  const col    = book ? getCoverColor(book.category) : '#3a5a8c';

  container.innerHTML = heading + `
    <div class="home-quote-card dog-eared-card" onclick="openHighlightDetail(${pick.id})" style="--card-accent:${col}">
      <p class="home-quote-text">“${pick.text}”</p>
      <p class="home-quote-source">&mdash; ${book ? book.title : 'Unknown'}</p>
    </div>`;
}

function refreshDogEared() {
  renderDogEared(dogEaredId);
}

function openHighlightDetail(id) {
  currentHighlightId = id;
  const h    = highlights.find(h => h.id === id);
  const book = h ? books.find(b => b.id === h.bookId) : null;
  if (!h) return;
  const col = book ? getCoverColor(book.category) : '#3a5a8c';
  document.getElementById('highlight-detail-content').innerHTML = `
    <div class="highlight-detail-card" style="border-left-color:${col}">
      <span class="highlight-detail-mark">&ldquo;</span>
      <p class="highlight-detail-text">${h.text}</p>
      <p class="highlight-detail-source">&mdash; ${book ? book.title : 'Unknown'}</p>
      ${h.whyItStayed ? `<div class="highlight-detail-section"><span class="highlight-detail-label">Reflection</span><p class="highlight-detail-body">${h.whyItStayed}</p></div>` : ''}
      ${h.date ? `<div class="highlight-detail-section"><span class="highlight-detail-label">Date</span><p class="highlight-detail-body">${formatDate(h.date)}</p></div>` : ''}
    </div>`;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('highlight-detail-view').classList.remove('hidden');
}

// ─── BOOKS ────────────────────────────────────────────────────────────────────
function setStatusFilter(value) {
  document.getElementById('books-status-filter').value = value;
  document.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'));
  const active = [...document.querySelectorAll('.status-pill')].find(p => p.textContent.trim() === (value || 'All'));
  if (active) active.classList.add('active');
  loadBooks();
}

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
        <h2 class="books-group-heading accent-${status.toLowerCase().replace(' ','-')}">${status}<span class="books-group-count">${group.length}</span></h2>
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
        <button onclick="showEditHighlightForm(${h.id}, event)" class="hl-edit" title="Edit">&#9998;</button>
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
let _categoryManualAdd      = false;
let _categoryManualEdit     = false;
let _categoryManualWishlist = false;

function markCategoryManual(form) {
  if (form === 'add')      _categoryManualAdd      = true;
  if (form === 'edit')     _categoryManualEdit     = true;
  if (form === 'wishlist') _categoryManualWishlist = true;
}

function _sugElId(form) {
  if (form === 'add')      return 'add-book-suggestions';
  if (form === 'wishlist') return 'wishlist-book-suggestions';
  return 'edit-book-suggestions';
}

function _titleElId(form) {
  if (form === 'add')      return 'book-title-input';
  if (form === 'wishlist') return 'wishlist-title-input';
  return 'edit-book-title';
}

function debounceBookLookup(form) {
  clearTimeout(_lookupTimer);
  const titleEl = document.getElementById(_titleElId(form));
  const sugEl   = document.getElementById(_sugElId(form));
  if (!titleEl || !sugEl) return;
  const title = titleEl.value.trim();
  if (title.length < 2) { sugEl.classList.add('hidden'); sugEl.innerHTML = ''; return; }
  sugEl.classList.remove('hidden');
  sugEl.innerHTML = '<p class="book-lookup-loading">Looking up…</p>';
  _lookupTimer = setTimeout(() => fetchBookSuggestions(title, form), 500);
}

function triggerEditBookLookup() {
  const title = document.getElementById('edit-book-title').value.trim();
  if (!title) return;
  const sugEl = document.getElementById('edit-book-suggestions');
  sugEl.classList.remove('hidden');
  sugEl.innerHTML = '<p class="book-lookup-loading">Looking up…</p>';
  fetchBookSuggestions(title, 'edit');
}

async function fetchBookSuggestions(title, form) {
  const sugEl = document.getElementById(_sugElId(form));
  if (!sugEl) return;
  try {
    const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=5&fields=title,author_name,subject,cover_i`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.docs || data.docs.length === 0) {
      sugEl.innerHTML = '<p class="book-lookup-loading">No results found.</p>';
      return;
    }
    renderBookSuggestions(data.docs, form, sugEl);
  } catch (err) {
    sugEl.innerHTML = '<p class="book-lookup-loading">Lookup failed.</p>';
    console.error('Book lookup error:', err);
  }
}

function renderBookSuggestions(items, form, sugEl) {
  const cards = items.map((item, i) => {
    const title  = item.title || '';
    const author = (item.author_name || []).join(', ');
    const cat    = mapCategory(item.subject);
    const thumb  = item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : '';
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
    `<button type="button" class="book-sug-none" onclick="document.getElementById('${_sugElId(form)}').classList.add('hidden')">None of these</button>`;
  sugEl._suggestions = items.map(item => ({
    title:    item.title || '',
    author:   (item.author_name || []).join(', '),
    category: mapCategory(item.subject),
    coverUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : '',
  }));
}

function applyBookSuggestion(index, form) {
  const sugEl = document.getElementById(_sugElId(form));
  const s     = sugEl._suggestions[index];
  if (!s) return;
  if (form === 'add') {
    document.getElementById('book-title-input').value   = s.title;
    document.getElementById('book-author-input').value  = s.author;
    if (!_categoryManualAdd) {
      document.getElementById('book-category-input').value = s.category;
      toggleAddBookFields();
    }
  } else if (form === 'wishlist') {
    document.getElementById('wishlist-title-input').value  = s.title;
    document.getElementById('wishlist-author-input').value = s.author;
    if (!_categoryManualWishlist) {
      document.getElementById('wishlist-category-input').value = s.category;
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
    medium:             document.querySelector('#add-book-medium-group .medium-btn.active')?.dataset.value || '',
    dateCompleted:      document.getElementById('book-date-completed-input').value,
    notes:              document.getElementById('book-notes-input').value,
    aftertaste:         document.getElementById('book-aftertaste-input').value,
    favouriteCharacter: document.getElementById('book-fav-char-input').value,
    updatedAt:          new Date().toISOString(),
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
    updatedAt:          new Date().toISOString(),
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
  const categoryFilter = document.getElementById('highlight-category-filter').value;
  let filtered = highlights;
  if (categoryFilter) {
    const ids = books.filter(b => b.category === categoryFilter).map(b => b.id);
    filtered  = filtered.filter(h => ids.includes(h.bookId));
  }
  const container = document.getElementById('all-highlights');
  if (filtered.length === 0) { container.innerHTML = '<p class="home-empty">No highlights yet.</p>'; return; }
  container.innerHTML = filtered.map(h => {
    const book = books.find(b => b.id === h.bookId);
    const col  = book ? getCoverColor(book.category) : '#3a5a8c';
    return `<div class="home-quote-card" onclick="showEditHighlightForm(${h.id})" style="--card-accent:${col}">
      <p class="home-quote-text">${h.text}</p>
      <p class="home-quote-source">&mdash; ${book ? book.title : 'Unknown'}${book ? ` <span class="hl-quote-category-inline">${book.category}</span>` : ''}</p>
      ${h.whyItStayed ? `<p class="hl-quote-why-inline">${h.whyItStayed}</p>` : ''}
      ${h.date ? `<p class="hl-quote-date-inline">${formatDate(h.date)}</p>` : ''}
      ${h.location || h.kindleDate ? `<p class="hl-quote-date-inline">${[h.location, h.kindleDate].filter(Boolean).join(' &middot; ')}</p>` : ''}
    </div>`;
  }).join('');
}

function toggleHlAddMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('hl-add-menu');
  menu.classList.toggle('hidden');
}

function closeHlAddMenu() {
  const menu = document.getElementById('hl-add-menu');
  if (menu) menu.classList.add('hidden');
}

document.addEventListener('click', () => closeHlAddMenu());

function showAddHighlightForm() {
  document.getElementById('add-highlight-form').classList.remove('hidden');
  document.getElementById('add-highlight-form').style.display = 'flex';
  if (!currentBookId) {
    document.getElementById('highlight-book-filter').value = '';
    _populateBookSelect('');
    _closeBookDropdown();
    document.getElementById('book-choice-section').style.display   = 'block';
    document.querySelectorAll('#book-choice-section .radio-label').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.choice === 'existing');
    });
    document.getElementById('existing-book-section').style.display = 'block';
    document.getElementById('new-book-section').style.display      = 'none';
  } else {
    document.getElementById('book-choice-section').style.display = 'none';
  }
}

function _populateBookSelect(filter) {
  const sorted   = [...books].sort((a, b) => a.title.localeCompare(b.title));
  const filtered = filter
    ? sorted.filter(b => b.title.split(/\s+/).some(word => word.toLowerCase().startsWith(filter.toLowerCase())))
    : sorted;
  // Update hidden select
  const select = document.getElementById('highlight-book-select');
  select.innerHTML = '<option value="" disabled selected></option>'
    + filtered.map(b => `<option value="${b.id}">${b.title}</option>`).join('');
  // Update visible dropdown list
  const dropdown = document.getElementById('book-dropdown');
  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="book-dropdown-empty">No books found</div>';
  } else {
    dropdown.innerHTML = filtered.map(b =>
      `<div class="book-dropdown-item" onclick="selectBookFromDropdown(${b.id}, '${b.title.replace(/'/g, "&#39;")}')">` +
      `${b.title}</div>`
    ).join('');
  }
}

function filterBookSelect() {
  const filter = document.getElementById('highlight-book-filter').value;
  _populateBookSelect(filter);
  document.getElementById('book-dropdown').classList.remove('hidden');
}

function openBookDropdown() {
  _populateBookSelect(document.getElementById('highlight-book-filter').value);
  document.getElementById('book-dropdown').classList.remove('hidden');
}

function _closeBookDropdown() {
  document.getElementById('book-dropdown').classList.add('hidden');
}

function selectBookFromDropdown(id, title) {
  document.getElementById('highlight-book-select').value = id;
  document.getElementById('highlight-book-filter').value = title;
  _closeBookDropdown();
}

function toggleBookChoice(choice) {
  document.querySelectorAll('#book-choice-section .radio-label').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.choice === choice);
  });
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
    const choice = document.querySelector('#book-choice-section .radio-label.active').dataset.choice;
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
  const h = { id: nextId(highlights), text, bookId, whyItStayed, date, savedAt: new Date().toISOString() };
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

function showEditHighlightForm(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const h = highlights.find(h => h.id === id);
  if (!h) return;
  currentHighlightId = id;
  document.getElementById('edit-highlight-text').value = h.text;
  document.getElementById('edit-highlight-why').value  = h.whyItStayed || '';
  document.getElementById('edit-highlight-date').value = h.date || '';
  document.getElementById('edit-highlight-form').classList.remove('hidden');
  document.getElementById('edit-highlight-form').style.display = 'flex';
}

async function updateHighlight(event) {
  event.preventDefault();
  const h = highlights.find(h => h.id === currentHighlightId);
  if (!h) return;
  h.text        = document.getElementById('edit-highlight-text').value;
  h.whyItStayed = document.getElementById('edit-highlight-why').value;
  h.date        = document.getElementById('edit-highlight-date').value;
  await dbPut('highlights', h);
  hideForm();
  await saveAndSync();
  const view = document.querySelector('.view:not(.hidden)');
  if (view.id === 'highlights-view')       loadHighlights();
  else if (view.id === 'book-detail-view') openBook(currentBookId);
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
async function loadEssays() {
  const grid     = document.getElementById('essays-grid');
  const buildBtn = document.getElementById('build-essay-btn');

  // Update Build/Resume button label
  if (buildBtn) {
    const draft = await dbGetActiveDraft();
    buildBtn.textContent = draft ? '↩ Resume Essay' : '✦ Build Essay';
  }

  // Tag filter bar — single scrollable row
  const filterBar = document.getElementById('essays-tag-filters');
  if (filterBar) {
    const allTags = [...new Set(essays.flatMap(e => _getEssayTags(e)))].sort();
    if (allTags.length) {
      filterBar.innerHTML =
        `<button class="essay-tag-pill ${_essayTagFilter === '' ? 'active' : ''}" onclick="setEssayTagFilter('')">All</button>` +
        allTags.map(t =>
          `<button class="essay-tag-pill ${_essayTagFilter === t ? 'active' : ''}" onclick="setEssayTagFilter(${JSON.stringify(t)})">${t}</button>`
        ).join('');
    } else {
      filterBar.innerHTML = '';
    }
    // Fade hint — hide once scrolled to end
    const wrap = document.getElementById('essays-tag-wrap');
    if (wrap) {
      const checkEnd = () => {
        const atEnd = filterBar.scrollLeft + filterBar.clientWidth >= filterBar.scrollWidth - 4;
        wrap.classList.toggle('scrolled-end', atEnd);
      };
      filterBar.removeEventListener('scroll', filterBar._scrollHint);
      filterBar._scrollHint = checkEnd;
      filterBar.addEventListener('scroll', checkEnd, { passive: true });
      checkEnd(); // evaluate immediately in case all pills fit
    }
  }

  // Filter
  let visible = _essayTagFilter
    ? essays.filter(e => _getEssayTags(e).includes(_essayTagFilter))
    : [...essays];

  // Sort
  if (_essaySort === 'date-desc')   visible.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  else if (_essaySort === 'date-asc')  visible.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  else if (_essaySort === 'title-az')  visible.sort((a, b) => a.title.localeCompare(b.title));

  // Section header
  const countEl = document.getElementById('essays-count');
  const sortRow = document.getElementById('essays-sort-row');
  if (countEl) {
    countEl.textContent = visible.length === 1 ? '1 essay' : `${visible.length} essays`;
  }
  if (sortRow) {
    const opts = [['date-desc', 'Newest'], ['date-asc', 'Oldest'], ['title-az', 'A–Z']];
    sortRow.innerHTML = opts.map(([val, label]) =>
      `<button class="essays-sort-btn ${_essaySort === val ? 'active' : ''}" onclick="setEssaySort('${val}')">${label}</button>`
    ).join('');
  }

  if (visible.length === 0) {
    grid.innerHTML = essays.length === 0
      ? '<p class="home-empty">No essays yet.</p>'
      : '<p class="home-empty">No essays match this tag.</p>';
    return;
  }

  grid.innerHTML = visible.map(e =>
    `<div class="essay-card" onclick="openEssay(${e.id})">
      <div class="essay-card-body">
        <h3 class="essay-card-title">${e.title}</h3>
        ${e.subtitle ? `<p class="essay-card-subtitle">${e.subtitle}</p>` : ''}
      </div>
      ${e.date ? `<p class="essay-card-date">${formatDate(e.date)}</p>` : ''}
    </div>`
  ).join('');
}

function setEssayTagFilter(tag) {
  _essayTagFilter = tag;
  loadEssays();
}

function setEssaySort(val) {
  _essaySort = val;
  loadEssays();
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
  _renderRelatedHighlights(essay);
  _renderRelatedEssays(essay);
}

function _getEssayTags(essay) {
  if (!essay.tags) return [];
  if (Array.isArray(essay.tags)) return essay.tags.map(t => t.trim().toLowerCase()).filter(Boolean);
  return essay.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

function _renderRelatedHighlights(essay) {
  const container = document.getElementById('essay-related-highlights');
  if (!container) return;
  const tags = _getEssayTags(essay);
  if (!tags.length) { container.innerHTML = ''; return; }

  const matched = highlights.filter(h => {
    const haystack = ((h.text || '') + ' ' + (h.whyItStayed || '')).toLowerCase();
    return tags.some(tag => haystack.includes(tag));
  }).slice(0, 6);

  if (!matched.length) { container.innerHTML = ''; return; }

  const book = id => books.find(b => b.id === id);
  container.innerHTML = `
    <div class="related-section-header">Related highlights</div>
    <div class="related-highlights-list">
      ${matched.map(h => {
        const b   = book(h.bookId);
        const col = b ? getCoverColor(b.category) : '#3a5a8c';
        return `<div class="related-highlight-card" style="border-left-color:${col}" onclick="openHighlightDetail(${h.id})">
          <p class="related-highlight-text">&ldquo;${h.text}&rdquo;</p>
          ${b ? `<p class="related-highlight-source">&mdash; ${b.title}</p>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function _renderRelatedEssays(essay) {
  const container = document.getElementById('essay-related-essays');
  if (!container) return;
  const tags = _getEssayTags(essay);
  if (!tags.length) { container.innerHTML = ''; return; }

  const matched = essays.filter(e => {
    if (e.id === essay.id) return false;
    return _getEssayTags(e).some(t => tags.includes(t));
  }).slice(0, 4);

  if (!matched.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="related-section-header">Related essays</div>
    <div class="related-essays-list">
      ${matched.map(e => `
        <div class="related-essay-card" onclick="openEssay(${e.id})">
          <p class="related-essay-title">${e.title}</p>
          ${e.subtitle ? `<p class="related-essay-subtitle">${e.subtitle}</p>` : ''}
          ${e.tags ? `<p class="related-essay-tags">${Array.isArray(e.tags) ? e.tags.join(', ') : e.tags}</p>` : ''}
        </div>`).join('')}
    </div>`;
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

async function shareEssay() {
  const essay = essays.find(e => e.id === currentEssayId);
  if (!essay) return;
  const subject = essay.title;
  const bodyText = `${essay.title}\n\n${essay.content}`;
  // Build RFC 2822 MIME message and base64url-encode it
  const mime = [
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText
  ].join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(mime)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    await gapi.client.request({
      path:   'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      method: 'POST',
      body:   JSON.stringify({ message: { raw: encoded } })
    });
    window.open('https://mail.google.com/mail/#drafts', '_blank');
  } catch (err) {
    // Fallback: copy to clipboard and open blank compose
    navigator.clipboard.writeText(bodyText).catch(() => {});
    window.open(`https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject)}`, '_blank');
    alert('Could not create draft automatically. Essay copied to clipboard — paste into Gmail.');
  }
}

// ─── FORMS ────────────────────────────────────────────────────────────────────
function setMediumBtn(groupSelector, value) {
  document.querySelectorAll(`${groupSelector} .medium-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

const RATING_LABELS = {
  forgot:    { icon: '<i class="ph-bold ph-smiley-meh"></i>',  label: 'Already forgot the plot' },
  goodwhile: { icon: '<i class="ph-bold ph-coffee"></i>',        label: 'It was good while it lasted' },
  rentfree:  { icon: '<i class="ph-bold ph-brain"></i>',       label: 'Rent-free in my head' },
  wrecked:   { icon: '<i class="ph-bold ph-fire"></i>',        label: 'Wrecked me (in a good way)' },
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
  _resetOcrSection();
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
async function loadWishlist() {
  const container = document.getElementById('wishlist-list');
  if (wishlist.length === 0) {
    container.innerHTML = '<p class="home-empty">Nothing on your wishlist yet.</p>';
    return;
  }

  const savedOrder = await dbGetMeta('wishlist-order') || [];
  const ordered = [
    ...savedOrder.map(id => wishlist.find(w => w.id === id)).filter(Boolean),
    ...wishlist.filter(w => !savedOrder.includes(w.id))
  ];

  const listEl = document.createElement('div');
  listEl.id = 'wishlist-draggable-list';
  listEl.innerHTML = ordered.map(w => `
    <div class="home-waitlist-item" data-id="${w.id}">
      <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
      <div class="home-waitlist-spine" style="background-color:${getCoverColor(w.category)}"></div>
      <div class="home-waitlist-info" onclick="showEditWishlistForm(${w.id})">
        <span class="home-waitlist-title">${w.title}</span>
        ${w.author ? `<span class="home-waitlist-author">${w.author}</span>` : ''}
        <span class="home-waitlist-category">${w.category}</span>
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
    </div>`).join('');

  container.innerHTML = '';
  container.appendChild(listEl);
  makeDraggableList(listEl, saveWishlistOrder);
}

function showEditWishlistForm(id) {
  const item = wishlist.find(w => w.id === id);
  if (!item) return;
  document.getElementById('edit-wishlist-title').value    = item.title;
  document.getElementById('edit-wishlist-category').value = item.category;
  document.getElementById('edit-wishlist-author').value   = item.author || '';
  document.getElementById('edit-wishlist-note').value     = item.note   || '';
  const form = document.getElementById('edit-wishlist-form');
  form._editId = id;
  form.classList.remove('hidden');
  form.style.display = 'flex';
}

async function updateWishlistItem(event) {
  event.preventDefault();
  const form = document.getElementById('edit-wishlist-form');
  const id   = form._editId;
  const item = wishlist.find(w => w.id === id);
  if (!item) return;
  item.title    = document.getElementById('edit-wishlist-title').value;
  item.category = document.getElementById('edit-wishlist-category').value;
  item.author   = document.getElementById('edit-wishlist-author').value;
  item.note     = document.getElementById('edit-wishlist-note').value;
  await dbPut('wishlist', item);
  hideForm();
  await saveAndSync();
  loadWishlist();
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
  _categoryManualWishlist = false;
  document.getElementById('wishlist-book-suggestions').classList.add('hidden');
  document.getElementById('wishlist-book-suggestions').innerHTML = '';
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
    if (field.hasAttribute('data-no-voice')) return;
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

// ─── SPRINT ───────────────────────────────────────────────────────────────────
function loadSprint() {
  renderSprintActive();
  renderSprintAchieved();
  renderSprintArchived();
}

function showSprintForm() {
  document.getElementById('sprint-form').classList.remove('hidden');
  document.getElementById('sprint-name').value   = '';
  document.getElementById('sprint-target').value = '';
  document.getElementById('sprint-start').value  = '';
  document.getElementById('sprint-end').value    = '';
  document.getElementById('sprint-custom-dates').style.display = 'none';
  document.querySelectorAll('.sprint-duration-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
}

function hideSprintForm() {
  document.getElementById('sprint-form').classList.add('hidden');
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.sprint-duration-btn');
  if (!btn) return;
  document.querySelectorAll('.sprint-duration-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sprint-custom-dates').style.display = btn.dataset.custom ? 'block' : 'none';
});

async function saveSprint() {
  const name   = document.getElementById('sprint-name').value.trim();
  const target = parseInt(document.getElementById('sprint-target').value);
  if (!name || !target || target < 1) return;

  const activeBtn = document.querySelector('.sprint-duration-btn.active');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let startDate, endDate;

  if (activeBtn.dataset.custom) {
    startDate = document.getElementById('sprint-start').value;
    endDate   = document.getElementById('sprint-end').value;
    if (!startDate || !endDate) return;
  } else {
    startDate = today.toISOString().slice(0, 10);
    const end = new Date(today);
    if (activeBtn.dataset.weeks) end.setDate(end.getDate() + parseInt(activeBtn.dataset.weeks) * 7);
    if (activeBtn.dataset.months) end.setMonth(end.getMonth() + parseInt(activeBtn.dataset.months));
    endDate = end.toISOString().slice(0, 10);
  }

  const challenge = { id: nextId(challenges), name, target, startDate, endDate };
  await dbPut('challenges', challenge);
  hideSprintForm();
  await saveAndSync();
  loadSprint();
}

async function deleteSprint(id) {
  if (!confirm('Delete this sprint?')) return;
  await dbDelete('challenges', id);
  await saveAndSync();
  loadSprint();
}

function sprintProgress(c) {
  return books.filter(b =>
    b.status === 'Completed' &&
    b.dateCompleted &&
    b.dateCompleted >= c.startDate &&
    b.dateCompleted <= c.endDate
  ).length;
}

function renderSprintActive() {
  const today  = new Date().toISOString().slice(0, 10);
  const active = challenges.filter(c => c.endDate >= today);
  const el     = document.getElementById('sprint-active');
  if (active.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `<p class="sprint-section-label">Active</p>` + active.map(c => {
    const done     = sprintProgress(c);
    const pct      = Math.min(100, Math.round((done / c.target) * 100));
    const daysLeft = Math.ceil((new Date(c.endDate) - new Date()) / (1000 * 60 * 60 * 24));
    return `<div class="sprint-card">
      <div class="sprint-card-top">
        <span class="sprint-card-name">${c.name}</span>
        <button class="sprint-card-delete" onclick="deleteSprint(${c.id})" title="Delete">&#215;</button>
      </div>
      <p class="sprint-motivation">A little reading a day keeps the existential dread at bay.</p>
      <div class="sprint-progress-row">
        <span class="sprint-progress-text">${done} / ${c.target} books</span>
        <span class="sprint-days-left">${daysLeft > 0 ? daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left' : 'Last day!'}</span>
      </div>
      <div class="sprint-bar-track"><div class="sprint-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderSprintAchieved() {
  const today    = new Date().toISOString().slice(0, 10);
  const achieved = challenges.filter(c => c.endDate < today && sprintProgress(c) >= c.target);
  const el       = document.getElementById('sprint-achieved');
  if (achieved.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `<p class="sprint-section-label">Achieved</p>` + achieved.map(c => {
    const done = sprintProgress(c);
    return `<div class="sprint-card sprint-card-achieved">
      <div class="sprint-card-top">
        <span class="sprint-card-name">${c.name}</span>
        <button class="sprint-card-delete" onclick="deleteSprint(${c.id})" title="Delete">&#215;</button>
      </div>
      <p class="sprint-achieved-headline">Plot twist: you actually did it. 🎉</p>
      <p class="sprint-achieved-sub">You said ${c.target}. You read ${done}. Respect.</p>
      <p class="sprint-achieved-range">${formatDate(c.startDate)} – ${formatDate(c.endDate)}</p>
    </div>`;
  }).join('');
}

function renderSprintArchived() {
  const today    = new Date().toISOString().slice(0, 10);
  const archived = challenges.filter(c => c.endDate < today && sprintProgress(c) < c.target);
  const el       = document.getElementById('sprint-archived');
  if (archived.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `<p class="sprint-section-label">Archived</p>` + archived.map(c => {
    const done = sprintProgress(c);
    const pct  = Math.min(100, Math.round((done / c.target) * 100));
    return `<div class="sprint-card sprint-card-archived">
      <div class="sprint-card-top">
        <span class="sprint-card-name">${c.name}</span>
        <button class="sprint-card-delete" onclick="deleteSprint(${c.id})" title="Delete">&#215;</button>
      </div>
      <div class="sprint-progress-row">
        <span class="sprint-progress-text">${done} / ${c.target} books</span>
        <span class="sprint-achieved-range">${formatDate(c.startDate)} – ${formatDate(c.endDate)}</span>
      </div>
      <div class="sprint-bar-track"><div class="sprint-bar-fill sprint-bar-fill-dim" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ─── IMAGE OCR IMPORT ────────────────────────────────────────────────────────
let _tesseractWorker = null;

function importHighlightFromImage() {
  document.getElementById('highlight-image-input').click();
}

async function handleHighlightImageFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  // Open the Add Highlight form first
  showAddHighlightForm();

  // Show OCR section with image preview
  const objectUrl = URL.createObjectURL(file);
  const preview   = document.getElementById('ocr-preview');
  preview.src     = objectUrl;
  preview.onload  = () => URL.revokeObjectURL(objectUrl);

  const ocrSection = document.getElementById('ocr-section');
  ocrSection.style.display = 'block';
  _setOcrProgress('Loading OCR engine… (first use may take ~10s)', 5);

  try {
    if (!_tesseractWorker) {
      _tesseractWorker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'loading tesseract core') {
            _setOcrProgress('Loading OCR engine…', 10);
          } else if (m.status === 'initializing tesseract') {
            _setOcrProgress('Initialising…', 30);
          } else if (m.status === 'loading language traineddata') {
            _setOcrProgress('Loading language data…', 50);
          } else if (m.status === 'initializing api') {
            _setOcrProgress('Initialising API…', 65);
          } else if (m.status === 'recognizing text') {
            const pct = Math.round(65 + (m.progress || 0) * 35);
            _setOcrProgress('Extracting text…', pct);
          }
        }
      });
    } else {
      _setOcrProgress('Extracting text…', 65);
    }

    const result = await _tesseractWorker.recognize(file);
    const text   = result.data.text.trim();

    document.getElementById('highlight-text-input').value = text;
    _setOcrProgress('Done — review and edit the text below', 100);

    // Collapse the OCR section after a short delay
    setTimeout(() => {
      ocrSection.style.display = 'none';
    }, 1800);

  } catch (err) {
    console.error('OCR failed', err);
    _setOcrProgress('OCR failed. Please type the text manually.', 0);
  }
}

function _setOcrProgress(message, percent) {
  const el  = document.getElementById('ocr-status-text');
  const bar = document.getElementById('ocr-progress-bar-fill');
  if (el)  el.textContent    = message;
  if (bar) bar.style.width   = percent + '%';
}

function _resetOcrSection() {
  const ocrSection = document.getElementById('ocr-section');
  if (ocrSection) ocrSection.style.display = 'none';
  const preview = document.getElementById('ocr-preview');
  if (preview) preview.src = '';
  _setOcrProgress('', 0);
}

// ─── AI SERVICE LAYER ─────────────────────────────────────────────────────────

/**
 * Core AI call. Sends a message to either OpenAI or Anthropic.
 * @param {string}   systemPrompt  - Instructions / constraints for the AI
 * @param {Array}    thread        - Prior [{role,content}] messages for refinement context
 * @param {string}   userMessage   - The new user message
 * @returns {Promise<string>}      - The AI's plain-text response
 */
async function callAI(systemPrompt, thread = [], userMessage) {
  const provider = await dbGetMeta('ai_provider') || 'openai';
  const apiKey   = await dbGetMeta('ai_api_key')  || '';

  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const messages = [
    ...thread,
    { role: 'user', content: userMessage }
  ];

  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 2048,
        system:     systemPrompt,
        messages
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API error ${res.status}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text ?? '';

  } else {
    // Default: OpenAI
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model:      'gpt-4o',
        max_tokens: 2048,
        messages:   [{ role: 'system', content: systemPrompt }, ...messages]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/**
 * Wraps a callAI() call for UI use.
 * On NO_API_KEY, nudges the user to Settings rather than throwing.
 * Returns the response string, or null if the key is missing.
 */
async function callAIWithFeedback(systemPrompt, thread, userMessage, feedbackEl) {
  try {
    if (feedbackEl) { feedbackEl.textContent = 'Thinking…'; feedbackEl.classList.remove('hidden'); }
    const result = await callAI(systemPrompt, thread, userMessage);
    if (feedbackEl) feedbackEl.classList.add('hidden');
    return result;
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.textContent = err.message === 'NO_API_KEY'
        ? 'No API key set. Go to Settings to add one.'
        : `AI error: ${err.message}`;
      feedbackEl.classList.remove('hidden');
    }
    return null;
  }
}

// ─── AI SYSTEM PROMPTS ────────────────────────────────────────────────────────

const AI_PROMPTS = {

  compiledThought: `You help writers build essays from their own thinking.
Your task is to compile a single paragraph (4–8 lines) from the user's raw notes.

STRICT RULES:
- Use ONLY content from the user's responses. Do NOT introduce any new ideas.
- Preserve original phrasing as much as possible.
- Remove duplicate or filler lines.
- Reorder content into this flow: (1) Observation or reaction, (2) Expansion, (3) Focus, (4) Tension or depth, (5) Closing line.
- Add minimal connectors only where necessary (e.g. "At the same time", "This becomes", "What remains is").
- Do NOT summarise abstractly. Do NOT change meaning.
- Output only the paragraph — no title, no explanation, no commentary.`,

  research: `You are a research assistant helping a writer find relevant intellectual material.
The user will provide their core idea and selected categories.
You will also receive any highlights the user has saved from their reading as context — use this to make suggestions more relevant.

For each selected category, return 2–3 items. Group results by category.
Each item must include:
- What it is (1–2 lines)
- Core idea (2–3 lines)
- Why it fits the user's idea (1–2 lines)

Format each item as:
**[Category]**
**Name:** [name]
What it is: [...]
Core idea: [...]
Why it fits: [...]

Only return items. No preamble or closing remarks.`,

  sectionDraft: `You are a writing assistant helping a writer draft one section of an essay.
You will receive the essay outline, the writer's compiled thought, any attached research, and previously written sections for context.

Your task is to draft only the requested section.
- Match the tone and voice of previously written sections if available.
- Incorporate attached research naturally where relevant, only if it strengthens the section.
- Do not write the full essay. Write only the requested section.
- Do not add a section heading — just the body text.
- Aim for the word count appropriate to the chosen format (Essay: ~200–300 words per section; Blog: ~100–200; Reflection: ~100–200).`,

  finalize: `You are an editor helping a writer polish a complete essay draft.
Your task is to improve flow and coherence across all sections.

RULES:
- Do not introduce new ideas.
- Do not change the writer's meaning or rewrite their voice.
- Fix transitions between sections.
- Remove repetition.
- Improve sentence-level flow only where needed.
- Return the full polished essay text only — no commentary.`,

  titles: `You are a writing assistant helping a writer choose a title for their essay.
Generate exactly 3 title options.
- Each title should be distinct in style (e.g. one declarative, one question, one elliptical or poetic).
- Titles should reflect the actual content and tone — not be generic.
- Keep titles concise (under 10 words each).
- Return only the 3 titles, one per line, numbered 1. 2. 3. — no other text.`,

  subtitle: `You are a writing assistant helping a writer create a subtitle for their essay.
Generate a single subtitle that:
- Complements and expands on the chosen title
- Hints at the essay's main argument or perspective
- Is 8–15 words long
- Reads naturally alongside the title
Return only the subtitle — no quotes, no explanation.`,

  tags: `You are a writing assistant helping a writer tag their essay for discovery.
Generate exactly 8 tags for the essay.
- Tags should be specific and meaningful — avoid generic words like "essay", "writing", "ideas".
- Mix conceptual tags (themes, ideas) with topical tags (subjects, domains).
- Use lowercase, 1–3 words each.
- Return only the 8 tags as a comma-separated list on a single line — no other text.`
};

// ─── AI TYPED CALL FUNCTIONS ──────────────────────────────────────────────────

async function aiCompiledThought(notes, thread, instruction, feedbackEl) {
  const userMsg = instruction
    ? `Here are my notes:\n\n${notes}\n\nInstruction: ${instruction}`
    : `Here are my notes:\n\n${notes}`;
  return callAIWithFeedback(AI_PROMPTS.compiledThought, thread, userMsg, feedbackEl);
}

async function aiResearch(excerpt, compiledThought, userHighlights, categories, thread, instruction, feedbackEl) {
  const highlightContext = userHighlights.length > 0
    ? `\n\nThe user's saved highlights (for context):\n${userHighlights.slice(0, 20).map(h => `- "${h.text}" (${h.bookTitle || ''})`).join('\n')}`
    : '';
  const base = `My core idea: ${compiledThought || excerpt}\n\nCategories I want: ${categories.join(', ')}${highlightContext}`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.research, thread, userMsg, feedbackEl);
}

async function aiSectionDraft(outline, compiledThought, attachedResearch, previousSections, sectionTitle, thread, instruction, feedbackEl) {
  const researchText = attachedResearch.length > 0
    ? `\n\nAttached research:\n${attachedResearch.map(r => `[${r.placement}] ${r.name}: ${r.coreIdea}`).join('\n')}`
    : '';
  const prevText = previousSections.length > 0
    ? `\n\nPreviously written sections:\n${previousSections.map(s => `## ${s.title}\n${s.content}`).join('\n\n')}`
    : '';
  const outlineText = `Outline:\n${outline.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}`;
  const base = `${outlineText}\n\nMy core idea: ${compiledThought}${researchText}${prevText}\n\nNow draft the section titled: "${sectionTitle}"`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.sectionDraft, thread, userMsg, feedbackEl);
}

async function aiFinalize(allSections, thread, instruction, feedbackEl) {
  const draftText = allSections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');
  const base = `Here is the full draft:\n\n${draftText}`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.finalize, thread, userMsg, feedbackEl);
}

async function aiTitles(draftText, thread, instruction, feedbackEl) {
  const base = `Here is my essay:\n\n${draftText}`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.titles, thread, userMsg, feedbackEl);
}

async function aiSubtitle(draftText, title, thread, instruction, feedbackEl) {
  const base = `Essay title: ${title}\n\nEssay:\n\n${draftText}`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.subtitle, thread, userMsg, feedbackEl);
}

async function aiTags(draftText, thread, instruction, feedbackEl) {
  const base = `Here is my essay:\n\n${draftText}`;
  const userMsg = instruction ? `${base}\n\nInstruction: ${instruction}` : base;
  return callAIWithFeedback(AI_PROMPTS.tags, thread, userMsg, feedbackEl);
}

// ─── BUILD ESSAY FLOW ─────────────────────────────────────────────────────────

let _buildDraft = null;

const THINKING_STAGES = [
  { id: 1, name: 'Open',   storeKey: 'open_notes',   questions: ['What exactly is happening in this line?', 'What is your reaction?', 'Where does this connect to your experience?'] },
  { id: 2, name: 'Expand', storeKey: 'expand_notes', questions: ['What else belongs with this idea?', 'Can you think of an example?', 'If this continues, where does it lead?'] },
  { id: 3, name: 'Focus',  storeKey: 'focus_note',   questions: ['Which one idea is worth keeping?', 'What can you discard?', 'Say this in one sentence'] },
  { id: 4, name: 'Deepen', storeKey: 'deepen_notes', questions: ['Why does this matter?', 'Where might this be wrong?', 'What don\'t you understand yet?'] },
  { id: 5, name: 'Edge',   storeKey: 'edge_note',    questions: ['What are you actually saying?', 'What is in conflict here?', 'Where do you stand?'] }
];

const FEELING_OPTIONS = [
  { value: 'recognition', label: 'Recognition', desc: 'feels true or familiar' },
  { value: 'discomfort',  label: 'Discomfort',  desc: 'something feels off' },
  { value: 'curiosity',   label: 'Curiosity',   desc: 'want to understand' },
  { value: 'memory',      label: 'Memory',      desc: 'reminds me of something personal' },
  { value: 'judgment',    label: 'Judgment',    desc: 'disagree / challenge' },
  { value: 'connection',  label: 'Connection',  desc: 'links to something else' },
  { value: 'not-sure',    label: 'Not sure',    desc: 'unclear reaction' }
];

// ── Entry / exit ───────────────────────────────────────────────────────────────

async function openBuildEssay() {
  _buildDraft = await dbGetActiveDraft();
  if (!_buildDraft) _buildDraft = newDraftTemplate();
  document.getElementById('build-essay-overlay').classList.remove('hidden');
  renderBuildStep(_buildDraft);
}

function closeBuildEssay() {
  document.getElementById('build-close-modal').classList.remove('hidden');
}

function hideBuildCloseModal() {
  document.getElementById('build-close-modal').classList.add('hidden');
}

async function saveBuildDraft() {
  if (_buildDraft) await dbSaveDraft(_buildDraft);
  _closeBuildOverlay();
}

async function discardBuildDraft() {
  if (_buildDraft && _buildDraft.id) await dbDeleteDraft(_buildDraft.id);
  _buildDraft = null;
  _closeBuildOverlay();
}

function _closeBuildOverlay() {
  document.getElementById('build-essay-overlay').classList.add('hidden');
  document.getElementById('build-close-modal').classList.add('hidden');
  loadEssays();
}

// ── State machine ──────────────────────────────────────────────────────────────

function renderBuildStep(draft) {
  const body      = document.getElementById('build-body');
  const indicator = document.getElementById('build-step-indicator');
  if (!body) return;
  body.innerHTML  = '';
  body.scrollTop  = 0;

  const labels = { 2: 'What triggered this?', 3: 'How does it feel?', 4: 'Time to think', '4o': 'Your compiled thought', '4n': 'Next action', 5: 'Research', 6: 'Structure', 7: 'Write', '9a': 'Polish', '9b': 'Title', '9c': 'Subtitle', '9d': 'Tags' };
  if (indicator) indicator.textContent = labels[draft.step] || 'Build Essay';

  switch (String(draft.step)) {
    case '2':  return _renderStep2(draft, body);
    case '3':  return _renderStep3(draft, body);
    case '4':  return _renderStep4(draft, body);
    case '4o': _renderStep4Output(draft, body); if (!draft.compiled_thought) _triggerCompiledThought(); return;
    case '4n': return _renderStep4Next(draft, body);
    case '5':  return _renderStep5(draft, body);
    case '6':  return _renderStep6(draft, body);
    case '7':  return _renderStep7(draft, body);
    case '9a': _renderStep9a(draft, body); if (!draft.finalized_draft) _triggerFinalize(); return;
    case '9b': _renderStep9b(draft, body); if (!draft.title)           _triggerTitles();  return;
    case '9c': _renderStep9c(draft, body); if (!draft.subtitle)        _triggerSubtitle(); return;
    case '9d': return _renderStep9d(draft, body);
    default:   body.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">This step is coming next.</p>';
  }
}

async function _autoSave() {
  if (!_buildDraft) return;
  try {
    const key = await dbSaveDraft(_buildDraft);
    if (!_buildDraft.id && key) _buildDraft.id = key;
  } catch (e) { console.warn('Auto-save failed', e); }
}

// ── Step 2: Excerpt ────────────────────────────────────────────────────────────

function _renderStep2(draft, body) {
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Add the line or idea that triggered this</p>
      <textarea class="build-textarea" id="build-excerpt-input" placeholder="Paste or type the line here…">${draft.excerpt || ''}</textarea>
      <div class="build-nav">
        <button class="build-next-btn" onclick="buildStep2Next()">Next →</button>
      </div>
    </div>`;
}

function buildStep2Next() {
  const val = document.getElementById('build-excerpt-input').value.trim();
  if (!val) { alert('Please enter a line or idea first.'); return; }
  _buildDraft.excerpt = val;
  _buildDraft.step    = 3;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 3: Feeling selection ──────────────────────────────────────────────────

function _renderStep3(draft, body) {
  const pills = FEELING_OPTIONS.map(f =>
    `<button class="feeling-pill ${draft.feeling_tag === f.value ? 'active' : ''}" onclick="selectFeeling('${f.value}')" data-value="${f.value}">
      <span class="feeling-label">${f.label}</span>
      <span class="feeling-desc">${f.desc}</span>
    </button>`).join('');
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">How does this idea land for you?</p>
      <div class="feeling-pills">${pills}</div>
      <div class="build-nav">
        <button class="build-next-btn" onclick="buildStep3Next()">Next →</button>
      </div>
    </div>`;
}

function selectFeeling(value) {
  _buildDraft.feeling_tag = value;
  document.querySelectorAll('.feeling-pill').forEach(p => p.classList.toggle('active', p.dataset.value === value));
}

function buildStep3Next() {
  if (!_buildDraft.feeling_tag) { alert('Please select how this idea feels.'); return; }
  _buildDraft.step  = 4;
  _buildDraft.stage = 1;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 4: Thinking stages ────────────────────────────────────────────────────

let _selectedQuestions = [];

function _renderStep4(draft, body) {
  const stageDef = THINKING_STAGES[draft.stage - 1];
  if (!stageDef) { _buildDraft.step = '4o'; _autoSave(); renderBuildStep(_buildDraft); return; }
  _selectedQuestions = [];

  const existing = _getExistingStageNote(draft, stageDef.storeKey);
  const qPills   = stageDef.questions.map((q, i) =>
    `<button class="question-pill" onclick="toggleQuestion(this,'${q.replace(/'/g,'\\\'')}',${i})" data-idx="${i}">${q}</button>`
  ).join('');

  body.innerHTML = `
    <div class="build-step">
      <div class="stage-header">
        <span class="stage-badge">Stage ${draft.stage} of 5</span>
        <span class="stage-name">${stageDef.name}</span>
      </div>
      <p class="build-prompt-small">Select one or two questions to guide your thinking, then write your response:</p>
      <div class="question-pills">${qPills}</div>
      <textarea class="build-textarea" id="build-stage-response" placeholder="Write your response here…"></textarea>
      ${existing ? `<p class="stage-existing-note"><em>Earlier note:</em> ${existing}</p>` : ''}
      <div class="build-nav">
        <button class="build-skip-btn" onclick="buildStageSkip()">Skip</button>
        <button class="build-next-btn" onclick="buildStageNext()">Next →</button>
      </div>
    </div>`;
}

function _getExistingStageNote(draft, storeKey) {
  const val = draft[storeKey];
  if (!val) return '';
  return Array.isArray(val) ? val.join(' / ') : val;
}

function toggleQuestion(btn, question, idx) {
  const isActive = btn.classList.toggle('active');
  if (isActive) {
    if (_selectedQuestions.length >= 2) {
      const first = document.querySelector(`.question-pill.active:not([data-idx="${idx}"])`);
      if (first) { first.classList.remove('active'); _selectedQuestions = _selectedQuestions.filter(q => q !== first.textContent.trim()); }
    }
    _selectedQuestions.push(question);
  } else {
    _selectedQuestions = _selectedQuestions.filter(q => q !== question);
  }
}

function buildStageNext() {
  const response = document.getElementById('build-stage-response').value.trim();
  _saveStageResponse(response);
  _advanceStage();
}

function buildStageSkip() {
  _advanceStage();
}

function _saveStageResponse(text) {
  if (!text) return;
  const stageDef = THINKING_STAGES[_buildDraft.stage - 1];
  if (!stageDef) return;
  const key = stageDef.storeKey;
  if (Array.isArray(_buildDraft[key])) _buildDraft[key].push(text);
  else _buildDraft[key] = text;
}

function _advanceStage() {
  if (_buildDraft.stage >= 5) {
    _buildDraft.step = '4o';
    _autoSave();
    renderBuildStep(_buildDraft);
  } else {
    _buildDraft.stage++;
    _autoSave();
    renderBuildStep(_buildDraft);
  }
}

// ── Step 4 Output: Compiled Thought ───────────────────────────────────────────

function _compileNotesForAI(draft) {
  const parts = [];
  if (draft.excerpt)              parts.push(`Excerpt: ${draft.excerpt}`);
  if (draft.feeling_tag)          parts.push(`Feeling: ${draft.feeling_tag}`);
  if (draft.open_notes?.length)   parts.push(`Open:\n${draft.open_notes.join('\n')}`);
  if (draft.expand_notes?.length) parts.push(`Expand:\n${draft.expand_notes.join('\n')}`);
  if (draft.focus_note)           parts.push(`Focus: ${draft.focus_note}`);
  if (draft.deepen_notes?.length) parts.push(`Deepen:\n${draft.deepen_notes.join('\n')}`);
  if (draft.edge_note)            parts.push(`Edge: ${draft.edge_note}`);
  return parts.join('\n\n');
}

function _renderStep4Output(draft, body) {
  const hasResult = !!draft.compiled_thought;
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Your compiled thought</p>
      <div id="build-compiled-thought" class="compiled-thought-box ${hasResult ? '' : 'loading'}">
        <p id="compiled-thought-text">${hasResult ? draft.compiled_thought : 'Generating your compiled thought…'}</p>
      </div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${hasResult ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask AI to change something…" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineCompiledThought()">Refine</button>
      </div>
      <div class="build-validation">
        <p class="build-prompt-small">Does this capture what you're trying to say?</p>
        <div class="build-nav build-nav-row">
          <button class="build-option-btn active-btn" onclick="compiledThoughtYes()">Yes, continue →</button>
          <button class="build-option-btn" onclick="compiledThoughtEdit()">Edit directly</button>
          <button class="build-option-btn" onclick="compiledThoughtRethink()">Keep thinking</button>
        </div>
      </div>` : ''}
    </div>`;
}

async function _triggerCompiledThought() {
  const feedbackEl = document.getElementById('build-ai-feedback');
  const notes      = _compileNotesForAI(_buildDraft);
  const result     = await aiCompiledThought(notes, _buildDraft.compiled_thought_thread, null, feedbackEl);
  if (!result) return;
  _buildDraft.compiled_thought = result;
  _buildDraft.compiled_thought_thread.push(
    { role: 'user',      content: `Here are my notes:\n\n${notes}` },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineCompiledThought() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const notes      = _compileNotesForAI(_buildDraft);
  const result     = await aiCompiledThought(notes, _buildDraft.compiled_thought_thread, instruction, feedbackEl);
  if (!result) return;
  _buildDraft.compiled_thought_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  _buildDraft.compiled_thought = result;
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function compiledThoughtYes() {
  _buildDraft.step = '4n';
  _autoSave();
  renderBuildStep(_buildDraft);
}

function compiledThoughtEdit() {
  const textEl = document.getElementById('compiled-thought-text');
  if (!textEl) return;
  const current = _buildDraft.compiled_thought;
  textEl.insertAdjacentHTML('afterend', `<textarea id="compiled-thought-edit" class="build-textarea" style="margin-top:0.5rem">${current}</textarea><div class="build-nav" style="margin-top:0.25rem"><button class="build-next-btn" onclick="saveCompiledThoughtEdit()">Save</button></div>`);
  textEl.style.display = 'none';
  document.getElementById('compiled-thought-edit').focus();
}

function saveCompiledThoughtEdit() {
  const ta = document.getElementById('compiled-thought-edit');
  if (!ta) return;
  _buildDraft.compiled_thought = ta.value.trim();
  _autoSave();
  renderBuildStep(_buildDraft);
}

function compiledThoughtRethink() {
  _buildDraft.step  = 4;
  _buildDraft.stage = 1;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 4 Next: Choose direction ──────────────────────────────────────────────

function _renderStep4Next(draft, body) {
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">What do you want to do next?</p>
      <div class="build-options-stack">
        <button class="build-option-card" onclick="buildChooseResearch()">
          <span class="build-option-title">Explore research</span>
          <span class="build-option-desc">Find frameworks, theories, quotes and examples that support or challenge your idea</span>
        </button>
        <button class="build-option-card" onclick="buildChooseWrite()">
          <span class="build-option-title">Start building</span>
          <span class="build-option-desc">Go straight to choosing a structure and writing</span>
        </button>
      </div>
    </div>`;
}

function buildChooseResearch() {
  _buildDraft.step = 5;
  _autoSave();
  renderBuildStep(_buildDraft);
}

function buildChooseWrite() {
  _buildDraft.step = 6;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 5: Research ───────────────────────────────────────────────────────────

const RESEARCH_CATEGORIES = ['Frameworks','Theories','Books','Quotes','Examples','Opposing viewpoints'];
const RESEARCH_PLACEMENTS = ['Intro','Supporting point','Counterpoint','Not sure'];

function _renderStep5(draft, body) {
  const selected = draft.research_categories || [];
  const catPills = RESEARCH_CATEGORIES.map(c =>
    `<button class="question-pill ${selected.includes(c) ? 'active' : ''}" onclick="toggleResearchCategory('${c}')" data-cat="${c}">${c}</button>`
  ).join('');

  const resultsHtml = draft.research_results?.length
    ? _renderResearchResults(draft)
    : '<p class="build-prompt-small" id="research-results-placeholder">Select categories above and tap Search to get suggestions.</p>';

  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Explore research</p>
      <p class="build-prompt-small">Choose up to 3 categories:</p>
      <div class="question-pills">${catPills}</div>
      <div class="build-nav build-nav-row" style="margin-top:0">
        <button class="build-next-btn" onclick="runResearchSearch()">Search →</button>
      </div>
      <div id="research-results-area">${resultsHtml}</div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${draft.research_results?.length ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask AI for different suggestions…" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineResearch()">Refine</button>
      </div>` : ''}
      <div class="build-nav" style="margin-top:1rem">
        <button class="build-skip-btn" onclick="skipResearch()">Continue without research</button>
        ${draft.research_results?.length ? `<button class="build-next-btn" onclick="buildStep5Done()">Done →</button>` : ''}
      </div>
    </div>`;
}

function toggleResearchCategory(cat) {
  const max = 3;
  const arr = _buildDraft.research_categories || [];
  const i   = arr.indexOf(cat);
  if (i > -1) { arr.splice(i, 1); }
  else { if (arr.length >= max) { alert('Select up to 3 categories.'); return; } arr.push(cat); }
  _buildDraft.research_categories = arr;
  document.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', arr.includes(b.dataset.cat)));
}

async function runResearchSearch() {
  const cats = _buildDraft.research_categories;
  if (!cats?.length) { alert('Please select at least one category.'); return; }
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiResearch(
    _buildDraft.excerpt,
    _buildDraft.compiled_thought,
    highlights,
    cats,
    _buildDraft.research_thread,
    null,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.research_results = _parseResearchResults(result);
  _buildDraft.research_thread.push(
    { role: 'user',      content: `Categories: ${cats.join(', ')}. My idea: ${_buildDraft.compiled_thought}` },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineResearch() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiResearch(
    _buildDraft.excerpt,
    _buildDraft.compiled_thought,
    highlights,
    _buildDraft.research_categories,
    _buildDraft.research_thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.research_results = _parseResearchResults(result);
  _buildDraft.research_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function _parseResearchResults(raw) {
  // Split by bold category headers like **Frameworks**
  const blocks = raw.split(/\n(?=\*\*[^*]+\*\*)/).filter(b => b.trim());
  const items  = [];
  let currentCat = '';
  for (const block of blocks) {
    const catMatch = block.match(/^\*\*([^*]+)\*\*/);
    if (catMatch) currentCat = catMatch[1].trim();
    const nameMatch = block.match(/\*\*Name:\*\*\s*(.+)/);
    const whatMatch = block.match(/What it is:\s*(.+)/s);
    const coreMatch = block.match(/Core idea:\s*(.+?)(?:\nWhy|$)/s);
    const whyMatch  = block.match(/Why it fits:\s*(.+)/s);
    if (nameMatch) {
      items.push({
        id:       Date.now() + Math.random(),
        category: currentCat,
        name:     nameMatch[1].trim(),
        whatItIs: whatMatch?.[1]?.trim() || '',
        coreIdea: coreMatch?.[1]?.trim() || '',
        whyItFits:whyMatch?.[1]?.trim() || '',
        placement: ''
      });
    }
  }
  return items;
}

function _renderResearchResults(draft) {
  const byCategory = {};
  (draft.research_results || []).forEach(item => {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  });
  const attached = new Set((draft.attached_research || []).map(r => r.id));
  return Object.entries(byCategory).map(([cat, items]) => `
    <div class="research-category">
      <p class="research-cat-label">${cat}</p>
      ${items.map(item => `
        <div class="research-item" id="ri-${item.id}">
          <p class="research-item-name">${item.name}</p>
          <p class="research-item-what">${item.whatItIs}</p>
          <p class="research-item-core">${item.coreIdea}</p>
          <p class="research-item-why">Why it fits: ${item.whyItFits}</p>
          ${attached.has(item.id)
            ? `<span class="research-used-badge">✓ Added</span>`
            : `<div class="research-use-row">
                <button class="build-option-btn" onclick="showResearchPlacement(${JSON.stringify(item.id)})">Use this</button>
               </div>
               <div id="placement-${item.id}" class="research-placement-picker hidden">
                 ${RESEARCH_PLACEMENTS.map(p =>
                   `<button class="question-pill" onclick="attachResearch(${JSON.stringify(item.id)},'${p}')">${p}</button>`
                 ).join('')}
               </div>`
          }
        </div>`).join('')}
    </div>`).join('');
}

function showResearchPlacement(itemId) {
  document.querySelectorAll('.research-placement-picker').forEach(el => {
    el.classList.toggle('hidden', el.id !== `placement-${itemId}`);
  });
}

function attachResearch(itemId, placement) {
  const item = _buildDraft.research_results.find(r => r.id === itemId);
  if (!item) return;
  if (!_buildDraft.attached_research) _buildDraft.attached_research = [];
  item.placement = placement;
  const already = _buildDraft.attached_research.find(r => r.id === itemId);
  if (!already) _buildDraft.attached_research.push({ ...item });
  _autoSave();
  // Refresh results display inline
  const area = document.getElementById('research-results-area');
  if (area) area.innerHTML = _renderResearchResults(_buildDraft);
}

function skipResearch() {
  _buildDraft.step = 6;
  _autoSave();
  renderBuildStep(_buildDraft);
}

function buildStep5Done() {
  _buildDraft.step = 6;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 6: Structure ──────────────────────────────────────────────────────────

const ESSAY_FORMATS = [
  { id: 'essay',      label: 'Essay',      words: '800–1500 words', sections: ['Introduction','Main idea','Supporting point 1','Supporting point 2','Conclusion'] },
  { id: 'blog',       label: 'Blog Post',  words: '500–900 words',  sections: ['Hook','Main idea','Section 1','Section 2','Takeaway'] },
  { id: 'reflection', label: 'Reflection', words: '300–700 words',  sections: ['Trigger','Thoughts','Insight'] }
];

function _renderStep6(draft, body) {
  const hasOutline = draft.outline?.length > 0;
  const formatCards = ESSAY_FORMATS.map(f => `
    <button class="build-option-card ${draft.format === f.id ? 'active' : ''}" onclick="selectFormat('${f.id}')" id="fcard-${f.id}">
      <span class="build-option-title">${f.label}</span>
      <span class="build-option-desc">${f.words}</span>
    </button>`).join('');

  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">What do you want to turn this into?</p>
      <div class="build-options-stack">${formatCards}</div>
      ${hasOutline ? `
      <p class="build-prompt-small" style="margin-top:1rem">Edit your outline:</p>
      <div id="outline-editor">${_renderOutlineEditor(draft.outline)}</div>
      <div class="build-nav build-nav-row">
        <button class="build-skip-btn" onclick="addOutlineSection()">+ Add section</button>
      </div>` : ''}
      <div class="build-nav">
        ${draft.format ? `<button class="build-next-btn" onclick="buildStep6Next()">Start writing →</button>` : ''}
      </div>
    </div>`;
}

function _renderOutlineEditor(outline) {
  return outline.map((s, i) => `
    <div class="outline-item" data-idx="${i}">
      <input class="outline-title-input" type="text" value="${s.title.replace(/"/g,'&quot;')}" onchange="updateOutlineTitle(${i}, this.value)">
      <div class="outline-item-actions">
        ${i > 0 ? `<button class="outline-move-btn" onclick="moveOutlineItem(${i},-1)" title="Move up">↑</button>` : ''}
        ${i < outline.length-1 ? `<button class="outline-move-btn" onclick="moveOutlineItem(${i},1)" title="Move down">↓</button>` : ''}
        <button class="outline-del-btn" onclick="removeOutlineSection(${i})" title="Remove">✕</button>
      </div>
    </div>`).join('');
}

function selectFormat(formatId) {
  _buildDraft.format = formatId;
  const fmt = ESSAY_FORMATS.find(f => f.id === formatId);
  if (!_buildDraft.outline?.length && fmt) {
    _buildDraft.outline = fmt.sections.map((t, i) => ({ id: i + 1, title: t, order: i }));
  }
  _autoSave();
  renderBuildStep(_buildDraft);
}

function updateOutlineTitle(idx, val) {
  if (_buildDraft.outline[idx]) _buildDraft.outline[idx].title = val;
  _autoSave();
}

function moveOutlineItem(idx, dir) {
  const arr    = _buildDraft.outline;
  const target = idx + dir;
  if (target < 0 || target >= arr.length) return;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  _buildDraft.outline = arr.map((s, i) => ({ ...s, order: i }));
  _autoSave();
  const editor = document.getElementById('outline-editor');
  if (editor) editor.innerHTML = _renderOutlineEditor(_buildDraft.outline);
}

function removeOutlineSection(idx) {
  _buildDraft.outline.splice(idx, 1);
  _buildDraft.outline = _buildDraft.outline.map((s, i) => ({ ...s, order: i }));
  _autoSave();
  const editor = document.getElementById('outline-editor');
  if (editor) editor.innerHTML = _renderOutlineEditor(_buildDraft.outline);
}

function addOutlineSection() {
  const n = _buildDraft.outline.length;
  _buildDraft.outline.push({ id: Date.now(), title: 'New section', order: n });
  _autoSave();
  const editor = document.getElementById('outline-editor');
  if (editor) editor.innerHTML = _renderOutlineEditor(_buildDraft.outline);
}

function buildStep6Next() {
  if (!_buildDraft.format || !_buildDraft.outline?.length) {
    alert('Please choose a format first.'); return;
  }
  // Initialise draft_sections to match outline if not already
  const existing = new Set((_buildDraft.draft_sections || []).map(s => s.id));
  _buildDraft.outline.forEach(s => {
    if (!existing.has(s.id)) _buildDraft.draft_sections.push({ id: s.id, title: s.title, content: '' });
  });
  _buildDraft.step = 7;
  _buildDraft._sectionIdx = 0;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 7: Write (section by section) ────────────────────────────────────────

function _renderStep7(draft, body) {
  const idx     = draft._sectionIdx ?? 0;
  const section = draft.draft_sections?.[idx];
  if (!section) {
    // All sections done
    _buildDraft.step = '9a';
    _autoSave();
    renderBuildStep(_buildDraft);
    return;
  }

  const total    = draft.draft_sections.length;
  const hasContent = !!section.content;
  const thread   = draft.section_threads?.[section.id] || [];

  body.innerHTML = `
    <div class="build-step">
      <div class="stage-header">
        <span class="stage-badge">Section ${idx + 1} of ${total}</span>
        <span class="stage-name">${section.title}</span>
      </div>
      <div id="section-draft-box" class="compiled-thought-box ${hasContent ? '' : 'loading'}">
        <p id="section-draft-text" style="white-space:pre-wrap">${hasContent ? section.content : 'Generating draft…'}</p>
      </div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${hasContent ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask AI to change something…" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineSectionDraft()">Refine</button>
      </div>` : ''}
      <div class="build-nav">
        ${total > 1 && idx > 0 ? `<button class="build-skip-btn" onclick="buildSection(-1)">← Previous</button>` : ''}
        ${hasContent ? `<button class="build-next-btn" onclick="buildSectionNext()">${idx < total - 1 ? 'Next section →' : 'Finish writing →'}</button>` : ''}
      </div>
    </div>`;

  if (!hasContent) _triggerSectionDraft();
}

async function _triggerSectionDraft() {
  const idx      = _buildDraft._sectionIdx ?? 0;
  const section  = _buildDraft.draft_sections[idx];
  if (!section) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const previous   = _buildDraft.draft_sections.slice(0, idx);
  const thread     = _buildDraft.section_threads?.[section.id] || [];

  const result = await aiSectionDraft(
    _buildDraft.outline,
    _buildDraft.compiled_thought,
    _buildDraft.attached_research || [],
    previous,
    section.title,
    thread,
    null,
    feedbackEl
  );
  if (!result) return;
  section.content = result;
  if (!_buildDraft.section_threads) _buildDraft.section_threads = {};
  _buildDraft.section_threads[section.id] = [
    ...thread,
    { role: 'user',      content: `Draft the section: "${section.title}"` },
    { role: 'assistant', content: result }
  ];
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineSectionDraft() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const idx        = _buildDraft._sectionIdx ?? 0;
  const section    = _buildDraft.draft_sections[idx];
  const thread     = _buildDraft.section_threads?.[section.id] || [];
  const previous   = _buildDraft.draft_sections.slice(0, idx);

  const result = await aiSectionDraft(
    _buildDraft.outline,
    _buildDraft.compiled_thought,
    _buildDraft.attached_research || [],
    previous,
    section.title,
    thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  section.content = result;
  _buildDraft.section_threads[section.id] = [
    ...thread,
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  ];
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function buildSectionNext() {
  // Save any direct edits to textarea if user typed
  const textEl = document.getElementById('section-draft-text');
  const section = _buildDraft.draft_sections[_buildDraft._sectionIdx ?? 0];
  if (textEl && section) section.content = textEl.textContent;
  buildSection(1);
}

function buildSection(dir) {
  const next = (_buildDraft._sectionIdx ?? 0) + dir;
  if (next < 0) return;
  _buildDraft._sectionIdx = next;
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 9a: Polish ─────────────────────────────────────────────────────────────

function _renderStep9a(draft, body) {
  const hasContent = !!draft.finalized_draft;
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Your polished draft</p>
      <div id="finalized-box" class="compiled-thought-box ${hasContent ? '' : 'loading'}">
        <p id="finalized-text" style="white-space:pre-wrap">${hasContent ? draft.finalized_draft : 'Polishing your draft\u2026'}</p>
      </div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${hasContent ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask AI to change something\u2026" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineFinalized()">Refine</button>
      </div>` : ''}
      <div class="build-nav">
        ${hasContent ? `<button class="build-next-btn" onclick="buildStep9aNext()">Choose a title \u2192</button>` : ''}
      </div>
    </div>`;
}

async function _triggerFinalize() {
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiFinalize(
    _buildDraft.draft_sections,
    _buildDraft.finalize_thread,
    null,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.finalized_draft = result;
  _buildDraft.finalize_thread.push(
    { role: 'user',      content: 'Please polish and unify this draft.' },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineFinalized() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiFinalize(
    _buildDraft.draft_sections,
    _buildDraft.finalize_thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.finalized_draft = result;
  _buildDraft.finalize_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function buildStep9aNext() {
  _buildDraft.step = '9b';
  _buildDraft.title_options = [];
  _buildDraft.title_thread  = [];
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 9b: Title ──────────────────────────────────────────────────────────────

function _renderStep9b(draft, body) {
  const options = draft.title_options || [];
  const selected = draft.title || '';

  const optionsHtml = options.length
    ? options.map((t, i) => `
        <button class="build-option-card ${selected === t ? 'active' : ''}" onclick="selectTitle(${i})">
          <span class="build-option-title">${t}</span>
        </button>`).join('')
    : '<p class="build-prompt-small" id="title-placeholder">Generating title options\u2026</p>';

  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Choose a title</p>
      <div class="build-options-stack" id="title-options-list">${optionsHtml}</div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${options.length ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask for different titles\u2026" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineTitles()">Refine</button>
      </div>` : ''}
      <div class="build-nav">
        ${selected ? `<button class="build-next-btn" onclick="buildStep9bNext()">Add a subtitle \u2192</button>` : ''}
      </div>
    </div>`;
}

async function _triggerTitles() {
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiTitles(
    _buildDraft.finalized_draft,
    _buildDraft.title_thread,
    null,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.title_options = _parseTitleOptions(result);
  _buildDraft.title_thread.push(
    { role: 'user',      content: 'Generate title options for this essay.' },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineTitles() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiTitles(
    _buildDraft.finalized_draft,
    _buildDraft.title_thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.title_options = _parseTitleOptions(result);
  _buildDraft.title         = '';
  _buildDraft.title_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function _parseTitleOptions(raw) {
  return raw
    .split('\n')
    .map(l => l.replace(/^[\d\-.*]+\.?\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim())
    .filter(l => l.length > 3)
    .slice(0, 5);
}

function selectTitle(idx) {
  _buildDraft.title = _buildDraft.title_options[idx];
  _autoSave();
  renderBuildStep(_buildDraft);
}

function buildStep9bNext() {
  if (!_buildDraft.title) { alert('Please select a title.'); return; }
  _buildDraft.step            = '9c';
  _buildDraft.subtitle        = '';
  _buildDraft.subtitle_thread = [];
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 9c: Subtitle ──────────────────────────────────────────────────────────

function _renderStep9c(draft, body) {
  const hasSubtitle = !!draft.subtitle;
  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Add a subtitle</p>
      <p class="build-prompt-small">Title: <strong>${draft.title}</strong></p>
      <div id="subtitle-box" class="compiled-thought-box ${hasSubtitle ? '' : 'loading'}">
        <p id="subtitle-text" style="white-space:pre-wrap">${hasSubtitle ? draft.subtitle : 'Generating subtitle\u2026'}</p>
      </div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${hasSubtitle ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask for a different subtitle\u2026" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineSubtitle()">Refine</button>
      </div>` : ''}
      <div class="build-nav">
        ${hasSubtitle ? `<button class="build-next-btn" onclick="buildStep9cNext()">Choose tags \u2192</button>` : ''}
        ${hasSubtitle ? `<button class="build-skip-btn" onclick="skipSubtitle()">Skip subtitle</button>` : ''}
      </div>
    </div>`;
}

async function _triggerSubtitle() {
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiSubtitle(
    _buildDraft.finalized_draft,
    _buildDraft.title,
    _buildDraft.subtitle_thread,
    null,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.subtitle = result.trim();
  _buildDraft.subtitle_thread.push(
    { role: 'user',      content: `Title: ${_buildDraft.title}. Generate a subtitle.` },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineSubtitle() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiSubtitle(
    _buildDraft.finalized_draft,
    _buildDraft.title,
    _buildDraft.subtitle_thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.subtitle = result.trim();
  _buildDraft.subtitle_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function skipSubtitle() {
  _buildDraft.subtitle        = '';
  _buildDraft.step            = '9d';
  _buildDraft.tags            = [];
  _buildDraft.tags_thread     = [];
  _autoSave();
  renderBuildStep(_buildDraft);
}

function buildStep9cNext() {
  _buildDraft.step        = '9d';
  _buildDraft.tags        = [];
  _buildDraft.tags_thread = [];
  _autoSave();
  renderBuildStep(_buildDraft);
}

// ── Step 9d: Tags ───────────────────────────────────────────────────────────────

function _renderStep9d(draft, body) {
  const suggestions  = draft.tag_suggestions || [];
  const selected     = draft.tags || [];
  const loading      = !suggestions.length;

  const chipHtml = suggestions.length
    ? suggestions.map(t => `
        <button class="question-pill ${selected.includes(t) ? 'active' : ''}" onclick="toggleTag('${t.replace(/'/g,'\\&apos;')}")">${t}</button>`).join('')
    : '<p class="build-prompt-small">Generating tag suggestions\u2026</p>';

  body.innerHTML = `
    <div class="build-step">
      <p class="build-prompt">Choose tags</p>
      <p class="build-prompt-small">These help you find and connect this essay later. Pick any that fit.</p>
      <div class="question-pills" id="tag-chips">${chipHtml}</div>
      <div id="build-ai-feedback" class="build-ai-feedback hidden"></div>
      ${suggestions.length ? `
      <div class="refinement-area">
        <textarea class="build-refine-input" id="build-refine-input" placeholder="Ask for different tag ideas\u2026" rows="2"></textarea>
        <button class="build-refine-send" onclick="refineTags()">Refine</button>
      </div>` : ''}
      <div class="build-nav">
        <button class="build-skip-btn" onclick="saveBuiltEssay()">Skip &amp; Publish</button>
        ${selected.length ? `<button class="build-next-btn" onclick="saveBuiltEssay()">Publish essay \u2192</button>` : ''}
      </div>
    </div>`;

  if (loading) _triggerTags();
}

async function _triggerTags() {
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiTags(
    _buildDraft.finalized_draft,
    _buildDraft.tags_thread,
    null,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.tag_suggestions = _parseTagSuggestions(result);
  _buildDraft.tags_thread.push(
    { role: 'user',      content: 'Suggest tags for this essay.' },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

async function refineTags() {
  const instruction = document.getElementById('build-refine-input')?.value.trim();
  if (!instruction) return;
  const feedbackEl = document.getElementById('build-ai-feedback');
  const result = await aiTags(
    _buildDraft.finalized_draft,
    _buildDraft.tags_thread,
    instruction,
    feedbackEl
  );
  if (!result) return;
  _buildDraft.tag_suggestions = _parseTagSuggestions(result);
  _buildDraft.tags            = [];
  _buildDraft.tags_thread.push(
    { role: 'user',      content: instruction },
    { role: 'assistant', content: result }
  );
  await _autoSave();
  renderBuildStep(_buildDraft);
}

function _parseTagSuggestions(raw) {
  return raw
    .split(/[,\n]+/)
    .map(t => t.replace(/^[\d\-.*#]+\.?\s*/, '').replace(/\*\*/g,'').trim().toLowerCase())
    .filter(t => t.length > 1 && t.length < 40)
    .slice(0, 8);
}

function toggleTag(tag) {
  const arr = _buildDraft.tags || [];
  const i   = arr.indexOf(tag);
  if (i > -1) arr.splice(i, 1);
  else         arr.push(tag);
  _buildDraft.tags = arr;
  _autoSave();
  document.querySelectorAll('#tag-chips .question-pill').forEach(b => {
    b.classList.toggle('active', arr.includes(b.textContent));
  });
  // Show/hide Publish button
  renderBuildStep(_buildDraft);
}

async function saveBuiltEssay() {
  const draft = _buildDraft;
  if (!draft.finalized_draft) { alert('No content to save.'); return; }

  // Reload essays array to get a fresh id
  const allEssays = await dbGetAll('essays');
  const id = allEssays.length === 0 ? 1 : Math.max(...allEssays.map(e => e.id)) + 1;

  const tagStr = (draft.tags || []).join(', ');
  const essay = {
    id,
    title:    draft.title    || 'Untitled essay',
    subtitle: draft.subtitle || '',
    date:     new Date().toISOString().slice(0, 10),
    tags:     tagStr,
    content:  draft.finalized_draft,
    source:   'built'
  };

  await dbPut('essays', essay);
  if (draft.id) await dbDeleteDraft(draft.id);
  _buildDraft = null;

  _closeBuildOverlay();
  await loadEssays();
  openEssay(id);
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const provider = await dbGetMeta('ai_provider') || 'openai';
  const key      = await dbGetMeta('ai_api_key')  || '';
  const providerEl = document.getElementById('settings-ai-provider');
  const keyEl      = document.getElementById('settings-ai-key');
  if (providerEl) providerEl.value = provider;
  if (keyEl)      keyEl.value      = key;
  const msg = document.getElementById('settings-save-msg');
  if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
}

async function saveSettings() {
  const provider = document.getElementById('settings-ai-provider').value;
  const key      = document.getElementById('settings-ai-key').value.trim();
  const msg      = document.getElementById('settings-save-msg');

  await dbSetMeta('ai_provider', provider);
  await dbSetMeta('ai_api_key',  key);

  msg.textContent = 'Settings saved.';
  msg.classList.remove('hidden', 'error');
  setTimeout(() => msg.classList.add('hidden'), 3000);
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('settings-ai-key');
  const eye   = document.getElementById('settings-key-eye');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    eye.className = 'ph-bold ph-eye-slash';
  } else {
    input.type = 'password';
    eye.className = 'ph-bold ph-eye';
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
  await openDB();
  await loadData();
  initializeForms();
  initVoice();
  showView('home');
  document.addEventListener('click', e => {
    const combobox = document.getElementById('book-combobox');
    if (combobox && !combobox.contains(e.target)) _closeBookDropdown();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

boot();
