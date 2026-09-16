import { describe, expect, it } from "vitest";
import { buildHoldingsIndex } from "./lib/holdings";
import { parseIsbnCell } from "./lib/isbn";
import { classifySearch, mergeHoldingsIntoResults, searchTitles } from "./lib/search";
import type { CollectionData, TitleRecord } from "./types";

function title(partial: Partial<TitleRecord> & Pick<TitleRecord, "id" | "title">): TitleRecord {
  return {
    authors: [],
    isbns: [],
    isbnDigits: [],
    batches: [],
    postedBatches: [],
    holdingsBatches: [],
    levels: [],
    audiences: [],
    editions: [],
    formats: { book: false, ebook: false, audio: false },
    posted: true,
    inCollection: false,
    possibleDuplicate: false,
    reviews: {},
    rowCount: 1,
    ...partial,
  };
}

const data: CollectionData = {
  generatedAt: "2026-09-16T00:00:00.000Z",
  sheet: "merged",
  rowCount: 2,
  uniqueTitleCount: 2,
  batches: ["Sep 2025", "All Campuses"],
  levels: ["Elementary"],
  stats: {
    rowsByBatch: {},
    titlesByBatch: {},
    rowsByLevel: {},
    titlesByLevel: {},
  },
  titles: [
    title({
      id: "dal",
      title: "101 Dalmatians",
      authors: ["Bobowicz, Pamela"],
      isbns: ["9780736481571"],
      isbnDigits: ["9780736481571"],
      batches: ["Sep 2025", "Follett 9.16.26"],
      postedBatches: ["Sep 2025"],
      holdingsBatches: ["Follett 9.16.26"],
      posted: true,
      inCollection: true,
    }),
    title({
      id: "dusty",
      title: "A Dusty donkey detour",
      authors: ["Nawrocki, Michael"],
      isbns: ["9781516080236"],
      isbnDigits: ["9781516080236"],
      batches: ["All Campuses"],
      postedBatches: ["All Campuses"],
      posted: true,
    }),
  ],
};

describe("ISBN scientific notation in search", () => {
  it("treats Excel scientific notation as the 13-digit ISBN", () => {
    expect(parseIsbnCell("9.781516080236E12")[0].isbn13).toBe("9781516080236");
    const results = searchTitles(data, "9.781516080236E12");
    expect(classifySearch(results).match?.title.title).toBe("A Dusty donkey detour");
    expect(classifySearch(results).match?.title.isbns).toContain("9781516080236");
  });
});

describe("holdings-only ISBN search", () => {
  it("returns In collection for an untitled Follett ISBN", () => {
    const index = buildHoldingsIndex({
      b: "Follett 9.16.26",
      n: 1,
      a: ["", "Someone, A"],
      s: [""],
      r: [[9780002251181, 1, 0, 1]],
    });
    const results = searchTitles(data, "0002251183", { holdingsIndex: index });
    const match = classifySearch(results).match?.title;
    expect(match?.inCollection).toBe(true);
    expect(match?.posted).toBe(false);
    expect(match?.titleUnknown).toBe(true);
    expect(match?.isbnDigits).toContain("9780002251181");
  });

  it("merges a worker holdings hit when posted search is empty", () => {
    const posted = searchTitles(data, "0002251183");
    const holding = title({
      id: "h:9780002251181",
      title: "",
      titleUnknown: true,
      isbnDigits: ["9780002251181", "0002251183"],
      isbns: ["9780002251181"],
      posted: false,
      inCollection: true,
    });
    const merged = mergeHoldingsIntoResults("0002251183", posted, [holding]);
    expect(classifySearch(merged).match?.title.id).toBe("h:9780002251181");
    expect(classifySearch(merged).match?.title.inCollection).toBe(true);
  });
});
