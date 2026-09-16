import type { ScoredTitle, TitleRecord } from "../types";

type ResultsListProps = {
  items: Array<ScoredTitle | { title: TitleRecord; score?: number; reason?: string }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  query: string;
  total?: number;
};

export function ResultsList({ items, activeId, onSelect, query, total }: ResultsListProps) {
  if (!items.length) return null;

  return (
    <section className="results no-print" aria-label="Matching titles">
      <div className="results-head">
        <h2>{query ? "Matching titles" : "Browse titles"}</h2>
        <p>
          {total != null && total > items.length
            ? `Showing ${items.length} of ${total.toLocaleString()}`
            : `${items.length} title${items.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <ul className="results-list">
        {items.map((item) => {
          const title = item.title;
          const selected = title.id === activeId;
          return (
            <li key={title.id}>
              <button
                type="button"
                className={selected ? "result-row result-row-active" : "result-row"}
                onClick={() => onSelect(title.id)}
                aria-pressed={selected}
              >
                <span className="result-title">{title.title}</span>
                <span className="result-meta">
                  {title.authors[0] ?? "Author not listed"}
                  {title.authors.length > 1 ? ` +${title.authors.length - 1}` : ""}
                </span>
                <span className="result-side">
                  <span>{title.levels[0] ?? ""}</span>
                  <span>{title.batches.join(" · ")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
