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
  isHiddenFromDesk,
  isSoraStaffOnly,
  loadPostedExclusions,
  pickFollettSources,
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
    expect(titleKey("13 Little Blue Envelopes (unabridged)")).toBe("13 little blue envelopes");
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

const HANDMAID_EXCLUSIONS = [{ title: "The Handmaid's Tale", author: "Margaret Atwood" }];
const HANDMAID_DESK_EXCLUSIONS = [{ title: "The Handmaid's Tale", author: "Margaret Atwood", hideFromDesk: true }];

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

  it("loads the checked-in exclusions file for Crank, Glass, The Handmaid's Tale, and the challenge list", () => {
    const loaded = loadPostedExclusions(join(process.cwd(), "data", "exclusions.json"));
    expect(loaded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Crank", author: "Ellen Hopkins", hideFromDesk: false, matchAuthor: false }),
        expect.objectContaining({ title: "Glass", author: "Ellen Hopkins", hideFromDesk: false, matchAuthor: false }),
        expect.objectContaining({ title: "The Handmaid's Tale", author: "Margaret Atwood", hideFromDesk: true, matchAuthor: false }),
        expect.objectContaining({ title: "Forever", author: "Judy Blume", hideFromDesk: true, matchAuthor: true }),
        expect.objectContaining({ title: "Hush", author: "Eishes Chayil", hideFromDesk: true, matchAuthor: true }),
        expect.objectContaining({ title: "Lessons in Chemistry", author: "Bonnie Garmus", hideFromDesk: true }),
        expect.objectContaining({ title: "The Lovely Bones", author: "Alice Sebold", hideFromDesk: true }),
        expect.objectContaining({ title: "Water for Elephants", author: "Sara Gruen", hideFromDesk: true }),
        expect.objectContaining({ title: "Black Butler", author: "Yana Toboso", hideFromDesk: true, matchAuthor: true }),
        expect.objectContaining({ title: "Inuyasha", author: "Rumiko Takahashi", hideFromDesk: true, matchAuthor: true }),
        expect.objectContaining({ title: "Pet Shop of Horrors", author: "Matsuri Akino", hideFromDesk: true, matchAuthor: true }),
        expect.objectContaining({ title: "Running with Scissors", author: "Augusten Burroughs", hideFromDesk: true }),
        expect.objectContaining({ title: "City on Fire", author: "Don Winslow", hideFromDesk: true, matchAuthor: true }),
      ]),
    );
    expect(loaded.length).toBeGreaterThan(60);
    expect(loaded.filter((item) => item.title === "Crank" || item.title === "Glass").every((item) => !item.hideFromDesk)).toBe(
      true,
    );
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

  it("matches The Handmaid's Tale title variants with Margaret Atwood author orderings", () => {
    expect(isExcludedPostedTitle("The Handmaid's Tale", "Atwood, Margaret", HANDMAID_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("Handmaid's Tale", "Margaret Atwood", HANDMAID_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("THE HANDMAID'S TALE", "ATWOOD, MARGARET.", HANDMAID_EXCLUSIONS)).toBe(true);
    expect(isExcludedPostedTitle("The Handmaid’s Tale", "Atwood, Margaret, 1939-", HANDMAID_EXCLUSIONS)).toBe(true);
  });

  it("does not match other Margaret Atwood titles or other Handmaid books", () => {
    expect(isExcludedPostedTitle("The Testaments", "Atwood, Margaret", HANDMAID_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Oryx and Crake", "Margaret Atwood", HANDMAID_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("The Handmaid's Tale", "Nault, Renee", HANDMAID_EXCLUSIONS)).toBe(false);
    expect(isExcludedPostedTitle("Women Heroes of World War II", "Atwood, Kathryn J.", HANDMAID_EXCLUSIONS)).toBe(false);
  });

  it("drops excluded Handmaid's Tale posted rows so a later import cannot restore them as approved", () => {
    const payload = buildCollection(
      [
        rows([
          {
            Title: "The Handmaid's Tale",
            Author: "Atwood, Margaret",
            ISBN: "9780385490818",
            "Source Batch": "Sep 2025",
            Level: "High",
          },
          {
            Title: "HANDMAID'S TALE",
            Author: "Margaret Atwood",
            ISBN: "9780547345666",
            "Source Batch": "All Campuses",
            Level: "High",
          },
          {
            Title: "The Testaments",
            Author: "Atwood, Margaret",
            ISBN: "9780525565697",
            "Source Batch": "Oct 2025",
            Level: "High",
          },
        ]),
        {
          filePath: "ebook-list-A.xlsx",
          label: "ebook-list-A.xlsx",
          kind: "ebook-order",
          rows: [{ Title: "THE HANDMAID'S TALE", Author: "ATWOOD, MARGARET", ISBN: "9780385490999", Edition: "EBOOK" }],
        },
      ],
      { exclusions: HANDMAID_EXCLUSIONS },
    );

    expect(payload.stats.skippedExcludedRows).toBe(3);
    expect(payload.titles.map((title) => title.title)).toEqual(["The Testaments"]);
    expect(payload.titles.find((title) => titleKey(title.title) === "handmaid s tale")).toBeUndefined();
  });

  it("does not treat Follett-only Handmaid's Tale holdings as posted", () => {
    const posted = buildCollection(
      [
        rows([
          { Title: "The Handmaid's Tale", Author: "Margaret Atwood", ISBN: "9780385490818", "Source Batch": "Sep 2025" },
          { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
        ]),
      ],
      { exclusions: HANDMAID_EXCLUSIONS },
    );
    const ingested = ingestFollettRows([
      {
        Author: "Atwood, Margaret.",
        ISBN: "9780385490818",
        "Material Type": "Book",
        "Title/Subtitle": "The Handmaid's Tale",
      },
      {
        Author: "Atwood, Margaret.",
        ISBN: "9780547345666",
        "Material Type": "eBook",
        "Title/Subtitle": "Handmaid's Tale",
      },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.titles.map((title) => title.title)).toEqual(["Harbor Lights"]);
    expect(posted.titles[0].posted).not.toBe(false);
    expect(compact.n).toBe(1);
    expect(titleKey(compact.s[compact.r[0][2]])).toBe("handmaid s tale");
    expect(posted.stats.holdingsLinkedToPosted).toBe(0);
  });

  it("matches hideFromDesk on the novel title and longer titles that start with it", () => {
    expect(isHiddenFromDesk("The Handmaid's Tale", HANDMAID_DESK_EXCLUSIONS)).toBe(true);
    expect(isHiddenFromDesk("HANDMAID'S TALE", HANDMAID_DESK_EXCLUSIONS)).toBe(true);
    expect(isHiddenFromDesk("The handmaid's tale, by Margaret Atwood", HANDMAID_DESK_EXCLUSIONS)).toBe(true);
    expect(isHiddenFromDesk("The Testaments", HANDMAID_DESK_EXCLUSIONS)).toBe(false);
    expect(isHiddenFromDesk("Oryx and Crake", HANDMAID_DESK_EXCLUSIONS)).toBe(false);
    expect(isHiddenFromDesk("Glory O'Brien's history of the future", HANDMAID_DESK_EXCLUSIONS)).toBe(false);
    expect(isHiddenFromDesk("The Handmaid's Tale", HANDMAID_EXCLUSIONS)).toBe(false);
    expect(isHiddenFromDesk("Crank", HOPKINS_EXCLUSIONS)).toBe(false);
  });

  const FOREVER_DESK_EXCLUSIONS = [{ title: "Forever", author: "Judy Blume", hideFromDesk: true, matchAuthor: true }];
  const HUSH_DESK_EXCLUSIONS = [{ title: "Hush", author: "Eishes Chayil", hideFromDesk: true, matchAuthor: true }];
  const INUYASHA_DESK_EXCLUSIONS = [
    {
      title: "Inuyasha",
      author: "Rumiko Takahashi",
      hideFromDesk: true,
      matchAuthor: true,
      aliases: ["Inu Yasha", "Inu-Yasha", "InuYasha"],
    },
  ];
  const PET_SHOP_DESK_EXCLUSIONS = [
    {
      title: "Pet Shop of Horrors",
      author: "Matsuri Akino",
      hideFromDesk: true,
      matchAuthor: true,
      aliases: ["Pet Shop of Horrors Tokyo"],
    },
  ];

  it("matchAuthor hideFromDesk peels Judy Blume Forever without hiding Maggie Stiefvater", () => {
    expect(isHiddenFromDesk("Forever", FOREVER_DESK_EXCLUSIONS, "Blume, Judy.")).toBe(true);
    expect(isHiddenFromDesk("Forever-- : a novel", FOREVER_DESK_EXCLUSIONS, "Judy Blume")).toBe(true);
    expect(isHiddenFromDesk("Forever", FOREVER_DESK_EXCLUSIONS, "Stiefvater, Maggie, 1981-")).toBe(false);
    expect(isHiddenFromDesk("Forever in Blue", FOREVER_DESK_EXCLUSIONS, "Brashares, Ann")).toBe(false);
  });

  it("matchAuthor hideFromDesk peels Eishes Chayil Hush without hiding Woodson or Melki-Wegner", () => {
    expect(isHiddenFromDesk("Hush", HUSH_DESK_EXCLUSIONS, "Chayil, Eishes.")).toBe(true);
    expect(isHiddenFromDesk("Hush", HUSH_DESK_EXCLUSIONS, "Woodson, Jacqueline.")).toBe(false);
    expect(isHiddenFromDesk("The Hush", HUSH_DESK_EXCLUSIONS, "Melki-Wegner, Skye,")).toBe(false);
    expect(isHiddenFromDesk("Hush, hush", HUSH_DESK_EXCLUSIONS, "Fitzpatrick, Becca")).toBe(false);
  });

  it("series aliases hide Inuyasha / Inu Yasha volumes by Rumiko Takahashi only", () => {
    expect(isHiddenFromDesk("Inuyasha. 1", INUYASHA_DESK_EXCLUSIONS, "Takahashi, Rumiko")).toBe(true);
    expect(isHiddenFromDesk("Inu Yasha. 10", INUYASHA_DESK_EXCLUSIONS, "Takahashi, Rumiko, 1957-")).toBe(true);
    expect(isHiddenFromDesk("Inu-Yasha : turning back time / Vol. 1.", INUYASHA_DESK_EXCLUSIONS, "Takahashi, Rumiko, 1957-")).toBe(
      true,
    );
    expect(isHiddenFromDesk("InuYasha. Volume 12", INUYASHA_DESK_EXCLUSIONS, "Takahashi, Rumiko")).toBe(true);
  });

  it("does not hide Pet Shop Racers or Cinderella picture books or Crankenstein", () => {
    const pet = [{ title: "Pet", author: "Akwaeke Emezi", hideFromDesk: true, matchAuthor: true }];
    const cinderella = [{ title: "Cinderella Is Dead", author: "Kalynn Bayron", hideFromDesk: true }];
    expect(isHiddenFromDesk("Pet Shop Racers Need Fur Speed", pet, "Jennings, C. S")).toBe(false);
    expect(isHiddenFromDesk("Pet", pet, "Emezi, Akwaeke,")).toBe(true);
    expect(isHiddenFromDesk("Cinderella", cinderella, "Perrault, Charles")).toBe(false);
    expect(isHiddenFromDesk("Cinderella is dead", cinderella, "Bayron, Kalynn.")).toBe(true);
    expect(isHiddenFromDesk("Crankenstein", HOPKINS_EXCLUSIONS, "Samantha Berger")).toBe(false);
    expect(isHiddenFromDesk("Pet shop of horrors : Tokyo. Volume 1", PET_SHOP_DESK_EXCLUSIONS, "Akino, Matsuri.")).toBe(true);
    expect(isHiddenFromDesk("Pet shop racers. 1", PET_SHOP_DESK_EXCLUSIONS, "Jennings, C. S")).toBe(false);
  });

  it("drops Blume Forever holdings from a merged Forever card and keeps Stiefvater", () => {
    const payload = buildCollection(
      [
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            {
              TitleID: 1,
              Title: "Forever",
              Creator: "Stiefvater, Maggie",
              ISBN: "9781338247206",
              Format: "Audiobook",
              "Content access levels": "Middle School",
            },
            {
              TitleID: 2,
              Title: "Forever",
              Creator: "Blume, Judy",
              ISBN: "9781481414432",
              Format: "Ebook",
              "Content access levels": "High School",
            },
          ],
        },
      ],
      { exclusions: FOREVER_DESK_EXCLUSIONS },
    );
    const ingested = ingestFollettRows(
      [
        {
          Author: "Blume, Judy.",
          ISBN: "978-1-48141443-2",
          "Material Type": "Book",
          "Title/Subtitle": "Forever--",
        },
        {
          Author: "Stiefvater, Maggie, 1981-",
          ISBN: "978-0-545-25908-8",
          "Material Type": "Book",
          "Title/Subtitle": "Forever",
        },
      ],
      { exclusions: FOREVER_DESK_EXCLUSIONS },
    );
    attachHoldingsToCollection(payload, ingested, { exclusions: FOREVER_DESK_EXCLUSIONS });
    const forever = payload.titles.find((title) => titleKey(title.title) === "forever");
    expect(forever).toBeTruthy();
    expect(forever.authors.some((author) => /stiefvater/i.test(author))).toBe(true);
    expect(forever.authors.some((author) => /blume/i.test(author))).toBe(false);
    expect(forever.isbnDigits).toContain("9781338247206");
    expect(forever.isbnDigits).toContain("9780545259088");
    expect(forever.isbnDigits).not.toContain("9781481414432");
    expect(ingested.byIsbn.has("9781481414432")).toBe(false);
  });

  it("drops Chayil Hush holdings and leaves a non-Chayil Hush card", () => {
    const payload = buildCollection(
      [
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            {
              TitleID: 1,
              Title: "Hush",
              Creator: "Chayil, Eishes",
              ISBN: "9780802722706",
              Format: "Ebook",
              "Content access levels": "High School",
            },
            {
              TitleID: 2,
              Title: "Hush",
              Creator: "Woodson, Jacqueline",
              ISBN: "9780142500491",
              Format: "Ebook",
              "Content access levels": "Middle School",
            },
          ],
        },
      ],
      { exclusions: HUSH_DESK_EXCLUSIONS },
    );
    expect(payload.titles.filter((title) => titleKey(title.title) === "hush")).toHaveLength(1);
    const hush = payload.titles.find((title) => titleKey(title.title) === "hush");
    expect(hush.authors.some((author) => /woodson/i.test(author))).toBe(true);
    expect(hush.authors.some((author) => /chayil/i.test(author))).toBe(false);
    expect(hush.isbnDigits).toContain("9780142500491");
    expect(hush.isbnDigits).not.toContain("9780802722706");
  });

  it("drops hideFromDesk holdings so they never become In collection cards", () => {
    const payload = buildCollection(
      [
        rows([
          {
            Title: "The Handmaid's Tale",
            Author: "Margaret Atwood",
            ISBN: "9780385490818",
            "Source Batch": "Sep 2025",
          },
          {
            Title: "The Testaments",
            Author: "Atwood, Margaret",
            ISBN: "9780525565697",
            "Source Batch": "Oct 2025",
          },
          { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
        ]),
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            {
              TitleID: 1,
              Title: "The Handmaid's Tale",
              Creator: "Atwood, Margaret",
              ISBN: "9780547345666",
              Format: "Ebook",
              "Content access levels": "High School",
            },
            {
              TitleID: 2,
              Title: "The Testaments",
              Creator: "Atwood, Margaret",
              ISBN: "9780525590484",
              Format: "Ebook",
              "Content access levels": "High School",
            },
          ],
        },
      ],
      { exclusions: HANDMAID_DESK_EXCLUSIONS },
    );
    const ingested = ingestFollettRows(
      [
        {
          Author: "Atwood, Margaret.",
          ISBN: "9780385490818",
          "Material Type": "Book",
          "Title/Subtitle": "The Handmaid's Tale",
        },
        {
          Author: "Atwood, Margaret.",
          ISBN: "9780547345666",
          "Material Type": "eBook",
          "Title/Subtitle": "The handmaid's tale",
        },
        {
          Author: "Weber, Valerie.",
          ISBN: "9781510537033",
          "Material Type": "eBook",
          "Title/Subtitle": "The handmaid's tale",
        },
        {
          Author: "editor, J. Brooks Bouson.",
          ISBN: "9781587656217",
          "Material Type": "eBook",
          "Title/Subtitle": "The handmaid's tale, by Margaret Atwood",
        },
        {
          Author: "Atwood, Margaret, 1939-",
          ISBN: "9780385543781",
          "Material Type": "Book",
          "Title/Subtitle": "The testaments",
        },
      ],
      { exclusions: HANDMAID_DESK_EXCLUSIONS },
    );
    const compact = attachHoldingsToCollection(payload, ingested, { exclusions: HANDMAID_DESK_EXCLUSIONS });

    expect(payload.titles.find((title) => titleKey(title.title) === "handmaid s tale")).toBeUndefined();
    expect(payload.titles.some((title) => titleKey(title.title).startsWith("handmaid s tale"))).toBe(false);
    expect(payload.titles.find((title) => titleKey(title.title) === "testaments")?.inCollection).toBe(true);
    expect(payload.titles.find((title) => title.title === "Harbor Lights")).toBeTruthy();
    expect(ingested.byIsbn.has("9780385490818")).toBe(false);
    expect(ingested.byIsbn.has("9780547345666")).toBe(false);
    expect(ingested.byIsbn.has("9781510537033")).toBe(false);
    expect(ingested.byIsbn.has("9781587656217")).toBe(false);
    expect(ingested.skippedHidden).toBe(4);
    for (const row of compact.r) {
      expect(titleKey(compact.s[row[2]]).startsWith("handmaid s tale")).toBe(false);
    }
  });

  it("drops a Sora-only Handmaid's Tale card when hideFromDesk is set", () => {
    const payload = buildCollection(
      [
        rows([{ Title: "Impulse", Author: "Hopkins, Ellen", ISBN: "9781416903567", "Source Batch": "Nov 2025" }]),
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            {
              TitleID: 1,
              Title: "The Handmaid's Tale",
              Creator: "Atwood, Margaret",
              ISBN: "9780385490818",
              Format: "Ebook",
              "Content access levels": "High School",
            },
          ],
        },
      ],
      { exclusions: HANDMAID_DESK_EXCLUSIONS },
    );
    expect(payload.titles.find((title) => titleKey(title.title) === "handmaid s tale")).toBeUndefined();
    expect(payload.stats.skippedExcludedRows).toBe(1);
    expect(payload.titles.find((title) => title.title === "Impulse")?.posted).not.toBe(false);
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

describe("Sora export", () => {
  it("unions a Sora ebook ISBN onto an existing posted title and does not create a duplicate card", () => {
    const payload = buildCollection([
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
        filePath: "Sora-titles.xlsx",
        label: "Sora-titles.xlsx",
        kind: "sora",
        rows: [
          {
            TitleID: 1,
            Title: "Don't Trust Fish!",
            Creator: "Sharpson, Neil",
            ISBN: "9780593616680",
            Format: "Ebook",
            "Audience/Rating": "Juvenile Fiction",
            "Content access levels": "Elementary",
          },
          {
            TitleID: 2,
            Title: "Don't Trust Fish! (unabridged)",
            Creator: "Sharpson, Neil",
            ISBN: "9780593616999",
            Format: "Audiobook",
            "Audience/Rating": "Juvenile Fiction",
            "Content access levels": "Elementary",
          },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    const title = payload.titles[0];
    expect(titleKey(title.title)).toBe("don t trust fish");
    expect(title.title).toBe("Don't trust fish");
    expect(title.formats.ebook).toBe(true);
    expect(title.formats.audio).toBe(true);
    expect(title.isbnDigits).toEqual(expect.arrayContaining(["9780593616673", "9780593616680", "9780593616999"]));
    expect(title.inCollection).toBe(true);
    expect(title.posted).toBe(true);
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "Sora 2026-09-16"]));
    expect(title.holdingsBatches).toEqual(["Sora 2026-09-16"]);
    expect(title.levels).toEqual(["Elementary"]);
    expect(title.audiences).toContain("Juvenile Fiction");
  });

  it("creates a searchable Sora-only row when the title is not already on a card", () => {
    const payload = buildCollection([
      rows([{ Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" }]),
      {
        filePath: "Sora-titles.xlsx",
        label: "Sora-titles.xlsx",
        kind: "sora",
        rows: [
          {
            TitleID: 9,
            Title: "Sora Only Adventure",
            Creator: "Lee, Pat",
            ISBN: "9781234567897",
            Format: "Ebook",
            "Content access levels": "Middle School",
          },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(2);
    const sora = payload.titles.find((title) => title.title === "Sora Only Adventure");
    expect(sora?.posted).toBe(false);
    expect(sora?.inCollection).toBe(true);
    expect(sora?.formats.ebook).toBe(true);
    expect(sora?.levels).toEqual(["Middle"]);
    expect(sora?.batches).toEqual(["Sora 2026-09-16"]);
  });

  it("skips Magazine/NTC rows and still honors Crank/Glass posted exclusions", () => {
    const payload = buildCollection(
      [
        rows([{ Title: "Impulse", Author: "Hopkins, Ellen", ISBN: "9781416903567", "Source Batch": "Nov 2025" }]),
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            { TitleID: 1, Title: "Crank", Creator: "Hopkins, Ellen", ISBN: "9781416905080", Format: "Ebook", "Content access levels": "High School" },
            { TitleID: 2, Title: "Hola Ninos", Creator: "", ISBN: "", Format: "Magazine", "Content access levels": "Elementary" },
            { TitleID: 3, Title: "Weird NTC", Creator: "A", ISBN: "9781111111111", Format: "NTC" },
          ],
        },
      ],
      { exclusions: [{ title: "Crank", author: "Ellen Hopkins" }] },
    );
    expect(payload.titles.map((title) => title.title).sort()).toEqual(["Crank", "Impulse"]);
    const crank = payload.titles.find((title) => title.title === "Crank");
    expect(crank?.posted).toBe(false);
    expect(crank?.inCollection).toBe(true);
    expect(crank?.formats.ebook).toBe(true);
    expect(payload.titles.find((title) => /hola/i.test(title.title))).toBeUndefined();
  });

  it("keeps a Sora-only Handmaid's Tale card as In collection, not posted", () => {
    const payload = buildCollection(
      [
        rows([{ Title: "Impulse", Author: "Hopkins, Ellen", ISBN: "9781416903567", "Source Batch": "Nov 2025" }]),
        {
          filePath: "Sora-titles.xlsx",
          label: "Sora-titles.xlsx",
          kind: "sora",
          rows: [
            {
              TitleID: 1,
              Title: "The Handmaid's Tale",
              Creator: "Atwood, Margaret",
              ISBN: "9780385490818",
              Format: "Ebook",
              "Content access levels": "High School",
            },
          ],
        },
      ],
      { exclusions: HANDMAID_EXCLUSIONS },
    );
    const handmaid = payload.titles.find((title) => titleKey(title.title) === "handmaid s tale");
    expect(handmaid?.posted).toBe(false);
    expect(handmaid?.inCollection).toBe(true);
    expect(handmaid?.formats.ebook).toBe(true);
    expect(payload.titles.find((title) => title.title === "Impulse")?.posted).not.toBe(false);
  });

  it("detects a Sora workbook and does not duplicate a matching posted title", () => {
    const dir = mkdtempSync(join(tmpdir(), "misd-sora-"));
    const postedFile = join(dir, "posted.xlsx");
    const soraFile = join(dir, "Sora-titles.xlsx");
    const postedSheet = XLSX.utils.json_to_sheet([
      { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
    ]);
    const postedWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(postedWb, postedSheet, "Master List");
    XLSX.writeFile(postedWb, postedFile);

    const soraSheet = XLSX.utils.json_to_sheet([
      {
        TitleID: 10,
        Title: "Harbor Lights",
        Creator: "Ng, C",
        ISBN: "9788888888888",
        Format: "Ebook",
        "Audience/Rating": "Young Adult Fiction",
        "Content access levels": "High School",
        Owned: 1,
        Subscription: "No",
      },
      {
        TitleID: 11,
        Title: "Sora Solo",
        Creator: "Solo, A",
        ISBN: "9789999999999",
        Format: "Audiobook",
        "Content access levels": "Elementary",
        Owned: 1,
        Subscription: "No",
      },
      {
        TitleID: 12,
        Title: "Skip Mag",
        Creator: "",
        ISBN: "",
        Format: "Magazine",
        "Content access levels": "Elementary",
        Owned: "Subscription",
        Subscription: "Yes",
      },
    ]);
    const soraWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(soraWb, soraSheet, "Title status & usage 2026-09-16");
    XLSX.writeFile(soraWb, soraFile);

    const catalog = buildCatalogFromFiles([postedFile, soraFile]);
    expect(catalog.collection.uniqueTitleCount).toBe(2);
    const harbor = catalog.collection.titles.find((title) => title.title === "Harbor Lights");
    expect(harbor?.isbnDigits).toEqual(expect.arrayContaining(["9787777777777", "9788888888888"]));
    expect(harbor?.formats.ebook).toBe(true);
    expect(harbor?.inCollection).toBe(true);
    const solo = catalog.collection.titles.find((title) => title.title === "Sora Solo");
    expect(solo?.formats.audio).toBe(true);
    expect(solo?.posted).toBe(false);
  });

  it("treats Staff Only (case-insensitive, including mixed access-level lists) as staff-only", () => {
    expect(isSoraStaffOnly("Staff Only")).toBe(true);
    expect(isSoraStaffOnly("staff only")).toBe(true);
    expect(isSoraStaffOnly("STAFF ONLY")).toBe(true);
    expect(isSoraStaffOnly("High School, Staff Only")).toBe(true);
    expect(isSoraStaffOnly("Staff Only; Elementary")).toBe(true);
    expect(isSoraStaffOnly("Elementary")).toBe(false);
    expect(isSoraStaffOnly("High School")).toBe(false);
    expect(isSoraStaffOnly("Middle School")).toBe(false);
  });

  it("skips Staff Only Sora rows and still imports Elementary/High School Sora titles", () => {
    const payload = buildCollection([
      {
        filePath: "Sora-titles.xlsx",
        label: "Sora-titles.xlsx",
        kind: "sora",
        rows: [
          {
            TitleID: 1,
            Title: "Dungeon Crawler Carl",
            Creator: "Dinniman, Matt",
            ISBN: "9798232923594",
            Format: "Ebook",
            "Content access levels": "Staff Only",
          },
          {
            TitleID: 2,
            Title: "STAFF ONLY AUDIO",
            Creator: "Hidden, A",
            ISBN: "9780001111111",
            Format: "Audiobook",
            "Content access levels": "staff only",
          },
          {
            TitleID: 3,
            Title: "Mixed Access Skip",
            Creator: "Skip, Me",
            ISBN: "9780002222222",
            Format: "Ebook",
            "Content access levels": "High School, Staff Only",
          },
          {
            TitleID: 4,
            Title: "1984",
            Creator: "Orwell, George",
            ISBN: "9780547249643",
            Format: "Ebook",
            "Content access levels": "High School",
          },
          {
            TitleID: 5,
            Title: "#Goldilocks: A Hashtag Cautionary Tale",
            Creator: "Willis, Jeanne",
            ISBN: "9781787611597",
            Format: "Ebook",
            "Content access levels": "Elementary",
          },
        ],
      },
    ]);
    expect(payload.titles.find((title) => title.title === "Dungeon Crawler Carl")).toBeUndefined();
    expect(payload.titles.find((title) => title.isbnDigits.includes("9798232923594"))).toBeUndefined();
    expect(payload.titles.find((title) => title.isbnDigits.includes("9780001111111"))).toBeUndefined();
    expect(payload.titles.find((title) => title.title === "Mixed Access Skip")).toBeUndefined();
    const campusHigh = payload.titles.find((title) => title.title === "1984");
    expect(campusHigh?.inCollection).toBe(true);
    expect(campusHigh?.posted).toBe(false);
    expect(campusHigh?.batches).toEqual(["Sora 2026-09-16"]);
    expect(campusHigh?.levels).toEqual(["High"]);
    expect(campusHigh?.isbnDigits).toContain("9780547249643");
    const campusElem = payload.titles.find((title) => title.title.includes("Goldilocks"));
    expect(campusElem?.inCollection).toBe(true);
    expect(campusElem?.levels).toEqual(["Elementary"]);
    expect(campusElem?.isbnDigits).toContain("9781787611597");
  });

  it("keeps a posted/Follett card and drops only the Staff Only Sora ISBN", () => {
    const payload = buildCollection([
      rows([
        {
          Title: "Circe",
          Author: "Miller, Madeline",
          ISBN: "9780316556330",
          "Source Batch": "Sep 2025",
          Level: "High",
        },
      ]),
      {
        filePath: "Sora-titles.xlsx",
        label: "Sora-titles.xlsx",
        kind: "sora",
        rows: [
          {
            TitleID: 1,
            Title: "Circe",
            Creator: "Miller, Madeline",
            ISBN: "9781478975311",
            Format: "Audiobook",
            "Content access levels": "Staff Only",
          },
          {
            TitleID: 2,
            Title: "Circe",
            Creator: "Miller, Madeline",
            ISBN: "9780547249999",
            Format: "Ebook",
            "Content access levels": "High School",
          },
        ],
      },
    ]);
    expect(payload.uniqueTitleCount).toBe(1);
    const title = payload.titles[0];
    expect(title.title).toBe("Circe");
    expect(title.posted).toBe(true);
    expect(title.inCollection).toBe(true);
    expect(title.isbnDigits).toContain("9780316556330");
    expect(title.isbnDigits).toContain("9780547249999");
    expect(title.isbnDigits).not.toContain("9781478975311");
    expect(title.batches).toEqual(expect.arrayContaining(["Sep 2025", "Sora 2026-09-16"]));
    expect(title.formats.ebook).toBe(true);
    expect(title.formats.audio).toBe(false);
  });
});

describe("titled Follett district report", () => {
  it("uses Title/Subtitle as the real title instead of Series Title", () => {
    const ingested = ingestFollettRows([
      {
        Author: "Lowry, Lois",
        ISBN: "9780544336261",
        "Material Type": "Book",
        "Series Title": "Giver Quartet",
        "Title/Subtitle": "The Giver",
      },
    ]);
    expect(ingested.byIsbn.get("9780544336261")?.title).toBe("The Giver");
    expect(ingested.byIsbn.get("9780544336261")?.series).toBe("Giver Quartet");
    expect(ingested.titled).toBe(1);
  });

  it("attaches a titled Follett ISBN onto an existing posted card by normalized title", () => {
    const posted = buildCollection([
      rows([{ Title: "The Giver", Author: "Lowry, Lois", ISBN: "9780385732550", "Source Batch": "Sep 2025" }]),
    ]);
    const ingested = ingestFollettRows([
      {
        Author: "Lowry, Lois",
        ISBN: "9780544336261",
        "Material Type": "Book",
        "Series Title": "Giver Quartet",
        "Title/Subtitle": "Giver",
      },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.uniqueTitleCount).toBe(1);
    expect(posted.titles[0].isbnDigits).toEqual(expect.arrayContaining(["9780385732550", "9780544336261"]));
    expect(posted.titles[0].inCollection).toBe(true);
    expect(compact.n).toBe(0);
  });

  it("groups leftover titled rows onto one compact card with every ISBN", () => {
    const posted = buildCollection([
      rows([{ Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" }]),
    ]);
    const ingested = ingestFollettRows([
      { Author: "A", ISBN: "9781111111111", "Material Type": "Book", "Title/Subtitle": "The Giver" },
      { Author: "A", ISBN: "9782222222222", "Material Type": "eBook", "Title/Subtitle": "Giver" },
      { Author: "A", ISBN: "9783333333333", "Material Type": "Sound", "Title/Subtitle": "The Giver!" },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(compact.n).toBe(1);
    expect(titleKey(compact.s[compact.r[0][2]])).toBe("giver");
    const extras = compact.x?.[0] || [];
    const isbns = [String(compact.r[0][0]), ...extras.map(String)];
    expect(isbns).toEqual(expect.arrayContaining(["9781111111111", "9782222222222", "9783333333333"]));
    expect(compact.r[0][3] & FOLLETT_FORMAT.book).toBeTruthy();
    expect(compact.r[0][3] & FOLLETT_FORMAT.ebook).toBeTruthy();
    expect(compact.r[0][3] & FOLLETT_FORMAT.audio).toBeTruthy();
  });

  it("does not create a second card when ISBN already sits on a titled card", () => {
    const posted = buildCollection([
      rows([{ Title: "The Giver", Author: "Lowry, Lois", ISBN: "9780544336261", "Source Batch": "Sep 2025" }]),
    ]);
    const ingested = ingestFollettRows([
      { Author: "Lowry, Lois", ISBN: "978-0-544-33626-1", "Material Type": "Book", "Title/Subtitle": "The Giver" },
      { Author: "Lowry, Lois", ISBN: "9780385732550", "Material Type": "eBook", "Title/Subtitle": "The Giver" },
    ]);
    const compact = attachHoldingsToCollection(posted, ingested);
    expect(posted.uniqueTitleCount).toBe(1);
    expect(posted.titles.filter((title) => titleKey(title.title) === "giver")).toHaveLength(1);
    expect(posted.titles[0].isbnDigits).toEqual(expect.arrayContaining(["9780544336261", "9780385732550"]));
    expect(compact.n).toBe(0);
  });

  it("prefers a titled Follett workbook over a title-less district report", () => {
    const dir = mkdtempSync(join(tmpdir(), "misd-follett-titled-"));
    const postedFile = join(dir, "posted.xlsx");
    const untitledFile = join(dir, "District-Report-9.16.26.xlsx");
    const titledFile = join(dir, "District-Report-Deduped.xlsx");

    const postedSheet = XLSX.utils.json_to_sheet([
      { Title: "Harbor Lights", Author: "Ng, C", ISBN: "9787777777777", "Source Batch": "Apr 2026" },
    ]);
    const postedWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(postedWb, postedSheet, "Master List");
    XLSX.writeFile(postedWb, postedFile);

    const untitledSheet = XLSX.utils.json_to_sheet([
      { Author: "Lowry, Lois", ISBN: "9780544336261", "Material Type": "Book", "Series Title": "Giver Quartet" },
      { Author: "Other", ISBN: "9781111111111", "Material Type": "Book", "Series Title": "" },
    ]);
    const untitledWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(untitledWb, untitledSheet, "District Report 9.16.26");
    XLSX.writeFile(untitledWb, untitledFile);

    const titledSheet = XLSX.utils.json_to_sheet([
      {
        Author: "Lowry, Lois",
        ISBN: "9780544336261",
        "Material Type": "Book",
        "Series Title": "Giver Quartet",
        "Title/Subtitle": "The Giver",
      },
    ]);
    const titledWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(titledWb, titledSheet, "District Report Deduped");
    XLSX.utils.book_append_sheet(titledWb, XLSX.utils.aoa_to_sheet([["Item", "Value"], ["Rows remaining", 1]]), "Dedup Summary");
    XLSX.writeFile(titledWb, titledFile);

    expect(
      pickFollettSources([
        { filePath: untitledFile, rows: XLSX.utils.sheet_to_json(untitledWb.Sheets["District Report 9.16.26"]) },
        { filePath: titledFile, rows: XLSX.utils.sheet_to_json(titledWb.Sheets["District Report Deduped"]) },
      ]).every((source) => /deduped/i.test(source.filePath)),
    ).toBe(true);

    const catalog = buildCatalogFromFiles([postedFile, untitledFile, titledFile]);
    expect(catalog.collection.sourceFiles.some((file) => /9\.16\.26/.test(file))).toBe(false);
    expect(catalog.collection.sourceFiles.some((file) => /Deduped/.test(file))).toBe(true);
    expect(catalog.collection.titles[0].inCollection).toBe(false);
    const giver = catalog.holdings.s[catalog.holdings.r[0][2]];
    expect(giver).toBe("The Giver");
    expect(catalog.holdings.n).toBe(1);
    expect(String(catalog.holdings.r[0][0])).toBe("9780544336261");
  });
});
