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
| v33–v44 | OCR image import (Tesseract.js v5); highlights toolbar restructured; edit highlight form + JS + CSS; book combobox with filter; toggle buttons for book choice; randomised home messages; stale nudge redesigned as full-width strip with triangle arrow |
| v45 | Dog-eared card redesigned: inline smart quotes, Caveat handwriting font, cream notecard background, border-top accent, drop shadow, slight tilt with hover straighten |
| v46 | Added notebook ruling lines to dog-eared card (later removed) |
| v47 | Removed ruling lines from dog-eared card |
| v48 | Dog-ear fold effect: CSS pseudo-element triangle on top-right corner |
| v49 | Fixed border bleed into fold; added right padding to prevent text/fold overlap |
| v50 | Nav tab active state: gold top-indicator line + icon scale; inactive tabs dimmed to 50% opacity |
| v51 | Replaced emoji nav icons with Phosphor Icons Bold (`ph-house`, `ph-books`, `ph-sparkle`, `ph-pencil-simple`, `ph-heart`, `ph-lightning`); white inactive / gold active |
| v52 | Active nav tab colour changed from gold to `--accent` red; inactive stayed white |
| v53–v58 | Book cover colour palette iterations: tried desaturated jewel tones (A), deep saturated (B), pastel (C); settled on pastel palette: Fiction `#C47A90`, History `#C4A96A`, Politics `#6B9CB8`, Philosophy `#9B8AB8`, Graphic Novels `#78A882` |
| v59 | Rating and medium icons on book covers: replaced drop-shadow with frosted dark pill background (`rgba(0,0,0,0.35)`) |
| v60 | Increased book-cover-body bottom padding from 28px to 42px to clear pill badges |
| v61 | Replaced emoji rating/medium icons with Phosphor Bold icons (white, CSS-colourable); `RATING_LABELS` and `MEDIUM_ICON` updated |
| v62–v63 | "Good while it lasted" icon changed: leaf → wind → coffee |
| v64 | Rating pill `left` offset increased from 8px to 18px to clear book spine |
| v65 | `--accent2` changed from gold `#f5a623` to teal `#4ABFBF` |
| v66 | Background palette changed from navy to deep forest: `--bg #141A16`, `--surface #1A2820`, `--surface2 #22382C` |
| v67 | Hero gradient hardcoded navy values replaced with deep forest surface tones |
| v68 | `--accent2` changed from teal to warm cream/ivory `#E8DFC8` |
| v69 | Added Playfair Display font; applied to app title (`SpellBound`) |
| v70 | Added Inter font as body font for all UI; Caveat kept for quote card only; quote attribution updated to use Inter |
| v71 | Hero message lightened to match stale nudge: `0.8rem`, `font-weight: 400`, `var(--text-muted)` |
| v72 | Quote card attribution (`— Book Title`) switched to Playfair Display italic |
| v73 | Numbers in hero messages now spelled out (`spellNum()` helper, covers 0–12) |
| v74 | Spelled numbers capitalised when sentence-initial |
| v75 | "Commitment is complicated" → "Commitment can sometimes be complicated" |
| v76 | Added favicon: generated `icon-192.png` and `icon-512.png` from source PNG; added `<link rel="icon">` and `<link rel="apple-touch-icon">` to `index.html`; trimmed white padding and applied dark background (`#1a1a2e`) to icons |
| v76 | Added header logo: generated `logo-header.png` (transparent background, green graphic) from source PNG; added `.app-title-group` wrapper with logo + title side by side; bumped SW cache to v76 |
| v77 | Highlights tab visual overhaul — see below |

### Favicon & Header Logo (SW v76)
- **Favicon**: generated `icon-192.png` and `icon-512.png` from source PNG (`SpellBound Favicon Green.png`) using `sharp`; trimmed white padding; applied dark background (`#1a1a2e`); added `<link rel="icon">` and `<link rel="apple-touch-icon">` to `index.html`. Icons appear on browser tabs, Android home screen (via manifest), and iOS home screen.
- **Header logo**: generated `logo-header.png` with white background removed (transparent), green graphic only; added `.app-title-group` flex wrapper in header with logo to the left of the title text; logo sized at `44px` height via CSS.

