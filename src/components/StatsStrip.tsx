import type { CollectionData } from "../types";

type StatsStripProps = {
  data: CollectionData;
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <p className="stat-value">{value}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}

export function StatsStrip({ data }: StatsStripProps) {
  const levels = data.levels
    .filter((level) => level !== "Milam Book Vending Machine")
    .map((level) => `${data.stats.titlesByLevel[level] ?? 0} ${level.toLowerCase()}`)
    .join(" · ");
  const holdings = data.stats.holdingsUniqueIsbns ?? 0;
  const linked = data.stats.inCollectionPostedCount ?? 0;

  return (
    <section className="stats-strip no-print" aria-label="Collection statistics">
      <Stat value={data.rowCount.toLocaleString()} label="Posted listings" />
      <Stat value={data.uniqueTitleCount.toLocaleString()} label="Unique posted titles" />
      <Stat value={holdings ? holdings.toLocaleString() : String(data.batches.length)} label={holdings ? "In collection (ISBNs)" : "Posted periods"} />
      <Stat value={String(data.levels.length)} label="Levels covered" />
      <p className="stats-note">
        {levels}
        {holdings
          ? ` · ${linked.toLocaleString()} posted title${linked === 1 ? "" : "s"} also in the collection · holdings search by title, author, or ISBN`
          : ""}
      </p>
    </section>
  );
}
