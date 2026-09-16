import type { TitleRecord } from "../types";
import { isbn13To10 } from "./isbn";
import { normalizeLoose } from "./normalize";

export type CompactHoldings = {
  b: string;
  n: number;
  a: string[];
  s: string[];
  r: Array<[number, number, number, number]>;
  /** Extra ISBN-13s on the same title card (unioned leftover holdings). */
  x?: number[][];
};

export type HoldingsIndex = {
  compact: CompactHoldings;
  isbnMap: Map<string, number>;
  tokenMap: Map<string, number[]>;
};

const TOKEN = /[a-z0-9]{2,}/g;

function tokenize(value: string): string[] {
  return (normalizeLoose(value).match(TOKEN) || []).filter((token) => token.length >= 2);
}

function addToken(map: Map<string, number[]>, token: string, index: number) {
  const list = map.get(token);
  if (list) {
    if (list[list.length - 1] !== index) list.push(index);
  } else {
    map.set(token, [index]);
  }
}

function addIsbn(map: Map<string, number>, isbn: string, index: number) {
  if (!isbn) return;
  map.set(isbn, index);
  const isbn10 = isbn.length === 13 ? isbn13To10(isbn) : "";
  if (isbn10) map.set(isbn10, index);
}

export function buildHoldingsIndex(compact: CompactHoldings): HoldingsIndex {
  const isbnMap = new Map<string, number>();
  const tokenMap = new Map<string, number[]>();
  for (let i = 0; i < compact.r.length; i += 1) {
    addIsbn(isbnMap, String(compact.r[i][0]), i);
    for (const extra of compact.x?.[i] || []) addIsbn(isbnMap, String(extra), i);
    const author = compact.a[compact.r[i][1]] || "";
    const title = compact.s[compact.r[i][2]] || "";
    for (const token of tokenize(author)) addToken(tokenMap, token, i);
    for (const token of tokenize(title)) addToken(tokenMap, token, i);
  }
  return { compact, isbnMap, tokenMap };
}

function holdingIsbnList(index: HoldingsIndex, rowIndex: number): string[] {
  const rec = index.compact.r[rowIndex];
  const seen = new Set<string>();
  const out: string[] = [];
  function push(isbn: string) {
    if (!isbn || seen.has(isbn)) return;
    seen.add(isbn);
    out.push(isbn);
    const isbn10 = isbn.length === 13 ? isbn13To10(isbn) : "";
    if (isbn10 && !seen.has(isbn10)) {
      seen.add(isbn10);
      out.push(isbn10);
    }
  }
  push(String(rec[0]));
  for (const extra of index.compact.x?.[rowIndex] || []) push(String(extra));
  return out;
}

export function hydrateHolding(index: HoldingsIndex, rowIndex: number): TitleRecord {
  const rec = index.compact.r[rowIndex];
  const isbnDigits = holdingIsbnList(index, rowIndex);
  const author = index.compact.a[rec[1]] || "";
  const title = index.compact.s[rec[2]] || "";
  const format = rec[3] || 1;
  return {
    id: `h:${String(rec[0])}`,
    title,
    titleUnknown: !title,
    authors: author ? author.split(/\s*;\s*/).filter(Boolean) : [],
    isbns: isbnDigits,
    isbnDigits,
    batches: [index.compact.b],
    postedBatches: [],
    holdingsBatches: [index.compact.b],
    levels: [],
    audiences: [],
    editions: [],
    formats: { book: Boolean(format & 1), ebook: Boolean(format & 2), audio: Boolean(format & 4) },
    posted: false,
    inCollection: true,
    possibleDuplicate: false,
    reviews: {},
    rowCount: 1,
  };
}

function tokenHits(index: HoldingsIndex, token: string): number[] {
  if (token.length < 2) return [];
  const exact = index.tokenMap.get(token);
  if (token.length < 4) return exact || [];
  const hits: number[] = [];
  const seen = new Set<number>();
  if (exact) {
    for (const id of exact) {
      seen.add(id);
      hits.push(id);
    }
  }
  for (const [key, values] of index.tokenMap) {
    if (key === token || !key.startsWith(token)) continue;
    for (const id of values) {
      if (seen.has(id)) continue;
      seen.add(id);
      hits.push(id);
    }
  }
  return hits;
}

function intersect(lists: number[][]): number[] {
  if (!lists.length) return [];
  const sorted = [...lists].sort((a, b) => a.length - b.length);
  const counts = new Map<number, number>();
  for (const id of sorted[0]) counts.set(id, 1);
  for (let i = 1; i < sorted.length; i += 1) {
    for (const id of sorted[i]) {
      const current = counts.get(id);
      if (current) counts.set(id, current + 1);
    }
  }
  const need = sorted.length;
  const out: number[] = [];
  for (const [id, count] of counts) {
    if (count === need) out.push(id);
  }
  return out;
}

export function lookupHoldingIsbn(index: HoldingsIndex, digits: string): TitleRecord | null {
  if (!digits) return null;
  const row = index.isbnMap.get(digits);
  if (row == null) return null;
  return hydrateHolding(index, row);
}

export function searchHoldingsTokens(index: HoldingsIndex, query: string, limit = 15): TitleRecord[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const lists = tokens.map((token) => tokenHits(index, token));
  if (lists.some((list) => !list.length)) return [];
  const ids = tokens.length === 1 ? lists[0] : intersect(lists);
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= limit) break;
  }
  return unique.map((id) => hydrateHolding(index, id));
}
