#!/usr/bin/env node
/**
 * Parse the McAllen ISD master-list xlsx into a compact, title-grouped JSON
 * file used by the static Collection Check app.
 *
 * Usage:
 *   npm run import
 *   npm run import -- path/to/new-master-list.xlsx
 *
 * Default source: data/master-list.xlsx
 * Output:        public/data/collection.json
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = join(ROOT, "data", "master-list.xlsx");
const OUTPUT = join(ROOT, "public", "data", "collection.json");

const ISBN_FIELDS = [
  "ISBN-13",
  "Normalized ISBN",
  "ISBN",
  "ISBN-HB",
  "ISBN-PB",
  "ISBN-10",
  "ISBN-Other",
];

const REVIEW_FIELDS = [
  ["Booklist", "booklist"],
  ["Kirkus", "kirkus"],
  ["PW", "pw"],
  ["SLJ", "slj"],
  ["Horn Book", "hornBook"],
  ["Common Sense Media", "commonSenseMedia"],
  ["Other Reviews", "other"],
];

const BATCH_ORDER = ["Sep 2025", "Oct 2025", "Nov 2025", "Jan 2026", "2026-2027"];
const LEVEL_ORDER = ["Elementary", "Middle", "High", "Milam Book Vending Machine"];

function cell(value) {
  if (value == null) return "";
  return String(value).trim();
}

function titleKey(title) {
  return cell(title).toLowerCase().replace(/\s+/g, " ");
}

function isbnDigits(value) {
  return cell(value).replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isIsbnLike(digits) {
  return digits.length === 10 || digits.length === 13;
}

function preferredIsbnDisplay(digits, original) {
  const cleaned = cell(original).replace(/[\s-]/g, "");
  if (digits.length === 13) return digits;
  if (digits.length === 10) return digits;
  return cleaned || digits;
}

function truthyFlag(value) {
  const v = cell(value).toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "x";
}

function canonicalAuthors(authors) {
  const unique = [];
  const seen = new Set();
  for (const raw of authors) {
    const name = cell(raw);
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }

  return unique.filter((name) => {
    if (name.includes(",")) return true;
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return true;
    const lastFirst = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`.toLowerCase();
    return !unique.some((other) => other.toLowerCase() === lastFirst);
  });
}

function sortBatches(batches) {
  return [...batches].sort((a, b) => {
    const ia = BATCH_ORDER.indexOf(a);
    const ib = BATCH_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.localeCompare(b);
  });
}

function sortLevels(levels) {
  return [...levels].sort((a, b) => {
    const ia = LEVEL_ORDER.indexOf(a);
    const ib = LEVEL_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.localeCompare(b);
  });
}

function pickDisplayTitle(counts) {
  let best = "";
  let bestCount = -1;
  for (const [title, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && title.length > best.length)
    ) {
      best = title;
      bestCount = count;
    }
  }
  return best;
}

function sourcePath() {
  const arg = process.argv[2];
  if (!arg) return DEFAULT_SOURCE;
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
}

const src = sourcePath();
const workbook = XLSX.readFile(src);
const sheetName = workbook.SheetNames.includes("Master List")
  ? "Master List"
  : workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

if (!rows.length) {
  console.error(`No rows found in sheet "${sheetName}" of ${src}`);
  process.exit(1);
}

/** @type {Map<string, any>} */
const groups = new Map();

