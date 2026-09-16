/**
 * Shared helpers for turning one or more master-list spreadsheets into the
 * grouped collection JSON the desk searches.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import XLSX from "xlsx";
import { isbnDigits, normalizeIsbnValue, toIsbn13 } from "./isbn.mjs";
import { buildOwnedCatalog, ownedIsbnSet } from "./owned-catalog.mjs";

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

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const LEVEL_ORDER = ["Elementary", "Middle", "High", "Milam Book Vending Machine"];

const HEADER_ALIASES = {
  title: "Title",
  booktitle: "Title",
  author: "Author",
  authors: "Author",
  authorname: "Author",
  sourcebatch: "Source Batch",
  batch: "Source Batch",
  posted: "Source Batch",
  posteddate: "Source Batch",
  dateposted: "Source Batch",
  period: "Source Batch",
  postingperiod: "Source Batch",
  postedperiod: "Source Batch",
  level: "Level",
  campuslevel: "Level",
  gradelevel: "Level",
  book: "Book",
  ebook: "eBook",
  audio: "Audio",
  isbn: "ISBN",
  isbn10: "ISBN-10",
  isbn13: "ISBN-13",
  normalizedisbn: "Normalized ISBN",
  isbnhb: "ISBN-HB",
  isbnpb: "ISBN-PB",
  isbnother: "ISBN-Other",
  possibleduplicate: "Possible Duplicate",
  duplicate: "Possible Duplicate",
  audience: "Audience",
  booklist: "Booklist",
  kirkus: "Kirkus",
  pw: "PW",
  slj: "SLJ",
  hornbook: "Horn Book",
  commonsensemedia: "Common Sense Media",
  otherreviews: "Other Reviews",
  elementarymiddleorhigh: "Level",
  campus: "Level",
  qty: "QTY",
  edition: "Edition",
  materialtype: "Material Type",
  seriestitle: "Series Title",
  follettebook: "Follett eBook",
  digitalcontentexpiration: "Digital Content Expiration",
};

export function cell(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function titleKey(title) {
  return cell(title).toLowerCase().replace(/\s+/g, " ");
}

export { isbnDigits, toIsbn13 };

function headerKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function canonicalizeRow(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const alias = HEADER_ALIASES[headerKey(key)];
    const dest = alias || key;
    if (out[dest] == null || cell(out[dest]) === "") out[dest] = value;
  }
  return out;
}

export function collectIsbns(row) {
  const map = new Map();
  for (const field of ISBN_FIELDS) {
    if (row[field] == null || row[field] === "") continue;
    for (const item of normalizeIsbnValue(row[field])) {
      if (!map.has(item.digits)) map.set(item.digits, item.display);
      if (item.isbn13 && !map.has(item.isbn13)) map.set(item.isbn13, item.isbn13);
    }
  }
  return map;
}

export function rowFingerprint(row) {
  const isbns = [...collectIsbns(row).keys()].sort().join(",");
  return [
    titleKey(row.Title),
    cell(row.Author).toLowerCase().replace(/\s+/g, " "),
    cell(row["Source Batch"]),
    isbns,
  ].join("\t");
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

function batchSortKey(label) {
  const school = cell(label).match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (school) return [1, Number(school[1]), 0, label];
  const monthYear = cell(label).match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1].slice(0, 3).toLowerCase()];
    if (month != null) return [0, Number(monthYear[2]), month, label];
  }
  return [2, 0, 0, label];
}

export function sortBatches(batches) {
  return [...batches].sort((a, b) => {
    const aa = batchSortKey(a);
    const bb = batchSortKey(b);
    for (let i = 0; i < 3; i += 1) {
      if (aa[i] !== bb[i]) return aa[i] - bb[i];
    }
    return String(aa[3]).localeCompare(String(bb[3]));
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
    if (count > bestCount || (count === bestCount && title.length > best.length)) {
      best = title;
      bestCount = count;
    }
  }
  return best;
}

function emptyGroup(key) {
  return {
    key,
    titleKeys: new Set([key]),
    titleCounts: new Map(),
    authors: [],
    isbnMap: new Map(),
    batches: new Set(),
    levels: new Set(),
    audiences: new Set(),
    formats: { book: false, ebook: false, audio: false },
    possibleDuplicate: false,
    posted: false,
    ebookOrder: false,
    owned: false,
    formatNotes: new Set(),
    ownedSources: new Set(),
    reviews: {
      booklist: new Set(),
      kirkus: new Set(),
      pw: new Set(),
      slj: new Set(),
      hornBook: new Set(),
      commonSenseMedia: new Set(),
      other: new Set(),
    },
    sourceFiles: new Set(),
    rowCount: 0,
  };
}

export function normalizeLevel(value) {
  const v = cell(value).replace(/\s+/g, " ");
  const key = v.toLowerCase();
  if (!key) return "";
  if (key.includes("vending")) return "Milam Book Vending Machine";
  if (key.includes("elem")) return "Elementary";
  if (key.includes("middle")) return "Middle";
  if (key.includes("high")) return "High";
  return v;
}

function addRowToGroup(group, row, sourceFile, kind = "posted") {
  const title = cell(row.Title);
  group.rowCount += 1;
  group.titleCounts.set(title, (group.titleCounts.get(title) || 0) + 1);
  group.titleKeys.add(titleKey(title));
  group.authors.push(cell(row.Author));
  if (sourceFile) group.sourceFiles.add(sourceFile);

  if (kind === "ebook-order") group.ebookOrder = true;
  else group.posted = true;

  const batch = cell(row["Source Batch"]);
  if (batch) group.batches.add(batch);
  const level = normalizeLevel(row.Level);
  if (level) group.levels.add(level);
  const audience = cell(row.Audience);
  if (audience && !/^\d{4}-\d{2}-\d{2}$/.test(audience) && !/^\d+(\.\d+)?$/.test(audience)) {
    group.audiences.add(audience);
  }

  const edition = cell(row.Edition);
  if (edition) group.formatNotes.add(edition);

  const anyFlag = truthyFlag(row.Book) || truthyFlag(row.eBook) || truthyFlag(row.Audio);
  if (truthyFlag(row.Book)) group.formats.book = true;
  if (truthyFlag(row.eBook) || kind === "ebook-order") group.formats.ebook = true;
  if (truthyFlag(row.Audio)) group.formats.audio = true;
  if (!anyFlag && kind !== "ebook-order") group.formats.book = true;
  if (truthyFlag(row["Possible Duplicate"])) group.possibleDuplicate = true;

  for (const [digits, display] of collectIsbns(row)) {
    if (!group.isbnMap.has(digits)) group.isbnMap.set(digits, display);
  }

  for (const [col, prop] of REVIEW_FIELDS) {
    const raw = cell(row[col]);
    if (!raw || raw.toLowerCase() === "reviews:") continue;
    group.reviews[prop].add(raw);
  }
  for (const key of Object.keys(row)) {
    if (!/^Reviews(_\d+)?$/.test(key)) continue;
    const raw = cell(row[key]);
    if (raw && raw.toLowerCase() !== "reviews:") group.reviews.other.add(raw);
  }
}

function mergeGroupInto(target, source) {
  if (target === source) return;
  target.rowCount += source.rowCount;
  for (const key of source.titleKeys) target.titleKeys.add(key);
  for (const [title, count] of source.titleCounts) {
    target.titleCounts.set(title, (target.titleCounts.get(title) || 0) + count);
  }
  target.authors.push(...source.authors);
  for (const [digits, display] of source.isbnMap) {
    if (!target.isbnMap.has(digits)) target.isbnMap.set(digits, display);
  }
  for (const batch of source.batches) target.batches.add(batch);
  for (const level of source.levels) target.levels.add(level);
  for (const audience of source.audiences) target.audiences.add(audience);
  target.formats.book = target.formats.book || source.formats.book;
  target.formats.ebook = target.formats.ebook || source.formats.ebook;
  target.formats.audio = target.formats.audio || source.formats.audio;
  target.possibleDuplicate = true;
  target.posted = target.posted || source.posted;
  target.ebookOrder = target.ebookOrder || source.ebookOrder;
  target.owned = target.owned || source.owned;
  for (const note of source.formatNotes) target.formatNotes.add(note);
  for (const label of source.ownedSources) target.ownedSources.add(label);
  for (const key of Object.keys(source.reviews)) {
    for (const value of source.reviews[key]) target.reviews[key].add(value);
  }
  for (const file of source.sourceFiles) target.sourceFiles.add(file);
}

function mergeGroupsBySharedIsbn(groups) {
  const keys = [...groups.keys()];
  const parent = new Map(keys.map((key) => [key, key]));

  function find(key) {
    let current = key;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)));
      current = parent.get(current);
    }
    return current;
  }

  const isbnOwner = new Map();
  for (const [key, group] of groups) {
    for (const isbn of group.isbnMap.keys()) {
      if (!isbnOwner.has(isbn)) {
        isbnOwner.set(isbn, key);
        continue;
      }
      const a = find(key);
      const b = find(isbnOwner.get(isbn));
      if (a !== b) parent.set(a, b);
    }
  }

  const merged = new Map();
  for (const key of keys) {
    const root = find(key);
    if (!merged.has(root)) merged.set(root, groups.get(root));
    if (key !== root) mergeGroupInto(merged.get(root), groups.get(key));
  }

  const byTitle = new Map();
  for (const group of merged.values()) {
    const display = pickDisplayTitle(group.titleCounts);
    const nextKey = titleKey(display) || group.key;
    if (group.titleKeys.size > 1) group.possibleDuplicate = true;
    if (!byTitle.has(nextKey)) {
      group.key = nextKey;
      byTitle.set(nextKey, group);
    } else {
      mergeGroupInto(byTitle.get(nextKey), group);
    }
  }
  return byTitle;
}

function isbnSort(a, b) {
  const rank = (d) => (d.startsWith("978") && d.length === 13 ? 0 : d.length === 13 ? 1 : d.length === 10 ? 2 : 3);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function finalizeGroups(groups, sourceFiles) {
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
        posted: g.posted,
        owned: g.owned,
        ebookOrder: g.ebookOrder,
        formatNotes: [...g.formatNotes],
        ownedSources: [...g.ownedSources],
        reviews,
        rowCount: g.rowCount,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));

  const titlesByBatch = {};
  const titlesByLevel = {};
  for (const t of titles) {
    for (const b of t.batches) titlesByBatch[b] = (titlesByBatch[b] || 0) + 1;
    for (const l of t.levels) titlesByLevel[l] = (titlesByLevel[l] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sheet: "merged",
    rowCount: titles.reduce((sum, title) => sum + title.rowCount, 0),
    uniqueTitleCount: titles.length,
    batches: sortBatches([...new Set(titles.flatMap((t) => t.batches))]),
    levels: sortLevels([...new Set(titles.flatMap((t) => t.levels))]),
    stats: {
      rowsByBatch: Object.fromEntries(sortBatches(Object.keys(titlesByBatch)).map((k) => [k, titlesByBatch[k]])),
      titlesByBatch: Object.fromEntries(sortBatches(Object.keys(titlesByBatch)).map((k) => [k, titlesByBatch[k]])),
      rowsByLevel: Object.fromEntries(sortLevels(Object.keys(titlesByLevel)).map((k) => [k, titlesByLevel[k]])),
      titlesByLevel: Object.fromEntries(sortLevels(Object.keys(titlesByLevel)).map((k) => [k, titlesByLevel[k]])),
      skippedDuplicateRows: 0,
    },
    titles,
  };
}

export function readSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath);
  const preferred = workbook.SheetNames.includes("Master List")
    ? "Master List"
    : workbook.SheetNames.find((name) => name.toLowerCase() !== "summary") || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[preferred], { defval: "" }).map(canonicalizeRow);
  return { filePath, sheet: preferred, rows };
}

function isSpreadsheetName(name) {
  const lower = name.toLowerCase();
  if (name.startsWith("~$")) return false;
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

export function listIncomingFiles(incomingDir) {
  if (!existsSync(incomingDir)) return [];
  return readdirSync(incomingDir)
    .filter(isSpreadsheetName)
    .map((name) => join(incomingDir, name))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export function collectSourceFiles({ masterList, incomingDir, extraFiles = [] }) {
  const files = [];
  const seen = new Set();
  function add(file) {
    if (!file || !existsSync(file)) return;
    const resolved = file;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    files.push(resolved);
  }
  add(masterList);
  for (const file of listIncomingFiles(incomingDir)) add(file);
  for (const file of extraFiles) add(file);
  return files;
}

export function detectKind(filePath, read) {
  const base = basename(filePath || read?.filePath || "").toLowerCase();
  const sheet = String(read?.sheet || "").toLowerCase();
  const keys = new Set(Object.keys(read?.rows?.[0] || {}).map((key) => headerKey(key)));
  if (
    keys.has("materialtype") &&
    (keys.has("follettebook") || keys.has("seriestitle") || sheet.includes("district"))
  ) {
    return "owned-follett";
  }
  if (base.includes("district-report") || sheet.includes("district report")) return "owned-follett";
  if ((keys.has("qty") && keys.has("edition")) || /^ebook-list/.test(base)) return "ebook-order";
  return "posted";
}

export function defaultBatch(filePath, kind) {
  const base = basename(filePath || "").replace(/\.(xlsx|xls)$/i, "");
  if (kind === "ebook-order") {
    const match = base.match(/ebook-list[-_ ]?([a-z0-9]+)/i);
    return match ? `eBook list ${match[1].toUpperCase()}` : "eBook list";
  }
  if (kind === "posted") {
    return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

export function buildCollection(sources) {
  const groups = new Map();
  const seen = new Set();
  let skippedDuplicateRows = 0;
  let acceptedRows = 0;
  const sourceFiles = [];

  for (const source of sources) {
    const label = source.label || source.filePath || "spreadsheet";
    const kind = source.kind || "posted";
    sourceFiles.push(label);
    for (const raw of source.rows) {
      const row = canonicalizeRow(raw);
      if (!cell(row.Title)) continue;
      if (!cell(row["Source Batch"]) && source.defaultBatch) {
        row["Source Batch"] = source.defaultBatch;
      }
      const fingerprint = rowFingerprint(row);
      if (seen.has(fingerprint)) {
        skippedDuplicateRows += 1;
        continue;
      }
      seen.add(fingerprint);
      acceptedRows += 1;
      const key = titleKey(row.Title);
      if (!groups.has(key)) groups.set(key, emptyGroup(key));
      addRowToGroup(groups.get(key), row, label, kind);
    }
  }

  const merged = mergeGroupsBySharedIsbn(groups);
  const payload = finalizeGroups(merged, sourceFiles);
  payload.rowCount = acceptedRows;
  payload.stats.skippedDuplicateRows = skippedDuplicateRows;
  payload.stats.rowsByBatch = payload.stats.titlesByBatch;
  payload.stats.postedTitleCount = payload.titles.filter((title) => title.posted).length;
  payload.stats.ebookOrderTitleCount = payload.titles.filter((title) => title.ebookOrder).length;
  payload.stats.ownedIsbnCount = payload.stats.ownedIsbnCount || 0;
  return payload;
}

export function applyOwnedToTitles(collection, owned) {
  const set = ownedIsbnSet(owned);
  const labels = owned.sources?.length ? owned.sources : owned.source ? [owned.source] : [];
  for (const title of collection.titles) {
    let ownedHit = false;
    for (const digits of title.isbnDigits) {
      const isbn13 = toIsbn13(digits);
      if (isbn13 && set.has(isbn13)) {
        ownedHit = true;
        break;
      }
    }
    title.owned = ownedHit;
    title.ownedSources = ownedHit ? labels : [];
  }
  collection.stats.ownedIsbnCount = owned.count || 0;
  collection.stats.ownedNamedTitleCount = collection.titles.filter((title) => title.owned).length;
  collection.stats.ownedAndPostedTitleCount = collection.titles.filter((title) => title.owned && title.posted).length;
  collection.owned = {
    source: owned.source,
    sources: owned.sources || (owned.source ? [owned.source] : []),
    count: owned.count || 0,
    file: "owned.json",
    stats: owned.stats || {},
  };
  return collection;
}

function relativeLabel(filePath, relativeTo) {
  if (relativeTo && filePath.startsWith(relativeTo)) {
    return filePath.slice(relativeTo.length).replace(/^\//, "");
  }
  return filePath;
}

export function buildDeskData(filePaths, { relativeTo } = {}) {
  const named = [];
  const ownedSources = [];
  for (const filePath of filePaths) {
    const read = readSpreadsheet(filePath);
    const kind = detectKind(filePath, read);
    const entry = {
      ...read,
      kind,
      defaultBatch: defaultBatch(filePath, kind),
      label: relativeLabel(filePath, relativeTo),
    };
    if (kind === "owned-follett") ownedSources.push(entry);
    else named.push(entry);
  }

  const collection = buildCollection(named);
  const owned = buildOwnedCatalog(ownedSources);
  applyOwnedToTitles(collection, owned);
  const ownedLabels = owned.sourceFiles || [];
  collection.sourceFiles = [...new Set([...(collection.sourceFiles || []), ...ownedLabels])];
  return { collection, owned };
}

export function buildCollectionFromFiles(filePaths, { relativeTo } = {}) {
  return buildDeskData(filePaths, { relativeTo }).collection;
}
