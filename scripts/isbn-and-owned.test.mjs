import { describe, expect, it } from "vitest";
import {
  collectNormalizedIsbn13s,
  isbn10To13,
  normalizeIsbnValue,
  parseIsbnCandidates,
  toIsbn13,
} from "./lib/isbn.mjs";
import { applyOwnedToTitles, buildCollection, detectKind, normalizeLevel } from "./lib/build-collection.mjs";
import { buildOwnedCatalog, ownedHasIsbn } from "./lib/owned-catalog.mjs";
import { classifySearch, searchTitles } from "../src/lib/search.ts";
import { prepareOwned } from "../src/lib/owned.ts";

describe("scientific-notation and messy ISBNs", () => {
  it("converts Excel scientific notation to a 13-digit ISBN", () => {
    expect(parseIsbnCandidates("9.781516080236E12")).toEqual(["9781516080236"]);
    expect(parseIsbnCandidates(9.781516080236e12)).toEqual(["9781516080236"]);
    expect(collectNormalizedIsbn13s("9.781516080236E12")).toEqual(["9781516080236"]);
    expect(collectNormalizedIsbn13s(9781516080236)).toEqual(["9781516080236"]);
  });

  it("strips Follett hyphens and (pbk.) suffixes", () => {
    expect(collectNormalizedIsbn13s("978-0-374-51868-4 (pbk.)")).toEqual(["9780374518684"]);
    expect(toIsbn13("978-0-374-51868-4 (pbk.)")).toBe("9780374518684");
  });

  it("normalizes ISBN-10 values, including X check digits", () => {
    const from10 = collectNormalizedIsbn13s("0-394-74839-5 (pbk.)");
    expect(from10).toContain("9780394748399");
    expect(isbn10To13("0394748395")).toBe("9780394748399");
    expect(collectNormalizedIsbn13s("0-02-865501-X")).toContain(isbn10To13("002865501X"));
  });

  it("keeps 13-digit ISBNs stored as JavaScript numbers", () => {
    const values = normalizeIsbnValue(9781516080236);
    expect(values.some((item) => item.isbn13 === "9781516080236")).toBe(true);
  });
});

describe("Follett owned catalog", () => {
  it("keeps Book/eBook rows with an ISBN and skips Video/Kit", () => {
    const owned = buildOwnedCatalog([
      {
        filePath: "data/incoming/District-Report-9.16.26.xlsx",
        sheet: "District Report 9.16.26",
        rows: [
          { Author: "", ISBN: "", "Material Type": "Video", "Series Title": "" },
          { Author: "", ISBN: "978-0-02-105887-7", "Material Type": "Kit", "Series Title": "" },
          { Author: "", ISBN: "0-00-225118-3", "Material Type": "Book", "Series Title": "" },
          { Author: "Dahl, Roald.", ISBN: "978-0-374-51868-4 (pbk.)", "Material Type": "eBook", "Series Title": "" },
          { Author: "", ISBN: "978-0-374-51868-4 (pbk.)", "Material Type": "Book", "Series Title": "Charlie books" },
        ],
      },
    ]);
    expect(owned.source).toBe("Follett 9.16.26");
    expect(owned.stats.skippedNonBook).toBe(2);
    expect(owned.count).toBe(2);
    expect(ownedHasIsbn(owned, toIsbn13("0002251183"))).toBe(true);
    expect(ownedHasIsbn(owned, "9780374518684")).toBe(true);
    expect(ownedHasIsbn(owned, "9780021058877")).toBe(false);
  });

  it("deduplicates by normalized ISBN and keeps series title as fallback", () => {
    const owned = buildOwnedCatalog([
      {
        filePath: "District-Report-9.16.26.xlsx",
        rows: [
          { Author: "", ISBN: "978-0-374-51868-4 (pbk.)", "Material Type": "Book", "Series Title": "" },
          { Author: "Dahl, Roald.", ISBN: "0-374-51868-0", "Material Type": "eBook", "Series Title": "Charlie books" },
        ],
      },
    ]);
    expect(owned.count).toBe(1);
    expect(owned.titles).toContain("Charlie books");
    expect(owned.authors).toContain("Dahl, Roald.");
    const prepared = prepareOwned(owned);
    const hit = searchTitles({ titles: [] }, "9780374518684", { owned: prepared });
    expect(classifySearch(hit).match?.title.title).toBe("Charlie books");
    expect(classifySearch(hit).match?.title.owned).toBe(true);
    expect(classifySearch(hit).match?.title.posted).toBe(false);
  });

  it("finds an owned ISBN-only row that has no title", () => {
    const owned = buildOwnedCatalog([
      {
        filePath: "District-Report-9.16.26.xlsx",
        rows: [{ Author: "", ISBN: "0-00-225118-3", "Material Type": "Book", "Series Title": "" }],
      },
    ]);
    const isbn13 = toIsbn13("0002251183");
    const results = searchTitles({ titles: [] }, isbn13, { owned: prepareOwned(owned) });
    const match = classifySearch(results).match;
    expect(match).not.toBeNull();
    expect(match?.reason).toBe("owned");
    expect(match?.title.title).toBe("");
    expect(match?.title.owned).toBe(true);
    expect(match?.title.isbns).toContain(isbn13);
  });
});

