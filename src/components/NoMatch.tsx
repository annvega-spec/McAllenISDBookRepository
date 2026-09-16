import { displayTitle, presenceOf, type ScoredTitle } from "../types";

type NoMatchProps = {
  query: string;
  suggestions: ScoredTitle[];
  onPick: (id: string) => void;
};

export function NoMatch({ query, suggestions, onPick }: NoMatchProps) {
  return (
    <section className="no-match" aria-live="polite">
      <p className="no-match-kicker">DON&apos;T HAVE IT</p>
      <h2>Not in collection · Not on the posted list</h2>
      <p className="no-match-copy">
        No title, author, or ISBN on the posted review lists or the Follett district holdings matches “{query}”.
      </p>
      {suggestions.length ? (
        <div className="did-you-mean">
          <p>Did you mean…</p>
          <ul>
            {suggestions.map((item) => (
              <li key={item.title.id}>
                <button type="button" onClick={() => onPick(item.title.id)}>
                  <strong>{displayTitle(item.title)}</strong>
                  <span>
                    {item.title.authors[0] ?? "Author not listed"}
                    {presenceLabel(item)}
                    {item.title.batches.length ? ` · ${item.title.batches.join(", ")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function presenceLabel(item: ScoredTitle): string {
  const presence = presenceOf(item.title);
  if (presence === "both") return " · In collection + posted";
  if (presence === "holdings") return " · In collection";
  return " · Posted for review";
}
