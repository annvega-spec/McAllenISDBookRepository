/**
 * Shared helpers for turning one or more master-list spreadsheets into the
 * grouped collection JSON the desk searches.
 *
 * Follett Destiny district holdings are compacted separately: unique ISBNs
 * with interned author/series strings, then linked onto posted titles by ISBN
 * (and, for Sound/Recording audiobooks, by series title + author when a titled
 * card already exists). Format bits: Book=1, eBook=2, Audio=4.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import XLSX from "xlsx";
import { parseIsbnCell } from "./isbn.mjs";

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

const FOLLETT_BATCH = "Follett 9.16.26";
const ALL_CAMPUSES_BATCH = "All Campuses";
const EBOOK_ORDER_BATCH = "eBook order";
const SORA_BATCH = "Sora 2026-09-16";

const HEADER_ALIASES = {
  title: "Title",
  booktitle: "Title",
  author: "Author",
  authors: "Author",
  authorname: "Author",
  creator: "Author",
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
  elementarymiddleorhigh: "Level",
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
  audiencerating: "Audience",
  booklist: "Booklist",
  kirkus: "Kirkus",
  pw: "PW",
  slj: "SLJ",
  hornbook: "Horn Book",
  commonsensemedia: "Common Sense Media",
  otherreviews: "Other Reviews",
  edition: "Edition",
  qty: "Qty",
  materialtype: "Material Type",
  seriestitle: "Series Title",
  follettebook: "Follett eBook",
  titleid: "TitleID",
  contentaccesslevels: "Level",
  owned: "Owned",
  subscription: "Subscription",
  format: "Format",
};

export function cell(value) {
  if (value == null) return "";
  return String(value).trim();
}

const ARTICLES = new Set(["a", "an", "the"]);

/** Must match src/lib/normalize.ts `normalizeTitle`: case, trim, punctuation, leading a/an/the. */
export function titleKey(title) {
  const stripped = cell(title)
    .toLowerCase()
    .replace(/\s*[\(\[]\s*(un)?abridged\s*[\)\]]/gi, " ")
    .replace(/\s+(un)?abridged\s*$/i, "")
    .replace(/[&+]/g, " and ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
  const parts = stripped.split(" ").filter(Boolean);
  while (parts.length > 1 && ARTICLES.has(parts[0])) {
    parts.shift();
  }
  return parts.join(" ");
}

export function authorTokens(author) {
  return cell(author)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function authorsMatch(rowAuthor, exclusionAuthor) {
  const need = authorTokens(exclusionAuthor);
  if (!need.length) return false;
  const have = new Set(authorTokens(rowAuthor));
  return need.every((token) => have.has(token));
}

/** Either author token set is a subset of the other (handles extra illustrators). */
export function authorsCompatible(left, right) {
  const a = new Set(authorTokens(left));
  const b = new Set(authorTokens(right));
  if (!a.size || !b.size) return false;
  const aInB = [...a].every((token) => b.has(token));
  const bInA = [...b].every((token) => a.has(token));
  return aInB || bInA;
}

export const FOLLETT_FORMAT = { book: 1, ebook: 2, audio: 4 };
const FOLLETT_MATERIALS = new Set(["Book", "eBook", "Sound", "Recording"]);

export function isFollettMaterial(material) {
  return FOLLETT_MATERIALS.has(cell(material));
}

export function follettFormatBit(material) {
  const mt = cell(material);
  if (mt === "eBook") return FOLLETT_FORMAT.ebook;
  if (mt === "Sound" || mt === "Recording") return FOLLETT_FORMAT.audio;
  if (mt === "Book") return FOLLETT_FORMAT.book;
  return 0;
}

export function loadPostedExclusions(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.postedTitles || [];
  return list
    .map((item) => ({
      title: cell(item.title),
      author: cell(item.author),
    }))
    .filter((item) => item.title && item.author);
}

export function isExcludedPostedTitle(title, author, exclusions = []) {
  const key = titleKey(title);
  if (!key || !exclusions.length) return false;
  return exclusions.some((item) => titleKey(item.title) === key && authorsMatch(author, item.author));
}

export function isbnDigits(value) {
  const parsed = parseIsbnCell(value);
  if (parsed[0]?.isbn13) return parsed[0].isbn13;
  return cell(value).replace(/[^0-9Xx]/g, "").toUpperCase();
}

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

function preferredIsbnDisplay(parsed) {
  return parsed.isbn13 || parsed.isbn10 || parsed.display;
}

export function collectIsbns(row) {
  const map = new Map();
  for (const field of ISBN_FIELDS) {
    const raw = row[field];
    if (raw == null || raw === "") continue;
    for (const parsed of parseIsbnCell(raw)) {
      if (parsed.isbn13 && !map.has(parsed.isbn13)) {
        map.set(parsed.isbn13, preferredIsbnDisplay(parsed));
      }
      if (parsed.isbn10 && !map.has(parsed.isbn10)) {
        map.set(parsed.isbn10, parsed.isbn10);
      }
    }
  }
  return map;
}

function primaryIsbn(isbnMap) {
  for (const digits of isbnMap.keys()) {
    if (digits.length === 13) return digits;
  }
  return isbnMap.keys().next().value || "";
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

export function normalizeLevel(level) {
  const v = cell(level).replace(/\s+/g, " ");
  const key = v.toLowerCase();
  if (!key) return "";
  if (key === "elementary") return "Elementary";
  if (key === "middle" || key === "middle school") return "Middle";
  if (key === "high" || key === "high school") return "High";
  return v;
}

export function isHoldingsBatch(label) {
  return /^(follett|sora)\b/i.test(cell(label));
}

export function cleanSoraTitle(title) {
  return cell(title)
    .replace(/\s*[\(\[]\s*(un)?abridged\s*[\)\]]\s*$/i, "")
    .replace(/\s+(un)?abridged\s*$/i, "")
    .trim();
}

export function isSoraStaffOnly(level) {
  const v = cell(level)
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");
  if (!v) return false;
  if (v === "staff only" || v === "staff-only") return true;
  const parts = v.split(/[,;/|]+/).map((part) => part.trim());
  if (parts.some((part) => part === "staff only" || part === "staff-only")) return true;
  return /\bstaff[\s-]+only\b/.test(v);
}

function soraLevel(level) {
  const v = cell(level);
  if (!v || isSoraStaffOnly(v)) return "";
  return normalizeLevel(v);
}

function pickDisplayTitle(counts) {
  let best = "";
  let bestCount = -1;
  let bestPenalty = 99;
  for (const [title, count] of counts) {
    if (!title) continue;
    const penalty = /\((un)?abridged\)/i.test(title) ? 1 : 0;
    if (
      penalty < bestPenalty ||
      (penalty === bestPenalty && (count > bestCount || (count === bestCount && title.length > best.length)))
    ) {
      best = title;
      bestCount = count;
      bestPenalty = penalty;
    }
  }
  return best;
}

function emptyGroup(key) {
  return {
    key,
    titleKeys: new Set([key]),
    titleCounts: new Map(),
    postedTitleCounts: new Map(),
    authors: [],
    isbnMap: new Map(),
    batches: new Set(),
    postedBatches: new Set(),
    holdingsBatches: new Set(),
    levels: new Set(),
    audiences: new Set(),
    editions: new Set(),
    formats: { book: false, ebook: false, audio: false },
    posted: false,
    inCollection: false,
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
    sourceFiles: new Set(),
    rowCount: 0,
  };
}

function addRowToGroup(group, row, sourceFile) {
  const title = cell(row.Title);
  group.rowCount += 1;
  if (title) {
    group.titleCounts.set(title, (group.titleCounts.get(title) || 0) + 1);
    if (row._presence !== "holdings") {
      group.postedTitleCounts.set(title, (group.postedTitleCounts.get(title) || 0) + 1);
    }
  }
  group.titleKeys.add(titleKey(title) || group.key);
  group.authors.push(cell(row.Author));
  if (sourceFile) group.sourceFiles.add(sourceFile);

  const batch = cell(row["Source Batch"]);
  if (batch) {
    group.batches.add(batch);
    if (isHoldingsBatch(batch) || row._presence === "holdings") group.holdingsBatches.add(batch);
    else group.postedBatches.add(batch);
  }
  if (row._presence === "holdings" || isHoldingsBatch(batch)) group.inCollection = true;
  else group.posted = true;

  const level = normalizeLevel(row.Level);
  if (level) group.levels.add(level);
  const audience = cell(row.Audience);
  if (audience && !/^\d{4}-\d{2}-\d{2}$/.test(audience) && !/^\d+(\.\d+)?$/.test(audience)) {
    group.audiences.add(audience);
  }
  const edition = cell(row.Edition);
  if (edition) group.editions.add(edition);

  if (truthyFlag(row.Book)) group.formats.book = true;
  if (truthyFlag(row.eBook)) group.formats.ebook = true;
  if (truthyFlag(row.Audio)) group.formats.audio = true;
  if (truthyFlag(row["Possible Duplicate"])) group.possibleDuplicate = true;

  for (const [digits, display] of collectIsbns(row)) {
    if (!group.isbnMap.has(digits)) group.isbnMap.set(digits, display);
  }

  for (const [col, prop] of REVIEW_FIELDS) {
    const raw = cell(row[col]);
    if (!raw || raw.toLowerCase() === "reviews:") continue;
    group.reviews[prop].add(raw);
  }
}

function mergeGroupInto(target, source) {
  if (target === source) return;
  target.rowCount += source.rowCount;
  for (const key of source.titleKeys) target.titleKeys.add(key);
  for (const [title, count] of source.titleCounts) {
    target.titleCounts.set(title, (target.titleCounts.get(title) || 0) + count);
  }
  for (const [title, count] of source.postedTitleCounts || []) {
    target.postedTitleCounts.set(title, (target.postedTitleCounts.get(title) || 0) + count);
  }
  target.authors.push(...source.authors);
  for (const [digits, display] of source.isbnMap) {
    if (!target.isbnMap.has(digits)) target.isbnMap.set(digits, display);
  }
  for (const batch of source.batches) target.batches.add(batch);
  for (const batch of source.postedBatches) target.postedBatches.add(batch);
  for (const batch of source.holdingsBatches) target.holdingsBatches.add(batch);
  for (const level of source.levels) target.levels.add(level);
  for (const audience of source.audiences) target.audiences.add(audience);
  for (const edition of source.editions) target.editions.add(edition);
  target.formats.book = target.formats.book || source.formats.book;
  target.formats.ebook = target.formats.ebook || source.formats.ebook;
  target.formats.audio = target.formats.audio || source.formats.audio;
  target.posted = target.posted || source.posted;
  target.inCollection = target.inCollection || source.inCollection;
  target.possibleDuplicate = true;
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
    const display = pickDisplayTitle(group.postedTitleCounts?.size ? group.postedTitleCounts : group.titleCounts);
    const nextKey = titleKey(display) || group.key;
    if (group.titleCounts.size > 1) group.possibleDuplicate = true;
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

function recountPayloadStats(payload) {
  const titlesByBatch = {};
  const titlesByLevel = {};
  for (const t of payload.titles) {
    for (const b of t.batches) titlesByBatch[b] = (titlesByBatch[b] || 0) + 1;
    for (const l of t.levels) titlesByLevel[l] = (titlesByLevel[l] || 0) + 1;
  }
  payload.batches = sortBatches([...new Set(payload.titles.flatMap((t) => t.batches))]);
  payload.levels = sortLevels([...new Set(payload.titles.flatMap((t) => t.levels))]);
  payload.stats.titlesByBatch = Object.fromEntries(sortBatches(Object.keys(titlesByBatch)).map((k) => [k, titlesByBatch[k]]));
  payload.stats.rowsByBatch = payload.stats.titlesByBatch;
  payload.stats.titlesByLevel = Object.fromEntries(sortLevels(Object.keys(titlesByLevel)).map((k) => [k, titlesByLevel[k]]));
  payload.stats.rowsByLevel = payload.stats.titlesByLevel;
  payload.stats.postedTitleCount = payload.titles.filter((t) => t.posted).length;
  payload.stats.inCollectionPostedCount = payload.titles.filter((t) => t.posted && t.inCollection).length;
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
      const title = pickDisplayTitle(g.postedTitleCounts?.size ? g.postedTitleCounts : g.titleCounts);
      if (g.titleCounts.size > 1) g.possibleDuplicate = true;
      const id = createHash("sha1").update(g.key).digest("hex").slice(0, 12);
      const postedBatches = sortBatches([...g.postedBatches]);
      const holdingsBatches = sortBatches([...g.holdingsBatches]);
      return {
        id,
        title,
        titleUnknown: !title,
        authors: canonicalAuthors(g.authors),
        isbns: isbnDigitsList.map((d) => g.isbnMap.get(d)),
        isbnDigits: isbnDigitsList,
        batches: sortBatches([...g.batches]),
        postedBatches,
        holdingsBatches,
        levels: sortLevels([...g.levels]),
        audiences: [...g.audiences].sort((a, b) => a.localeCompare(b)),
        editions: [...g.editions].sort((a, b) => a.localeCompare(b)),
        formats: g.formats,
        posted: g.posted,
        inCollection: g.inCollection,
        possibleDuplicate: g.possibleDuplicate,
        reviews,
        rowCount: g.rowCount,
      };
    })
    .sort((a, b) => (a.title || a.isbnDigits[0] || "").localeCompare(b.title || b.isbnDigits[0] || "", "en", { sensitivity: "base" }));

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sheet: "merged",
    rowCount: titles.reduce((sum, title) => sum + title.rowCount, 0),
    uniqueTitleCount: titles.length,
    batches: [],
    levels: [],
    stats: {
      rowsByBatch: {},
      titlesByBatch: {},
      rowsByLevel: {},
      titlesByLevel: {},
      skippedDuplicateRows: 0,
      skippedExcludedRows: 0,
      postedTitleCount: 0,
      inCollectionPostedCount: 0,
      holdingsRows: 0,
      holdingsUniqueIsbns: 0,
      holdingsLinkedToPosted: 0,
    },
    titles,
  };
  recountPayloadStats(payload);
  return payload;
}

export function detectSourceKind(filePath, sheet, columns = []) {
  const name = basename(filePath || "").toLowerCase();
  const sheetName = String(sheet || "").toLowerCase();
  const cols = new Set(columns.map(headerKey));
  if (name.includes("district-report") || sheetName.includes("district report")) return "follett";
  if (cols.has("materialtype") && cols.has("isbn") && cols.has("seriestitle") && !cols.has("title")) {
    return "follett";
  }
  if (name.includes("sora") || sheetName.includes("title status") || (cols.has("titleid") && cols.has("format") && cols.has("owned") && cols.has("title"))) {
    return "sora";
  }
  if (name.startsWith("ebook-list") || (cols.has("qty") && cols.has("edition") && cols.has("title") && cols.has("isbn"))) {
    return "ebook-order";
  }
  if (name.includes("all-campuses") || sheetName === "all campuses" || cols.has("elementarymiddleorhigh")) {
    return "all-campuses";
  }
  return "master";
}

function applySourceHints(row, kind) {
  if (kind === "all-campuses") {
    if (!cell(row["Source Batch"])) row["Source Batch"] = ALL_CAMPUSES_BATCH;
    row.Level = normalizeLevel(row.Level);
    row._presence = "posted";
  } else if (kind === "ebook-order") {
    if (!cell(row["Source Batch"])) row["Source Batch"] = EBOOK_ORDER_BATCH;
    row.eBook = true;
    row._presence = "posted";
  } else if (kind === "follett") {
    if (!cell(row["Source Batch"])) row["Source Batch"] = FOLLETT_BATCH;
    const mt = cell(row["Material Type"]);
    if (mt === "Book") row.Book = true;
    if (mt === "eBook") row.eBook = true;
    if (mt === "Sound" || mt === "Recording") row.Audio = true;
    if (!cell(row.Title) && cell(row["Series Title"])) row.Title = cell(row["Series Title"]);
    row._presence = "holdings";
  } else if (kind === "sora") {
    if (!cell(row["Source Batch"])) row["Source Batch"] = SORA_BATCH;
    if (cell(row.Title)) row.Title = cleanSoraTitle(row.Title);
    row.Level = soraLevel(row.Level);
    const fmt = cell(row.Format).toLowerCase();
    if (fmt === "ebook") row.eBook = true;
    if (fmt === "audiobook") row.Audio = true;
    row._presence = "holdings";
  } else {
    row._presence = row._presence || "posted";
  }
  return row;
}

function preferredSheetName(sheetNames, kind) {
  if (kind === "follett") {
    return sheetNames.find((name) => /district report/i.test(name)) || sheetNames[0];
  }
  if (kind === "sora") {
    return sheetNames.find((name) => /title status/i.test(name)) || sheetNames[0];
  }
  if (kind === "all-campuses") {
    return sheetNames.find((name) => /all campuses/i.test(name)) || sheetNames[0];
  }
  if (kind === "ebook-order") {
    return sheetNames.find((name) => /page 1/i.test(name)) || sheetNames[0];
  }
  if (sheetNames.includes("Master List")) return "Master List";
  return sheetNames.find((name) => name.toLowerCase() !== "summary") || sheetNames[0];
}

export function readSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath);
  const probeKind = detectSourceKind(filePath, workbook.SheetNames[0], []);
  const preferred = preferredSheetName(workbook.SheetNames, probeKind);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[preferred], { defval: "", raw: true }).map(canonicalizeRow);
  const kind = detectSourceKind(filePath, preferred, rows[0] ? Object.keys(rows[0]) : []);
  return { filePath, sheet: preferred, rows, kind };
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

