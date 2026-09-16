# McAllen ISD Collection Check

A desk tool for campus librarians to look up whether **we HAVE IT**: a title posted for community review under Texas HB 900 and SB 13, a holding already in the Follett district collection, and/or a title on an eBook order list.

Product name: **McAllen ISD Collection Check**.

The app runs in a web browser with no separate server. Spreadsheets are read when someone runs the import (including automatically when this project is published), then saved as files the desk can search even without the internet.

## Live desk (bookmark this)

After this project is merged to `main` and GitHub Pages is turned on, librarians can open:

**https://annvega-spec.github.io/McAllenISDBookRepository/**

That is a normal website. Bookmark it. No GitHub account is needed to search **if the repository is public**.

### Turn on GitHub Pages (one-time)

1. On GitHub, open the repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge to `main` (or re-run the “Build and deploy GitHub Pages” workflow). The first successful deploy on `main` tries to turn Pages on. If the live URL still 404s, set **Source** to **GitHub Actions** as above and run the workflow again.

If Pages is already set to GitHub Actions, you can skip this.

### If the repository is private

On GitHub’s free plan, Pages sites from **private** repositories are not a public bookmark for staff. People may be asked to sign in to GitHub, or the site may not publish at all.

To let campus librarians open the desk **without a GitHub login**, make this repository **public** (Settings → General → Danger Zone → Change repository visibility), or use a paid GitHub plan that allows public Pages from a private repo. The Excel files in this repo will then be visible to anyone, same as the website.

## Open the desk on a computer (for updates)

In the project folder, run:

```bash
npm install
npm run dev
```

Then open the address it prints (usually `http://localhost:5173`).

To make a copy you can put on a static website:

```bash
npm run build
npm run preview
```

A push to `main` also builds and publishes the live GitHub Pages site, including `npm run import` so new files in `data/incoming` are picked up.

## Search behavior

- Search by **title**, **author**, or **ISBN**.
- Matching ignores case, punctuation, and leading articles (`a` / `an` / `the`).
- The result card answers **HAVE IT** or **Do not have it**, and can show more than one source on the same title:
  - **Posted for community review** — original master list, All Campuses, and similar posted/approved lists
  - **In collection / owned** — Follett district holdings (ISBN index; not an HB 900 posted batch)
  - **eBook order list** — eBook order spreadsheets
- The card lists all sources, all ISBNs, and all dates/batches when a title appears on more than one list.
- Title search stays on the named lists (posted + eBook orders). ISBN search also checks the compact Follett holdings file, including rows that have no title.
- If nothing matches, the desk shows **Do not have it**, plus **Did you mean…** when a close title exists.

## Files already imported

These five additional spreadsheets are already in `data/incoming` and are merged on every import (they do **not** replace `data/master-list.xlsx`):

| File | Role |
| --- | --- |
| `District-Report-9.16.26.xlsx` | Follett district holdings. Book and eBook rows with an ISBN. Compact ISBN index. Tagged **Follett 9.16.26** (owned collection, not a posted batch). |
| `All-Campuses.xlsx` | Posted/approved campus list. Searchable by title. Level from the first column. |
| `ebook-list-A.xlsx` | eBook order list A. Edition kept as a format note. |
| `ebook-list-B.xlsx` | eBook order list B. |
| `ebook-list-C.xlsx` | eBook order list C. |

Leave those files in `data/incoming`. Future files still drop in the same folder.

## Adding another spreadsheet

When the district sends a **new** Excel file, add it. Do not throw away the original list.

1. **Drop the file** into the `data/incoming` folder. Leave `data/master-list.xlsx` where it is — that is the original posted list. New files are added on top; they do not replace it. You can put more than one file in `data/incoming`.
2. **Run the import** from the project folder:

   ```bash
   npm run import
   ```

   This reads the original spreadsheet plus everything in `data/incoming`. Posted and eBook-order rows are matched by title and ISBN. Follett holdings are compacted into `public/data/owned.json` (ISBN-normalized; Video/Kit/other material types are skipped). Running the same step again with the same files will not double the list.
3. **Refresh the desk.** If you are testing on your computer and the desk is already open, reload the browser page. After the change is on `main`, wait for GitHub Actions to finish — the live bookmark updates by itself.

Leave the new Excel files in `data/incoming` after importing so the next update still includes them. Skip Excel lock files whose names start with `~$`.

Posted/approved lists should have a **Title** column. Follett district reports can omit Title; Series Title is used as a display fallback, and ISBN/author still find the holding. Other columns can match the original Master List, or close names such as Period / Posted, ISBN-13, Authors, Elementary/Middle/High, QTY, or Edition. Useful columns:

`Source Batch | Level | Title | Author | Book | eBook | Audio | ISBN | ISBN-10 | ISBN-13 | Normalized ISBN | ISBN-HB | ISBN-PB | ISBN-Other | Possible Duplicate | Audience | Booklist | Kirkus | PW | SLJ | Horn Book | Common Sense Media | Other Reviews | Edition | Material Type | Series Title`

Scientific-notation ISBNs from Excel (for example `9.781516080236E12`) are converted to 13-digit strings. Follett ISBNs with hyphens, `(pbk.)` suffixes, and ISBN-10 values are normalized.

If you are handing files to someone else: put them in `data/incoming` and ask that person to run the import (step 2) and refresh (step 3).

## Replacing the original master list

Only do this if you received a **full** new master workbook meant to stand in for `data/master-list.xlsx`. Copy it over that file, keep any still-needed extras in `data/incoming`, then run `npm run import` and refresh as above.

## Tests

```bash
npm test
```

Covers import counts, merge/idempotent extra spreadsheets, scientific-notation ISBNs, Follett ISBN cleanup, merge of a titled row with an owned ISBN-only row, and the “101 Dalmatians” lookup.

## Stack

Vite + React + TypeScript. No server, no database. Named lists ship as `public/data/collection.json`. Follett holdings ship as a compact ISBN index in `public/data/owned.json`.
