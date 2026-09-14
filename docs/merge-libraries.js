// ─── LIBRARY MERGE (pure function) ────────────────────────────────────────
//
// Step 2 of the multi-device sync plan (see /memories/repo/sync-foundation.md
// for Step 1). THIS FILE IS NOT WIRED INTO THE APP. Nothing requires it,
// nothing calls it, index.html does not load it. It exists purely so it can
// be exercised by a standalone Node runner (scripts/merge-runner.js) before
// any real sync behaviour changes.
//
// mergeLibraries(local, remote) takes two export-shaped plain objects (same
// shape as exportLibrary()/syncToDrive()'s payload in docs/app.js: { books,
// highlights, essays, wishlist, challenges, essay_drafts, waitlistOrder,
// wishlistOrder, fnrRejectedForever, deletions }) and returns ONE plain
// object of the same shape. No IndexedDB, no Drive/gapi, no DOM, no globals
// — everything it needs comes in through the two arguments.
//
// SCOPE:
// - books/highlights/essays/wishlist/challenges/essay_drafts: union by id,
//   newer updatedAt wins, tombstoned (deletions) ids dropped. essay_drafts
//   uses its own record shape's `updated_at` (snake_case, unlike every other
//   store's `updatedAt`) as its timestamp field — same union-by-id algorithm,
//   just reading the field that store actually has.
// - waitlistOrder/wishlistOrder: order arrays (see _pickOrderArraySide).
// - fnrRejectedForever: unioned, deduped by normalized title+author key,
//   never drops an entry — even one a user later "Undo"-ed on one side
//   reappears after merge, per explicit instruction to only ever grow this
//   list here.
// - deletions: unioned, not deduped by winner (see _mergeAll).
// - Orphaned highlights (bookId pointing at a book that isn't in the merged
//   result) are NEVER dropped by this function — an orphan is recoverable,
//   a silently-deleted highlight the user never deleted is not. Instead the
//   count is surfaced via mergeLibrariesWithStats()'s `orphanedHighlights`
//   stat so the runner can print/flag it.

const RECORD_STORES = ['books', 'highlights', 'essays', 'wishlist', 'challenges'];
// Stores merged by the same union-by-id/newer-updatedAt-wins algorithm as
// RECORD_STORES, plus essay_drafts (which has its own timestamp field name —
// see STORE_TIMESTAMP_FIELD below). Exported separately from RECORD_STORES
// so callers that specifically mean "the 5 main content stores" (e.g. the
// order-array activity check) aren't silently affected by essay_drafts.
const ID_MERGED_STORES = RECORD_STORES.concat(['essay_drafts']);
const ORDER_ARRAY_KEYS = ['waitlistOrder', 'wishlistOrder'];
// essay_drafts is the one store whose timestamp field isn't `updatedAt`
// (dbSaveDraft() in docs/app.js stamps `updated_at` instead). Everything
// else defaults to `updatedAt`.
const STORE_TIMESTAMP_FIELD = { essay_drafts: 'updated_at' };
function _timestampFieldFor(storeName) {
  return STORE_TIMESTAMP_FIELD[storeName] || 'updatedAt';
}

function _toArray(x) {
  return Array.isArray(x) ? x : [];
}

// Builds a Set of "store::recordId" keys from a (possibly duplicate-laden,
// unioned) deletions array. Rows missing store/recordId are ignored rather
// than throwing, since deletions may be absent/malformed on older exports.
function _deletionKeySet(deletions) {
  const set = new Set();
  for (const d of deletions) {
    if (!d || d.store == null || d.recordId == null) continue;
    set.add(d.store + '::' + d.recordId);
  }
  return set;
}

// Compares two updatedAt values for "which record wins" purposes.
// Returns > 0 if `a` is newer, < 0 if `b` is newer, 0 on a genuine tie
// (both present and equal, OR both missing).
// A missing/blank updatedAt always loses to a present one.
function _compareUpdatedAt(a, b) {
  const hasA = a != null && a !== '';
  const hasB = b != null && b !== '';
  if (!hasA && !hasB) return 0;
  if (!hasA) return -1;
  if (!hasB) return 1;
  if (a === b) return 0;
  return a > b ? 1 : -1; // ISO 8601 strings compare correctly lexicographically
}

