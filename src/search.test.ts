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
      expect.arrayContaining(["Sep 2025", "Oct 2025", "Nov 2025", "Jan 2026", "2026-2027", "All Campuses", "eBook order", "McAllen 100", "Sora 2026-09-16"]),
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
    expect(normalizeTitle("13 Little Blue Envelopes (unabridged)")).toBe("13 little blue envelopes");
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

  it("finds a previously ISBN-only Follett holding by Title/Subtitle and keeps one card", () => {
    const results = searchTitles(data, "Christmas around the world", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "christmas around the world")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("Christmas around the world");
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(false);
    expect(title?.isbnDigits).toContain("9780002251181");
    expect(title?.isbnDigits.length).toBeGreaterThan(1);

    const byIsbn = classifySearch(searchTitles(data, "9780002251181", { holdingsIndex })).match?.title;
    expect(byIsbn?.title).toBe("Christmas around the world");
    expect(byIsbn?.isbnDigits).toContain("9780002251181");
  });

  it("does not create duplicate cards for the same normalized Follett title", () => {
    const keys = data.titles.map((title) => normalizeTitle(title.title)).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    const results = searchTitles(data, "Henry and Beezus", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "henry and beezus")).toHaveLength(1);
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

function isMargaretAtwood(authors: string[]): boolean {
  const tokens = new Set(normalizeLoose(authors.join(" ")).split(" ").filter(Boolean));
  return tokens.has("margaret") && tokens.has("atwood");
}

describe("Margaret Atwood desk exclusions", () => {
  function isHandmaidCard(title: string): boolean {
    const key = normalizeTitle(title);
    return key === "handmaid s tale" || key.startsWith("handmaid s tale ");
  }

  it("does not return The Handmaid's Tale anywhere on the desk", () => {
    expect(data.titles.filter((title) => isHandmaidCard(title.title))).toHaveLength(0);
    expect(
      data.titles.filter(
        (title) =>
          normalizeTitle(title.title) === "handmaid s tale" && isMargaretAtwood(title.authors),
      ),
    ).toHaveLength(0);

    for (const query of ["Handmaid", "Handmaid's Tale", "The Handmaid's Tale"]) {
      const results = searchTitles(data, query, { holdingsIndex });
      expect(results.filter((item) => isHandmaidCard(item.title.title)), query).toHaveLength(0);
      const classified = classifySearch(results);
      if (classified.match) {
        expect(isHandmaidCard(classified.match.title.title), query).toBe(false);
      }
    }

    for (const isbn of ["9780385490818", "9780547345666", "9781510537033", "9781587656217"]) {
      const match = classifySearch(searchTitles(data, isbn, { holdingsIndex })).match?.title;
      expect(match, isbn).toBeUndefined();
    }
  });

  it("leaves other Margaret Atwood titles searchable", () => {
    const testaments = data.titles.find(
      (title) => /testament/i.test(title.title) && isMargaretAtwood(title.authors),
    );
    expect(testaments).toBeTruthy();
    const match = classifySearch(searchTitles(data, "The Testaments", { holdingsIndex })).match?.title;
    expect(match && /testament/i.test(match.title)).toBe(true);
    expect(isMargaretAtwood(match?.authors || [])).toBe(true);
  });
});

function isJudyBlume(authors: string[]): boolean {
  const tokens = new Set(normalizeLoose(authors.join(" ")).split(" ").filter(Boolean));
  return tokens.has("judy") && tokens.has("blume");
}

function isEishesChayil(authors: string[]): boolean {
  const tokens = new Set(normalizeLoose(authors.join(" ")).split(" ").filter(Boolean));
  return tokens.has("eishes") && tokens.has("chayil");
}

describe("district challenge-list desk exclusions", () => {
  it("does not return Lessons in Chemistry, The Lovely Bones, or Water for Elephants as HAVE IT", () => {
    for (const query of [
      "Lessons in Chemistry",
      "The Lovely Bones",
      "Water for Elephants",
      "Water for Elephants: A Novel",
    ]) {
      const classified = classifySearch(searchTitles(data, query, { holdingsIndex }));
      if (classified.match) {
        const key = normalizeTitle(classified.match.title.title);
        expect(key === "lessons in chemistry" || key.startsWith("lessons in chemistry "), query).toBe(false);
        expect(key === "lovely bones" || key.startsWith("lovely bones "), query).toBe(false);
        expect(key === "water for elephants" || key.startsWith("water for elephants "), query).toBe(false);
      }
    }

    expect(data.titles.some((title) => normalizeTitle(title.title).startsWith("lessons in chemistry"))).toBe(false);
    expect(data.titles.some((title) => normalizeTitle(title.title).startsWith("lovely bones"))).toBe(false);
    expect(data.titles.some((title) => normalizeTitle(title.title).startsWith("water for elephants"))).toBe(false);

    for (const isbn of ["9780385547345", "9780316145725", "9781598872729", "9781565125858"]) {
      const match = classifySearch(searchTitles(data, isbn, { holdingsIndex })).match?.title;
      expect(match, isbn).toBeUndefined();
    }
  });

  it("peels Judy Blume Forever off the desk without hiding Maggie Stiefvater Forever", () => {
    expect(
      data.titles.some(
        (title) => normalizeTitle(title.title) === "forever" && isJudyBlume(title.authors),
      ),
    ).toBe(false);
    expect(data.titles.some((title) => title.isbnDigits.includes("9781481414432"))).toBe(false);
    expect(classifySearch(searchTitles(data, "9781481414432", { holdingsIndex })).match?.title).toBeUndefined();

    const forever = classifySearch(searchTitles(data, "Forever", { holdingsIndex })).match?.title;
    expect(forever && normalizeTitle(forever.title) === "forever").toBe(true);
    expect(forever?.authors.some((author) => /stiefvater/i.test(author))).toBe(true);
    expect(isJudyBlume(forever?.authors || [])).toBe(false);
    expect(forever?.isbnDigits).not.toContain("9781481414432");
  });

  it("peels Eishes Chayil Hush off the desk and leaves a non-Chayil Hush card", () => {
    expect(
      data.titles.some((title) => normalizeTitle(title.title) === "hush" && isEishesChayil(title.authors)),
    ).toBe(false);
    expect(data.titles.some((title) => title.isbnDigits.includes("9780802722706"))).toBe(false);
    expect(classifySearch(searchTitles(data, "9780802722706", { holdingsIndex })).match?.title).toBeUndefined();

    const hush = classifySearch(searchTitles(data, "9780142500491", { holdingsIndex })).match?.title;
    expect(hush && normalizeTitle(hush.title) === "hush").toBe(true);
    expect(isEishesChayil(hush?.authors || [])).toBe(false);
    expect(hush?.authors.some((author) => /woodson|melki/i.test(author))).toBe(true);
    expect(hush?.isbnDigits).not.toContain("9780802722706");
  });

  it("leaves lookalike titles searchable", () => {
    expect(data.titles.some((title) => normalizeTitle(title.title) === "crankenstein")).toBe(true);
    expect(classifySearch(searchTitles(data, "Crankenstein", { holdingsIndex })).match?.title.title).toBe("Crankenstein");
    expect(data.titles.some((title) => /pet shop racers/i.test(title.title))).toBe(true);
    const racers = classifySearch(searchTitles(data, "Pet Shop Racers Need Fur Speed", { holdingsIndex })).match?.title;
    expect(racers && /pet shop racers/i.test(racers.title)).toBe(true);
    expect(data.titles.some((title) => normalizeTitle(title.title) === "cinderella")).toBe(true);
    expect(data.titles.every((title) => normalizeTitle(title.title) !== "cinderella is dead")).toBe(true);
  });

  it("hides challenge-list holdings that were leftover compact cards, including series volumes", () => {
    expect(classifySearch(searchTitles(data, "Running with scissors", { holdingsIndex })).match?.title).toBeUndefined();
    expect(classifySearch(searchTitles(data, "9780062851192", { holdingsIndex })).match?.title).toBeUndefined();
    expect(classifySearch(searchTitles(data, "9781427806079", { holdingsIndex })).match?.title).toBeUndefined();
    expect(classifySearch(searchTitles(data, "Inu Yasha. Vol. 27", { holdingsIndex })).match?.title).toBeUndefined();
    expect(classifySearch(searchTitles(data, "9781421504674", { holdingsIndex })).match?.title).toBeUndefined();

    const otherCity = classifySearch(searchTitles(data, "9780385353779", { holdingsIndex })).match?.title;
    expect(otherCity && /city on fire/i.test(otherCity.title)).toBe(true);
    expect(otherCity?.authors.join(" ")).toMatch(/hallberg|minutaglio/i);
  });

  it("does not return Let's Talk About It by Erika Moen as HAVE IT", () => {
    expect(data.titles.some((title) => title.isbnDigits.includes("9781984893147"))).toBe(false);
    expect(classifySearch(searchTitles(data, "9781984893147", { holdingsIndex })).match?.title).toBeUndefined();

    const classified = classifySearch(searchTitles(data, "Let's Talk About It", { holdingsIndex }));
    if (classified.match) {
      const key = normalizeTitle(classified.match.title.title);
      const authors = classified.match.title.authors.join(" ");
      const isMoenGraphic =
        (key === "let s talk about it" || key.startsWith("let s talk about it ") || key.startsWith("lets talk about it")) &&
        /moen|nolan/i.test(authors);
      expect(isMoenGraphic).toBe(false);
    }

    const online = classifySearch(searchTitles(data, "Online safety", { holdingsIndex })).match?.title;
    expect(online && /online safety/i.test(online.title)).toBe(true);
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

  it("returns In collection for a Destiny audio ISBN, now titled and unioned onto that title card", () => {
    expect(holdingsIndex).not.toBeNull();
    const results = searchTitles(data, "9780807210260", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(false);
    expect(title?.formats.audio).toBe(true);
    expect(title?.title).toBe("Henry and Beezus");
    expect(title?.isbnDigits).toContain("9780807210260");
    expect(title?.isbnDigits.length).toBeGreaterThan(1);
  });
});

describe("Sora Ebook/Audiobook import", () => {
  it("attaches a Sora ISBN onto an existing titled Last Kids volume instead of a second card", () => {
    const results = searchTitles(data, "Last Kids on Earth and the Cosmic Beyond", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "last kids on earth and the cosmic beyond")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("Last Kids on Earth and the Cosmic Beyond");
    expect(title?.posted).not.toBe(false);
    expect(title?.inCollection).toBe(true);
    expect(title?.formats.ebook).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["All Campuses", "Sora 2026-09-16"]));
    expect(title?.isbnDigits).toContain("9780425292082");
    expect(title?.isbnDigits).toContain("9780425292099");

    const byIsbn = classifySearch(searchTitles(data, "9780425292099", { holdingsIndex })).match?.title;
    expect(byIsbn?.title).toBe("Last Kids on Earth and the Cosmic Beyond");
    expect(byIsbn?.isbnDigits).toEqual(expect.arrayContaining(["9780425292082", "9780425292099"]));
  });

  it("returns HAVE IT / In collection for a Sora-only title that has no posted book card", () => {
    const results = searchTitles(data, "9780547249643", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("1984");
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(false);
    expect(title?.formats.ebook).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["Sora 2026-09-16"]));
  });

  it("does not return HAVE IT from Sora Staff Only for Dungeon Crawler Carl", () => {
    expect(data.titles.some((title) => title.isbnDigits.includes("9798232923594"))).toBe(false);
    expect(
      data.titles.some(
        (title) =>
          normalizeTitle(title.title) === "dungeon crawler carl" && title.batches.some((batch) => /^sora/i.test(batch)),
      ),
    ).toBe(false);

    const isbnMatch = classifySearch(searchTitles(data, "9798232923594", { holdingsIndex })).match?.title;
    expect(isbnMatch).toBeUndefined();

    const classified = classifySearch(searchTitles(data, "Dungeon Crawler Carl", { holdingsIndex }));
    const match = classified.match?.title;
    if (match && normalizeTitle(match.title) === "dungeon crawler carl") {
      expect(match.isbnDigits).not.toContain("9798232923594");
      expect(match.batches.some((batch) => /^sora/i.test(batch))).toBe(false);
    } else {
      expect(classified.match).toBeNull();
    }
  });

  it("still imports a normal Elementary Sora title", () => {
    const results = searchTitles(data, "9781449466060", { holdingsIndex });
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("¡Hola!");
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(false);
    expect(title?.batches).toEqual(expect.arrayContaining(["Sora 2026-09-16"]));
    expect(title?.levels).toEqual(expect.arrayContaining(["Elementary"]));
    expect(title?.isbnDigits).toContain("9781449466060");
  });
});

describe("later campus, McAllen 100, and eBook order lists", () => {
  it("adds Everything MLB once, with the hyphenated 979 ISBN, as posted All Campuses", () => {
    const results = searchTitles(data, "Everything MLB", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "everything mlb")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("Everything MLB");
    expect(title?.posted).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["All Campuses"]));
    expect(title?.levels).toEqual(expect.arrayContaining(["Middle"]));
    expect(title?.isbnDigits).toContain("9798893045581");
    expect(title?.isbnDigits.some((isbn) => /e/i.test(isbn) || isbn.includes("-"))).toBe(false);

    const byIsbn = classifySearch(searchTitles(data, "979-88-930455-8-1", { holdingsIndex })).match?.title;
    expect(byIsbn?.title).toBe("Everything MLB");
  });

  it("unions a new ISBN onto an existing title instead of a second card", () => {
    const results = searchTitles(data, "Leatherback Sea Turtles", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "leatherback sea turtles")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.isbnDigits).toContain("9798368796857");
    expect(title?.posted).not.toBe(false);
  });

  it("keeps one Olympic Soccer card for both new ISBNs", () => {
    const results = searchTitles(data, "Olympic Soccer", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "olympic soccer")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.isbnDigits).toEqual(expect.arrayContaining(["9781098295509", "9781098295516"]));
  });

  it("adds a McAllen 100 Spanish title by title and ISBN and posts it for review", () => {
    const results = searchTitles(data, "Coco se cepilla los dientes", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "coco se cepilla los dientes")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.posted).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["McAllen 100"]));
    expect(title?.authors.some((author) => /cinetto/i.test(author))).toBe(true);
    expect(title?.isbnDigits).toContain("9789878371436");
    expect(title?.levels).not.toContain("LG");

    const byIsbn = classifySearch(searchTitles(data, "9789878371436", { holdingsIndex })).match?.title;
    expect(normalizeTitle(byIsbn?.title || "")).toBe("coco se cepilla los dientes");
  });

  it("unions the McAllen 100 Macbeth ISBN onto the existing holdings card and marks that card posted", () => {
    const results = searchTitles(data, "Macbeth", { holdingsIndex });
    expect(results.filter((item) => normalizeTitle(item.title.title) === "macbeth")).toHaveLength(1);
    const title = classifySearch(results).match?.title;
    expect(title?.title).toBe("Macbeth");
    expect(title?.inCollection).toBe(true);
    expect(title?.posted).toBe(true);
    expect(title?.batches).toEqual(expect.arrayContaining(["McAllen 100", "Follett 9.16.26"]));
    expect(title?.isbnDigits).toContain("9788467945928");
  });

  it("does not create cards from blank campus rows, totals, or the McAllen notes sheet", () => {
    expect(data.titles.some((title) => /^(total|totals|notes|selection evidence)$/i.test(title.title.trim()))).toBe(false);
    expect(data.titles.some((title) => title.title === "Should Not Import")).toBe(false);
    expect(data.titles.some((title) => normalizeTitle(title.title) === "elementary")).toBe(false);
  });
});

