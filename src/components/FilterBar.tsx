import type { ReactNode } from "react";
import type { CollectionData } from "../types";

type FilterBarProps = {
  data: CollectionData;
  batch: string;
  level: string;
  onBatch: (value: string) => void;
  onLevel: (value: string) => void;
};

export function FilterBar({ data, batch, level, onBatch, onLevel }: FilterBarProps) {
  return (
    <section className="filters no-print" aria-label="Browse filters">
      <div className="filter-row">
        <p className="filter-label">Posted period</p>
        <div className="chip-row" role="tablist" aria-label="Source batch">
          <Chip active={batch === "all"} onClick={() => onBatch("all")}>
            All periods
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