### Favicon Overhaul (post-v76)
- Replaced hand-generated icon files with a proper **favicon.io** icon set
- Files added: `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180×180, iOS), `android-chrome-192x192.png`, `android-chrome-512x512.png`
- `index.html` updated: replaced single `<link rel="icon">` + `<link rel="apple-touch-icon">` with the full set including `favicon.ico`, sized 16×16 and 32×32 PNGs, and 180×180 Apple touch icon
- `manifest.json` updated: icons array now points to `android-chrome-192x192.png` and `android-chrome-512x512.png`

### Highlights Tab Visual Overhaul (v77)
- **Removed search input** — the category filter alone is sufficient; search served no real purpose
- **Toolbar collapsed to one row** — category dropdown (neutral style) + red `+ Add Highlight ▾` button side by side
- **`+ Add Highlight` dropdown menu** — replaces three full-width action buttons; opens a small positioned menu with Phosphor Bold icons (`ph-pencil-simple`, `ph-image`, `ph-upload-simple`) and labels; dismisses on outside click
- **Delete button removed from highlight cards** — cards are now completely buttonless; tapping a card opens the edit form
- **Delete moved into edit form** — `Delete` button added between Save and Cancel in the edit highlight form, so destructive action is behind an intentional tap
- **Edit button removed from cards** — the edit pencil icon is gone; the whole card is the tap target for editing
- **Card treatment updated** — highlight cards now use the same `home-quote-card` parchment style as the "Pages you've dog-eared" section on Home: cream background, top-border accent in category colour, dog-ear fold pseudo-element, Caveat italic font for quote text, Playfair Display italic for source attribution, slight rotation with hover-straighten
- **`"` quote mark removed** from all highlight cards in both the tab and the book detail view

---

- **Toggle buttons** (medium, rating): JS click handlers on each button, `active` class toggled, `set*Btn(selector, value)` helper used to pre-fill forms
- **Completion fields**: shown/hidden via `toggleCompletionFields()` based on status === 'Completed'
- **Favourite Character field**: shown/hidden based on category === 'Fiction' or 'Graphic Novels'
- **SW bump**: every feature push increments the cache version so returning users get fresh assets
- **Drive sync**: `saveAndSync()` called after every write — serialises all books + highlights to JSON and uploads to `appDataFolder`

---

## AI-Assisted Essay Builder (v78–v87)

A full end-to-end multi-step flow for building essays from reading highlights, powered by OpenAI or Anthropic. Accessible from the Essays tab via "✦ Build Essay". One draft at a time. Resumable.

### Piece 1 — Settings Screen (v78)
- Gear icon (`ph-gear-six`) in the header, right-aligned in `.header-right` flex wrapper
- `settings-view`: AI provider dropdown (OpenAI / Anthropic) + masked API key input + eye-toggle + Save button
- `loadSettings()` / `saveSettings()` / `toggleApiKeyVisibility()` functions
- API key stored in `meta` IndexedDB store and never included in Drive sync payload
- Fixed header layout: `.header-right { flex-shrink: 0 }`, `.app-title-group { flex: 1 1 0; overflow: hidden }`
- Fixed SW cache versioning bug that was hiding the gear icon on returning visits

### Piece 2 — AI Service Layer (v78)
- `callAI(systemPrompt, thread, userMessage)` — core `fetch()` to OpenAI (`gpt-4o`) or Anthropic (`claude-sonnet-4-5`) REST APIs using user-supplied key from `meta` store
- `callAIWithFeedback(...)` — wraps `callAI` with a UI feedback element; gracefully handles missing API key
- `AI_PROMPTS` object with 7 system prompts: `compiledThought`, `research`, `sectionDraft`, `finalize`, `titles`, `subtitle`, `tags`
- 7 typed call functions: `aiCompiledThought`, `aiResearch`, `aiSectionDraft`, `aiFinalize`, `aiTitles`, `aiSubtitle`, `aiTags`

