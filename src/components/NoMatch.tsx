import type { ScoredTitle } from "../types";

type NoMatchProps = {
  query: string;
  suggestions: ScoredTitle[];
  onPick: (id: string) => void;
};

export function NoMatch({ query, suggestions, onPick }: NoMatchProps) {
  return (
    <section className="no-match" aria-live="polite">
      <p className="no-match-kicker">Do not have it</p>
      <h2>Not found on the posted list, owned collection, or eBook orders</h2>
      <p className="no-match-copy">
        No title, author, or ISBN matches “{query}”.
      </p>
      {suggestions.length ? (
        <div className="did-you-mean">
          <p>Did you mean…</p>
          <ul>
            {suggestions.map((item) => (
              <li key={item.title.id}>
                <button type="button" onClick={() => onPick(item.title.id)}>
                  <strong>{item.title.title || item.title.isbns[0] || "Untitled holding"}</strong>
                  <span>
                    {item.title.authors[0] ?? "Author not listed"}
                    {item.title.batches.length ? ` · ${item.title.batches.join(", ")}` : ""}
                    {item.title.owned ? " · owned" : ""}
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
