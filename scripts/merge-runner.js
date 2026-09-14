#!/usr/bin/env node
// ─── MERGE RUNNER (Step 2 verification tool) ──────────────────────────────
//
// Standalone Node script - NOT wired into the app, NOT a build step. Takes
// two SpellBound export JSON files (local + remote), runs the pure
// mergeLibraries()/mergeLibrariesWithStats() function from
// docs/merge-libraries.js, writes the merged result to a third path, prints
// a before/after summary (including essay_drafts and fnrRejectedForever, and
// an orphaned-highlights count), and asserts three invariants on the output.
//
// Usage:
//   node scripts/merge-runner.js <local.json> <remote.json> <output.json>

'use strict';

const fs   = require('fs');
const path = require('path');
const { mergeLibrariesWithStats, ID_MERGED_STORES } = require('../docs/merge-libraries.js');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const [, , localPath, remotePath, outputPath] = process.argv;
  if (!localPath || !remotePath || !outputPath) {
    console.error('Usage: node scripts/merge-runner.js <local.json> <remote.json> <output.json>');
    process.exit(1);
  }

  const local  = readJson(path.resolve(localPath));
  const remote = readJson(path.resolve(remotePath));

  const { merged, stats, orderSide } = mergeLibrariesWithStats(local, remote);

  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(merged, null, 2), 'utf8');

  console.log('=== Merge summary ===');
  console.log(`local:  ${localPath}`);
  console.log(`remote: ${remotePath}`);
  console.log(`output: ${outputPath}`);
  console.log(`order arrays (waitlistOrder/wishlistOrder) based on: ${orderSide} copy (more recent overall activity)`);

  let totalLocalOnly = 0, totalRemoteOnly = 0, totalToLocal = 0, totalToRemote = 0;

  for (const store of ID_MERGED_STORES) {
    const s = stats[store];
    console.log(`\n[${store}]`);
    console.log(`  before -> local: ${s.localCount}, remote: ${s.remoteCount}`);
    console.log(`  after  -> merged: ${s.mergedCount}`);
    console.log(`  local only: ${s.localOnly}, remote only: ${s.remoteOnly}`);
    console.log(`  conflicts resolved -> kept local: ${s.conflictsResolvedLocal}, kept remote: ${s.conflictsResolvedRemote}`);
    totalLocalOnly  += s.localOnly;
    totalRemoteOnly += s.remoteOnly;
    totalToLocal    += s.conflictsResolvedLocal;
    totalToRemote   += s.conflictsResolvedRemote;
  }

  console.log('\n[totals across all stores]');
  console.log(`  local only: ${totalLocalOnly}, remote only: ${totalRemoteOnly}`);
  console.log(`  conflicts resolved -> kept local: ${totalToLocal}, kept remote: ${totalToRemote}`);

  const fnr = stats.fnrRejectedForever;
  console.log(`\n[fnrRejectedForever] before -> local: ${fnr.localCount}, remote: ${fnr.remoteCount}; after -> merged: ${fnr.mergedCount} (unioned, deduped by title+author, never dropped)`);

  const localDeletions  = Array.isArray(local.deletions)  ? local.deletions  : [];
  const remoteDeletions = Array.isArray(remote.deletions) ? remote.deletions : [];
  console.log(`\n[deletions] local: ${localDeletions.length}, remote: ${remoteDeletions.length}, merged (unioned, not deduped): ${merged.deletions.length}`);

  console.log(`\n[data quality] orphaned highlights (bookId not in merged books): ${stats.orphanedHighlights}${stats.orphanedHighlights > 0 ? '  <-- surfaced, not dropped' : ''}`);

  console.log('\n=== Assertions ===');
  let allPassed = true;

  // 1. No id appears twice within a store.
  for (const store of ID_MERGED_STORES) {
    const ids = merged[store].map(r => r.id);
    const ok  = ids.length === new Set(ids).size;
    console.log(`[${store}] no duplicate ids: ${ok ? 'pass' : 'FAIL'}`);
    if (!ok) allPassed = false;
  }

  // 2. No record survives whose id is in deletions for its store.
  const deletionKeys = new Set(merged.deletions.map(d => d && d.store != null && d.recordId != null ? d.store + '::' + d.recordId : null).filter(Boolean));
  let deletionLeak = false;
  for (const store of ID_MERGED_STORES) {
    for (const rec of merged[store]) {
      if (deletionKeys.has(store + '::' + rec.id)) deletionLeak = true;
    }
  }
  console.log(`no record survives whose id is in deletions: ${deletionLeak ? 'FAIL' : 'pass'}`);
  if (deletionLeak) allPassed = false;

  // 3. No highlight's bookId points at a book that isn't in the merged result.
  const bookIds = new Set(merged.books.map(b => b.id));
  let danglingBookId = false;
  for (const h of merged.highlights) {
    if (h.bookId != null && !bookIds.has(h.bookId)) danglingBookId = true;
  }
  console.log(`no dangling highlight.bookId: ${danglingBookId ? 'FAIL' : 'pass'}`);
  if (danglingBookId) allPassed = false;

  console.log(`\nOverall: ${allPassed ? 'ALL ASSERTIONS PASSED' : 'SOME ASSERTIONS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

main();
