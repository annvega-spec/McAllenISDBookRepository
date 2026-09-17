# McAllen ISD Collection Check

A desk tool for campus librarians to look up whether a title is **in the Follett collection**, **posted for community review** under Texas HB 900 and SB 13, or **both**.

Product name: **McAllen ISD Collection Check**.

The app runs in a web browser with no separate server. Spreadsheets are loaded when someone runs the import (including automatically when this project is published), then saved as files the desk can search even without the internet.

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
- A hit answers **HAVE IT** or **DON'T HAVE IT**.
- **HAVE IT** cards show whether the title is posted for HB 900 / SB 13 review, already in the Follett Destiny or Sora collection, or both — plus author, all ISBNs, posted dates, and holdings dates.
- If Follett has no title on the district report, the card says so and still shows ISBN and author. ISBN/author search still finds that item. The current titled Follett export (`District-Report-Deduped.xlsx`) supplies **Title/Subtitle**, so most holdings cards search by name.
- If nothing matches, the desk shows **DON'T HAVE IT**, plus **Did you mean…** when a close title exists.
- Source-batch and level chips browse the posted lists. Follett holdings-only titles (not on a posted list) are found by search, not by paging through every district card.

The same book may appear on more than one spreadsheet (different ISBNs or posting months). The desk shows each unique title once: matching ignores capital letters, extra spaces, punctuation, and leading a/an/the, then lists every approved ISBN, author, posted date, and level on that one card. Untitled Follett holdings that share an ISBN with a posted title attach to that card instead of becoming a blank duplicate. Titled Follett Book/eBook/Sound/Recording rows use **Title/Subtitle** (not Series Title alone), group by that normalized title, and union every ISBN onto that one card. If an ISBN already sits on a titled card, it merges there. The titled `District-Report-Deduped.xlsx` export supersedes the older title-less `District-Report-9.16.26.xlsx` so the two files do not double-count. Sora Ebook/Audiobook rows follow the same alignment rule: matching titles get extra ISBNs and format flags on the existing card.

## Spreadsheet sources

The original posted list stays in `data/master-list.xlsx`. Additional files live in `data/incoming/` and are **unioned** with that list (never a replace). Re-running import with the same files does not double the list.

To keep a title off the approved / posted-for-community-review list, add it to `data/exclusions.json` (normalized title + author). Import skips those posted rows so a later spreadsheet cannot put them back. Follett Destiny and Sora holdings-only copies may still search as **In collection**, unless the exclusion also sets `"hideFromDesk": true` — that drops matching holdings cards (and longer titles that start with the same normalized title, such as a study guide named after the work) so desk search returns no match.

Optional exclusion fields:

- `"matchAuthor": true` — hide only rows whose author matches. Use this when the same normalized title is more than one work (Judy Blume **Forever** vs Maggie Stiefvater **Forever**; Eishes Chayil **Hush** vs Jacqueline Woodson / Skye Melki-Wegner).
- `"aliases"` — extra title strings that use the same hide rule (Inuyasha / Inu Yasha volumes; Black Butler also matches the PDF misspelling Black Butter).

Posted-only exclusions: **Crank** and **Glass** by Ellen Hopkins. Hidden from the desk: **The Handmaid's Tale** by Margaret Atwood, plus the district challenge list in `data/exclusions.json` (Lessons in Chemistry, The Lovely Bones, Water for Elephants, Judy Blume Forever, Eishes Chayil Hush, Let's Talk About It by Erika Moen, and the rest of that PDF).

Current additional sources:

