# McAllen ISD Collection Check

A static desk tool for campus librarians to look up whether a title was posted for community review under Texas HB 900 and SB 13.

Product name: **McAllen ISD Collection Check**.

The app runs entirely in the browser. The master list is parsed at build/import time into JSON and committed with the source so it works offline, with no backend.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

The build output in `dist/` can be hosted on any static file server.

## Search behavior

- Search by **title**, **author**, or **ISBN**.
- Matching ignores case, punctuation, and leading articles (`a` / `an` / `the`).
- Exact or near-exact titles open an **In collection / Posted for review** card with author(s), approved ISBNs, and posted period(s) (`Source Batch`).
- If nothing matches, the desk shows **Not in collection / Not found on the posted list**, plus **Did you mean…** suggestions when a close title exists.
- Posted period and level chips browse the same grouped title list without leaving search as the primary action.

Titles that appear more than once (different ISBNs or posting months) are grouped by normalized title.

## Refresh the master list

1. Replace `data/master-list.xlsx` with the new workbook, **or** pass a path to the import script. The importer reads the **Master List** sheet and expects these columns:

   `Source Batch | Level | Title | Author | Book | eBook | Audio | ISBN | ISBN-10 | ISBN-13 | Normalized ISBN | ISBN-HB | ISBN-PB | ISBN-Other | Possible Duplicate | Audience | Booklist | Kirkus | PW | SLJ | Horn Book | Common Sense Media | Other Reviews`

2. Regenerate the bundled JSON:

   ```bash
   npm run import
   # or
   npm run import -- /absolute/or/relative/path/to/new-file.xlsx
   ```

3. Commit the updated files:

   - `data/master-list.xlsx` (optional but recommended so the source stays with the app)
   - `public/data/collection.json` (required — this is what the UI searches)

4. Rebuild or restart `npm run dev`.

The import groups rows by title (case-insensitive, collapsed whitespace), unions authors and ISBNs, and keeps every distinct `Source Batch` as a posted date. ISBN-13 / Normalized ISBN values are preferred in the display order; all distinct approved ISBN values are kept.

## Tests

```bash
npm test
```

Covers import counts and the “101 Dalmatians” lookup used as the librarian smoke check.

## Stack

Vite + React + TypeScript. No server, no database.
