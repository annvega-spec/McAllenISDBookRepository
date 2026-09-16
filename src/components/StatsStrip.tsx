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

  return (
    <section className="stats-strip no-print" aria-label="Collection statistics">
      <Stat value={data.rowCount.toLocaleString()} label="Posted listings" />
      <Stat value={data.uniqueTitleCount.toLocaleString()} label="Unique titles" />
      <Stat value={String(data.batches.length)} label="Posted periods" />
      <Stat value={String(data.levels.length)} label="Levels covered" />
      <p className="stats-note">{levels}</p>
    </section>
  );
}