describe("Dog Man A Sprinkle in Time ISBNs", () => {
  const publisherIsbn13 = "9781546199359";
  const publisherIsbn10 = "1546199357";
  const permaIsbn13 = "9780847921188";
  const permaIsbn10 = "0847921182";

  function sprinkleCards() {
    return data.titles.filter((title) => /sprinkle in time/i.test(title.title) && /dog\s*man|dogman/i.test(title.title));
  }

  it("keeps one Dog Man / Dogman card and lists both normalized ISBNs", () => {
    const cards = sprinkleCards();
    expect(cards).toHaveLength(1);
    const title = cards[0];
    expect(title.title).toBe("Dog Man : a sprinkle in time");
    expect(title.authors).toEqual(["Pilkey, Dav"]);
    expect(title.posted).toBe(true);
    expect(title.batches).toEqual(["All Campuses"]);
    expect(title.isbnDigits).toEqual(
      expect.arrayContaining(["9798318956560", publisherIsbn13, publisherIsbn10, permaIsbn13, permaIsbn10]),
    );
    expect(title.isbnDigits.filter((isbn) => [publisherIsbn13, publisherIsbn10, permaIsbn13, permaIsbn10].includes(isbn))).toEqual([
      permaIsbn13,
      publisherIsbn13,
      permaIsbn10,
      publisherIsbn10,
    ]);
    expect(title.isbnDigits.some((isbn) => isbn.includes("-"))).toBe(false);
    expect(title.possibleDuplicate).toBe(false);
  });

  it("finds that single card by Dogman, Dog Man, and the new ISBNs", () => {
    for (const query of [
      "Dog Man : a sprinkle in time",
      "Dog Man: A Sprinkle in Time",
      "Dog Man. A Sprinkle in Time",
      "978-1-546-19935-9",
      "978-0-8479-2118-8",
      publisherIsbn10,
      permaIsbn10,
    ]) {
      const results = searchTitles(data, query, { holdingsIndex });
      const hits = results.filter((item) => /sprinkle in time/i.test(item.title.title) && /dog\s*man|dogman/i.test(item.title.title));
      expect(hits, query).toHaveLength(1);
      expect(hits[0].title.title, query).toBe("Dog Man : a sprinkle in time");
      expect(hits[0].title.isbnDigits, query).toEqual(expect.arrayContaining([publisherIsbn13, publisherIsbn10, permaIsbn13, permaIsbn10]));
      expect(classifySearch(results).match?.title.title, query).toBe("Dog Man : a sprinkle in time");
    }

    const dogman = searchTitles(data, "Dogman: A Sprinkle in Time", { holdingsIndex });
    const dogmanHits = dogman.filter((item) => /sprinkle in time/i.test(item.title.title) && /dog\s*man|dogman/i.test(item.title.title));
    expect(dogmanHits).toHaveLength(1);
    expect(dogmanHits[0].title.title).toBe("Dog Man : a sprinkle in time");
    expect(dogmanHits[0].title.isbnDigits).toEqual(expect.arrayContaining([publisherIsbn13, publisherIsbn10, permaIsbn13, permaIsbn10]));
    expect(dogman.filter((item) => /sprinkle in time/i.test(item.title.title))).toHaveLength(1);
    expect(sprinkleCards()).toHaveLength(1);
  });
});