for (const row of rows) {
  const title = cell(row.Title);
  if (!title) continue;
  const key = titleKey(title);
  if (!groups.has(key)) {
    groups.set(key, {
      key,
      titleCounts: new Map(),
      authors: [],
      isbnMap: new Map(),
      batches: new Set(),
      levels: new Set(),
      audiences: new Set(),
      formats: { book: false, ebook: false, audio: false },
      possibleDuplicate: false,
      reviews: {
        booklist: new Set(),
        kirkus: new Set(),
        pw: new Set(),
        slj: new Set(),
        hornBook: new Set(),
        commonSenseMedia: new Set(),
        other: new Set(),
      },
      rowCount: 0,
    });
  }

  const g = groups.get(key);
  g.rowCount += 1;
  g.titleCounts.set(title, (g.titleCounts.get(title) || 0) + 1);
  g.authors.push(cell(row.Author));

  const batch = cell(row["Source Batch"]);
  if (batch) g.batches.add(batch);
  const level = cell(row.Level);
  if (level) g.levels.add(level);
  const audience = cell(row.Audience);
  if (audience && !/^\d{4}-\d{2}-\d{2}$/.test(audience) && !/^\d+(\.\d+)?$/.test(audience)) {
    g.audiences.add(audience);
  }

  if (truthyFlag(row.Book)) g.formats.book = true;
  if (truthyFlag(row.eBook)) g.formats.ebook = true;
  if (truthyFlag(row.Audio)) g.formats.audio = true;
  if (truthyFlag(row["Possible Duplicate"])) g.possibleDuplicate = true;

  for (const field of ISBN_FIELDS) {
    const raw = cell(row[field]);
    if (!raw) continue;
    const digits = isbnDigits(raw);
    if (!digits || digits === "0") continue;
    if (digits.length < 8) continue;
    if (!g.isbnMap.has(digits)) {
      g.isbnMap.set(digits, preferredIsbnDisplay(digits, raw));
    }
  }

  for (const [col, prop] of REVIEW_FIELDS) {
    const raw = cell(row[col]);
    if (!raw) continue;
    if (raw.toLowerCase() === "reviews:") continue;
    g.reviews[prop].add(raw);
  }
}

function isbnSort(a, b) {
  const rank = (d) => (d.startsWith("978") && d.length === 13 ? 0 : d.length === 13 ? 1 : d.length === 10 ? 2 : 3);
  return rank(a) - rank(b) || a.localeCompare(b);
}

const titles = [...groups.values()]
  .map((g) => {
    const isbnDigitsList = [...g.isbnMap.keys()].sort(isbnSort);
    const reviews = {};
    for (const key of Object.keys(g.reviews)) {
      const values = [...g.reviews[key]];
      if (values.length) reviews[key] = values;
    }

    const title = pickDisplayTitle(g.titleCounts);
    const id = createHash("sha1").update(g.key).digest("hex").slice(0, 12);

    return {
      id,
      title,
      authors: canonicalAuthors(g.authors),
      isbns: isbnDigitsList.map((d) => g.isbnMap.get(d)),
      isbnDigits: isbnDigitsList,
      batches: sortBatches([...g.batches]),
      levels: sortLevels([...g.levels]),
      audiences: [...g.audiences].sort((a, b) => a.localeCompare(b)),
      formats: g.formats,
      possibleDuplicate: g.possibleDuplicate,
      reviews,
      rowCount: g.rowCount,
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));

const batchCounts = {};
const levelCounts = {};
for (const t of titles) {
  for (const b of t.batches) batchCounts[b] = (batchCounts[b] || 0) + 1;
  for (const l of t.levels) levelCounts[l] = (levelCounts[l] || 0) + 1;
}

const payload = {
  generatedAt: new Date().toISOString(),
  sourceFile: src.replace(ROOT + "/", ""),
  sheet: sheetName,
  rowCount: rows.length,
  uniqueTitleCount: titles.length,
  batches: sortBatches([...new Set(titles.flatMap((t) => t.batches))]),
  levels: sortLevels([...new Set(titles.flatMap((t) => t.levels))]),
  stats: {
    rowsByBatch: Object.fromEntries(
      sortBatches(Object.keys(batchCounts)).map((k) => [k, rows.filter((r) => cell(r["Source Batch"]) === k).length]),
    ),
    titlesByBatch: Object.fromEntries(sortBatches(Object.keys(batchCounts)).map((k) => [k, batchCounts[k]])),
    rowsByLevel: Object.fromEntries(
      sortLevels(Object.keys(levelCounts)).map((k) => [k, rows.filter((r) => cell(r.Level) === k).length]),
    ),
    titlesByLevel: Object.fromEntries(sortLevels(Object.keys(levelCounts)).map((k) => [k, levelCounts[k]])),
  },
  titles,
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(payload));

console.log(`Imported ${rows.length} rows from ${src}`);
console.log(`Sheet: ${sheetName}`);
console.log(`Unique titles: ${titles.length}`);
console.log(`Batches: ${payload.batches.join(", ")}`);
console.log(`Levels: ${payload.levels.join(", ")}`);
console.log(`Wrote ${OUTPUT}`);
