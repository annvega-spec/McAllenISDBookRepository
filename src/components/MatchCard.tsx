import { useState } from "react";
import { displayTitle, presenceOf, type TitleRecord } from "../types";

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

function statusCopy(title: TitleRecord) {
  const presence = presenceOf(title);
  if (presence === "both") {
    return {
      kicker: "HAVE IT",
      line: "In collection · Posted for HB 900 / SB 13 review",
      className: "match-card match-both",
    };
  }
  if (presence === "holdings") {
    return {
      kicker: "HAVE IT",
      line: "In collection — not on the posted review list",
      className: "match-card match-holdings",
    };
  }
  return {
    kicker: "HAVE IT",
    line: "Posted for HB 900 / SB 13 review — not on the Follett district report",
    className: "match-card match-posted",
  };
}

export function MatchCard({ title, onClose }: MatchCardProps) {
  const formats = [
    title.formats.book ? "Book" : null,
    title.formats.ebook ? "eBook" : null,
    title.formats.audio ? "Audio" : null,
  ].filter(Boolean) as string[];

  const reviewEntries = Object.entries(title.reviews).filter(([, values]) => values?.length);
  const presence = presenceOf(title);
  const copy = statusCopy(title);
  const unknown = Boolean(title.titleUnknown || !title.title);
  const postedBatches = title.postedBatches ?? (presence === "holdings" ? [] : title.batches);
  const holdingsBatches = title.holdingsBatches ?? (title.inCollection ? title.batches.filter((batch) => /^follett/i.test(batch)) : []);
  const isbnLabel = presence === "posted" ? `Approved ISBN${title.isbns.length === 1 ? "" : "s"}` : `ISBN${title.isbns.length === 1 ? "" : "s"}`;

  return (
    <article className={copy.className} aria-live="polite">
      <div className="match-ribbon">
        <span className="status-dot" aria-hidden="true" />
        <div className="match-status-block">
          <p className="match-kicker">{copy.kicker}</p>
          <p className="match-status">{copy.line}</p>
        </div>
        <ul className="presence-pills" aria-label="Record status">
          {title.inCollection ? <li className="pill-holdings">In collection</li> : null}
          {presence !== "holdings" ? <li className="pill-posted">Posted for review</li> : null}
        </ul>
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

      <h2 className={unknown ? "match-title match-title-unknown" : "match-title"}>{displayTitle(title)}</h2>
      {unknown ? (
        <p className="unknown-title-note">
          No title is listed on this holdings row. Identify the item by ISBN and author — search still finds it.
        </p>
      ) : null}
      <p className="match-author">{title.authors.length ? title.authors.join("; ") : "Author not listed"}</p>

      <dl className="meta-grid">
        <div>
          <dt>{isbnLabel}</dt>
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
        {postedBatches.length ? (
          <div>
            <dt>Date{postedBatches.length === 1 ? "" : "s"} posted</dt>
            <dd>
              <ul className="batch-pills">
                {postedBatches.map((batch) => (
                  <li key={batch}>{batch}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {holdingsBatches.length ? (
          <div>
            <dt>District holdings</dt>
            <dd>
              <ul className="batch-pills">
                {holdingsBatches.map((batch) => (
                  <li key={batch}>{batch}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
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
        {title.editions?.length ? (
          <div>
            <dt>Edition</dt>
            <dd>{title.editions.join(" · ")}</dd>
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
        McAllen ISD Collection Check · HAVE IT / DON&apos;T HAVE IT desk (HB 900 / SB 13 and Follett holdings)
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