function groupKeyForRow(row) {
  const title = titleKey(row.Title);
  if (title) return title;
  const isbn = primaryIsbn(collectIsbns(row));
  if (isbn) return `isbn:${isbn}`;
  return "";
}

export function buildCollection(sources, { exclusions = [] } = {}) {
  const groups = new Map();
  const seen = new Set();
  let skippedDuplicateRows = 0;
  let skippedExcludedRows = 0;
  let acceptedRows = 0;
  const sourceFiles = [];

  for (const source of sources) {
    const label = source.label || source.filePath || "spreadsheet";
    const kind = source.kind || "master";
    sourceFiles.push(label);
    for (const raw of source.rows) {
      const canonical = canonicalizeRow(raw);
      if (kind === "sora" && isSoraStaffOnly(canonical.Level || canonical["Content access levels"])) {
        continue;
      }
      const row = applySourceHints(canonical, kind);
      if (kind === "sora") {
        const fmt = cell(row.Format).toLowerCase();
        if (fmt !== "ebook" && fmt !== "audiobook") continue;
      }
      const material = cell(row["Material Type"]);
      if (material && !isFollettMaterial(material)) continue;
      const title = cell(row.Title);
      const isbns = collectIsbns(row);
      if (!title && !isbns.size) continue;
      if (row._presence !== "holdings" && isExcludedPostedTitle(title, cell(row.Author), exclusions)) {
        skippedExcludedRows += 1;
        continue;
      }
      const fingerprint = rowFingerprint(row);
      if (seen.has(fingerprint)) {
        skippedDuplicateRows += 1;
        continue;
      }
      seen.add(fingerprint);
      acceptedRows += 1;
      const key = groupKeyForRow(row);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, emptyGroup(key));
      addRowToGroup(groups.get(key), row, label);
    }
  }

  const merged = mergeGroupsBySharedIsbn(groups);
  const payload = finalizeGroups(merged, sourceFiles);
  payload.rowCount = acceptedRows;
  payload.stats.skippedDuplicateRows = skippedDuplicateRows;
  payload.stats.skippedExcludedRows = skippedExcludedRows;
  payload.stats.rowsByBatch = payload.stats.titlesByBatch;
  return payload;
}

