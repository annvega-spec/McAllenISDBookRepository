#!/usr/bin/env node
/**
 * Build public/data/collection.json and public/data/owned.json from:
 *   - data/master-list.xlsx (the original posted list — always kept)
 *   - every Excel file in data/incoming/ (additional lists and district holdings)
 *   - optional extra file paths passed on the command line
 *
 * Re-running with the same files will not duplicate titles. Matching is by
 * normalized title and ISBN; posted dates, ISBNs, and HAVE-IT sources are
 * combined. Follett district holdings are compacted into an ISBN index so the
 * browser does not load a 300k-row title list.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeskData, collectSourceFiles } from "./lib/build-collection.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "data", "master-list.xlsx");
const INCOMING = join(ROOT, "data", "incoming");
const OUTPUT = join(ROOT, "public", "data", "collection.json");
const OWNED_OUTPUT = join(ROOT, "public", "data", "owned.json");

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

const { collection, owned } = buildDeskData(files, { relativeTo: ROOT });
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(collection));
writeFileSync(OWNED_OUTPUT, JSON.stringify(owned));

const extraCount = files.filter((file) => file !== MASTER).length;
console.log(`Read ${files.length} spreadsheet${files.length === 1 ? "" : "s"}:`);
for (const file of files) {
  console.log(`  - ${file.replace(ROOT + "/", "")}`);
}
console.log(`Unique listings (after skipping exact re-imports): ${collection.rowCount}`);
if (collection.stats.skippedDuplicateRows) {
  console.log(`Skipped ${collection.stats.skippedDuplicateRows} duplicate row${collection.stats.skippedDuplicateRows === 1 ? "" : "s"} already on the list`);
}
console.log(`Unique named titles: ${collection.uniqueTitleCount}`);
console.log(`Posted periods / named lists: ${collection.batches.join(", ")}`);
console.log(`Levels: ${collection.levels.join(", ")}`);
if (owned.count) {
  console.log(`Owned Follett catalog (${owned.source}): ${owned.count.toLocaleString()} unique ISBNs`);
  console.log(`  kept Book/eBook rows with ISBN: ${owned.stats.acceptedRows.toLocaleString()}`);
  console.log(`  skipped non-book material: ${owned.stats.skippedNonBook.toLocaleString()}`);
  console.log(`  skipped Book/eBook with no ISBN: ${owned.stats.skippedNoIsbn.toLocaleString()}`);
}
if (extraCount) {
  console.log(`Additional files from data/incoming (or extra paths): ${extraCount}`);
}
console.log(`Wrote ${OUTPUT.replace(ROOT + "/", "")}`);
console.log(`Wrote ${OWNED_OUTPUT.replace(ROOT + "/", "")}`);
