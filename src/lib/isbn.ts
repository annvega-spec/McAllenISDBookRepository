/**
 * Browser-side ISBN cleanup. Keep in sync with scripts/lib/isbn.mjs.
 */

export function isbnDigits(value: string): string {
  return String(value ?? "")
    .replace(/[^0-9Xx]/g, "")
    .toUpperCase();
}

export function isbn10To13(isbn10: string): string {
  const core = isbnDigits(isbn10).slice(0, 9);
  if (!/^\d{9}$/.test(core)) return "";
  const body = `978${core}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

export function toIsbn13(value: string): string {
  const digits = isbnDigits(value);
  if (digits.length === 13 && /^\d{13}$/.test(digits)) return digits;
  if (digits.length === 10) return isbn10To13(digits);
  return "";
}

function fromNumber(n: number): string[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  if (n >= 1e9 && n < 1e14) return [String(Math.round(n))];
  const sig = n
    .toExponential(14)
    .replace(/^-/, "")
    .replace(".", "")
    .replace(/e[+-]?\d+$/i, "");
  const match = sig.match(/97[89]\d{10}/);
  return match ? [match[0]] : [];
}

export function parseIsbnCandidates(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (typeof value === "number") return fromNumber(value);
  const text = String(value).trim();
  if (!text) return [];
  if (/^[+-]?\d*\.?\d+e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return fromNumber(n);
  }
  return text
    .split(/[,;/|\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function looksLikeIsbnQuery(value: string): boolean {
  const trimmed = value.trim();
  if (/^[+-]?\d*\.?\d+e[+-]?\d+$/i.test(trimmed)) {
    return toIsbn13(parseIsbnCandidates(trimmed)[0] || "") !== "";
  }
  const digits = isbnDigits(trimmed);
  return digits.length >= 10 && digits.length <= 13;
}

export function queryIsbn13(value: string): string {
  const candidates = parseIsbnCandidates(value);
  for (const candidate of candidates.length ? candidates : [value]) {
    const isbn13 = toIsbn13(candidate);
    if (isbn13) return isbn13;
  }
  return toIsbn13(value);
}
