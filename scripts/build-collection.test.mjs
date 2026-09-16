import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  attachHoldingsToCollection,
  buildCatalogFromFiles,
  buildCollection,
  buildCollectionFromFiles,
  FOLLETT_FORMAT,
  ingestFollettRows,
  isExcludedPostedTitle,
  loadPostedExclusions,
  rowFingerprint,
  titleKey,
} from "../scripts/lib/build-collection.mjs";
import { parseIsbnCell } from "../scripts/lib/isbn.mjs";

function rows(list) {
  return { filePath: "test.xlsx", label: "test.xlsx", rows: list };
}

describe("spreadsheet merge", () => {
  it("unions ISBNs and posted dates for the same title", () => {
    const payload = buildCollection([
      rows([
        { Title: "101 Dalmatians", Author: "Bobowicz, Pamela", ISBN: "9780736481571", "Source Batch": "Sep 2025", Level: "Elementary" },
      ]),
      rows([
        { Title: "101 Dalmatians", Author: "Bobowicz, Pamela", ISBN: "9780736481571", "Source Batch": "Oct 2025", Level: "Elementary" },
        { Title: "101 Dalmatians", Author: "Bobowicz, Pamela", "ISBN-13": "9780736481999", "Source Batch": "Feb 2026", Level: "Elementary" },
      ]),
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].isbns).toEqual(expect.arrayContaining(["9780736481571", "9780736481999"]));
    expect(payload.titles[0].batches).toEqual(["Sep 2025", "Oct 2025", "Feb 2026"]);
    expect(payload.rowCount).toBeGreaterThan(payload.uniqueTitleCount);
  });

  it("does not drop a title that is missing from a later spreadsheet", () => {
    const payload = buildCollection([
      rows([
        { Title: "Kept Title", Author: "A", ISBN: "9781111111111", "Source Batch": "Sep 2025" },
        { Title: "Shared Title", Author: "B", ISBN: "9782222222222", "Source Batch": "Sep 2025" },
      ]),
      rows([{ Title: "Shared Title", Author: "B", ISBN: "9782222222222", "Source Batch": "Nov 2025" }]),
    ]);
    expect(payload.titles.map((t) => t.title).sort()).toEqual(["Kept Title", "Shared Title"]);
    expect(payload.titles.find((t) => t.title === "Shared Title")?.batches).toEqual(["Sep 2025", "Nov 2025"]);
  });

  it("is idempotent when the same rows are imported twice", () => {
    const list = [
      { Title: "Same Book", Author: "Lee, A", ISBN: "9783333333333", "Source Batch": "Jan 2026" },
      { Title: "Same Book", Author: "Lee, A", ISBN: "9783333333333", "Source Batch": "Jan 2026" },
    ];
    const once = buildCollection([rows(list.slice(0, 1))]);
    const twice = buildCollection([rows(list), rows(list)]);
    expect(twice.uniqueTitleCount).toBe(1);
    expect(twice.rowCount).toBe(once.rowCount);
    expect(twice.stats.skippedDuplicateRows).toBeGreaterThan(0);
    expect(rowFingerprint(list[0])).toBe(rowFingerprint(list[1]));
  });

  it("groups a shared ISBN even when the title text differs slightly", () => {
    const payload = buildCollection([
      rows([{ Title: "The Lake House", Author: "X", ISBN: "9784444444444", "Source Batch": "Sep 2025" }]),
      rows([{ Title: "Lake House", Author: "X", ISBN: "9784444444444", "Source Batch": "Oct 2025" }]),
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].possibleDuplicate).toBe(true);
    expect(payload.titles[0].batches).toEqual(["Sep 2025", "Oct 2025"]);
  });

  it("collapses titles that differ only by article or punctuation and unions ISBNs", () => {
    const payload = buildCollection([
      rows([
        {
          Title: "Plate of Hope",
          Author: "Erin Frankel",
          ISBN: "9780593380581",
          "Source Batch": "Oct 2025",
          Level: "Elementary",
        },
      ]),
      rows([
        {
          Title: "A Plate of Hope!",
          Author: "Frankel, Erin",
          "ISBN-13": "9780593380999",
          "Source Batch": "Sep 2025",
          Level: "Elementary",
        },
      ]),
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].isbns).toEqual(expect.arrayContaining(["9780593380581", "9780593380999"]));
    expect(payload.titles[0].batches).toEqual(["Sep 2025", "Oct 2025"]);
    expect(payload.titles[0].authors.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts similar column names on an extra spreadsheet", () => {
    const payload = buildCollection([
      rows([{ Title: "Old", Author: "A", ISBN: "9785555555555", "Source Batch": "Sep 2025" }]),
      rows([{ "Book Title": "New", Authors: "B", ISBN13: "9786666666666", Period: "Mar 2026" }]),
    ]);
    expect(payload.uniqueTitleCount).toBe(2);
    expect(payload.titles.find((t) => t.title === "New")?.batches).toEqual(["Mar 2026"]);
  });

  it("reads real xlsx files without doubling when the same file is listed twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "misd-import-"));
    const file = join(dir, "extra.xlsx");
    const sheet = XLSX.utils.json_to_sheet([
      { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026", Level: "Middle" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Master List");
    XLSX.writeFile(wb, file);
    const payload = buildCollectionFromFiles([file, file]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.rowCount).toBe(1);
    expect(payload.stats.skippedDuplicateRows).toBe(1);
  });
});

describe("title key", () => {
  it("matches desk search normalization, including articles and punctuation", () => {
    expect(titleKey("The 101 Dalmatians!")).toBe("101 dalmatians");
    expect(titleKey("A Plate of Hope")).toBe("plate of hope");
    expect(titleKey("DON'T TRUST FISH!")).toBe("don t trust fish");
    expect(titleKey("Barbie : a fashion fairytale")).toBe("barbie a fashion fairytale");
  });
});

describe("ISBN normalization", () => {
  it("converts Excel scientific notation to a 13-digit ISBN", () => {
    expect(parseIsbnCell("9.781516080236E12")[0].isbn13).toBe("9781516080236");
    expect(parseIsbnCell(9.781516080236e12)[0].isbn13).toBe("9781516080236");
    expect(parseIsbnCell(9781516080236)[0].isbn13).toBe("9781516080236");
  });

  it("strips hyphens and parenthetical suffixes and upgrades ISBN-10", () => {
    const messy = parseIsbnCell("0-02-865378-5 (hc. : acid-free paper)")[0];
    expect(messy.isbn10).toBe("0028653785");
    expect(messy.isbn13).toBe("9780028653785");
    expect(parseIsbnCell("0-02-865501-X")[0].isbn13).toMatch(/^978002865501/);
    expect(parseIsbnCell("978-0-02-105887-7")[0].isbn13).toBe("9780021058877");
  });
});

describe("untitled Follett rows", () => {
  it("merges an untitled holdings row onto a titled posted book by ISBN", () => {
    const payload = buildCollection([
      rows([
        {
          Title: "A Dusty donkey detour",
          Author: "Nawrocki, Michael",
          ISBN: "9781516080236",
          "Source Batch": "All Campuses",
          Level: "Elementary",
        },
      ]),
      {
        filePath: "follett.xlsx",
        label: "follett.xlsx",
        kind: "follett",
        rows: [
          {
            Author: "Nawrocki, Michael",
            ISBN: "978-1-5160-8023-6 (pbk.)",
            "Material Type": "Book",
            "Series Title": "",
            "Source Batch": "Follett 9.16.26",
          },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    const title = payload.titles[0];
    expect(title.title).toBe("A Dusty donkey detour");
    expect(title.posted).toBe(true);
    expect(title.inCollection).toBe(true);
    expect(title.isbnDigits).toContain("9781516080236");
    expect(title.postedBatches).toContain("All Campuses");
    expect(title.holdingsBatches).toContain("Follett 9.16.26");
  });

  it("keeps untitled ISBN rows searchable instead of dropping them", () => {
    const payload = buildCollection([
      {
        filePath: "follett.xlsx",
        label: "follett.xlsx",
        kind: "follett",
        rows: [
          { Author: "Someone, A", ISBN: "9780736481571", "Material Type": "Book", "Series Title": "" },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].title).toBe("");
    expect(payload.titles[0].titleUnknown).toBe(true);
    expect(payload.titles[0].inCollection).toBe(true);
    expect(payload.titles[0].isbnDigits).toContain("9780736481571");
  });

  it("does not collapse two untitled books that share no ISBN", () => {
    const payload = buildCollection([
      {
        filePath: "follett.xlsx",
        label: "follett.xlsx",
        kind: "follett",
        rows: [
          { Author: "A", ISBN: "9781111111111", "Material Type": "Book" },
          { Author: "B", ISBN: "9782222222222", "Material Type": "Book" },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(2);
  });

  it("skips Video/Kit/etc and rows without an ISBN", () => {
    const payload = buildCollection([
      {
        filePath: "follett.xlsx",
        label: "follett.xlsx",
        kind: "follett",
        rows: [
          { Author: "A", ISBN: "9781111111111", "Material Type": "Book" },
          { Author: "B", ISBN: "9782222222222", "Material Type": "Video" },
          { Author: "C", ISBN: "", "Material Type": "Book" },
          { Author: "D", ISBN: "9783333333333", "Material Type": "Kit" },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].isbnDigits).toContain("9781111111111");
  });
});

describe("additional source shapes", () => {
  it("maps All Campuses level column and scientific-notation ISBNs", () => {
    const payload = buildCollection([
      {
        filePath: "All-Campuses.xlsx",
        label: "All-Campuses.xlsx",
        kind: "all-campuses",
        rows: [
          {
            "Elementary, Middle or High": "Middle School",
            Title: "A Dusty donkey detour",
            Author: "Nawrocki, Michael",
            ISBN: 9.781516080236e12,
            "ISBN-13": "9.781516080236E12",
          },
        ],
      },
    ]);
    const title = payload.titles[0];
    expect(title.batches).toEqual(["All Campuses"]);
    expect(title.levels).toEqual(["Middle"]);
    expect(title.isbns).toContain("9781516080236");
    expect(title.posted).toBe(true);
  });

  it("imports eBook order rows with edition metadata", () => {
    const payload = buildCollection([
      {
        filePath: "ebook-list-A.xlsx",
        label: "ebook-list-A.xlsx",
        kind: "ebook-order",
        rows: [
          {
            QTY: 1,
            Title: "ALMOST SUNSET",
            Author: "ALGARMI, WAHAB",
            ISBN: "9780063355682",
            Edition: "26 CHECKOUT SUBSCRIPTION/SINGLE-USER EBOOK",
          },
        ],
      },
    ]);
    const title = payload.titles[0];
    expect(title.batches).toEqual(["eBook order"]);
    expect(title.formats.ebook).toBe(true);
    expect(title.editions).toEqual(["26 CHECKOUT SUBSCRIPTION/SINGLE-USER EBOOK"]);
    expect(title.posted).toBe(true);
  });

  it("unions All Campuses, eBook order, and Follett ISBN onto one normalized title", () => {
    const posted = buildCollection([
      rows([
        {
          Title: "Don't trust fish",
          Author: "Sharpson, Neil",
          ISBN: "9780593616673",
          "Source Batch": "Sep 2025",
          Level: "Elementary",
        },
      ]),
      {
        filePath: "All-Campuses.xlsx",
        label: "All-Campuses.xlsx",
        kind: "all-campuses",
        rows: [
          {
            Title: "Don't Trust Fish!",
            Author: "SHARPSON, NEIL",
            ISBN: "9780593616680",
            "Elementary, Middle or High": "Elementary",
          },
        ],
      },
      {
        filePath: "ebook-list-A.xlsx",
        label: "ebook-list-A.xlsx",
        kind: "ebook-order",
        rows: [
          {
            Title: "DON'T TRUST FISH!",
            Author: "SHARPSON, NEIL",
            ISBN: "9780593616680",
            Edition: "EBOOK",
          },
        ],
      },
    ]);
    const ingested = ingestFollettRows([
      { Author: "Sharpson, Neil", ISBN: "978-0-593-61667-3", "Material Type": "Book", "Series Title": "" },
    ]);
    attachHoldingsToCollection(posted, ingested);
    expect(posted.uniqueTitleCount).toBe(1);
    const title = posted.titles[0];
    expect(title.isbns).toEqual(expect.arrayContaining(["9780593616673", "9780593616680"]));
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "All Campuses", "eBook order", "Follett 9.16.26"]));
    expect(title.inCollection).toBe(true);
    expect(title.formats.ebook).toBe(true);
    expect(title.editions).toContain("EBOOK");
  });
});

describe("compact Follett holdings", () => {
  it("links overlapping ISBNs onto posted titles and keeps the rest compact", () => {
    const posted = buildCollection([
      rows([
        { Title: "101 Dalmatians", Author: "Bobowicz, Pamela", ISBN: "9780736481571", "Source Batch": "Sep 2025" },
      ]),
    ]);
    const ingested = ingestFollettRows([
      { Author: "Bobowicz, Pamela", ISBN: "978-0-7364-8157-1", "Material Type": "Book", "Series Title": "" },
      { Author: "Unknown", ISBN: "0-00-225118-3", "Material Type": "Book", "Series Title": "Old series" },
      { Author: "Skip", ISBN: "9780000000000", "Material Type": "Video" },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.titles[0].inCollection).toBe(true);
    expect(posted.titles[0].holdingsBatches).toEqual(["Follett 9.16.26"]);
    expect(posted.stats.holdingsLinkedToPosted).toBe(1);
    expect(compact.n).toBe(1);
    expect(String(compact.r[0][0])).toBe("9780002251181");
    expect(compact.s[compact.r[0][2]]).toBe("Old series");
  });

  it("detects a Follett workbook and does not dump holdings into posted titles", () => {
    const dir = mkdtempSync(join(tmpdir(), "misd-follett-"));
    const postedFile = join(dir, "posted.xlsx");
    const follettFile = join(dir, "District-Report-9.16.26.xlsx");
    const postedSheet = XLSX.utils.json_to_sheet([
      { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
    ]);
    const postedWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(postedWb, postedSheet, "Master List");
    XLSX.writeFile(postedWb, postedFile);

    const follettSheet = XLSX.utils.json_to_sheet([
      { Author: "Ng, C", ISBN: "978-7-777-77777-7", "Material Type": "Book", "Series Title": "" },
      { Author: "Other", ISBN: "0-00-225118-3", "Material Type": "eBook", "Series Title": "Series A" },
      { Author: "Nope", ISBN: "978123", "Material Type": "Kit", "Series Title": "" },
    ]);
    const follettWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(follettWb, follettSheet, "District Report 9.16.26");
    XLSX.writeFile(follettWb, follettFile);

    const catalog = buildCatalogFromFiles([postedFile, follettFile]);
    expect(catalog.collection.uniqueTitleCount).toBe(1);
    expect(catalog.collection.titles[0].inCollection).toBe(true);
    expect(catalog.holdings.n).toBe(1);
  });
});

const HOPKINS_EXCLUSIONS = [
  { title: "Crank", author: "Ellen Hopkins" },
  { title: "Glass", author: "Ellen Hopkins" },
];

describe("posted title exclusions", () => {
  it("matches Crank / Glass title variants with Ellen Hopkins author orderings", () => {
    expect(isExcludedPostedTitle("CRANK.", "Hopkins, Ellen.", HOPKINS_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("Crank", "Ellen Hopkins", HOPKINS_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("Glass", "Hopkins, Ellen,", HOPKINS_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("The Glass", "Ellen Hopkins", HOPKINS_EXCLUSIONS)).toBe(true);
  });

  it("does not match other Ellen Hopkins titles or other Crank/Glass books", () => {
    expect(isExcludedPostedTitle("Impulse", "Hopkins, Ellen", HOPKINS_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Crankenstein", "Samantha Berger", HOPKINS_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Glass slippers", "Cypess, Leah", HOPKINS_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Crank", "Hopkinson, Deborah", HOPKINS_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Starminster", "Hopkins, Megan", HOPKINS_EXCLUSIONS)).toBe(false);
  });

  it("drops excluded posted rows so a later import cannot restore them as approved", () => {
    const payload = buildCollection(
      [
        rows([
          { Title: "Crank", Author: "Hopkins, Ellen", ISBN: "9781416905080", "Source Batch": "Sep 2025", Level: "High" },
          { Title: "CRANK.", Author: "Ellen Hopkins", ISBN: "9781442471818", "Source Batch": "All Campuses", Level: "High" },
          { Title: "Glass", Author: "Hopkins, Ellen.", ISBN: "9781416940906", "Source Batch": "Oct 2025", Level: "High" },
          { Title: "Impulse", Author: "Hopkins, Ellen", ISBN: "9781416903567", "Source Batch": "Nov 2025", Level: "High" },
          { Title: "Crankenstein", Author: "Samantha Berger", ISBN: "9780316126564", "Source Batch": "Oct 2025", Level: "Elementary" },
          { Title: "Glass slippers", Author: "Cypess, Leah", ISBN: "9781546130000", "Source Batch": "All Campuses", Level: "Elementary" },
        ]),
        {
          filePath: "ebook-list-A.xlsx",
          label: "ebook-list-A.xlsx",
          kind: "ebook-order",
          rows: [{ Title: "CRANK", Author: "HOPKINS, ELLEN", ISBN: "9781439106518", Edition: "EBOOK" }],
        },
      ],
      { exclusions: HOPKINS_EXCLUSIONS },
    );

    expect(payload.stats.skippedExcludedRows).toBe(4);
    expect(payload.titles.map((title) => title.title).sort()).toEqual(["Crankenstein", "Glass slippers", "Impulse"]);
    expect(payload.titles.every((title) => title.posted !== false)).toBe(true);
    expect(payload.titles.find((title) => titleKey(title.title) === "crank")).toBeUndefined();
    expect(payload.titles.find((title) => titleKey(title.title) === "glass")).toBeUndefined();
  });

  it("does not treat Follett-only Crank/Glass holdings as posted", () => {
    const posted = buildCollection(
      [
        rows([
          { Title: "Crank", Author: "Ellen Hopkins", ISBN: "9781416905080", "Source Batch": "Sep 2025" },
          { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
        ]),
      ],
      { exclusions: HOPKINS_EXCLUSIONS },
    );
    const ingested = ingestFollettRows([
      { Author: "Hopkins, Ellen.", ISBN: "9781439106518", "Material Type": "eBook", "Series Title": "Crank." },
      { Author: "Hopkins, Ellen.", ISBN: "9781416940906", "Material Type": "Book", "Series Title": "Glass." },
      { Author: "Hopkins, Ellen.", ISBN: "9781442471818", "Material Type": "Sound", "Series Title": "Crank." },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.titles.map((title) => title.title)).toEqual(["Harbor Lights"]);
    expect(posted.titles[0].posted).not.toBe(false);
    expect(compact.n).toBe(3);
    expect(posted.stats.holdingsLinkedToPosted).toBe(0);
  });

  it("loads the checked-in exclusions file for Crank and Glass by Ellen Hopkins", () => {
    const loaded = loadPostedExclusions(join(process.cwd(), "data", "exclusions.json"));
    expect(loaded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Crank", author: "Ellen Hopkins" }),
        expect.objectContaining({ title: "Glass", author: "Ellen Hopkins" }),
      ]),
    );
    expect(loaded).toHaveLength(2);
  });

  it("honors exclusions when reading a real posted spreadsheet", () => {
    const dir = mkdtempSync(join(tmpdir(), "misd-exclude-"));
    const file = join(dir, "posted.xlsx");
    const sheet = XLSX.utils.json_to_sheet([
      { Title: "Crank", Author: "Ellen Hopkins", ISBN: "9781416905080", "Source Batch": "Sep 2025" },
      { Title: "Glass", Author: "Hopkins, Ellen", ISBN: "9781416940906", "Source Batch": "Oct 2025" },
      { Title: "Impulse", Author: "Hopkins, Ellen", ISBN: "9781416903567", "Source Batch": "Nov 2025" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Master List");
    XLSX.writeFile(wb, file);
    const payload = buildCollectionFromFiles([file], { exclusions: HOPKINS_EXCLUSIONS });
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles[0].title).toBe("Impulse");
    expect(payload.stats.skippedExcludedRows).toBe(2);
  });
});

describe("Follett Sound/Recording audiobooks", () => {
  it("unions an audiobook ISBN onto an existing titled card and marks Audio", () => {
    const posted = buildCollection([
      rows([
        {
          Title: "Don't trust fish",
          Author: "Sharpson, Neil",
          ISBN: "9780593616673",
          "Source Batch": "Sep 2025",
          Level: "Elementary",
        },
      ]),
    ]);
    const ingested = ingestFollettRows([
      { Author: "Sharpson, Neil", ISBN: "978-0-593-61667-3", "Material Type": "Book", "Series Title": "" },
      { Author: "Sharpson, Neil", ISBN: "9780593616999", "Material Type": "Sound", "Series Title": "Don't Trust Fish" },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.uniqueTitleCount).toBe(1);
    const title = posted.titles[0];
    expect(title.title).toBe("Don't trust fish");
    expect(title.titleUnknown).toBeFalsy();
    expect(title.formats.book).toBe(true);
    expect(title.formats.audio).toBe(true);
    expect(title.isbnDigits).toEqual(expect.arrayContaining(["9780593616673", "9780593616999"]));
    expect(title.inCollection).toBe(true);
    expect(compact.n).toBe(0);
  });

  it("keeps an audio-only ISBN searchable as In collection when no book/ebook counterpart exists", () => {
    const posted = buildCollection([
      rows([{ Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" }]),
    ]);
    const ingested = ingestFollettRows([
      { Author: "Someone, A", ISBN: "0-8072-1026-9", "Material Type": "Sound", "Series Title": "" },
      { Author: "Skip", ISBN: "9780000000000", "Material Type": "Video" },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.uniqueTitleCount).toBe(1);
    expect(posted.titles[0].formats.audio).toBe(false);
    expect(posted.titles[0].isbnDigits).not.toContain("9780807210260");
    expect(compact.n).toBe(1);
    expect(String(compact.r[0][0])).toBe("9780807210260");
    expect(compact.r[0][3] & FOLLETT_FORMAT.audio).toBeTruthy();
    expect(compact.r[0][3] & FOLLETT_FORMAT.book).toBeFalsy();
  });

  it("does not create a second titled card when Sound and Book share a normalized title", () => {
    const payload = buildCollection([
      rows([{ Title: "The Last Kids on Earth", Author: "Brallier, Max", ISBN: "9780425287378", "Source Batch": "Sep 2025" }]),
      {
        filePath: "follett.xlsx",
        label: "follett.xlsx",
        kind: "follett",
        rows: [
          { Author: "Brallier, Max.", ISBN: "9780525495581", "Material Type": "Sound", "Series Title": "The Last Kids on Earth." },
          { Author: "Brallier, Max.", ISBN: "9780525495628", "Material Type": "Recording", "Series Title": "The Last Kids on Earth" },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    expect(payload.titles.filter((title) => titleKey(title.title) === "last kids on earth")).toHaveLength(1);
    expect(payload.titles[0].formats.audio).toBe(true);
    expect(payload.titles[0].isbnDigits).toEqual(
      expect.arrayContaining(["9780425287378", "9780525495581", "9780525495628"]),
    );
  });

  it("ORs Audio onto an existing Book ISBN instead of a second holdings record", () => {
    const ingested = ingestFollettRows([
      { Author: "A", ISBN: "9781111111111", "Material Type": "Book" },
      { Author: "A", ISBN: "9781111111111", "Material Type": "Sound" },
    ]);
    expect(ingested.accepted).toBe(2);
    expect(ingested.byIsbn.size).toBe(1);
    expect(ingested.byIsbn.get("9781111111111")?.format).toBe(FOLLETT_FORMAT.book | FOLLETT_FORMAT.audio);
  });

  it("ingests Sound and Recording and still skips Video/Kit", () => {
    const ingested = ingestFollettRows([
      { Author: "A", ISBN: "9781111111111", "Material Type": "Book" },
      { Author: "B", ISBN: "9782222222222", "Material Type": "Sound" },
      { Author: "C", ISBN: "9783333333333", "Material Type": "Recording" },
      { Author: "D", ISBN: "9784444444444", "Material Type": "Video" },
      { Author: "E", ISBN: "9785555555555", "Material Type": "Kit" },
      { Author: "F", ISBN: "", "Material Type": "Sound" },
    ]);
    expect(ingested.accepted).toBe(3);
    expect(ingested.skippedType).toBe(2);
    expect(ingested.skippedNoIsbn).toBe(1);
    expect(ingested.byIsbn.get("9782222222222")?.format).toBe(FOLLETT_FORMAT.audio);
    expect(ingested.byIsbn.get("9783333333333")?.format).toBe(FOLLETT_FORMAT.audio);
  });
});