// Merges one store's records. Returns the merged (deletion-filtered) record
// array plus stats describing where each surviving-and-non-surviving record
// came from, for the runner's summary. `timestampField` lets a store use a
// field name other than `updatedAt` (essay_drafts uses `updated_at`).
function _mergeStore(storeName, localRecords, remoteRecords, deletionKeys, timestampField) {
  const localMap = new Map();
  for (const rec of localRecords) {
    if (rec && rec.id != null) localMap.set(rec.id, rec);
  }
  const remoteMap = new Map();
  for (const rec of remoteRecords) {
    if (rec && rec.id != null) remoteMap.set(rec.id, rec);
  }

  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const merged = [];
  let localOnly = 0, remoteOnly = 0, conflictsResolvedLocal = 0, conflictsResolvedRemote = 0;

  for (const id of allIds) {
    const hasLocal  = localMap.has(id);
    const hasRemote = remoteMap.has(id);
    let winner;

    if (hasLocal && hasRemote) {
      const localRec  = localMap.get(id);
      const remoteRec = remoteMap.get(id);
      // Newer timestamp wins; missing loses to present; identical (including
      // both-missing) timestamps keep the local copy.
      if (_compareUpdatedAt(localRec[timestampField], remoteRec[timestampField]) >= 0) {
        winner = localRec;
        conflictsResolvedLocal++;
      } else {
        winner = remoteRec;
        conflictsResolvedRemote++;
      }
    } else if (hasLocal) {
      winner = localMap.get(id);
      localOnly++;
    } else {
      winner = remoteMap.get(id);
      remoteOnly++;
    }

    if (deletionKeys.has(storeName + '::' + id)) continue; // tombstoned - drop regardless of side/timestamps
    merged.push(winner);
  }

  return {
    records: merged,
    stats: {
      localCount: localRecords.length,
      remoteCount: remoteRecords.length,
      mergedCount: merged.length,
      localOnly,
      remoteOnly,
      conflictsResolvedLocal,
      conflictsResolvedRemote
    }
  };
}

// Normalizes an { title, author } entry for dedup purposes — mirrors
// docs/app.js's _fnrNormKey exactly (kept as an independent copy since this
// file must not depend on app.js).
function _fnrNormKey(title, author) {
  return `${(title || '').trim().toLowerCase()}|${(author || '').trim().toLowerCase()}`;
}