### Piece 3 — Database (v78)
- IndexedDB bumped v3 → v4; `essay_drafts` object store added
- Draft helpers: `dbGetActiveDraft()`, `dbSaveDraft(draft)`, `dbDeleteDraft(id)`, `newDraftTemplate()`
- `newDraftTemplate()` initialises all fields for all steps (excerpt, feeling, stage notes, compiled thought, research, outline, sections, finalized draft, title options, subtitle, tags)
- `syncFromDrive()` and `syncToDrive()` updated to include `essay_drafts` store

### Piece 4 — Build Flow Steps 2–4 (v78)
- "✦ Build Essay" / "↩ Resume Essay" button added to essays toolbar
- Full-screen overlay (`#build-essay-overlay`) with step indicator, close button, and close-confirm modal (Save Draft / Discard / Keep Writing)
- `_buildDraft` module-level state variable; `openBuildEssay()`, `closeBuildEssay()`, `saveBuildDraft()`, `discardBuildDraft()`, `_closeBuildOverlay()`
- `renderBuildStep(draft)` — switch-based state machine routing to step renderers
- `_autoSave()` — upserts draft to IndexedDB on every meaningful action
- **Step 2** (Excerpt): paste or type the passage that sparked the idea → `buildStep2Next()`
- **Step 3** (Feeling): 7 feeling-option pills (Recognition / Discomfort / Curiosity / Memory / Tension / Surprise / Longing) → `selectFeeling()`, `buildStep3Next()`
- **Step 4** (Thinking): 5 thinking stages (Open → Expand → Focus → Deepen → Edge), each with 3 question pills + free-text textarea; stage progress badge; skip allowed → `toggleQuestion()`, `buildStageNext()`, `buildStageSkip()`
- **Step 4o** (Compiled Thought): AI generates a synthesised thought from all stage notes; refinement textarea loop; Yes / Edit / Rethink actions → `_triggerCompiledThought()`, `refineCompiledThought()`, `compiledThoughtYes/Edit/Rethink()`
- **Step 4n** (Next Action): two option cards — "Research first" (→ step 5) or "Start writing" (→ step 6)

### Piece 5 — Build Flow Steps 5–7 (v79)
- **Step 5** (Research): multi-select category chips up to 3 (Frameworks / Theories / Books / Quotes / Examples / Opposing viewpoints); `aiResearch()` returns 2–3 items per category; each item has name / what it is / core idea / why it fits; "Use this" reveals placement chips (Intro / Supporting point / Counterpoint / Not sure); attached items saved to `draft.attached_research[]`; refinement loop; "Continue without research" skip
- **Step 6** (Structure): three format cards (Essay 800–1500w / Blog Post 500–900w / Reflection 300–700w); selecting a format auto-generates a default outline; inline outline editor with editable titles, move up/down, delete, add section; saves `draft.format` + `draft.outline[]`
- **Step 7** (Write): section by section; `aiSectionDraft()` uses outline + compiled thought + attached research + previous sections as context; editable AI output per section; refinement loop; Previous / Next section navigation; after last section advances to step `'9a'`
- Bug fix in same version: `function dbGetMeta(key) {` declaration had been accidentally dropped in Piece 3's insertion — restored

### Piece 6 — Build Flow Steps 9a–9d (v80)
- **Step 9a** (Polish): `aiFinalize()` reassembles and polishes all draft sections into a single flowing essay; refinement loop; "Choose a title →" advances
- **Step 9b** (Title): `aiTitles()` generates up to 5 title options parsed into selectable option cards; refinement loop for different styles; "Add a subtitle →" once selected
- **Step 9c** (Subtitle): `aiSubtitle()` generates a single subtitle using the chosen title as context; refinement loop; "Skip subtitle" option
- **Step 9d** (Tags): `aiTags()` generates 7–8 tag chips; toggle-select any; refinement loop; "Skip & Publish" or "Publish essay →"
- `saveBuiltEssay()` — assembles final essay `{ id, title, subtitle, date, tags (comma string), content, source: 'built' }`, writes to `essays` store, deletes draft, closes overlay, opens essay detail view

