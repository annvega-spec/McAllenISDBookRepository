import type { CollectionData, Reviews, ScoredTitle, TitleRecord } from "../types";
import { normalizeLoose, normalizeTitle } from "./normalize";

function uniqueStrings(values: string[], keyFn: (value: string) => string = (value) => value.toLowerCase()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isbnRank(digits: string): number {
  if (digits.startsWith("978") && digits.length === 13) return 0;
  if (digits.length === 13) return 1;
  if (digits.length === 10) return 2;
  return 3;
}

function isbnSort(a: string, b: string): number {
  return isbnRank(a) - isbnRank(b) || a.localeCompare(b);
}

function mergeReviews(a: Reviews, b: Reviews): Reviews {
  const out: Reviews = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Reviews>;
  for (const key of keys) {
    const values = uniqueStrings([...(a[key] ?? []), ...(b[key] ?? [])]);
    if (values.length) out[key] = values;
  }
  return out;
}

function preferredBase(a: TitleRecord, b: TitleRecord): TitleRecord {
  const score = (title: TitleRecord) =>
    (title.title && !title.titleUnknown ? 4 : 0) + (title.posted !== false ? 2 : 0) + (title.inCollection ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

function pickDisplayTitle(a: TitleRecord, b: TitleRecord): string {
  if (a.title && !a.titleUnknown) return a.title;
  if (b.title && !b.titleUnknown) return b.title;
  return a.title || b.title || "";
}

function mergeIsbnMaps(a: TitleRecord, b: TitleRecord): { isbns: string[]; isbnDigits: string[] } {
  const map = new Map<string, string>();
  for (const rec of [a, b]) {
    rec.isbnDigits.forEach((digits, index) => {
      if (!digits || map.has(digits)) return;
      map.set(digits, rec.isbns[index] ?? digits);
    });
    for (const isbn of rec.isbns) {
      const digits = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
      if (digits && !map.has(digits)) map.set(digits, isbn);
    }
  }
  const isbnDigits = [...map.keys()].sort(isbnSort);
  return { isbnDigits, isbns: isbnDigits.map((digits) => map.get(digits) ?? digits) };
}

export function mergeTitleRecords(a: TitleRecord, b: TitleRecord): TitleRecord {
  if (a === b) return a;
  const base = preferredBase(a, b);
  const other = base === a ? b : a;
  const title = pickDisplayTitle(base, other);
  const isbns = mergeIsbnMaps(base, other);
  return {
    ...base,
    title,
    titleUnknown: !title,
    authors: uniqueStrings([...base.authors, ...other.authors], (name) => normalizeLoose(name)),
    isbns: isbns.isbns,
    isbnDigits: isbns.isbnDigits,
    batches: uniqueStrings([...base.batches, ...other.batches]),
    postedBatches: uniqueStrings([...(base.postedBatches ?? []), ...(other.postedBatches ?? [])]),
    holdingsBatches: uniqueStrings([...(base.holdingsBatches ?? []), ...(other.holdingsBatches ?? [])]),
    levels: uniqueStrings([...base.levels, ...other.levels]),
    audiences: uniqueStrings([...base.audiences, ...other.audiences]),
    editions: uniqueStrings([...(base.editions ?? []), ...(other.editions ?? [])]),
    formats: {
      book: base.formats.book || other.formats.book,
      ebook: base.formats.ebook || other.formats.ebook,
      audio: base.formats.audio || other.formats.audio,
    },
    posted: base.posted !== false || other.posted !== false,
    inCollection: Boolean(base.inCollection || other.inCollection),
    possibleDuplicate: Boolean(
      base.possibleDuplicate ||
        other.possibleDuplicate ||
        (Boolean(base.title) && Boolean(other.title) && base.title !== other.title),
    ),
    reviews: mergeReviews(base.reviews, other.reviews),
    rowCount: base.rowCount + other.rowCount,
  };
}

export function titleGroupKey(title: TitleRecord): string {
  const normalized = normalizeTitle(title.title || "");
  if (normalized) return `title:${normalized}`;
  const isbn = title.isbnDigits.find((digits) => digits.length >= 10) || title.isbns[0] || title.id;
  return `isbn:${isbn}`;
}

type Cluster<T> = { record: TitleRecord; extra: T };

function collapseClusters<T>(items: Array<Cluster<T>>, mergeExtra: (left: T, right: T) => T): Array<Cluster<T>> {
  if (items.length < 2) return items;

  const groups = new Map<string, Cluster<T>>();
  for (const item of items) {
    const key = titleGroupKey(item.record);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, item);
      continue;
    }
    groups.set(key, {
      record: mergeTitleRecords(existing.record, item.record),
      extra: mergeExtra(existing.extra, item.extra),
    });
  }

  const parent = new Map<string, string>();
  for (const key of groups.keys()) parent.set(key, key);

  function find(key: string): string {
    let current = key;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)!)!);
      current = parent.get(current)!;
    }
    return current;
  }

  const isbnOwner = new Map<string, string>();
  for (const [key, cluster] of groups) {
    for (const isbn of cluster.record.isbnDigits) {
      if (!isbnOwner.has(isbn)) {
        isbnOwner.set(isbn, key);
        continue;
      }
      const a = find(key);
      const b = find(isbnOwner.get(isbn)!);
      if (a === b) continue;
      const aTitled = Boolean(normalizeTitle(groups.get(a)!.record.title || ""));
      const bTitled = Boolean(normalizeTitle(groups.get(b)!.record.title || ""));
      if (!aTitled && bTitled) parent.set(a, b);
      else parent.set(b, a);
    }
  }

  const merged = new Map<string, Cluster<T>>();
  for (const key of groups.keys()) {
    const root = find(key);
    const cluster = groups.get(key)!;
    const existing = merged.get(root);
    if (!existing) {
      merged.set(root, cluster);
      continue;
    }
    merged.set(root, {
      record: mergeTitleRecords(existing.record, cluster.record),
      extra: mergeExtra(existing.extra, cluster.extra),
    });
  }

  return [...merged.values()];
}

