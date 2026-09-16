import type { CollectionData, ScoredTitle, TitleRecord } from "../types";
import {
  diceCoefficient,
  isbnDigits,
  levenshtein,
  looksLikeIsbn,
  normalizeLoose,
  normalizeTitle,
} from "./normalize";

const TITLE_EXACT = 1;
const TITLE_PREFIX = 0.96;
const TITLE_CONTAINS = 0.88;
const AUTHOR_EXACT = 0.84;
const ISBN_MATCH = 1;

function tokenSet(value: string): string[] {
  return value.split(" ").filter((token) => token.length > 1 || /^\d+$/.test(token));
}

function tokensSimilar(queryToken: string, titleToken: string): boolean {
  if (queryToken === titleToken) return true;
  if (queryToken.length < 3 || titleToken.length < 3) return false;
  if (/^\d+$/.test(queryToken) || /^\d+$/.test(titleToken)) return queryToken === titleToken;
  return titleToken.startsWith(queryToken) || queryToken.startsWith(titleToken);
}

function tokenOverlap(query: string, target: string): number {
  const q = tokenSet(query);
  const t = tokenSet(target);
  if (!q.length || !t.length) return 0;
  let hit = 0;
  for (const token of q) {
    if (t.some((part) => tokensSimilar(token, part))) hit += 1;
  }
  return hit / q.length;
}

function authorBlob(title: TitleRecord): string {
  return normalizeLoose(title.authors.join(" "));
}

function titleScore(query: string, title: TitleRecord): { score: number; reason: ScoredTitle["reason"] } {
  const raw = query.trim();
  if (!raw) return { score: 0, reason: "title" };

  if (looksLikeIsbn(raw) || /^\d{10,13}$/.test(isbnDigits(raw))) {
    const qDigits = isbnDigits(raw);
    if (title.isbnDigits.some((isbn) => isbn === qDigits || isbn.includes(qDigits) || qDigits.includes(isbn))) {
      return { score: ISBN_MATCH, reason: "isbn" };
    }
  }

  const nq = normalizeTitle(raw);
  const nTitle = normalizeTitle(title.title);
  const looseTitle = normalizeLoose(title.title);
  const looseQuery = normalizeLoose(raw);

  if (nq && nTitle === nq) return { score: TITLE_EXACT, reason: "title" };
  if (nq && (nTitle.startsWith(`${nq} `) || nTitle.startsWith(nq))) {
    return { score: TITLE_PREFIX, reason: "title" };
  }
  if (nq && (nTitle.includes(` ${nq} `) || nTitle.endsWith(` ${nq}`) || nTitle.includes(nq))) {
    const coverage = nq.length / Math.max(nTitle.length, 1);
    return { score: TITLE_CONTAINS + Math.min(0.07, coverage * 0.07), reason: "title" };
  }

  const author = authorBlob(title);
  if (author && (author === looseQuery || author.includes(looseQuery))) {
    const authorScore = author === looseQuery ? AUTHOR_EXACT : 0.72;
    const overlap = tokenOverlap(nq || looseQuery, nTitle);
    return { score: Math.max(authorScore, overlap * 0.7), reason: overlap > 0.5 ? "title" : "author" };
  }

  const overlap = tokenOverlap(nq || looseQuery, nTitle);
  const dice = diceCoefficient(nq || looseQuery, nTitle);
  const dist = levenshtein(nq || looseQuery, nTitle);
  const lev =
    nq && nTitle
      ? 1 - dist / Math.max(nq.length, nTitle.length, 1)
      : 0;

  let score = Math.max(overlap * 0.78, dice * 0.86, lev > 0.72 ? lev * 0.9 : 0);
  if (looseTitle.includes(looseQuery) && looseQuery.length >= 3) {
    score = Math.max(score, 0.8);
  }

  if (nq.length >= 5 && nTitle.length >= 5 && dist <= 2) {
    score = Math.max(score, 0.9);
  }

  return { score, reason: score >= 0.9 ? "title" : "fuzzy" };
}

export function searchTitles(
  data: CollectionData,
  query: string,
  options: { limit?: number; minScore?: number; batch?: string; level?: string } = {},
): ScoredTitle[] {
  const { limit = 50, minScore = 0.42, batch, level } = options;
  const trimmed = query.trim();
  const pool = data.titles.filter((title) => {
    if (batch && batch !== "all" && !title.batches.includes(batch)) return false;
    if (level && level !== "all" && !title.levels.includes(level)) return false;
    return true;
  });

  if (!trimmed) {
    return pool.slice(0, limit).map((title) => ({ title, score: 0, reason: "title" }));
  }

  const scored: ScoredTitle[] = [];
  for (const title of pool) {
    const { score, reason } = titleScore(trimmed, title);
    if (score >= minScore) {
      scored.push({ title, score, reason });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.title.title.localeCompare(b.title.title));
  return scored.slice(0, limit);
}

export function classifySearch(results: ScoredTitle[]): {
  match: ScoredTitle | null;
  close: ScoredTitle[];
  list: ScoredTitle[];
} {
  if (!results.length) return { match: null, close: [], list: [] };
  const top = results[0];
  const second = results[1];
  const confident =
    top.score >= 0.92 && (!second || top.score - second.score >= 0.04 || top.reason === "isbn");

  const close = results
    .filter((item) => item.title.id !== top.title.id && item.score >= 0.58)
    .slice(0, 5);

  if (confident) {
    return { match: top, close, list: results };
  }

  return { match: null, close: results.slice(0, 5), list: results };
}

export function filterTitles(
  data: CollectionData,
  batch: string,
  level: string,
): TitleRecord[] {
  return data.titles.filter((title) => {
    if (batch !== "all" && !title.batches.includes(batch)) return false;
    if (level !== "all" && !title.levels.includes(level)) return false;
    return true;
  });
}
