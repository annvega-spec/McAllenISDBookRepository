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
  ingestFollettRows,
  rowFingerprint,
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
