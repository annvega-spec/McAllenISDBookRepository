import { describe, expect, it } from "vitest";
import { buildHoldingsIndex } from "./lib/holdings";
import { parseIsbnCell } from "./lib/isbn";
import { normalizeTitle } from "./lib/normalize";
import { classifySearch, searchTitles } from "./lib/search";
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

describe("duplicate title collapse", () => {
  const dupes: CollectionData = {
    ...data,
    rowCount: 4,
    uniqueTitleCount: 4,
    titles: [
      title({
        id: "dal-sep",
        title: "101 Dalmatians",
        authors: ["Bobowicz, Pamela"],
        isbns: ["9780736481571"],
        isbnDigits: ["9780736481571"],
        batches: ["Sep 2025"],
        postedBatches: ["Sep 2025"],
        levels: ["Elementary"],
      }),
      title({
        id: "dal-oct",
        title: "The 101 Dalmatians!",
        authors: ["Pamela Bobowicz"],
        isbns: ["9780736481571"],
        isbnDigits: ["9780736481571"],
        batches: ["Oct 2025"],
        postedBatches: ["Oct 2025"],
        levels: ["Elementary"],
      }),
      title({
        id: "dal-other",
        title: "101 Dalmatians",
        authors: ["Bobowicz, Pamela"],
        isbns: ["9780736481999"],
        isbnDigits: ["9780736481999"],
        batches: ["Feb 2026"],
        postedBatches: ["Feb 2026"],
        levels: ["Elementary"],
      }),
      title({
        id: "dal-blank",
        title: "",
        titleUnknown: true,
        isbns: ["9780736481571"],
        isbnDigits: ["9780736481571"],
        batches: ["Follett 9.16.26"],
        holdingsBatches: ["Follett 9.16.26"],
        posted: false,
        inCollection: true,
      }),
    ],
  };

  it("returns one card with every approved ISBN and posted date", () => {
    const results = searchTitles(dupes, "101 Dalmatians");
    expect(results).toHaveLength(1);
    const match = classifySearch(results).match?.title;
    expect(match).toBeTruthy();
    expect(normalizeTitle(match!.title)).toBe("101 dalmatians");
    expect(match!.isbns).toEqual(expect.arrayContaining(["9780736481571", "9780736481999"]));
    expect(match!.postedBatches).toEqual(expect.arrayContaining(["Sep 2025", "Oct 2025", "Feb 2026"]));
    expect(match!.authors.length).toBeGreaterThanOrEqual(1);
    expect(match!.inCollection).toBe(true);
    expect(match!.titleUnknown).toBeFalsy();
  });

  it("does not spawn a blank-title card when the ISBN already has a titled match", () => {
    const results = searchTitles(dupes, "9780736481571");
    expect(results).toHaveLength(1);
    expect(results[0].title.title).toBe("101 Dalmatians");
    expect(results[0].title.titleUnknown).toBeFalsy();
    expect(results[0].title.isbns).toContain("9780736481571");
  });

  it("still says not found for a nonsense title", () => {
    const results = searchTitles(dupes, "zxqwv purple giraffe cookbook");
    expect(classifySearch(results).match).toBeNull();
    expect(results).toHaveLength(0);
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
});

describe("Follett audiobook alignment", () => {
  it("attaches an audio ISBN onto the existing titled card instead of a second card", () => {
    const index = buildHoldingsIndex({
      b: "Follett 9.16.26",
      n: 1,
      a: ["", "Bobowicz, Pamela"],
      s: ["", "101 Dalmatians"],
      r: [[9780736481999, 1, 1, 4]],
    });
    const byTitle = searchTitles(data, "101 Dalmatians", { holdingsIndex: index });
    expect(byTitle.filter((item) => normalizeTitle(item.title.title) === "101 dalmatians")).toHaveLength(1);
    expect(byTitle[0].title.formats.audio).toBe(true);
    expect(byTitle[0].title.isbnDigits).toEqual(expect.arrayContaining(["9780736481571", "9780736481999"]));

    const byIsbn = searchTitles(data, "9780736481999", { holdingsIndex: index });
    expect(byIsbn).toHaveLength(1);
    const match = classifySearch(byIsbn).match?.title;
    expect(match?.title).toBe("101 Dalmatians");
    expect(match?.titleUnknown).toBeFalsy();
    expect(match?.formats.audio).toBe(true);
    expect(match?.inCollection).toBe(true);
    expect(match?.isbnDigits).toEqual(expect.arrayContaining(["9780736481571", "9780736481999"]));
  });

  it("returns HAVE IT / In collection for an audio-only Follett ISBN", () => {
    const index = buildHoldingsIndex({
      b: "Follett 9.16.26",
      n: 1,
      a: ["", "Someone, A"],
      s: [""],
      r: [[9780807210260, 1, 0, 4]],
    });
    const results = searchTitles(data, "9780807210260", { holdingsIndex: index });
    const match = classifySearch(results).match?.title;
    expect(match?.inCollection).toBe(true);
    expect(match?.posted).toBe(false);
    expect(match?.formats.audio).toBe(true);
    expect(match?.formats.book).toBe(false);
    expect(match?.isbnDigits).toContain("9780807210260");
  });

  it("does not spawn duplicate cards for the same normalized title", () => {
    const withAudio: CollectionData = {
      ...data,
      titles: [
        title({
          ...data.titles[0],
          isbns: ["9780736481571", "9780736481999"],
          isbnDigits: ["9780736481571", "9780736481999"],
          formats: { book: true, ebook: false, audio: true },
          inCollection: true,
        }),
        title({
          id: "dal-audio",
          title: "The 101 Dalmatians",
          authors: ["Pamela Bobowicz"],
          isbns: ["9780736481999"],
          isbnDigits: ["9780736481999"],
          batches: ["Follett 9.16.26"],
          holdingsBatches: ["Follett 9.16.26"],
          posted: false,
          inCollection: true,
          formats: { book: false, ebook: false, audio: true },
        }),
        data.titles[1],
      ],
    };
    const results = searchTitles(withAudio, "101 Dalmatians");
    expect(results.filter((item) => normalizeTitle(item.title.title) === "101 dalmatians")).toHaveLength(1);
    expect(results[0].title.isbns).toEqual(expect.arrayContaining(["9780736481571", "9780736481999"]));
    expect(results[0].title.formats.audio).toBe(true);
  });
});
