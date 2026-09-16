import type { ReactNode } from "react";
import type { CollectionData, SourceFilter } from "../types";

type FilterBarProps = {
  data: CollectionData;
  batch: string;
  level: string;
  source: SourceFilter;
  onBatch: (value: string) => void;
  onLevel: (value: string) => void;
  onSource: (value: SourceFilter) => void;
};

export function FilterBar({ data, batch, level, source, onBatch, onLevel, onSource }: FilterBarProps) {
  const ownedCount = data.stats.ownedNamedTitleCount ?? data.titles.filter((title) => title.owned).length;
  const ebookCount = data.stats.ebookOrderTitleCount ?? data.titles.filter((title) => title.ebookOrder).length;
  const postedCount = data.stats.postedTitleCount ?? data.titles.filter((title) => title.posted !== false).length;

  return (
    <section className="filters no-print" aria-label="Browse filters">
      <div className="filter-row">
        <p className="filter-label">HAVE IT source</p>
        <div className="chip-row" role="tablist" aria-label="Source kind">
          <Chip active={source === "all"} onClick={() => onSource("all")}>
            All sources
          </Chip>
          <Chip active={source === "posted"} onClick={() => onSource("posted")}>
            Posted for review
            <span className="chip-count">{postedCount}</span>
          </Chip>
          <Chip active={source === "owned"} onClick={() => onSource("owned")}>
            In collection
            <span className="chip-count">{ownedCount}</span>
          </Chip>
          <Chip active={source === "ebook-order"} onClick={() => onSource("ebook-order")}>
            eBook orders
            <span className="chip-count">{ebookCount}</span>
          </Chip>
        </div>
      </div>
      <div className="filter-row">
        <p className="filter-label">Named list / period</p>
        <div className="chip-row" role="tablist" aria-label="Source batch">
          <Chip active={batch === "all"} onClick={() => onBatch("all")}>
            All lists
          </Chip>
          {data.batches.map((item) => (
            <Chip key={item} active={batch === item} onClick={() => onBatch(item)}>
              {item}
              <span className="chip-count">{data.stats.titlesByBatch[item] ?? 0}</span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="filter-row">
        <p className="filter-label">Level</p>
        <div className="chip-row" role="tablist" aria-label="Level">
          <Chip active={level === "all"} onClick={() => onLevel("all")}>
            All levels
          </Chip>
          {data.levels.map((item) => (
            <Chip key={item} active={level === item} onClick={() => onLevel(item)}>
              {item}
              <span className="chip-count">{data.stats.titlesByLevel[item] ?? 0}</span>
            </Chip>
          ))}
        </div>
      </div>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={active ? "chip chip-active" : "chip"} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  );
}