### Piece 7 — Essay Detail Related Sections (v81)
- Two new sections appended below essay body in `essay-detail-view`
- **Related Highlights**: finds highlights whose `text + whyItStayed` contains any of the essay's tags (case-insensitive keyword match); shows up to 6; each card is styled with the book's category colour as a left border; tappable to open highlight detail
- **Related Essays**: finds other essays sharing at least one tag; shows up to 4; tappable cards with title, subtitle, tags
- `_getEssayTags(essay)` helper normalises tags whether stored as comma string (manual essays) or array (built essays)
- Both sections are hidden when there are no matches

### Piece 8 — Essays Grid Tag Filters (v82)
- `#essays-tag-filters` div added between toolbar and grid in HTML
- `_essayTagFilter` state variable (empty = "All")
- `loadEssays()` collects all unique tags from all essays, sorts them, renders "All" pill + one pill per tag
- Active pill highlighted with `--accent2` tint; scrollable horizontally
- `setEssayTagFilter(tag)` updates state and re-renders grid

### Essays Tab UI Overhaul (v83–v87)

**v83 — Full redesign**
- Buttons redesigned as equal `.essays-action-btn` (flex: 1, same size, same style)
- Tag filter bar changed to single non-wrapping horizontally scrollable row (no multi-line wrapping)
- Tags removed from individual essay cards (filter bar carries that information)
- Essay cards redesigned: title (2-line clamp) + subtitle (1-line ellipsis) + date bottom-left; no preview, no tags, no delete button
- Delete button moved to essay detail view only
- Section header added: "N ESSAYS" label (uppercase `--accent2`) + Newest / Oldest / A–Z sort buttons in a grouped pill control
- `_essaySort` session-only state variable; `setEssaySort(val)` function
- `formatDate()` updated to humanised format ("9 Apr 2026") using `toLocaleDateString` with timezone fix (`T00:00:00` suffix)
- Option C color approach: `--accent2` used only at structural level (count label, active sort button); cards neutral

**v84 — Color pass**
- Essay cards get warm cream left border (`rgba(232,223,200,0.18)`) that brightens on hover/tap
- Date tinted `--accent2` at low opacity
- "Build Essay" button gets `--accent2` background tint and matching border to signal it as the featured action
- Sort buttons grouped inside `--surface2` pill container; active sort gets `--accent2` background chip

**v85 — Tag bar scroll hint**
- `#essays-tag-filters` wrapped in `.essays-tag-wrap` div
- `::after` pseudo-element fades right edge (`transparent → --bg`) to signal more pills off-screen
- JS scroll listener on the filter row toggles `.scrolled-end` class on the wrapper, fading out the gradient once the user reaches the end
- `checkEnd()` called immediately on render — gradient hidden if all pills fit without scrolling

**v86 — Button color correction**
- Both buttons changed to solid `var(--accent)` red fill with white text — matches nav tab red exactly
- Hover/active use opacity only so red stays consistent

**v87 — Spacing improvements + final button style**
- Buttons: solid `var(--accent)` red, `padding: 0.75rem`, `gap: 0.75rem` between them, toolbar `padding: 1rem 0`
- Tag row `padding-bottom` increased to `1rem`
- Section header `margin-bottom` increased to `1rem`, `padding-bottom` to `0.75rem`
- Card gap increased from `10px` to `14px`

---

