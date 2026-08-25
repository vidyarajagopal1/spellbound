# Spellbound First-Run Quest

Copy and interaction spec. This file is the single source of truth for all quest strings. Do not invent, reword, or "improve" any copy below. If a string is needed that isn't here, ask rather than writing one.

---

## Structure

Welcome pop-up → Goodreads import instructions → **Quest intro** → Stages 1–6 → Find Your Next Read → Home

Two paths: importer and non-importer. They differ only at Stages 1 and 3, and only in where the books come from. Stages 2, 4, 5, 6 and the ending are a single implementation.

Trigger: the app has no books.

---

## Intro

> **A shelf of your own, waiting to be filled.**
>
> Come on a quest. We'll start with a few books you know, and find your next great read along the way.
>
> `Begin the quest →`

**Behind the copy:** a pseudo shelf of labelled spines, using the existing spine component with dummy data. Titles must be real, widely known, and spread deliberately across the five Spellbound categories — Escape, Understand, Reflect, Evolve, Question — so the shelf demonstrates range rather than taste. Six to eight spines. Titles are chosen by Vidya, not generated.

---

## Stage 1 — Last book

### Non-importer

> **What's the last book you finished?**
>
> *Don't worry about chronology. The last one you remember works just fine.*
>
> `[ Search for books ]`

### Importer

> **Which of these did you finish last?**
>
> *Don't worry about chronology. The last one you remember works just fine.*
>
> *The six most recent from your import.*
>
> `[ grid of six covers ]`
>
> *Not here? Search for it.*
>
> `[ Search for books ]`

### Both

Empty pile, before the first book lands:
> Your pile starts here

Advance button, disabled until a book is added:
> `Continue`

**Mandatory stage.** One book only. No skip. There must be a visible way to exit the quest entirely from this screen.

---

## Stage 2 — Rating

> **How did it leave you feeling?**
>
> `Already forgot the plot`
> `It was good while it lasted`
> `Rent-free in my head`
> `Wrecked me (in a good way)`
>
> *We don't do stars, because a book can be five stars and still leave you cold.*

The note sits below the options, set smaller or after a gap, so it reads as an aside rather than an instruction.

Rates the book from Stage 1. No importer variant.

---

## Stage 3 — Re-reads

### Non-importer

> **Which books would you re-read without hesitating?**
>
> *Five or more, ideally. It helps us get your taste right.*
>
> `[ Search for books ]`

### Importer

> **Which books would you re-read without hesitating?**
>
> *Five or more, ideally. It helps us get your taste right.*
>
> *Pick from your library, or add a new one.*
>
> `[ grid — tap to select, tap again to deselect ]`
>
> *Not here? Search for it.*
>
> `[ Search for books ]`

### Both

Counter beside the pile:
> 3 added

Advance button, nothing added:
> `Maybe later`

Advance button, one or more:
> `Continue`

---

## Stage 4 — Currently reading

> **Reading anything right now?**
>
> *Physical, audio, or e-book. Whatever you're reading gets its own Spotlight on your Home page.*
>
> `[ Search for books ]`

Advance button, nothing added:
> `Maybe later`

Advance button, one or more:
> `Continue`

No importer variant. Books added here are marked as currently reading.

---

## Stage 5 — Queued

> **Any books you've been eyeing?**
>
> *So you always have a glimpse of your TBR, waiting for you at Home.*
>
> `[ Search for books ]`

Advance button, nothing added:
> `Maybe later`

Advance button, one or more:
> `Continue`

No importer variant. Books added here are marked as queued.

---

## Stage 6 — Highlights

> **Any lines you find yourself quoting?**
>
> `Write it` · `Record it` · `Take a picture`
>
> *We'll keep them in your Highlights, so your notes app can't lose them.*

Three capture routes as equal options, not typing-with-alternatives. They map to the existing typed, voice and OCR capture paths.

After capturing, the pile appears for book attachment:
> **Which book?**

Skipped if the pile holds only one book — attaches silently. For importers with large libraries, the picker gets the same live search filter as Stage 3.

Advance button, nothing added:
> `Can't think of one`

Advance button, once added:
> `Continue`

---

## Find Your Next Read

Runs after Stage 6, using the books and ratings collected during the quest. This is the payoff the intro promised, not a seventh stage.

### Five or more books in the pile

> **That's your shelf, and it'll keep growing.**
>
> *Now for the part we promised. Let's find you something worth reading next.*

Then the FNR form opens.

### Under five books

> **That's your shelf, and it'll keep growing.**
>
> *Find Your Next Read works best with five to eight books in your pile. You've got two.*
>
> `Add a few more` · `Go ahead anyway`

The count is live and reflects the actual pile. `Add a few more` opens a search field in place on the same screen — not a jump back through the stages. The count updates as books are added, then continues.

### On the FNR form

> Fill in only the parts you feel strongly about.

### Failure

> We couldn't reach the service. Check your connection and try Find Your Next Read from the Wishlist tab.

Nothing is saved or queued on failure. The recommendation only exists if they run it again.

### Exit, after the recommendation

> `Go to Home` → Home tab
> `See my shelf` → Books tab

---

## Interaction rules

**Search field.** Used at Stages 1 and 3–6. Stays open and never closes. Type → results appear beneath → tap one → spine lands on the pile, field clears and keeps focus, ready for the next title. No separate Add button. Tap a spine to remove it. Placeholder is `Search for books` at every stage.

**Multiple books.** Allowed at Stages 3, 4 and 5. Stage 1 takes one book only.

**Importer grids.** Stages 1 and 3. Tap to select, tap again to deselect. The search field filters the library live rather than requiring scrolling — essential for a 300-book import.

**Writes.** Every selection saves to IndexedDB immediately, not on advancing. Leaving mid-quest loses nothing.

**The pile.** A filtered view of the library showing only books added during this session. Grows spine by spine as the quest runs. No merge step at the end — the filter drops away and the Books tab shows everything, quest books included.

**Skips.** Every stage except Stage 1 advances whether answered or not.

**Search source.** All searches use the existing shared `googleBooksSearch()` helper.

---

## Suggested build order

Each step tested on the live site before the next.

1. Quest shell — container, stage navigation, state, pile component, IndexedDB writes
2. Stages 1 and 2, including the importer grid
3. Stages 3–5 — the repeated search-and-add pattern, built once and reused
4. Stage 6 — three capture routes and book attachment
5. Find Your Next Read handoff — thin-pile gate, form instruction, failure state, exit buttons
6. Trigger logic and the intro screen

**Version hygiene applies to every push.** All five locations must match: `CACHE_NAME` in `sw.js` line 1, both `?v=` entries in the `sw.js` ASSETS array, and `styles.css?v=` and `app.js?v=` in `index.html`. Check `docs/sw.js` line 1 first.

---

## Prerequisite

Book deletion must cascade to highlights before the quest ships, so the no-books trigger can't strand a user with orphaned highlights. Worth a confirmation dialog naming the count.
