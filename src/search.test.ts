import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifySearch, searchTitles } from "./lib/search";
import { normalizeTitle } from "./lib/normalize";
import type { CollectionData } from "./types";

const data = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "collection.json"), "utf8"),
) as CollectionData;

describe("collection import", () => {
  it("indexes the full master list", () => {
    expect(data.rowCount).toBe(7590);
    expect(data.uniqueTitleCount).toBeGreaterThan(5000);
    expect(data.titles).toHaveLength(data.uniqueTitleCount);
    expect(data.batches).toEqual(["Sep 2025", "Oct 2025", "Nov 2025", "Jan 2026", "2026-2027"]);
  });
});

describe("title search", () => {
  it("finds 101 Dalmatians with author, ISBN, and posted batches", () => {
    const results = searchTitles(data, "101 Dalmatians");
    const classified = classifySearch(results);
    expect(classified.match).not.toBeNull();
    const title = classified.match!.title;
    expect(title.title).toBe("101 Dalmatians");
    expect(title.authors.some((author) => /bobowicz/i.test(author))).toBe(true);
    expect(title.isbns).toContain("9780736481571");
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "Oct 2025"]));
  });

  it("matches ISBN lookups", () => {
    const results = searchTitles(data, "9780736481571");
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("is tolerant of articles, case, and punctuation", () => {
    expect(normalizeTitle("The 101 Dalmatians!")).toBe("101 dalmatians");
    const results = searchTitles(data, "the 101 dalmatians!");
    expect(classifySearch(results).match?.title.title).toBe("101 Dalmatians");
  });

  it("offers a close match for a near-miss spelling", () => {
    const results = searchTitles(data, "101 Dalmations");
    expect(results[0]?.title.title).toBe("101 Dalmatians");
  });

  it("says not found for a nonsense title", () => {
    const results = searchTitles(data, "zxqwv purple giraffe cookbook");
    expect(classifySearch(results).match).toBeNull();
    expect(results.every((item) => item.score < 0.92)).toBe(true);
  });

  it("does not list unrelated titles under an exact match", () => {
    const classified = classifySearch(searchTitles(data, "101 Dalmatians"));
    expect(classified.close.some((item) => item.title.title === "10 perros")).toBe(false);
    expect(classified.close.every((item) => item.score >= 0.58)).toBe(true);
  });
});
