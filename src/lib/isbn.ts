/**
 * ISBN cleanup mirrored from scripts/lib/isbn.mjs for the browser search desk.
 */

const SCI_NOTATION = /^\s*[0-9]+(?:\.[0-9]+)?e[+-]?[0-9]+\s*$/i;
const ISBN_TOKEN = /[0-9][0-9Xx .()\-]{8,}[0-9Xx]/g;

export function isbn10To13(isbn10: string): string {
  const d = String(isbn10 || "")
    .replace(/[^0-9Xx]/gi, "")
    .toUpperCase();
  if (d.length !== 10 || !/^\d{9}[\dX]$/.test(d)) return "";
  const body = `978${d.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function isbn13To10(isbn13: string): string {
  const d = String(isbn13 || "").replace(/[^0-9]/g, "");
  if (d.length !== 13 || !d.startsWith("978")) return "";
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(core[i]) * (10 - i);
  }
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : String(check)}`;
}

function finalizeDigits(digits: string) {
  let d = String(digits || "")
    .replace(/[^0-9Xx]/gi, "")
    .toUpperCase();
  if (d.length === 9 && /^\d+$/.test(d)) d = d.padStart(10, "0");
  if (d.length === 10) {
    const isbn13 = isbn10To13(d);
    if (!isbn13) return null;
    return { isbn10: d, isbn13, display: isbn13 };
  }
  if (d.length === 13) {
    return { isbn10: isbn13To10(d), isbn13: d, display: d };
  }
  return null;
}

export function parseIsbnCell(value: unknown) {
  if (value == null || value === "") return [] as Array<{ isbn10: string; isbn13: string; display: string }>;
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = finalizeDigits(String(Math.round(value)));
    return parsed ? [parsed] : [];
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (SCI_NOTATION.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const parsed = finalizeDigits(String(Math.round(n)));
      return parsed ? [parsed] : [];
    }
  }
  const tokens = raw.match(ISBN_TOKEN) || [raw];
  const seen = new Set<string>();
  const out: Array<{ isbn10: string; isbn13: string; display: string }> = [];
  for (const token of tokens) {
    const parsed = finalizeDigits(token);
    if (!parsed || seen.has(parsed.isbn13)) continue;
    seen.add(parsed.isbn13);
    out.push(parsed);
  }
  return out;
}

export function isbnQueryDigits(value: string): string {
  const parsed = parseIsbnCell(value);
  if (parsed[0]?.isbn13) return parsed[0].isbn13;
  return value.replace(/[^0-9Xx]/gi, "").toUpperCase();
}

export function looksLikeIsbnQuery(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  if (SCI_NOTATION.test(raw)) return true;
  const digits = raw.replace(/[^0-9Xx]/gi, "");
  return digits.length >= 10 && digits.length <= 13;
}
