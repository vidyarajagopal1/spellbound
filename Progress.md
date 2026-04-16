# SpellBound — Progress Log

SpellBound is a personal reading memory PWA. Pure static frontend (HTML/CSS/JS), deployed on GitHub Pages. No backend — all data stored in IndexedDB, with optional Google Drive sync via the `appDataFolder` API.

---

## Architecture

| Layer | Choice |
|---|---|
| Storage | IndexedDB v3 (books + highlights + essays + wishlist + challenges + meta stores) |
| Sync | Google Drive `appDataFolder` — single JSON file, read on sign-in, written on every change |
| Hosting | GitHub Pages (static, no server) |
| Offline | Service Worker with cache-first strategy, versioned cache (`spellbound-vN`) |
| Auth | Google Identity Services (`gapi` + `gis`) — silent sign-in on load, prompt fallback |

---

## Features Built

### Core (Initial Release)
- **Books** — add/edit/delete with title, status (Reading / Completed / Paused / Waitlisted), category (Fiction / History / Politics / Philosophy / Graphic Novels)
- **Highlights** — add/edit/delete quotes linked to a book, with reflection and impact level (low / medium / high)
- **Five tabs** — Home, Books, Highlights, Essays, Wishlist
- **Home** — Currently Reading shelf + Recent Highlights feed
- **Book detail view** — pills row (status, category, medium), metadata grid (date completed, notes, aftertaste, favourite character), highlights list
- **PWA** — manifest, service worker, installable

### Medium Field (SW v4–v6)
- Toggle-button UI (Kindle 📱 / Audiobook 🎧 / Physical 📖) instead of a dropdown
- Wired via JS click handlers with `.active` class toggle; `setMediumBtn()` helper for pre-filling edit form
- Medium shown as a pill in book detail view and as a badge icon on cover tiles

### Draggable Waitlist (pre-v7)
- Waitlist tab with drag-and-drop reordering of waitlisted books
- Persisted order saved back to IndexedDB

### Wishlist Tab (SW v7)
- Separate wishlist store — books you want to read but haven't started
- "Move to Books" flow promotes a wishlist item into the main books store

### Voice Input (SW v8)
- Microphone button added to every text input and textarea in the app
- Uses Web Speech API (`SpeechRecognition`) — appends transcript to existing field value
- Graceful fallback if browser doesn't support it

### Kindle Import (SW v9) → replaced in v14
- Initial import: parsed Kindle `My Clippings.txt` format
- Later replaced entirely by Bookcision JSON import (see v14)

### Add Highlight — Book Selector Fix (SW v10)
- Bug: book selector in Add Highlight form was pre-selecting a stale book when opened from non-book-detail views
- Fix: reset `currentBookId` in `showView()` for any view that isn't book detail

### Radio Button Styling Fix (SW v11)
- Impact level radio buttons in Add Highlight form were unstyled/broken
- Replaced with consistent toggle-button pattern matching the medium buttons

### Google Sign-in Visibility Fix (SW v12)
- Silent auth was running before the header status element was updated, so "Tap to sign in" never appeared on first load
- Fix: always set the prompt text before attempting silent auth, so users see the correct state immediately

### Author Field (SW v13)
- Added `author` field to book objects
- Shown in: book detail header (below title), waitlist rows, edit form
- Stored and synced via Drive like all other fields

### Bookcision JSON Import + Category Modal (SW v14)
- Replaced Kindle `.txt` import with **Bookcision JSON** import
- Bookcision is a browser extension that exports Kindle highlights as structured JSON (title, author, highlights array)
- On import: creates the book (if not found by title match) and bulk-inserts all highlights
- A modal prompts for category assignment before saving, since Bookcision JSON doesn't include category

### Google Books Auto-Lookup (SW v15–v17)
- Debounced 2 s after typing in the title field (Add Book and Edit Book forms)
- Query uses `intitle:` operator for accuracy; fetches up to 5 results
- On match: auto-fills **author** and **category** fields
- Category mapping: Google Books `categories` array → SpellBound's fixed category list (Fiction / History / Politics / Philosophy / Graphic Novels)
- Manual category edits are flagged (`_categoryManualEdit`) and not overwritten by a subsequent lookup
- Cover images were added then removed by user request — colour tiles kept instead
- Technical: `fetch` to `https://www.googleapis.com/books/v1/volumes?q=intitle:...&maxResults=5`, no API key required for basic metadata

