# McAllen ISD Collection Check

A desk tool for campus librarians to look up whether a title was posted for community review under Texas HB 900 and SB 13.

Product name: **McAllen ISD Collection Check**.

The app runs in a web browser with no separate server. The posted-title list is loaded from Excel files when someone runs the import (including automatically when this project is published), then saved as a file the desk can search even without the internet.

## Live desk (bookmark this)

After this project is merged to `main` and GitHub Pages is turned on, librarians can open:

**https://annvega-spec.github.io/McAllenISDBookRepository/**

That is a normal website. Bookmark it. No GitHub account is needed to search **if the repository is public**.

### Turn on GitHub Pages (one-time)

1. On GitHub, open the repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge to `main` (or re-run the “Build and deploy GitHub Pages” workflow). The live URL above should work after the workflow finishes (often a minute or two).

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
- Exact or near-exact titles open an **In collection / Posted for review** card with author(s), approved ISBNs, and posted period(s).
- If nothing matches, the desk shows **Not in collection / Not found on the posted list**, plus **Did you mean…** when a close title exists.
- Posted period and level chips browse the same list. Search stays the main action.

The same book may appear on more than one spreadsheet (different ISBNs or posting months). The desk groups those into one title.

## Adding another spreadsheet

When the district sends a **new** posted-title Excel file, add it. Do not throw away the original list.

1. **Drop the file** into the `data/incoming` folder. Leave `data/master-list.xlsx` where it is — that is the original list. New files are added on top; they do not replace it. You can put more than one file in `data/incoming`.
2. **Run the import** from the project folder:

   ```bash
   npm run import
   ```

   This reads the original spreadsheet plus everything in `data/incoming`, matches books by title (ignoring capital letters and extra spaces) and ISBN, and combines all ISBNs and posted months for each title. Running the same step again with the same files will not double the list.
3. **Refresh the desk.** If you are testing on your computer and the desk is already open, reload the browser page. After the change is on `main`, wait for GitHub Actions to finish — the live bookmark updates by itself.

Leave the new Excel files in `data/incoming` after importing so the next update still includes them. Skip Excel lock files whose names start with `~$`.

The spreadsheets should have a **Title** column. Other columns can match the original Master List, or close names such as Period / Posted, ISBN-13, or Authors. Useful columns:

`Source Batch | Level | Title | Author | Book | eBook | Audio | ISBN | ISBN-10 | ISBN-13 | Normalized ISBN | ISBN-HB | ISBN-PB | ISBN-Other | Possible Duplicate | Audience | Booklist | Kirkus | PW | SLJ | Horn Book | Common Sense Media | Other Reviews`

If you are handing files to someone else: put them in `data/incoming` and ask that person to run the import (step 2) and refresh (step 3).

## Replacing the original master list

Only do this if you received a **full** new master workbook meant to stand in for `data/master-list.xlsx`. Copy it over that file, keep any still-needed extras in `data/incoming`, then run `npm run import` and refresh as above.

## Tests

```bash
npm test
```

Covers import counts, merge/idempotent extra spreadsheets, and the “101 Dalmatians” lookup.

## Stack

Vite + React + TypeScript. No server, no database.
