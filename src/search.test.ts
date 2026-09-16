import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collapseCollection } from "./lib/group";
import { buildHoldingsIndex, type CompactHoldings } from "./lib/holdings";
import { classifySearch, searchTitles } from "./lib/search";
import { normalizeLoose, normalizeTitle } from "./lib/normalize";
import type { CollectionData } from "./types";

const root = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(root, "..", "public", "data", "collection.json"), "utf8")) as CollectionData;
const data = collapseCollection(raw);
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

  it("counts unique titles rather than spreadsheet rows", () => {
    const keys = data.titles.map((title) => normalizeTitle(title.title)).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    expect(data.uniqueTitleCount).toBeLessThan(data.rowCount);
    expect(data.titles.filter((title) => normalizeTitle(title.title) === "101 dalmatians")).toHaveLength(1);
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
    expect(results.filter((item) => normalizeTitle(item.title.title) === "101 dalmatians")).toHaveLength(1);
    expect(classified.close.some((item) => normalizeTitle(item.title.title) === "101 dalmatians")).toBe(false);
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

function isEllenHopkins(authors: string[]): boolean {
  const tokens = new Set(normalizeLoose(authors.join(" ")).split(" ").filter(Boolean));
  return tokens.has("ellen") && tokens.has("hopkins") && !tokens.has("hopkinson");
}

describe("Ellen Hopkins posted exclusions", () => {
  it("does not list Crank or Glass by Ellen Hopkins as posted for community review", () => {
    const postedHopkins = data.titles.filter(
      (title) =>
        (normalizeTitle(title.title) === "crank" || normalizeTitle(title.title) === "glass") &&
        isEllenHopkins(title.authors) &&
        title.posted !== false,
    );
    expect(postedHopkins).toHaveLength(0);

    for (const query of ["Crank Ellen Hopkins", "Glass Ellen Hopkins", "Crank Hopkins", "Glass Hopkins"]) {
      const results = searchTitles(data, query, { holdingsIndex });
      for (const item of results) {
        const key = normalizeTitle(item.title.title);
        if ((key === "crank" || key === "glass") && isEllenHopkins(item.title.authors)) {
          expect(item.title.posted, query).toBe(false);
        }
      }
      const match = classifySearch(results).match?.title;
      if (match && (normalizeTitle(match.title) === "crank" || normalizeTitle(match.title) === "glass") && isEllenHopkins(match.authors)) {
        expect(match.posted).toBe(false);
      }
    }
  });

  it("leaves other titles, including other Ellen Hopkins and other Glass/Crank books, in place", () => {
    expect(data.titles.some((title) => normalizeTitle(title.title) === "crankenstein" && title.posted !== false)).toBe(true);
    expect(data.titles.some((title) => normalizeTitle(title.title) === "glass slippers" && title.posted !== false)).toBe(true);
    const slippers = classifySearch(searchTitles(data, "Glass slippers", { holdingsIndex })).match?.title;
    expect(slippers?.title).toBe("Glass slippers");
    expect(slippers?.posted).not.toBe(false);
  });
});

describe("Follett Sound/Recording audiobooks", () => {
  it("attaches an audiobook ISBN onto the existing titled Last Kids on Earth card", () => {
    const results = searchTitles(data, "The Last Kids on Earth", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "last kids on earth")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("The Last Kids on Earth");
    expect(title?.formats.audio).toBe(true);
    expect(title?.formats.ebook).toBe(true);
    expect(title?.isbnDigits).toContain("9780525495581");
    expect(title?.isbnDigits).toContain("9780425287569");
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).not.toBe(false);

    const byIsbn = classifySearch(searchTitles(data, "9780525495581", { holdingsIndex })).match?.title;
    expect(byIsbn?.title).toBe("The Last Kids on Earth");
    expect(byIsbn?.formats.audio).toBe(true);
    expect(byIsbn?.isbnDigits).toEqual(expect.arrayContaining(["9780425287569", "9780525495581"]));
  });

  it("does not dump series audiobooks onto a different Last Kids volume", () => {
    const results = searchTitles(data, "Last Kids on Earth and the Cosmic Beyond", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("Last Kids on Earth and the Cosmic Beyond");
    expect(title?.isbnDigits).not.toContain("9780525495581");
  });

  it("returns In collection for an audio-only Destiny ISBN with no book/ebook counterpart", () => {
    expect(holdingsIndex).not.toBeNull();
    const results = searchTitles(data, "9780807210260", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(false);
    expect(title?.formats.audio).toBe(true);
    expect(title?.formats.book).toBe(false);
    expect(title?.isbnDigits).toContain("9780807210260");
  });
});