### Rating System (SW v18)
- Four rating levels for completed books: **Forgot** 😶 / **Good while it lasted** 🍂 / **Rent-free** 🧠 / **Wrecked** 🔥
- Full labels: "Already forgot the plot" / "It was good while it lasted" / "Rent-free in my head" / "Wrecked me (in a good way)"
- **In forms** (Add Book + Edit Book, inside completion fields): full-text toggle buttons ("How did it land?"), same pattern as medium buttons
- **In book detail view**: full label pill (e.g. `🔥 Wrecked me (in a good way)`) in the pills row
- **On cover tiles**: icon only (😶 / 🍂 / 🧠 / 🔥) as a small badge in the bottom-left corner (medium icon stays bottom-right)
- Stored as `rating` field on book object (`'forgot'` | `'goodwhile'` | `'rentfree'` | `'wrecked'` | `''`)
- `RATING_LABELS` constant maps value → `{ icon, label }`
- `setRatingBtn(groupSelector, value)` helper mirrors `setMediumBtn()` for pre-filling edit form
- Cover tile bottom padding increased to prevent badge overlap with title text

### "The pages you've dog-eared" + Highlight Detail (SW v19)
- Replaced Recent Highlights feed on Home with a single random highlight card
- Section heading: **"The pages you've dog‑eared"** with a ↻ refresh button
- Refresh picks a new random highlight (avoids repeating the current one)
- Card shows quote text + book title; tapping opens a new **Highlight Detail view**
- Highlight Detail view shows: quote, book title, reflection, date. Back button returns to Home
- **Empty / inactive state**: shown when no highlights exist OR no highlight has been saved in the last 7 days
  - Copy: *"There is no friend as loyal as a book. And you didn't save a single thing it said? 💔"*
  - Primary action button: **Add Highlight**
- `savedAt` ISO timestamp added to every new highlight for recency tracking

### Stale Reading Nudge (SW v20)
- Reading books with no activity in 10+ days get a nudge banner below the cover shelf on Home
- Activity = adding a highlight (`savedAt`) or editing the book (`updatedAt`)
- `updatedAt` ISO timestamp added to book objects on every Add/Edit save
- Nudge copy: *"📚 If [Title] were a library book, you'd owe a fine by now!"*
- Tap to dismiss (in-memory only — reappears on next load if still stale)
- One nudge card per stale book

### Sprint Tab (SW v21)
- New **Sprint** tab (⚡) added at the end of the nav
- Create time-boxed reading challenges with: name, target (number of books), duration (2 weeks / 1 month / 3 months / custom date range)
- Progress counts books whose `dateCompleted` falls within the sprint's start–end range
- **Active cards** show: name, motivational line (*"A little reading a day keeps the existential dread at bay."*), `X / Y books` + thin progress bar, days remaining
- **Achieved** (target met after end date): *"Plot twist: you actually did it. 🎉 You said X. You read X. Respect."*
- **Archived** (target not met after end date): greyed out with final tally
- Multiple simultaneous sprints supported
- New `challenges` store in IndexedDB (`{ id, name, target, startDate, endDate }`), included in Drive sync
- IndexedDB bumped to v3

### Home Page UI Improvements
- **Hero strip** — gradient banner at the top of Home with time-aware greeting (*Good morning / afternoon / evening*) and a dry-wit message based on reading count:
  - 0 books → *"Books don't read themselves. Allegedly."*
  - 1 book → *"Just the one. Suspicious."*
  - 2+ books → *"Juggling N books. Very on-brand."*
- **Section cards** — Currently Reading, Dog-eared, and Waitlisted sections each wrapped in a subtle bordered panel (`1px solid rgba(white, 7%)`) to visually separate them
- **Section spacing** — gap between Dog-eared and Waitlisted increased from `0` to `1.25rem`; spacing below Currently Reading from `0.5rem` to `1.25rem`
- **Section title top margin** reset to `0` inside panels (panel padding provides breathing room)

### Books Tab UI Improvements
- **Status pill tabs** — horizontal scrollable pill row (All · Reading · Waitlisted · Paused · Completed) replaces the status dropdown as the primary filter UI; hidden `#books-status-filter` select kept in DOM for `loadBooks()` compatibility; `setStatusFilter()` wires pills to select and handles active state
- **Category dropdown** moved to a second toolbar row alongside the Add Book button
- **Group heading accents** — each status group heading gets a left-border in its status colour:
  - Reading → green (`#4caf50`)
  - Waitlisted → purple (`#9c6fda`)
  - Paused → amber (`#f5a623`)
  - Completed → blue (`#6ea8fe`)

