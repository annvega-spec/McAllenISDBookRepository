/**
 * Shared ISBN cleanup for spreadsheet import and desk search.
 * Handles Excel scientific notation, hyphenated values, (pbk.) suffixes,
 * and ISBN-10 ↔ ISBN-13 conversion.
 */

const SCI_NOTATION = /^\s*[0-9]+(?:\.[0-9]+)?e[+-]?[0-9]+\s*$/i;
const ISBN_TOKEN = /[0-9][0-9Xx .()\-]{8,}[0-9Xx]/g;

export function isbn10To13(isbn10) {
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

export function isbn13To10(isbn13) {
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

export function digitsFromIsbnValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value));
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (SCI_NOTATION.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  return "";
}

function finalizeDigits(digits) {
  let d = String(digits || "")
    .replace(/[^0-9Xx]/gi, "")
    .toUpperCase();
  if (d.length === 9 && /^\d+$/.test(d)) d = d.padStart(10, "0");
  if (d.length === 11 && d.startsWith("0") && /^\d{10}[\dX]$/.test(`${d.slice(1)}`)) {
    d = d.slice(1);
  }
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

export function parseIsbnCell(value) {
  const fromNumber = digitsFromIsbnValue(value);
  if (fromNumber) {
    const parsed = finalizeDigits(fromNumber);
    return parsed ? [parsed] : [];
  }

  const raw = String(value ?? "").trim();
  if (!raw) return [];

  const tokens = raw.match(ISBN_TOKEN) || [raw];
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    const parsed = finalizeDigits(token);
    if (!parsed || seen.has(parsed.isbn13)) continue;
    seen.add(parsed.isbn13);
    out.push(parsed);
  }
  return out;
}

export function isbnSearchDigits(value) {
  const parsed = parseIsbnCell(value);
  if (parsed.length) return parsed[0].isbn13;
  return String(value ?? "")
    .replace(/[^0-9Xx]/gi, "")
    .toUpperCase();
}

export function looksLikeIsbnQuery(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  if (SCI_NOTATION.test(raw)) return true;
  const digits = raw.replace(/[^0-9Xx]/gi, "");
  return digits.length >= 10 && digits.length <= 13;
}