export function ingestFollettRows(rows, { batch = FOLLETT_BATCH } = {}) {
  const byIsbn = new Map();
  let accepted = 0;
  let skippedNoIsbn = 0;
  let skippedType = 0;

  for (const raw of rows) {
    const row = canonicalizeRow(raw);
    const mt = cell(row["Material Type"]);
    if (!isFollettMaterial(mt)) {
      skippedType += 1;
      continue;
    }
    const parsed = parseIsbnCell(row.ISBN);
    const isbn13 = parsed[0]?.isbn13;
    if (!isbn13) {
      skippedNoIsbn += 1;
      continue;
    }
    accepted += 1;
    let rec = byIsbn.get(isbn13);
    if (!rec) {
      rec = {
        isbn13,
        isbn10: parsed[0].isbn10 || "",
        author: cell(row.Author),
        series: cell(row["Series Title"]),
        format: 0,
        rowCount: 0,
      };
      byIsbn.set(isbn13, rec);
    }
    rec.rowCount += 1;
    rec.format |= follettFormatBit(mt);
    if (!rec.author) rec.author = cell(row.Author);
    if (!rec.series) rec.series = cell(row["Series Title"]);
    if (!rec.isbn10 && parsed[0].isbn10) rec.isbn10 = parsed[0].isbn10;
  }

  return { batch, byIsbn, accepted, skippedNoIsbn, skippedType };
}

