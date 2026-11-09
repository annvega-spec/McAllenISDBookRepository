const ARTICLES = new Set(["a", "an", "the"]);

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function stripPunctuation(value: string): string {
  return value.replace(/[&+]/g, " and ").replace(/[^a-z0-9\s]/gi, " ");
}

export function stripLeadingArticles(value: string): string {
  const parts = value.split(" ").filter(Boolean);
  while (parts.length > 1 && ARTICLES.has(parts[0])) {
    parts.shift();
  }
  return parts.join(" ");
}

export function normalizeTitle(value: string): string {
  const withoutEdition = value
    .toLowerCase()
    .replace(/\s*[\(\[]\s*(un)?abridged\s*[\)\]]/gi, " ")
    .replace(/\s+(un)?abridged\s*$/i, "");
  return stripLeadingArticles(
    collapseWhitespace(stripPunctuation(withoutEdition)),
  );
}

export function normalizeLoose(value: string): string {
  return collapseWhitespace(stripPunctuation(value.toLowerCase()));
}

export function authorTokens(author: string): string[] {
  return normalizeLoose(author).split(" ").filter(Boolean);
}

/** Either author token set is a subset of the other (handles extra illustrators). */
export function authorsCompatible(left: string, right: string): boolean {
  const a = new Set(authorTokens(left));
  const b = new Set(authorTokens(right));
  if (!a.size || !b.size) return false;
  const aInB = [...a].every((token) => b.has(token));
  const bInA = [...b].every((token) => a.has(token));
  return aInB || bInA;
}

export function isbnDigits(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function looksLikeIsbn(value: string): boolean {
  const digits = isbnDigits(value);
  return digits.length >= 10 && digits.length <= 13;
}

export function bigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 1; i += 1) {
    grams.add(padded.slice(i, i + 2));
  }
  return grams;
}

export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let overlap = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aGrams.size + bGrams.size);
}

const TITLE_RELATION_STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "vol",
  "volume",
  "book",
  "part",
  "novel",
  "graphic",
  "edition",
  "standard",
]);

function foldedTitleKey(title: string): string {
  return normalizeTitle(title.normalize("NFD").replace(/\p{M}/gu, ""));
}

function relationTokens(titleKey: string): string[] {
  return titleKey.split(" ").filter((token) => token.length > 2 && !TITLE_RELATION_STOP.has(token));
}

/**
 * Same work for ISBN union. Kept in step with scripts/lib/build-collection.mjs
 * `titlesLookRelated`: spacing, accents, a shorter title inside a longer one,
 * or a one-character typo. Unrelated titles are not the same work.
 */
export function titlesLookRelated(left: string, right: string): boolean {
  const a = foldedTitleKey(left);
  const b = foldedTitleKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const compactA = a.replace(/ /g, "");
  const compactB = b.replace(/ /g, "");
  if (compactA === compactB) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const [shortCompact, longCompact] = compactA.length <= compactB.length ? [compactA, compactB] : [compactB, compactA];
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  if (shortCompact.length >= 8 && longCompact.includes(shortCompact)) return true;
  if (shortCompact.length >= 6 && longCompact.startsWith(shortCompact)) return true;
  const shortTokens = relationTokens(shorter);
  const longTokenList = relationTokens(longer);
  const longTokens = new Set(longTokenList);
  if (shortTokens.length >= 2 && shortTokens.every((token) => longTokens.has(token))) return true;
  if (shortTokens.length >= 3 && longTokenList.length >= 3) {
    let shared = 0;
    const used = new Set<number>();
    for (const token of shortTokens) {
      const match = longTokenList.findIndex(
        (other, index) => !used.has(index) && (other === token || (token.length >= 5 && other.length >= 5 && levenshtein(token, other) <= 1)),
      );
      if (match >= 0) {
        used.add(match);
        shared += 1;
      }
    }
    if (shared >= 3 && shared / shortTokens.length >= 0.75) return true;
  }
  return false;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 8) return 99;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}
