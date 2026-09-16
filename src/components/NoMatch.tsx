import type { ScoredTitle } from "../types";

type NoMatchProps = {
  query: string;
  suggestions: ScoredTitle[];
  onPick: (id: string) => void;
};

export function NoMatch({ query, suggestions, onPick }: NoMatchProps) {
  return (
    <section className="no-match" aria-live="polite">
      <p className="no-match-kicker">Not in collection</p>
      <h2>Not found on the posted list</h2>
      <p className="no-match-copy">
        No title, author, or ISBN on the current master list matches “{query}”.
      </p>
      {suggestions.length ? (
        <div className="did-you-mean">
          <p>Did you mean…</p>
          <ul>
            {suggestions.map((item) => (
              <li key={item.title.id}>
                <button type="button" onClick={() => onPick(item.title.id)}>
                  <strong>{item.title.title}</strong>
                  <span>
                    {item.title.authors[0] ?? "Author not listed"}
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
