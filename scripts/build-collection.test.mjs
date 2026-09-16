import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { buildCollection, buildCollectionFromFiles, rowFingerprint } from "../scripts/lib/build-collection.mjs";

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
