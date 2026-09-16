/**
 * Compact Follett / owned-holdings index.
 *
 * The district report is ~365k rows. We keep Book and eBook rows that have an
 * ISBN, drop Video/Kit/etc, normalize ISBNs, and ship a packed ISBN-13 string
 * plus dictionary-encoded author/series metadata. Title search never walks this
 * list — only ISBN (and a cheap author dictionary) lookup does.
 */

import { basename } from "node:path";
import { collectNormalizedIsbn13s, isbnDigits } from "./isbn.mjs";

const BOOK_TYPES = new Set(["book", "ebook"]);

export function ownedLabelFromFile(filePath, sheet = "") {
  const base = basename(filePath || "");
  const fromName = base.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/);
  if (fromName) return `Follett ${fromName[1]}`;
  const fromSheet = String(sheet || "").match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/);
  if (fromSheet) return `Follett ${fromSheet[1]}`;
  return "Follett district report";
}

export function isOwnedMaterialType(value) {
  return BOOK_TYPES.has(String(value || "").trim().toLowerCase());
}

function cell(value) {
  if (value == null) return "";
  return String(value).trim();
}

function packU16(values) {
  const buf = Buffer.allocUnsafe(values.length * 2);
  for (let i = 0; i < values.length; i += 1) {
    buf.writeUInt16LE(values[i] & 0xffff, i * 2);
  }
  return buf.toString("base64");
}

function intern(dict, index, value) {
  const text = cell(value);
  if (!text) return 0;
  if (index.has(text)) return index.get(text);
  const next = dict.length;
  if (next > 0xffff) {
    throw new Error("Owned-catalog dictionary overflowed 65535 unique strings");
  }
  index.set(text, next);
  dict.push(text);
  return next;
}

export function buildOwnedCatalog(sources) {
  const byIsbn = new Map();
  const sourceFiles = [];
  const labels = new Set();
  let sourceRows = 0;
  let skippedType = 0;
  let skippedNoIsbn = 0;
  let accepted = 0;

  for (const source of sources) {
    const label = source.label || source.filePath || "owned";
    sourceFiles.push(label);
    labels.add(ownedLabelFromFile(source.filePath || label, source.sheet));
    for (const row of source.rows || []) {
      sourceRows += 1;
      if (!isOwnedMaterialType(row["Material Type"])) {
        skippedType += 1;
        continue;
      }
      const isbn13s = collectNormalizedIsbn13s(row.ISBN);
      if (!isbn13s.length) {
        skippedNoIsbn += 1;
        continue;
      }
      accepted += 1;
      const author = cell(row.Author);
      const title = cell(row["Series Title"]) || cell(row.Title);
      const material = String(row["Material Type"] || "").trim().toLowerCase();
      for (const isbn13 of isbn13s) {
        const current = byIsbn.get(isbn13);
        if (!current) {
          byIsbn.set(isbn13, {
            author,
            title,
            book: material === "book",
            ebook: material === "ebook",
          });
          continue;
        }
        if (!current.author && author) current.author = author;
        if (!current.title && title) current.title = title;
        if (material === "book") current.book = true;
        if (material === "ebook") current.ebook = true;
      }
    }
  }

  const isbn13List = [...byIsbn.keys()].sort();
  const authors = [""];
  const titles = [""];
  const authorIndex = new Map();
  const titleIndex = new Map();
  const a = [];
  const t = [];
  const flags = [];

  for (const isbn of isbn13List) {
    const row = byIsbn.get(isbn);
    a.push(intern(authors, authorIndex, row.author));
    t.push(intern(titles, titleIndex, row.title));
    flags.push(row.book && row.ebook ? "2" : row.ebook ? "E" : "B");
  }

  const source = [...labels][0] || "Follett district report";

  return {
    source,
    sources: [...labels],
    sourceFiles,
    count: isbn13List.length,
    isbn13: isbn13List.join(""),
    authors,
    titles,
    a: packU16(a),
    t: packU16(t),
    f: flags.join(""),
    stats: {
      sourceRows,
      acceptedRows: accepted,
      uniqueIsbn13: isbn13List.length,
      skippedNonBook: skippedType,
      skippedNoIsbn,
      duplicateIsbnRows: Math.max(0, accepted - isbn13List.length),
    },
  };
}

export function ownedHasIsbn(catalog, isbn13) {
  if (!catalog?.isbn13 || !isbn13 || isbn13.length !== 13) return false;
  const packed = catalog.isbn13;
  const n = packed.length / 13;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = packed.slice(mid * 13, mid * 13 + 13);
    if (cur === isbn13) return true;
    if (cur < isbn13) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export function ownedIsbnSet(catalog) {
  const set = new Set();
  const packed = catalog?.isbn13 || "";
  for (let i = 0; i < packed.length; i += 13) {
    set.add(packed.slice(i, i + 13));
  }
  return set;
}

export { isbnDigits };
