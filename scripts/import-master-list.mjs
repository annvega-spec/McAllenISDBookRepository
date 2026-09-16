#!/usr/bin/env node
/**
 * Build public/data/collection.json from:
 *   - data/master-list.xlsx (the original posted list — always kept)
 *   - every Excel file in data/incoming/ (additional lists)
 *   - optional extra file paths passed on the command line
 *
 * Re-running with the same files will not duplicate titles. Matching is by
 * normalized title and ISBN; posted dates and ISBNs are combined.
 *
 * Posted titles listed in data/exclusions.json (normalized title + author)
 * are skipped so they cannot return to the approved / posted-for-review list.
 * Follett Destiny holdings are written to public/data/holdings.json as a
 * compact ISBN index so the desk can search ~200k items without shipping
 * a verbose object per row.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogFromFiles, collectSourceFiles, loadPostedExclusions } from "./lib/build-collection.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "data", "master-list.xlsx");
const INCOMING = join(ROOT, "data", "incoming");
const EXCLUSIONS = join(ROOT, "data", "exclusions.json");
const OUTPUT = join(ROOT, "public", "data", "collection.json");
const HOLDINGS = join(ROOT, "public", "data", "holdings.json");

const extraFiles = process.argv.slice(2).map((arg) => (isAbsolute(arg) ? arg : resolve(process.cwd(), arg)));
const files = collectSourceFiles({
  masterList: MASTER,
  incomingDir: INCOMING,
  extraFiles,
});

if (!files.length) {
  console.error("No spreadsheets found. Keep data/master-list.xlsx and/or add files to data/incoming/.");
  process.exit(1);
}

const exclusions = loadPostedExclusions(EXCLUSIONS);
const { collection, holdings } = buildCatalogFromFiles(files, { relativeTo: ROOT, exclusions });
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(collection));
if (holdings) writeFileSync(HOLDINGS, JSON.stringify(holdings));

const extraCount = files.filter((file) => file !== MASTER).length;
console.log(`Read ${files.length} spreadsheet${files.length === 1 ? "" : "s"}:`);
for (const file of files) {
  console.log(`  - ${file.replace(ROOT + "/", "")}`);
}
console.log(`Unique listings (after skipping exact re-imports): ${collection.rowCount}`);
if (collection.stats.skippedDuplicateRows) {
  console.log(
    `Skipped ${collection.stats.skippedDuplicateRows} duplicate row${collection.stats.skippedDuplicateRows === 1 ? "" : "s"} already on the list`,
  );
}
if (collection.stats.skippedExcludedRows) {
  console.log(
    `Skipped ${collection.stats.skippedExcludedRows} excluded posted title row${collection.stats.skippedExcludedRows === 1 ? "" : "s"}`,
  );
}
console.log(`Unique posted titles: ${collection.uniqueTitleCount}`);
console.log(`Posted periods: ${collection.batches.join(", ")}`);
console.log(`Levels: ${collection.levels.join(", ")}`);
if (collection.stats.holdingsUniqueIsbns) {
  console.log(
    `Follett holdings: ${collection.stats.holdingsRows.toLocaleString()} Book/eBook rows with ISBN → ${collection.stats.holdingsUniqueIsbns.toLocaleString()} unique ISBNs (${collection.stats.holdingsLinkedToPosted.toLocaleString()} already on a posted title, ${collection.stats.holdingsOnly.toLocaleString()} holdings-only)`,
  );
}
if (extraCount) {
  console.log(`Additional files from data/incoming (or extra paths): ${extraCount}`);
}
console.log(`Wrote ${OUTPUT.replace(ROOT + "/", "")}`);
if (holdings) {
  console.log(`Wrote ${HOLDINGS.replace(ROOT + "/", "")} (${holdings.n.toLocaleString()} compact records)`);
}
