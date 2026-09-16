type FooterProps = {
  generatedAt?: string;
  sourceCount?: number;
  ownedCount?: number;
};

export function Footer({ generatedAt, sourceCount, ownedCount }: FooterProps) {
  const built = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <footer className="site-footer no-print">
      <p>HAVE IT lookup: posted for community review (HB 900 / SB 13), owned Follett holdings, and eBook order lists</p>
      <p>McAllen ISD Collection Check · Campus librarian desk tool</p>
      {built ? (
        <p>
          Title list last built {built}
          {sourceCount ? ` from ${sourceCount} spreadsheet${sourceCount === 1 ? "" : "s"}` : ""}
          {ownedCount ? ` · ${ownedCount.toLocaleString()} owned ISBNs` : ""}. New Excel files go in the data/incoming folder.
        </p>
      ) : null}
    </footer>
  );
}
