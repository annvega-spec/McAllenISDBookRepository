import { sourceKinds } from "../lib/owned";
import type { ScoredTitle, TitleRecord } from "../types";

type ResultsListProps = {
  items: Array<ScoredTitle | { title: TitleRecord; score?: number; reason?: string }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  heading: string;
  total?: number;
};

export function ResultsList({ items, activeId, onSelect, heading, total }: ResultsListProps) {
  if (!items.length) return null;

  return (
    <section className="results no-print" aria-label={heading}>
      <div className="results-head">
        <h2>{heading}</h2>
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
          const kinds = sourceKinds(title);
          return (
            <li key={title.id}>
              <button
                type="button"
                className={selected ? "result-row result-row-active" : "result-row"}
                onClick={() => onSelect(title.id)}
                aria-pressed={selected}
              >
                <span className="result-title">{title.title || title.isbns[0] || "Untitled holding"}</span>
                <span className="result-meta">
                  {title.authors[0] ?? "Author not listed"}
                  {title.authors.length > 1 ? ` +${title.authors.length - 1}` : ""}
                </span>
                <span className="result-side">
                  <span>{kinds.map((kind) => (kind === "ebook-order" ? "eBook order" : kind === "owned" ? "owned" : "posted")).join(" · ")}</span>
                  <span>{title.batches.join(" · ") || title.ownedSources?.join(" · ") || ""}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
