import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifySearch, searchTitles } from "./lib/search";
import { normalizeTitle } from "./lib/normalize";
import { prepareOwned } from "./lib/owned";
import type { CollectionData, OwnedCatalog } from "./types";

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(root, "..", "public", "data", "collection.json"), "utf8")) as CollectionData;
const ownedPath = join(root, "..", "public", "data", "owned.json");
const owned = existsSync(ownedPath)
  ? prepareOwned(JSON.parse(readFileSync(ownedPath, "utf8")) as OwnedCatalog)
  : null;

describe("collection import", () => {
  it("indexes the full master list and keeps original posted periods", () => {
    expect(data.rowCount).toBeGreaterThan(6000);
    expect(data.uniqueTitleCount).toBeGreaterThan(5000);
    expect(data.titles).toHaveLength(data.uniqueTitleCount);
    expect(data.batches).toEqual(
      expect.arrayContaining(["Sep 2025", "Oct 2025", "Nov 2025", "Jan 2026", "2026-2027"]),
    );
  });

  it("merges All Campuses and eBook order lists without dropping the master list", () => {
    expect(data.batches).toEqual(expect.arrayContaining(["All Campuses", "eBook list A", "eBook list B", "eBook list C"]));
    expect(data.sourceFiles?.some((file) => file.includes("master-list.xlsx"))).toBe(true);
    expect(data.sourceFiles?.some((file) => file.includes("All-Campuses.xlsx"))).toBe(true);
    expect(data.stats.ebookOrderTitleCount).toBeGreaterThan(100);
  });

  it("ships a compact Follett owned ISBN index instead of a 300k-row title list", () => {
    expect(data.owned?.count ?? 0).toBeGreaterThan(100000);
    expect(data.uniqueTitleCount).toBeLessThan(20000);
    expect(owned?.count ?? 0).toBeGreaterThan(100000);
  });
});

describe("title search", () => {
  it("finds 101 Dalmatians with author, ISBN, and posted batches", () => {
    const results = searchTitles(data, "101 Dalmatians", { owned });
    const classified = classifySearch(results);
    expect(classified.match).not.toBeNull();
    const title = classified.match!.title;
    expect(title.title).toBe("101 Dalmatians");
    expect(title.authors.some((author) => /bobowicz/i.test(author))).toBe(true);
    expect(title.isbns).toContain("9780736481571");
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "Oct 2025"]));
  });

  it("matches ISBN lookups", () => {
    const results = searchTitles(data, "9780736481571", { owned });
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("is tolerant of articles, case, and punctuation", () => {
    expect(normalizeTitle("The 101 Dalmatians!")).toBe("101 dalmatians");
    const results = searchTitles(data, "the 101 dalmatians!", { owned });
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("offers a close match for a near-miss spelling", () => {
    const results = searchTitles(data, "101 Dalmations", { owned });
    expect(results[0]?.title.title).toBe("101 Dalmatians");
  });

  it("says not found for a nonsense title", () => {
    const results = searchTitles(data, "zxqwv purple giraffe cookbook", { owned });
    expect(classifySearch(results).match).toBeNull();
    expect(results.every((item) => item.score < 0.92)).toBe(true);
  });

  it("does not list unrelated titles under an exact match", () => {
    const classified = classifySearch(searchTitles(data, "101 Dalmatians", { owned }));
    expect(classified.close.some((item) => item.title.title === "10 perros")).toBe(false);
    expect(classified.close.every((item) => item.score >= 0.58)).toBe(true);
  });

  it("finds an All Campuses title by name", () => {
    const results = searchTitles(data, "A Dusty donkey detour", { owned });
    const match = classifySearch(results).match;
    expect(match?.title.title).toBe("A Dusty donkey detour");
    expect(match?.title.posted).toBe(true);
    expect(match?.title.batches).toContain("All Campuses");
    expect(match?.title.isbns).toContain("9781516080236");
  });

  it("finds an eBook order title by name", () => {
    const results = searchTitles(data, "ALMOST SUNSET", { owned });
    const match = classifySearch(results).match;
    expect(match?.title.title.toLowerCase()).toBe("almost sunset");
    expect(match?.title.ebookOrder).toBe(true);
    expect(match?.title.formatNotes?.some((note) => /ebook/i.test(note))).toBe(true);
  });

  it("returns HAVE IT for a Follett ISBN even when the holding has no title", () => {
    const results = searchTitles(data, "9780002251181", { owned });
    const match = classifySearch(results).match;
    expect(match).not.toBeNull();
    expect(match?.title.owned).toBe(true);
    expect(match?.title.isbnDigits).toContain("9780002251181");
  });
});