| Version | Changes |
|---|---|
| v78 | AI Essay Builder: Settings screen, AI service layer, DB v4 + essay_drafts, Build flow steps 2–4 |
| v79 | Build flow steps 5–7 (Research, Structure, Write); fix: restored missing `dbGetMeta` declaration |
| v80 | Build flow steps 9a–9d (Polish, Title, Subtitle, Tags, Publish) |
| v81 | Essay detail: Related Highlights + Related Essays sections |
| v82 | Essays grid: tag filter pill bar, `_essayTagFilter` state, `setEssayTagFilter()` |
| v83 | Essays tab UI overhaul: equal buttons, scrollable tag bar, section header + sort, clean cards, humanised dates |
| v84 | Essays color pass: card left borders, Build Essay accent, sort pill container |
| v85 | Tag bar scroll fade hint (`::after` gradient + JS scroll listener) |
| v86 | Buttons corrected to solid `--accent` red |
| v87 | Spacing pass: toolbar, tag row, section header, card gap |
| v88 | Highlights search bar; Books tab row layout + sub-grouping; font and style polish |
| v89 | Books tab UX refinements: category pill stacking, heading cleanup, font consistency |

---

## Highlights Search (v88)

- **Category dropdown removed** from Highlights toolbar entirely
- **Single search bar** added: `<input type="search" id="highlight-search" placeholder="Search by keyword, book, or author…">`
- Live-filters as you type — a highlight passes if the query matches (case-insensitive, partial):
  - highlight text
  - book title
  - author name
- Empty query shows all highlights

---

## Books Tab Overhaul (v88–v89)

### Row layout (v88)
- Replaced the 3-column `home-covers` grid with full-width **horizontal rows** (`book-row`)
- Each row: 4px left border (category colour, full saturation) + category colour at 12% opacity as background tint
- Left side: book title (`0.85rem`, weight 600, Inter — matching Home waitlist) + author below in `0.65rem` italic muted
- Right side: category pill (filled, full colour, white text) stacked above a row of rating + medium icon badges
- **Delete button removed** from list view entirely — only accessible from the book detail view
- `hexToRgba(hex, alpha)` helper added next to `getCoverColor`
- Existing `.home-covers` / `.book-cover` CSS left untouched — still used by Home "Currently Reading" shelf

### Category sub-grouping (v88)
- Within each status group, books are **sub-grouped by category** in `CATEGORY_ORDER` sequence
- Sub-group headings: collapsible (expanded by default), toggled by `toggleBookSubgroup(id)`
- Caret icon rotates 90° when collapsed (`.rotated` class on `.book-subgroup-toggle`)
- `toggleBookSubgroup(id)` toggles `.collapsed` on the list div

### Search bar (v88)
- `<input type="search" id="books-search" placeholder="Search by title or author…">` added above status pills
- `loadBooks()` reads query and filters by title + author before grouping
- Category dropdown retained alongside `+ Add Book` in the second toolbar row

### Status heading cleanup (v89)
- **Count badge removed** from status headings — number no longer displayed next to "READING", "COMPLETED" etc.

### Category sub-group heading style (v89)
- Heading made much quieter: lowercase, no uppercase/letter-spacing, `rgba(255,255,255,0.2)` colour
- Faint `1px solid rgba(255,255,255,0.06)` divider line beneath each heading
- Count badge retained on category headings only (small, muted)

### Book detail view font (v88–v89)
- `.book-detail-title` switched to Playfair Display, `1.2rem`, weight 700, `line-height: 1.25`
- Meta card value text (Date Completed, Aftertaste, Favourite Character) reduced to `0.8rem` via `.book-meta-item span:not(.book-meta-label)`

---

## Find Your Next Read (v90)

An AI-powered book recommendation feature inside the Wishlist tab. Takes user mood, reference books/authors, and reading context as input, then returns 5 personalised book recommendations with the option to replace individual results or add them directly to the Wishlist.

### Wishlist Tab UI Redesign (v90)
- Replaced flat toolbar (two equal red buttons) with a **two-zone layout**:
  - **Zone 1 — FNR card**: tappable surface card at the top with wand icon, `Find Your Next Read` title in accent red, and tagline *"Somewhere out there is your next great read. Let's go find it."* + `→` arrow
  - **Zone 2 — Wishlist section**: titled card `YOUR WISHLIST` with a small red `+` button on the right; list items render as flat rows inside the card, separated by subtle dividers (no nested cards)
