#!/usr/bin/env node
/**
 * Build public/data/collection.json from:
 *   - data/master-list.xlsx (the original posted list — always kept)
 *   - every Excel file in data/incoming/ (additional lists)
 *   - optional extra file paths passed on the command line
 *
 * Re-running with the same files will not duplicate titles. Matching is by
 * normalized title and ISBN; posted dates and ISBNs are combined.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCollectionFromFiles, collectSourceFiles } from "./lib/build-collection.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "data", "master-list.xlsx");
const INCOMING = join(ROOT, "data", "incoming");
const OUTPUT = join(ROOT, "public", "data", "collection.json");

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

const payload = buildCollectionFromFiles(files, { relativeTo: ROOT });
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(payload));

const extraCount = files.filter((file) => file !== MASTER).length;
console.log(`Read ${files.length} spreadsheet${files.length === 1 ? "" : "s"}:`);
for (const file of files) {
  console.log(`  - ${file.replace(ROOT + "/", "")}`);
}
console.log(`Unique listings (after skipping exact re-imports): ${payload.rowCount}`);
if (payload.stats.skippedDuplicateRows) {
  console.log(`Skipped ${payload.stats.skippedDuplicateRows} duplicate row${payload.stats.skippedDuplicateRows === 1 ? "" : "s"} already on the list`);
}
console.log(`Unique titles: ${payload.uniqueTitleCount}`);
console.log(`Posted periods: ${payload.batches.join(", ")}`);
console.log(`Levels: ${payload.levels.join(", ")}`);
if (extraCount) {
  console.log(`Additional files from data/incoming (or extra paths): ${extraCount}`);
}
console.log(`Wrote ${OUTPUT.replace(ROOT + "/", "")}`);
