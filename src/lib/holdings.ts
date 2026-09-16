import type { TitleRecord } from "../types";
import { isbn13To10 } from "./isbn";
import { normalizeLoose } from "./normalize";

export type CompactHoldings = {
  b: string;
  n: number;
  a: string[];
  s: string[];
  r: Array<[number, number, number, number]>;
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

export function buildHoldingsIndex(compact: CompactHoldings): HoldingsIndex {
  const isbnMap = new Map<string, number>();
  const tokenMap = new Map<string, number[]>();
  for (let i = 0; i < compact.r.length; i += 1) {
    const isbn13 = String(compact.r[i][0]);
    isbnMap.set(isbn13, i);
    const isbn10 = isbn13To10(isbn13);
    if (isbn10) isbnMap.set(isbn10, i);
    const author = compact.a[compact.r[i][1]] || "";
    const series = compact.s[compact.r[i][2]] || "";
    for (const token of tokenize(author)) addToken(tokenMap, token, i);
    for (const token of tokenize(series)) addToken(tokenMap, token, i);
  }
  return { compact, isbnMap, tokenMap };
}

export function hydrateHolding(index: HoldingsIndex, rowIndex: number): TitleRecord {
  const rec = index.compact.r[rowIndex];
  const isbn13 = String(rec[0]);
  const isbn10 = isbn13To10(isbn13);
  const author = index.compact.a[rec[1]] || "";
  const series = index.compact.s[rec[2]] || "";
  const format = rec[3] || 1;
  const isbnDigits = isbn10 ? [isbn13, isbn10] : [isbn13];
  return {
    id: `h:${isbn13}`,
    title: series,
    titleUnknown: !series,
    authors: author ? [author] : [],
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
