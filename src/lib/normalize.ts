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
  return stripLeadingArticles(
    collapseWhitespace(stripPunctuation(value.toLowerCase())),
  );
}

export function normalizeLoose(value: string): string {
  return collapseWhitespace(stripPunctuation(value.toLowerCase()));
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