| File | What it is | How it is imported |
| --- | --- | --- |
| `data/incoming/District-Report-Deduped.xlsx` | Follett Destiny district holdings (sheet `District Report Deduped`; `Dedup Summary` is counts only) | Book, eBook, Sound, and Recording rows that have an ISBN. Video, Kit, and other material types are skipped. Sound/Recording are tagged **Audio**. **Title/Subtitle** is the real title (Series Title is not used in place of it). Rows group by normalized title — one card, all ISBNs, authors, and formats. If an ISBN already sits on a titled posted/Sora card, it merges there. Status is **In collection**. Source batch: `Follett 9.16.26`. Compact leftover titles go to `public/data/holdings.json`. This titled export **supersedes** the older title-less `District-Report-9.16.26.xlsx` (do not keep both). |
| `data/incoming/Sora-titles.xlsx` | Sora digital collection (sheet `Title status & usage 2026-09-16`) | Ebook and Audiobook rows. Magazine and other formats are skipped. Creator is Author. Format flags: eBook / Audio. Level from Content access levels (Elementary / Middle / High). **Staff Only** access is skipped (case-insensitive; also skipped if the field contains Staff Only as an access level), so those titles are not searchable as Sora In collection. Audience/Rating is stored as audience. Status is **In collection**. Source batch: `Sora 2026-09-16`. Matching titles union onto an existing posted/Follett card; a new titled row is created only when that title is not already on a card. Trailing `(unabridged)` is ignored for matching. |
| `data/incoming/All-Campuses.xlsx` | Posted/approved campus list (sheet `All Campuses`) | Title, author, all ISBN columns. Excel scientific-notation ISBNs such as `9.781516080236E12` are stored as `9781516080236`. Level comes from the first column (Elementary / Middle / High). Source batch: `All Campuses`. |
| `data/incoming/ebook-list-A.xlsx` | eBook order (sheet `Page 1`) | Title, author, ISBN, Edition. Format: eBook. Source batch: `eBook order`. |
| `data/incoming/ebook-list-B.xlsx` | eBook order (sheet `Page 1`) | Same columns and rules as list A. |
| `data/incoming/ebook-list-C.xlsx` | eBook order (sheet `Page 1`) | Same columns and rules as list A. |

Messy ISBNs are normalized on every file: hyphens, `(pbk.)` / `(hc. …)` suffixes, ISBN-10, and Excel scientific notation.

## Adding another spreadsheet

When the district sends a **new** posted-title Excel file, add it. Do not throw away the original list.

1. **Drop the file** into the `data/incoming` folder. Leave `data/master-list.xlsx` where it is — that is the original list. New files are added on top; they do not replace it. You can put more than one file in `data/incoming`.
2. **Run the import** from the project folder:

   ```bash
   npm run import
   ```

   This reads the original spreadsheet plus everything in `data/incoming`, matches books by title (ignoring capital letters, extra spaces, punctuation, and leading a/an/the) and ISBN, and combines all ISBNs and posted months for each title. Titled Follett holdings merge onto a titled posted/Sora card when the ISBN or normalized Title/Subtitle matches. Untitled leftover rows (if any) still merge by ISBN. Sora Ebook/Audiobook ISBNs union onto that same card when the normalized title matches. Sora rows marked Staff Only are left out. Running the same step again with the same files will not double the list. Stats count unique titles, not spreadsheet rows.
3. **Refresh the desk.** If you are testing on your computer and the desk is already open, reload the browser page. After the change is on `main`, wait for GitHub Actions to finish — the live bookmark updates by itself.

Leave the new Excel files in `data/incoming` after importing so the next update still includes them. Skip Excel lock files whose names start with `~$`.

Generic posted-title spreadsheets should have a **Title** column. Other columns can match the original Master List, or close names such as Period / Posted, ISBN-13, or Authors. Useful columns:

`Source Batch | Level | Title | Author | Book | eBook | Audio | ISBN | ISBN-10 | ISBN-13 | Normalized ISBN | ISBN-HB | ISBN-PB | ISBN-Other | Possible Duplicate | Audience | Booklist | Kirkus | PW | SLJ | Horn Book | Common Sense Media | Other Reviews`

Follett district reports (`Title/Subtitle` or the older Material Type + ISBN shape), Sora title-status exports (TitleID / Creator / Format / Owned), and eBook order sheets (QTY / Title / Author / ISBN / Edition) are recognized automatically. If both a titled Follett report and an older title-less Follett report are present, only the titled report is imported.

If you are handing files to someone else: put them in `data/incoming` and ask that person to run the import (step 2) and refresh (step 3).

## Replacing the original master list

Only do this if you received a **full** new master workbook meant to stand in for `data/master-list.xlsx`. Copy it over that file, keep any still-needed extras in `data/incoming`, then run `npm run import` and refresh as above.

## Tests

```bash
npm test
```

Covers import counts, merge/idempotent extra spreadsheets, ISBN cleanup (including scientific notation), titled Follett Title/Subtitle grouping (one title, all ISBNs), untitled Follett + posted ISBN grouping, Follett Sound/Recording audiobook alignment, Sora Ebook/Audiobook title alignment (including skipping Staff Only), posted-title exclusions (`data/exclusions.json`, including Crank/Glass) and hide-from-desk exclusions (The Handmaid's Tale and the district challenge list, including author-scoped Forever/Hush and series aliases), and lookups such as “101 Dalmatians”, All Campuses titles, eBook orders, and Follett ISBNs.

## Stack

Vite + React + TypeScript. No server, no database. Follett holdings use a compact title+ISBN index plus a token index for title/author typeahead.