- Empty state updated to: *"Nothing here yet. Add a book manually or use Find Your Next Read above."*

### FNR Form (v90)
Six prompts, all visible at once:
1. **Genre mood** — up to 3 selectable pills (11 options + "Something else →" reveals text input)
2. **Topic/mood** — freetext textarea
3. **Reference book** — autocomplete via Google Books `intitle:` API; optional "what stayed with you?" textarea
4. **Reference author** — autocomplete via Google Books `inauthor:` API; optional "what about their writing?" textarea
5. **Reading context** — up to 2 selectable pills (7 options)
6. **Avoid** — freetext textarea

**Form design:**
- `✦` ornament above title; Playfair Display italic 2rem in amber `#e8c97e`
- Intro line: *"The best part of reading is knowing there's another book waiting. Let's find yours."*
- 2.5rem gap between prompts; 0.95rem bold Inter prompt labels
- Pills: 24px border-radius, 10px gap; active = `--accent` red with 3px glow ring
- Inputs: warm border `rgba(220,185,120,0.14)`, focus → accent red
- Submit button: `Find my next read →`, 1rem bold, 16px padding, 12px border-radius

### FNR Navigation (v90)
- **Header** shows two buttons side by side: `← Back to Wishlist` (always) + `⊟ Edit Preferences` (shown only on results screen)
- `openFindNextRead()` — hides wishlist-main, shows blank form, hides Edit Preferences
- `fnrBack()` — results → pre-filled form (restores `_fnrFormState`), hides Edit Preferences
- `fnrBackToWishlist()` — exits FNR entirely, clears `_fnrFormState`

### User Context (v90)
`_fnrBuildUserContext()` reads from IndexedDB to build a signal object passed to the AI:
- `topRatedBooks`: all books rated `rentfree` or `wrecked`, up to 30. Top 10 by highlight count each contribute up to 3 `whyItStayed` entries (highlight texts) as rich signal.
- `pausedBooks`: negative signal — books the user started but didn't finish
- `medium`: counts of kindle / audiobook / physical across all books
- `densityTop5`: top 5 books by highlight count regardless of rating

### AI Prompt (v90)
`AI_PROMPTS.findNextRead` — 8-step algorithm instructing the AI to:
1. Study user context signals
2. Parse form input
3. Avoid books already in the user's library
4. Generate 5 diverse candidates
5. Score and rank them
6. Return strict JSON: `{ recommendations: [{ title, author, description, why_it_fits, tags[], effort }] }`

Replace calls pass currently-displayed titles to avoid near-duplicates.

### FNR Results (v90)
- 5 skeleton cards shown during AI call (pulsing animation)
- Each result card: title (Playfair Display bold), author italic, description, pink left-border `why_it_fits` blockquote, tag pills, effort badge (Easy/Medium/Dense), Google Books link, `↺ Replace` + `♡ Add to Wishlist` buttons
- Replace: targeted single-slot AI call with `avoid` array of current titles
- Add to Wishlist: silent save to wishlist store, button changes to `✓ Added` (disabled)

---

## Books Tab Elevated Redesign (v90)

### Toolbar
- **Category dropdown removed** — redundant since books are already grouped by category
- `+ Add Book` button moved to the search bar row (right of search input), eliminating the second toolbar row

### Status Section Headings
- All four headings unified: **Playfair Display italic**, 1.25rem, weight 400
- Single accent color for all: `#9c6fda` (the Waitlisted purple)
- No borders, no ornaments — differentiation through color alone, generous spacing (`margin-bottom: 1.25rem`, group spacing `2.5rem`)

### Book Row Redesign
- **Title**: Inter 500, 0.95rem, `letter-spacing: -0.01em` — sharper and narrower
- **Author + medium icon** on meta row (line 2) — author italic muted, medium icon at 30% opacity beside it
- **Rating** moved to right column: icon + short text label, each in its pastel accent color
  - 😐 *Forgot the plot* → `#8ab0c5` (muted slate blue)
  - ☕ *Good while it lasted* → `#c9a97a` (dusty amber)
  - 🧠 *Rent-free* → `#b09ad8` (soft lavender)
  - 🔥 *Wrecked me* → `#c47a85` (dusty rose)