export function collapseTitleRecords(titles: TitleRecord[]): TitleRecord[] {
  const collapsed = collapseClusters(
    titles.map((record) => ({ record, extra: null })),
    () => null,
  ).map((cluster) => cluster.record);
  if (collapsed.length === titles.length) return titles;
  return collapsed.sort((a, b) =>
    (a.title || a.isbnDigits[0] || "").localeCompare(b.title || b.isbnDigits[0] || "", "en", { sensitivity: "base" }),
  );
}

export function collapseScoredTitles(results: ScoredTitle[]): ScoredTitle[] {
  const collapsed = collapseClusters(
    results.map((item) => ({ record: item.title, extra: { score: item.score, reason: item.reason } })),
    (left, right) => (right.score > left.score ? right : left),
  ).map((cluster) => ({
    title: cluster.record,
    score: cluster.extra.score,
    reason: cluster.extra.reason,
  }));
  if (collapsed.length === results.length) return results;
  return collapsed.sort((a, b) => b.score - a.score || (a.title.title || "").localeCompare(b.title.title || ""));
}

export function collapseCollection(data: CollectionData): CollectionData {
  const titles = collapseTitleRecords(data.titles);
  if (titles === data.titles) return data;

  const titlesByBatch: Record<string, number> = {};
  const titlesByLevel: Record<string, number> = {};
  for (const title of titles) {
    for (const batch of title.batches) titlesByBatch[batch] = (titlesByBatch[batch] || 0) + 1;
    for (const level of title.levels) titlesByLevel[level] = (titlesByLevel[level] || 0) + 1;
  }

  return {
    ...data,
    titles,
    uniqueTitleCount: titles.length,
    stats: {
      ...data.stats,
      titlesByBatch,
      titlesByLevel,
      postedTitleCount: titles.filter((title) => title.posted !== false).length,
      inCollectionPostedCount: titles.filter((title) => title.posted !== false && title.inCollection).length,
    },
  };
}
