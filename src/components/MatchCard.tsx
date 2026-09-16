import { useState } from "react";
import type { TitleRecord } from "../types";

const REVIEW_LABELS: Record<string, string> = {
  booklist: "Booklist",
  kirkus: "Kirkus",
  pw: "Publishers Weekly",
  slj: "School Library Journal",
  hornBook: "Horn Book",
  commonSenseMedia: "Common Sense Media",
  other: "Other reviews",
};

type MatchCardProps = {
  title: TitleRecord;
  onClose?: () => void;
};

export function MatchCard({ title, onClose }: MatchCardProps) {
  const formats = [
    title.formats.book ? "Book" : null,
    title.formats.ebook ? "eBook" : null,
    title.formats.audio ? "Audio" : null,
  ].filter(Boolean) as string[];

  const reviewEntries = Object.entries(title.reviews).filter(([, values]) => values?.length);

  return (
    <article className="match-card" aria-live="polite">
      <div className="match-ribbon">
        <span className="status-dot" aria-hidden="true" />
        <p className="match-status">In collection · Posted for review</p>
        <div className="match-actions no-print">
          <button type="button" className="text-btn" onClick={() => window.print()}>
            Print record
          </button>
          {onClose ? (
            <button type="button" className="text-btn" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>

      <h2 className="match-title">{title.title}</h2>
      <p className="match-author">{title.authors.length ? title.authors.join("; ") : "Author not listed"}</p>

      <dl className="meta-grid">
        <div>
          <dt>Approved ISBN{title.isbns.length === 1 ? "" : "s"}</dt>
          <dd>
            {title.isbns.length ? (
              <ul className="isbn-list">
                {title.isbns.map((isbn) => (
                  <li key={isbn}>
                    <CopyChip value={isbn} />
                  </li>
                ))}
              </ul>
            ) : (
              "No ISBN recorded"
            )}
          </dd>
        </div>
        <div>
          <dt>Date{title.batches.length === 1 ? "" : "s"} posted</dt>
          <dd>
            <ul className="batch-pills">
              {title.batches.map((batch) => (
                <li key={batch}>{batch}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd>{title.levels.join(" · ") || "—"}</dd>
        </div>
        {title.audiences.length ? (
          <div>
            <dt>Audience</dt>
            <dd>{title.audiences.join(" · ")}</dd>
          </div>
        ) : null}
        {formats.length ? (
          <div>
            <dt>Format flags</dt>
            <dd>{formats.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>

      {title.possibleDuplicate ? (
        <p className="dupe-note">
          Flagged as a possible duplicate ISBN on the master list. This can be the same title ordered for another campus or format — review before removing.
        </p>
      ) : null}

      {reviewEntries.length ? (
        <details className="reviews">
          <summary>Review sources on file</summary>
          <dl>
            {reviewEntries.map(([key, values]) => (
              <div key={key}>
                <dt>{REVIEW_LABELS[key] ?? key}</dt>
                <dd>{values.join(" · ")}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <p className="print-only print-foot">
        McAllen ISD Collection Check · Titles posted for community review (HB 900 / SB 13)
      </p>
    </article>
  );
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="isbn-chip"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span>{value}</span>
      <em>{copied ? "Copied" : "Copy"}</em>
    </button>
  );
}