### Wishlist Improvements (SW v22–v27)

- **Book lookup on Add Wishlist form** — debounced `oninput` on the title field queries the **Open Library API** (`openlibrary.org/search.json`) and shows clickable suggestion cards (title, author, category auto-fill). Switched from Google Books API which was silently failing.
- **Draggable wishlist list** — Wishlist tab now renders a flat draggable list using the same `makeDraggableList()` utility as the Home waitlist. Reorder persists via `wishlist-order` key in the `meta` IndexedDB store and is included in Drive sync payload.
- **Click to edit** — tapping a wishlist row title opens a pre-filled `#edit-wishlist-form` with title / category / author / note fields. `showEditWishlistForm(id)` populates the form; `updateWishlistItem(event)` saves changes.
- **"Add to Books" button styling** — made subtle: transparent background, muted text colour, smaller padding/font — no longer visually competing with the row content.

### Essay Sharing (SW v28–v32)

- **Replaced Print button** with two separate actions: **✉ Gmail** and **🖨 Save as PDF**.
- **Gmail button iterations**:
  - v28: `navigator.share` Web Share API — opened Outlook instead of Gmail (OS-controlled, can't target specific app)
  - v29: Gmail compose URL (`?view=cm&su=...&body=...`) — returned Error 400 for long essays (URL too long)
  - v31: Clipboard + Gmail compose URL with subject only — works but requires manual paste
  - v32 (current): **Gmail API draft creation** — builds an RFC 2822 MIME message, base64url-encodes it, and POSTs to `gmail.googleapis.com/gmail/v1/users/me/drafts`. Opens `mail.google.com/#drafts` on success so user can address and send the complete essay.
  - Requires `gmail.compose` OAuth scope (added alongside `drive.appdata`) and Gmail API enabled in Google Cloud Console. Falls back to clipboard + compose URL if the API call fails.

---

| Version | Changes |
|---|---|
| v1–v3 | Initial PWA, cache setup |
| v4–v5 | Medium field, icon fixes, script load order |
| v6 | Medium buttons wired via JS |
| v7 | Wishlist tab |
| v8 | Voice input |
| v9 | Kindle import |
| v10 | Book selector fix |
| v11 | Radio button fix |
| v12 | Google sign-in fix |
| v13 | Author field |
| v14 | Bookcision import + category modal |
| v15 | Google Books lookup + cover images |
| v16 | Lookup fix: `intitle:` + 5 results |
| v17 | Remove cover images, keep lookup for author/category |
| v18 | Rating system (4 levels incl. 🍂 goodwhile); cover tile padding fix |
| v19 | "The pages you've dog-eared" + Highlight Detail view |
| v20 | Stale reading nudge; `updatedAt` on books, `savedAt` on highlights |
| v21 | Sprint tab + challenges store (IndexedDB v3) |
| v22–v24 | Wishlist book lookup (Open Library API); debounce + null-guards; cache-busting fixes |
| v25 | Wishlist draggable flat list (reusing `makeDraggableList`); order persisted in `meta` store + Drive sync |
| v26 | Click wishlist title → opens pre-filled edit form (`showEditWishlistForm`, `updateWishlistItem`) |
| v27 | "Add to Books" button on wishlist rows made subtle (transparent bg, muted text) |
| v28 | Essay sharing: added ✉ Gmail button + 🖨 Save as PDF button (was single Print button) |
| v29–v32 | Gmail sharing iterations: URL approach failed (400 Bad Request, body too long); switched to Gmail API draft creation via `gmail.compose` OAuth scope |

---

## Known Patterns / Conventions

- **Toggle buttons** (medium, rating): JS click handlers on each button, `active` class toggled, `set*Btn(selector, value)` helper used to pre-fill forms
- **Completion fields**: shown/hidden via `toggleCompletionFields()` based on status === 'Completed'
- **Favourite Character field**: shown/hidden based on category === 'Fiction' or 'Graphic Novels'
- **SW bump**: every feature push increments the cache version so returning users get fresh assets
- **Drive sync**: `saveAndSync()` called after every write — serialises all books + highlights to JSON and uploads to `appDataFolder`