function internString(map, value) {
  const s = cell(value);
  if (!map.has(s)) map.set(s, map.size);
  return map.get(s);
}

export function compactHoldings(records, { batch = FOLLETT_BATCH } = {}) {
  const authors = new Map([["", 0]]);
  const series = new Map([["", 0]]);
  const rows = [];
  for (const rec of records) {
    rows.push([
      Number(rec.isbn13),
      internString(authors, rec.author),
      internString(series, rec.series),
      rec.format || FOLLETT_FORMAT.book,
    ]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return {
    b: batch,
    n: rows.length,
    a: [...authors.keys()],
    s: [...series.keys()],
    r: rows,
  };
}

function unionHoldingIsbn(hit, rec) {
  if (rec.isbn10 && !hit.isbnDigits.includes(rec.isbn10)) {
    hit.isbnDigits.push(rec.isbn10);
    hit.isbns.push(rec.isbn10);
  }
  if (rec.isbn13 && !hit.isbnDigits.includes(rec.isbn13)) {
    hit.isbnDigits.push(rec.isbn13);
    hit.isbns.push(rec.isbn13);
  }
}

function applyHoldingToTitle(hit, rec, batch) {
  hit.inCollection = true;
  if (!hit.holdingsBatches.includes(batch)) hit.holdingsBatches.push(batch);
  if (!hit.batches.includes(batch)) hit.batches.push(batch);
  if (rec.format & FOLLETT_FORMAT.book) hit.formats.book = true;
  if (rec.format & FOLLETT_FORMAT.ebook) hit.formats.ebook = true;
  if (rec.format & FOLLETT_FORMAT.audio) hit.formats.audio = true;
  unionHoldingIsbn(hit, rec);
  if (rec.author && !hit.authors.length) hit.authors.push(rec.author);
  if (hit.titleUnknown && rec.series) {
    hit.title = rec.series;
    hit.titleUnknown = false;
  }
  hit.rowCount += rec.rowCount;
}

function indexTitledCards(titles) {
  const byKey = new Map();
  for (const title of titles) {
    if (title.titleUnknown || !cell(title.title)) continue;
    const key = titleKey(title.title);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(title);
  }
  return byKey;
}

function findTitledCardForHolding(rec, titledByKey) {
  const key = titleKey(rec.series);
  if (!key || !cell(rec.author)) return null;
  const candidates = titledByKey.get(key);
  if (!candidates?.length) return null;
  return (
    candidates.find((title) => title.authors.some((author) => authorsCompatible(author, rec.author))) || null
  );
}

export function attachHoldingsToCollection(payload, ingested) {
  const byDigits = new Map();
  for (const title of payload.titles) {
    if (title.posted == null) title.posted = true;
    if (title.inCollection == null) title.inCollection = false;
    if (!title.postedBatches) title.postedBatches = title.batches.filter((b) => !isHoldingsBatch(b));
    if (!title.holdingsBatches) title.holdingsBatches = title.batches.filter((b) => isHoldingsBatch(b));
    if (!title.editions) title.editions = [];
    if (title.titleUnknown == null) title.titleUnknown = !title.title;
    for (const digits of title.isbnDigits) byDigits.set(digits, title);
  }

  const remaining = [];
  let linked = 0;
  for (const rec of ingested.byIsbn.values()) {
    const hit = byDigits.get(rec.isbn13) || (rec.isbn10 ? byDigits.get(rec.isbn10) : null);
    if (!hit) {
      remaining.push(rec);
      continue;
    }
    linked += 1;
    applyHoldingToTitle(hit, rec, ingested.batch);
    for (const digits of [rec.isbn13, rec.isbn10]) {
      if (digits) byDigits.set(digits, hit);
    }
  }

  const titledByKey = indexTitledCards(payload.titles);
  const leftover = [];
  for (const rec of remaining) {
    const audioOnlyAttach = Boolean(rec.format & FOLLETT_FORMAT.audio);
    const hit = audioOnlyAttach ? findTitledCardForHolding(rec, titledByKey) : null;
    if (!hit) {
      leftover.push(rec);
      continue;
    }
    linked += 1;
    applyHoldingToTitle(hit, rec, ingested.batch);
    for (const digits of [rec.isbn13, rec.isbn10]) {
      if (digits) byDigits.set(digits, hit);
    }
  }

  for (const title of payload.titles) {
    title.batches = sortBatches(title.batches);
    title.postedBatches = sortBatches(title.postedBatches);
    title.holdingsBatches = sortBatches(title.holdingsBatches);
    title.isbnDigits.sort(isbnSort);
    title.isbns = title.isbnDigits.slice();
  }

  const compact = compactHoldings(leftover, { batch: ingested.batch });
  payload.stats.holdingsRows = ingested.accepted;
  payload.stats.holdingsUniqueIsbns = ingested.byIsbn.size;
  payload.stats.holdingsLinkedToPosted = linked;
  payload.stats.holdingsOnly = compact.n;
  payload.holdingsFile = "data/holdings.json";
  payload.holdingsBatch = ingested.batch;
  recountPayloadStats(payload);
  return compact;
}

export function buildCollectionFromFiles(filePaths, { relativeTo, exclusions = [] } = {}) {
  return buildCatalogFromFiles(filePaths, { relativeTo, exclusions }).collection;
}

export function buildCatalogFromFiles(filePaths, { relativeTo, exclusions = [] } = {}) {
  const posted = [];
  const follett = [];
  for (const filePath of filePaths) {
    const read = readSpreadsheet(filePath);
    const label =
      relativeTo && filePath.startsWith(relativeTo) ? filePath.slice(relativeTo.length).replace(/^\//, "") : filePath;
    const source = { ...read, label };
    if (read.kind === "follett") follett.push(source);
    else posted.push(source);
  }

  const collection = buildCollection(posted, { exclusions });
  let holdings = null;
  if (follett.length) {
    const ingested = ingestFollettRows(
      follett.flatMap((source) => source.rows),
      { batch: FOLLETT_BATCH },
    );
    for (const source of follett) collection.sourceFiles.push(source.label);
    holdings = attachHoldingsToCollection(collection, ingested);
  }
  return { collection, holdings };
}

export { FOLLETT_BATCH, ALL_CAMPUSES_BATCH, EBOOK_ORDER_BATCH, SORA_BATCH };