// Unions two fnrRejectedForever lists. Per explicit instruction: keep
// EVERY entry from both sides, never remove one (even though the app's own
// "Undo" feature can remove an entry from a single device's copy — a merge
// against an older copy that still has it will bring it back, which is the
// accepted, documented trade-off here). Only collapses entries that are
// literally the same title+author (present on both sides) into one row —
// that's not a removal, since nothing distinct is lost.
function _mergeFnrRejectedForever(localList, remoteList) {
  const merged = [];
  const seen = new Set();
  for (const entry of localList.concat(remoteList)) {
    if (!entry || !entry.title) continue;
    const key = _fnrNormKey(entry.title, entry.author);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return {
    records: merged,
    stats: { localCount: localList.length, remoteCount: remoteList.length, mergedCount: merged.length }
  };
}

// Latest updatedAt seen across every record store in one whole export-shaped
// copy (local or remote). Returns null if nothing in that copy has a usable
// updatedAt. Used to decide which side's order array to prefer, below.
function _overallActivityTimestamp(exportObj) {
  let max = null;
  for (const storeName of RECORD_STORES) {
    for (const rec of _toArray(exportObj[storeName])) {
      if (rec && rec.updatedAt != null && rec.updatedAt !== '') {
        if (max == null || rec.updatedAt > max) max = rec.updatedAt;
      }
    }
  }
  return max;
}

// JUDGMENT CALL (documented per spec's "accept this is imperfect" framing):
// "the copy with the most recent activity" is read here as a single,
// whole-export comparison (local's latest updatedAt across ALL stores vs.
// remote's), reused for BOTH order arrays, rather than trying to scope
// activity to just the one store each order array happens to reference.
// A missing timestamp on one side loses to a present one on the other; if
// neither side has any usable timestamp, local is preferred (same
// tie-leans-local convention as record conflicts above).
function _pickOrderArraySide(local, remote) {
  const localTs  = _overallActivityTimestamp(local);
  const remoteTs = _overallActivityTimestamp(remote);
  if (localTs == null && remoteTs == null) return 'local';
  if (localTs == null) return 'remote';
  if (remoteTs == null) return 'local';
  return remoteTs > localTs ? 'remote' : 'local';
}

function _mergeOrderArray(baseOrder, mergedRecordIds) {
  const base = _toArray(baseOrder).slice();
  const seen = new Set(base);
  for (const id of mergedRecordIds) {
    if (!seen.has(id)) {
      base.push(id);
      seen.add(id);
    }
  }
  return base;
}

// The full merge, including the per-store stats the runner needs for its
// summary. mergeLibraries() (below) is a thin wrapper that returns just the
// merged plain object, matching the spec's "takes two, returns one" contract.
function _mergeAll(local, remote) {
  local  = local  || {};
  remote = remote || {};

  const localDeletions  = _toArray(local.deletions);
  const remoteDeletions = _toArray(remote.deletions);
  // Deletions are unioned, not deduped by winner - every row from either
  // side survives, regardless of whether the same store/recordId appears
  // more than once.
  const combinedDeletions = localDeletions.concat(remoteDeletions);
  const deletionKeys = _deletionKeySet(combinedDeletions);

  const merged = { deletions: combinedDeletions };
  const stats  = {};

  for (const storeName of ID_MERGED_STORES) {
    const { records, stats: storeStats } = _mergeStore(
      storeName,
      _toArray(local[storeName]),
      _toArray(remote[storeName]),
      deletionKeys,
      _timestampFieldFor(storeName)
    );
    merged[storeName] = records;
    stats[storeName]  = storeStats;
  }

  const { records: fnrRejectedForever, stats: fnrStats } = _mergeFnrRejectedForever(
    _toArray(local.fnrRejectedForever),
    _toArray(remote.fnrRejectedForever)
  );
  merged.fnrRejectedForever = fnrRejectedForever;
  stats.fnrRejectedForever  = fnrStats;

  const orderSide = _pickOrderArraySide(local, remote);
  for (const orderKey of ORDER_ARRAY_KEYS) {
    // waitlistOrder holds book ids, wishlistOrder holds wishlist ids - map
    // each order array to the store its ids actually come from.
    const relatedStore = orderKey === 'waitlistOrder' ? 'books' : 'wishlist';
    const baseOrder = orderSide === 'local' ? local[orderKey] : remote[orderKey];
    merged[orderKey] = _mergeOrderArray(baseOrder, merged[relatedStore].map(r => r.id));
  }

  // Orphaned highlights are never dropped here (see file header) — only
  // counted, so the runner can surface the number rather than it passing
  // unnoticed. A dangling bookId can legitimately arise whenever a book's
  // deletion wasn't (or couldn't be) cascaded into a matching highlights
  // deletion row on the other side.
  const mergedBookIds = new Set(merged.books.map(b => b.id));
  stats.orphanedHighlights = merged.highlights.filter(h => h.bookId != null && !mergedBookIds.has(h.bookId)).length;

  return { merged, stats, orderSide };
}

function mergeLibraries(local, remote) {
  return _mergeAll(local, remote).merged;
}

// Same merge, plus the stats/side-decision info the runner prints in its
// summary - kept as a separate export so mergeLibraries() itself stays a
// clean "takes two, returns one [merged object]" function.
function mergeLibrariesWithStats(local, remote) {
  return _mergeAll(local, remote);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeLibraries, mergeLibrariesWithStats, RECORD_STORES, ID_MERGED_STORES, ORDER_ARRAY_KEYS };
}
