import type { OwnedCatalog, TitleRecord } from "../types";
import { isbnDigits, queryIsbn13, toIsbn13 } from "./isbn";
import { normalizeLoose } from "./normalize";

export type PreparedOwned = {
  catalog: OwnedCatalog;
  count: number;
  authors: Uint16Array;
  titles: Uint16Array;
  flags: string;
  authorIndex: Map<string, number[]>;
};

function unpackU16(b64: string): Uint16Array {
  const bin = atob(b64);
  const out = new Uint16Array(bin.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  }
  return out;
}

export function findOwnedIndex(packed: string, isbn13: string): number {
  if (!packed || !isbn13 || isbn13.length !== 13) return -1;
  const n = packed.length / 13;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = packed.slice(mid * 13, mid * 13 + 13);
    if (cur === isbn13) return mid;
    if (cur < isbn13) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function prepareOwned(catalog: OwnedCatalog | null | undefined): PreparedOwned | null {
  if (!catalog?.isbn13) return null;
  const count = catalog.count || catalog.isbn13.length / 13;
  const authors = unpackU16(catalog.a || "");
  const titles = unpackU16(catalog.t || "");
  const authorIndex = new Map<string, number[]>();
  for (let i = 0; i < count; i += 1) {
    const name = catalog.authors[authors[i] || 0];
    if (!name) continue;
    const key = normalizeLoose(name);
    const list = authorIndex.get(key);
    if (list) list.push(i);
    else authorIndex.set(key, [i]);
  }
  return {
    catalog,
    count,
    authors,
    titles,
    flags: catalog.f || "",
    authorIndex,
  };
}

function flagsToFormats(flag: string): TitleRecord["formats"] {
  return {
    book: flag === "B" || flag === "2",
    ebook: flag === "E" || flag === "2",
    audio: false,
  };
}

export function ownedRecordAt(prepared: PreparedOwned, index: number): TitleRecord {
  const isbn = prepared.catalog.isbn13.slice(index * 13, index * 13 + 13);
  const title = prepared.catalog.titles[prepared.titles[index] || 0] || "";
  const author = prepared.catalog.authors[prepared.authors[index] || 0] || "";
  const source = prepared.catalog.source || "Follett district report";
  const flag = prepared.flags[index] || "B";
  return {
    id: `owned-${isbn}`,
    title,
    authors: author ? [author] : [],
    isbns: [isbn],
    isbnDigits: [isbn],
    batches: [],
    levels: [],
    audiences: [],
    formats: flagsToFormats(flag),
    possibleDuplicate: false,
    posted: false,
    owned: true,
    ebookOrder: false,
    formatNotes: [],
    ownedSources: [source],
    reviews: {},
    rowCount: 1,
  };
}

export function lookupOwnedIsbn(prepared: PreparedOwned | null, query: string): TitleRecord | null {
  if (!prepared) return null;
  const direct = queryIsbn13(query);
  const isbn13 = direct || toIsbn13(isbnDigits(query));
  if (!isbn13) return null;
  const index = findOwnedIndex(prepared.catalog.isbn13, isbn13);
  if (index < 0) return null;
  return ownedRecordAt(prepared, index);
}

export function searchOwnedAuthors(
  prepared: PreparedOwned | null,
  query: string,
  limit = 8,
): TitleRecord[] {
  if (!prepared) return [];
  const q = normalizeLoose(query);
  if (q.length < 4) return [];
  const hits: TitleRecord[] = [];
  const seen = new Set<string>();
  for (const [author, indexes] of prepared.authorIndex) {
    if (!(author === q || author.includes(q) || q.includes(author))) continue;
    for (const index of indexes) {
      const record = ownedRecordAt(prepared, index);
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      hits.push(record);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export function hasPosted(title: TitleRecord): boolean {
  if (title.posted != null) return title.posted;
  return !title.ebookOrder && !title.id.startsWith("owned-");
}

export function sourceKinds(title: TitleRecord): Array<"posted" | "owned" | "ebook-order"> {
  const kinds: Array<"posted" | "owned" | "ebook-order"> = [];
  if (hasPosted(title)) kinds.push("posted");
  if (title.owned) kinds.push("owned");
  if (title.ebookOrder) kinds.push("ebook-order");
  return kinds;
}

export function haveIt(title: TitleRecord): boolean {
  return sourceKinds(title).length > 0;
}