describe("Dot the Ladybug ISBN", () => {
  const isbn13 = "9780800043735";
  const isbn10 = "0800043731";
  const priorIsbn13 = "9780063137509";
  const priorIsbn10 = "006313750X";

  function ladybugCards() {
    return data.titles.filter((title) => /dot the ladybug/i.test(title.title));
  }

  it("keeps one posted Dot the Ladybug card and stores the normalized ISBN", () => {
    const cards = ladybugCards();
    expect(cards).toHaveLength(1);
    const title = cards[0];
    expect(title.title).toBe("Dot the ladybug : the missing dot");
    expect(title.authors).toEqual(["George, K.", "George, K. (Kallie), 1983-"]);
    expect(title.posted).toBe(true);
    expect(title.inCollection).toBe(true);
    expect(title.batches).toEqual(["Oct 2025", "Follett 9.16.26"]);
    expect(title.levels).toEqual(["Elementary"]);
    expect(title.isbnDigits).toEqual([priorIsbn13, isbn13, priorIsbn10, isbn10]);
    expect(title.isbnDigits.some((isbn) => isbn.includes("-"))).toBe(false);
    expect(title.possibleDuplicate).toBe(false);

    const dotDay = data.titles.find((item) => item.title === "Dot Day");
    expect(dotDay?.authors).toEqual(["George, Kallie"]);
    expect(dotDay?.batches).toEqual(["2026-2027"]);
    expect(dotDay?.isbnDigits).toEqual(["9780063137462", "9780800043735", "0063137461", "0800043731"]);
    expect(data.titles.filter((item) => item.title === "Dot the Ladybug")).toHaveLength(0);
    const hidden = new Set(["crank", "glass", "handmaid s tale", "let s talk about it"]);
    expect(data.titles.some((item) => hidden.has(normalizeTitle(item.title)))).toBe(false);
  });

  it("finds that single posted card by the subtitle and by punctuation variants", () => {
    for (const query of [
      "Dot the ladybug : the missing dot",
      "Dot the Ladybug: The Missing Dot",
      "Dot the ladybug. The missing dot",
    ]) {
      const results = searchTitles(data, query, { holdingsIndex });
      const hits = results.filter((item) => item.title.title === "Dot the ladybug : the missing dot");
      expect(hits, query).toHaveLength(1);
      expect(hits[0].title.isbnDigits, query).toEqual([priorIsbn13, isbn13, priorIsbn10, isbn10]);
      expect(classifySearch(results).match?.title.title, query).toBe("Dot the ladybug : the missing dot");
    }
    expect(ladybugCards()).toHaveLength(1);
  });
});