describe("merge titled row with owned ISBN-only row", () => {
  it("flags the posted title as owned without replacing it", () => {
    const collection = buildCollection([
      {
        filePath: "master.xlsx",
        kind: "posted",
        rows: [
          { Title: "101 Dalmatians", Author: "Bobowicz, Pamela", ISBN: "9780736481571", "Source Batch": "Sep 2025" },
        ],
      },
    ]);
    const owned = buildOwnedCatalog([
      {
        filePath: "District-Report-9.16.26.xlsx",
        rows: [
          { Author: "", ISBN: "978-0-7364-8157-1", "Material Type": "Book", "Series Title": "" },
        ],
      },
    ]);
    applyOwnedToTitles(collection, owned);
    expect(collection.uniqueTitleCount).toBe(1);
    expect(collection.titles[0].title).toBe("101 Dalmatians");
    expect(collection.titles[0].posted).toBe(true);
    expect(collection.titles[0].owned).toBe(true);
    expect(collection.titles[0].ownedSources).toEqual(["Follett 9.16.26"]);
    expect(collection.titles[0].batches).toEqual(["Sep 2025"]);

    const results = searchTitles(collection, "9780736481571", { owned: prepareOwned(owned) });
    const match = classifySearch(results).match;
    expect(match?.title.title).toBe("101 Dalmatians");
    expect(match?.title.owned).toBe(true);
    expect(match?.title.posted).toBe(true);
  });
});

describe("named list helpers", () => {
  it("maps All Campuses level labels and detects spreadsheet kinds", () => {
    expect(normalizeLevel("Middle School ")).toBe("Middle");
    expect(normalizeLevel("High School")).toBe("High");
    expect(normalizeLevel("Elementary")).toBe("Elementary");
    expect(
      detectKind("data/incoming/All-Campuses.xlsx", {
        sheet: "All Campuses",
        rows: [{ Level: "Elementary", Title: "X", ISBN: 1 }],
      }),
    ).toBe("posted");
    expect(
      detectKind("data/incoming/ebook-list-A.xlsx", {
        sheet: "Page 1",
        rows: [{ QTY: 1, Title: "X", ISBN: "978", Edition: "eBook" }],
      }),
    ).toBe("ebook-order");
    expect(
      detectKind("data/incoming/District-Report-9.16.26.xlsx", {
        sheet: "District Report 9.16.26",
        rows: [{ "Material Type": "Book", "Series Title": "", "Follett eBook": "false", ISBN: "" }],
      }),
    ).toBe("owned-follett");
  });

  it("keeps eBook edition notes and does not treat them as HB 900 batches", () => {
    const payload = buildCollection([
      {
        filePath: "ebook-list-A.xlsx",
        kind: "ebook-order",
        defaultBatch: "eBook list A",
        rows: [
          { Title: "ALMOST SUNSET", Author: "ALGARMI, WAHAB", ISBN: "9780063355682", Edition: "26 CHECKOUT SUBSCRIPTION/SINGLE-USER EBOOK" },
        ],
      },
    ]);
    const title = payload.titles[0];
    expect(title.posted).toBe(false);
    expect(title.ebookOrder).toBe(true);
    expect(title.formats.ebook).toBe(true);
    expect(title.formatNotes).toEqual(["26 CHECKOUT SUBSCRIPTION/SINGLE-USER EBOOK"]);
    expect(title.batches).toEqual(["eBook list A"]);
  });
});