- **Category pill removed** from rows — still visible in book detail view
- **Spine**: 6px solid category color; background: 7% opacity tint of same color
- **Status order**: Reading → Completed → Paused → Waitlisted

### Essay Tab Typography Alignment
- Essay card titles: Inter 500, 0.95rem, `letter-spacing: -0.01em` (matches book row titles)
- Essay card subtitles: 0.7rem italic muted (matches book row author style)

---

| Version | Changes |
|---|---|
| v88 | Highlights search bar; Books tab row layout + sub-grouping; font and style polish |
| v89 | Books tab UX refinements: category pill stacking, heading cleanup, font consistency |
| v90 | Find Your Next Read AI feature; Wishlist two-zone layout; Books tab elevated redesign; Essay tab typography alignment |
| v91 | Books tab: titles sorted alphabetically within each category sub-group (`localeCompare`) |
| v92–v95 | Category rename + status rename; service worker no-cache header for local dev |

---

## Category Redesign (v92–v95)

### New Categories
Replaced the 5 original categories with 5 intent-based categories:

| Category | Replaces | Subtitle (hint text) | Colour |
|---|---|---|---|
| **Escape** | Fiction + Graphic Novels | Fiction, graphic novels, narrative-driven reads | `#C47A90` rose-pink |
| **Understand** | History + Politics + Science | History, politics, science, culture | `#C4A96A` warm sand |
| **Reflect** | Philosophy + Memoir | Philosophy, psychology, memoir, inner life | `#9B8AB8` pale lavender |
| **Evolve** | Self-help + Non-fiction | Self-development, habits, skills, applied thinking | `#78A882` sage green |
| **Question** | Essays + Critical thinking | Essays, critical thinking, disruptive ideas | `#6B9CB8` muted sky blue |

- Same 5 hex values as before, reallocated to new names
- `COVER_COLORS` keys updated in `app.js`
- `CATEGORY_ORDER` updated for book list sort order
- `CATEGORY_MAP` regexes broadened to map Open Library subjects to the new 5 categories
- All 5 `<select>` dropdowns updated in `index.html` (Add Book, Edit Book, Add Highlight inline, Edit Wishlist, Add Wishlist)
- Kindle import category modal updated; default selection changed to `Understand`
- No migration — existing books retain old category values and are re-categorised manually

### Category Hint
- A `<small class="category-hint">` element added directly below the Category `<select>` in **Add Book** and **Edit Book** forms
- Updates dynamically via `updateCategoryHint(selectId, hintId)` on every `onchange` and on form open
- `CATEGORY_HINTS` constant maps each category name to its subtitle string
- CSS: `0.72rem`, muted, italic, `min-height: 1em` to avoid layout jump

### Favourite Character Field Removed
- Field removed from Add Book and Edit Book forms entirely (HTML + JS)
- `toggleAddBookFields()` and `toggleCompletionFields()` no longer show/hide the field
- `addBook()` and `updateBook()` no longer read or save `favouriteCharacter`
- `showEditBookForm()` no longer pre-fills it

### Status Rename: Waitlisted → Queued Up
- All instances of `'Waitlisted'` as a stored status value updated to `'Queued Up'`
- Updated in: `STATUS_ORDER`, home section title, wishlist "Add as" button, all `<select>` options, status pill filter, `books-status-filter` hidden select
- CSS: `.book-status-waitlisted` → `.book-status-queued-up`; `.books-group-heading.accent-waitlisted` → `.accent-queued-up`
- Existing books saved with `status: 'Waitlisted'` in IndexedDB lose colour match until re-saved via Edit Book

### Service Worker Dev Fix
- `server.js` updated: `sw.js` route added before `express.static`, returning `Cache-Control: no-store` header
- Prevents the service worker from being cached by the browser during local development, so cache version bumps take effect without manual unregister
