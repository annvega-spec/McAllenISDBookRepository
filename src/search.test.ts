import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildHoldingsIndex, type CompactHoldings } from "./lib/holdings";
import { classifySearch, searchTitles } from "./lib/search";
import { normalizeTitle } from "./lib/normalize";
import type { CollectionData } from "./types";

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(root, "..", "public", "data", "collection.json"), "utf8")) as CollectionData;
const holdingsPath = join(root, "..", "public", "data", "holdings.json");
const holdingsIndex = existsSync(holdingsPath)
  ? buildHoldingsIndex(JSON.parse(readFileSync(holdingsPath, "utf8")) as CompactHoldings)
  : null;

describe("collection import", () => {
  it("indexes the full master list plus additional sources", () => {
    expect(data.rowCount).toBeGreaterThan(6000);
    expect(data.uniqueTitleCount).toBeGreaterThan(5000);
    expect(data.titles).toHaveLength(data.uniqueTitleCount);
    expect(data.batches).toEqual(
      expect.arrayContaining(["Sep 2025", "Oct 2025", "Nov 2025", "Jan 2026", "2026-2027", "All Campuses", "eBook order"]),
    );
  });
});

describe("title search", () => {
  it("finds 101 Dalmatians with author, ISBN, and posted batches", () => {
    const results = searchTitles(data, "101 Dalmatians", { holdingsIndex });
    const classified = classifySearch(results);
    expect(classified.match).not.toBeNull();
    const title = classified.match!.title;
    expect(title.title).toBe("101 Dalmatians");
    expect(title.authors.some((author) => /bobowicz/i.test(author))).toBe(true);
    expect(title.isbns).toContain("9780736481571");
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "Oct 2025"]));
    expect(title.posted).not.toBe(false);
  });

  it("matches ISBN lookups", () => {
    const results = searchTitles(data, "9780736481571", { holdingsIndex });
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("is tolerant of articles, case, and punctuation", () => {
    expect(normalizeTitle("The 101 Dalmatians!")).toBe("101 dalmatians");
    const results = searchTitles(data, "the 101 dalmatians!", { holdingsIndex });
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("offers a close match for a near-miss spelling", () => {
    const results = searchTitles(data, "101 Dalmations", { holdingsIndex });
    expect(results[0]?.title.title).toBe("101 Dalmatians");
  });

  it("says not found for a nonsense title", () => {
    const results = searchTitles(data, "zxqwv purple giraffe cookbook", { holdingsIndex });
    expect(classifySearch(results).match).toBeNull();
    expect(results.every((item) => item.score < 0.92)).toBe(true);
  });

  it("does not list unrelated titles under an exact match", () => {
    const classified = classifySearch(searchTitles(data, "101 Dalmatians", { holdingsIndex }));
    expect(classified.close.some((item) => item.title.title === "10 perros")).toBe(false);
    expect(classified.close.every((item) => item.score >= 0.58)).toBe(true);
  });
});

describe("additional spreadsheets", () => {
  it("finds an All Campuses title with a real 13-digit ISBN, not scientific notation", () => {
    const results = searchTitles(data, "A Dusty donkey detour", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("A Dusty donkey detour");
    expect(title?.isbns.some((isbn) => /e/i.test(isbn))).toBe(false);
    expect(title?.isbnDigits).toContain("9781516080236");
    expect(title?.postedBatches ?? title?.batches).toEqual(expect.arrayContaining(["All Campuses"]));
  });

  it("finds an eBook order title from lists A/B/C", () => {
    const results = searchTitles(data, "ALMOST SUNSET", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.title.toLowerCase()).toContain("almost sunset");
    expect(title?.formats.ebook).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["eBook order"]));
    expect(title?.editions?.length).toBeGreaterThan(0);
  });

  it("returns In collection for a Follett holdings ISBN even without a title", () => {
    expect(holdingsIndex).not.toBeNull();
    const results = searchTitles(data, "0002251183", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.inCollection).toBe(true);
    expect(title?.isbnDigits.some((isbn) => isbn === "9780002251181" || isbn === "0002251183")).toBe(true);
    if (!title?.title) {
      expect(title?.titleUnknown).toBe(true);
    }
  });
});
