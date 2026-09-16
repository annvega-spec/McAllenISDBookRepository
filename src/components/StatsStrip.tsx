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
  const owned = data.owned?.count ?? data.stats.ownedIsbnCount ?? 0;
  const ebook = data.stats.ebookOrderTitleCount ?? 0;

  return (
    <section className="stats-strip no-print" aria-label="Collection statistics">
      <Stat value={data.uniqueTitleCount.toLocaleString()} label="Named titles" />
      <Stat value={owned.toLocaleString()} label="Owned ISBNs" />
      <Stat value={String(data.batches.length)} label="Named lists" />
      <Stat value={ebook.toLocaleString()} label="eBook order titles" />
      <p className="stats-note">
        {data.rowCount.toLocaleString()} posted/order listings · {owned.toLocaleString()} Follett holdings by ISBN
        {levels ? ` · ${levels}` : ""}
      </p>
    </section>
  );
}
