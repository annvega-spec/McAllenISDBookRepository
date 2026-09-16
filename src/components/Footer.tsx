type FooterProps = {
  generatedAt?: string;
  sourceCount?: number;
};

export function Footer({ generatedAt, sourceCount }: FooterProps) {
  const built = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <footer className="site-footer no-print">
      <p>Titles posted for community review (HB 900 / SB 13)</p>
      <p>McAllen ISD Collection Check · Campus librarian desk tool</p>
      {built ? (
        <p>
          Title list last built {built}
          {sourceCount ? ` from ${sourceCount} spreadsheet${sourceCount === 1 ? "" : "s"}` : ""}. New Excel files go in the data/incoming folder.
        </p>
      ) : null}
    </footer>
  );
}
