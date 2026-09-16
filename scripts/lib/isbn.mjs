/**
 * ISBN cleanup shared by the importer.
 * Handles Excel scientific notation, hyphens, "(pbk.)" suffixes, and ISBN-10.
 */

export function isbnDigits(value) {
  return String(value ?? "")
    .replace(/[^0-9Xx]/g, "")
    .toUpperCase();
}

export function isbn10To13(isbn10) {
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

export function toIsbn13(value) {
  const digits = isbnDigits(value);
  if (digits.length === 13 && /^\d{13}$/.test(digits)) return digits;
  if (digits.length === 10) return isbn10To13(digits);
  return "";
}

function fromNumber(n) {
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

/**
 * Turn an Excel cell (number, scientific-notation string, or messy ISBN text)
 * into raw candidate strings. Does not yet validate length.
 */
export function parseIsbnCandidates(value) {
  if (value == null || value === "") return [];
  if (typeof value === "number") return fromNumber(value);
  const text = String(value).trim();
  if (!text) return [];
  if (/^[+-]?\d*\.?\d+e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return fromNumber(n);
  }
  return text.split(/[,;/|\n]+/).map((part) => part.trim()).filter(Boolean);
}

function displayIsbn(digits, original) {
  if (digits.length === 13 || digits.length === 10) return digits;
  const cleaned = String(original ?? "").replace(/[\s-]/g, "");
  return cleaned || digits;
}

/**
 * Normalize one candidate into 10- and/or 13-digit ISBN keys plus a display value.
 */
export function normalizeIsbnValue(value) {
  const out = [];
  const seen = new Set();
  function add(digits, original) {
    if (!digits || seen.has(digits)) return;
    if (digits === "0" || digits.length < 10) return;
    seen.add(digits);
    const isbn13 = digits.length === 13 ? digits : digits.length === 10 ? isbn10To13(digits) : "";
    out.push({
      digits,
      display: displayIsbn(digits, original),
      isbn13: isbn13 && /^\d{13}$/.test(isbn13) ? isbn13 : "",
    });
  }

  for (const candidate of parseIsbnCandidates(value)) {
    const digits = isbnDigits(candidate);
    if (digits.length === 13 && /^\d{13}$/.test(digits)) {
      add(digits, candidate);
      continue;
    }
    if (digits.length === 10) {
      add(digits, candidate);
      const isbn13 = isbn10To13(digits);
      if (isbn13) add(isbn13, isbn13);
      continue;
    }
    if (digits.length > 13) {
      const found = digits.match(/97[89]\d{10}/g) || [];
      if (found.length) {
        for (const isbn of found) add(isbn, isbn);
        continue;
      }
      add(digits.slice(0, 13), candidate);
    }
  }
  return out;
}

export function collectNormalizedIsbn13s(value) {
  const set = new Set();
  for (const item of normalizeIsbnValue(value)) {
    if (item.isbn13) set.add(item.isbn13);
  }
  return [...set];
}
