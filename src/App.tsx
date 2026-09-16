import { useEffect, useMemo, useState } from "react";
import { Footer } from "./components/Footer";
import { FilterBar } from "./components/FilterBar";
import { Header } from "./components/Header";
import { MatchCard } from "./components/MatchCard";
import { NoMatch } from "./components/NoMatch";
import { ResultsList } from "./components/ResultsList";
import { SearchBox } from "./components/SearchBox";
import { StatsStrip } from "./components/StatsStrip";
import { useDebouncedValue } from "./hooks";
import { classifySearch, filterTitles, searchTitles } from "./lib/search";
import type { CollectionData, TitleRecord } from "./types";

const PAGE_SIZE = 40;

export default function App() {
  const [data, setData] = useState<CollectionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/collection.json`;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the posted title list.");
        return response.json() as Promise<CollectionData>;
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="app-shell">
        <Header />
        <section className="no-match">
          <h2>Title list unavailable</h2>
          <p>{error} Refresh the page, or regenerate public/data/collection.json with npm run import.</p>
        </section>
        <Footer />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell">
        <Header />
        <section className="welcome" aria-busy="true" aria-live="polite">
          <p className="search-kicker">Loading posted titles</p>
          <h2>Opening the collection desk…</h2>
          <p>The master list is loading in this browser. No server is required after that.</p>
        </section>
        <Footer />
      </div>
    );
  }

  return <Desk data={data} />;
}

function Desk({ data }: { data: CollectionData }) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("all");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounced = useDebouncedValue(query, 120);
  const searching = debounced.trim().length > 0;
  const filteredBrowse = useMemo(
    () => (searching ? [] : filterTitles(data, batch, level)),
    [data, searching, batch, level],
  );

  const results = useMemo(
    () => (searching ? searchTitles(data, debounced, { limit: 60, batch, level }) : []),
    [data, searching, debounced, batch, level],
  );

  const classified = useMemo(() => classifySearch(results), [results]);
  const selected = useMemo<TitleRecord | null>(() => {
    if (!selectedId) return classified.match?.title ?? null;
    return data.titles.find((title) => title.id === selectedId) ?? classified.match?.title ?? null;
  }, [data.titles, selectedId, classified.match]);

  useEffect(() => {
    setSelectedId(null);
    setVisibleCount(PAGE_SIZE);
  }, [debounced, batch, level]);

  const browseActive = batch !== "all" || level !== "all";
  const listItems = searching
    ? classified.match
      ? classified.close
      : classified.list.slice(0, 40)
    : filteredBrowse.slice(0, visibleCount).map((title) => ({ title, score: 0, reason: "title" as const }));

  const showNoMatch = searching && !classified.match && classified.list.length === 0;
  const showSuggestionsOnly =
    searching && !classified.match && classified.list.length > 0 && classified.list[0].score < 0.62;

  const searchHint = !query.trim()
    ? "Punctuation and leading articles are ignored. Close matches appear if an exact title is not found."
    : classified.match
      ? "Posted for review — title found on the master list."
      : showNoMatch
        ? "No posted title matched this search."
        : `${results.length} matching title${results.length === 1 ? "" : "s"}`;

  const verdict = (
    <>
      {selected && (searching || selectedId) ? (
        <MatchCard title={selected} onClose={selectedId ? () => setSelectedId(null) : undefined} />
      ) : null}

      {showNoMatch ? (
        <NoMatch
          query={debounced}
          suggestions={searchTitles(data, debounced, { limit: 5, minScore: 0.18, batch, level })}
          onPick={setSelectedId}
        />
      ) : null}

      {showSuggestionsOnly ? (
        <NoMatch query={debounced} suggestions={classified.close} onPick={setSelectedId} />
      ) : null}
    </>
  );

  const listPanel =
    (searching && !showNoMatch && !showSuggestionsOnly) || browseActive ? (
      <>
        <ResultsList
          items={listItems}
          activeId={selected?.id ?? null}
          onSelect={setSelectedId}
          heading={searching ? (classified.match ? "Other close titles" : "Matching titles") : "Browse titles"}
          total={searching ? (classified.match ? classified.close.length : results.length) : filteredBrowse.length}
        />
        {!searching && visibleCount < filteredBrowse.length ? (
          <div className="load-more no-print">
            <button type="button" className="chip" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Show more titles
            </button>
          </div>
        ) : null}
      </>
    ) : null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#search">
        Skip to search
      </a>
      <Header />
      <main>
        <div id="search">
          <SearchBox value={query} onChange={setQuery} hint={searchHint} />
        </div>
        {searching ? verdict : null}
        {searching ? listPanel : null}
        <StatsStrip data={data} />
        <FilterBar data={data} batch={batch} level={level} onBatch={setBatch} onLevel={setLevel} />
        {!searching ? verdict : null}

        {!searching && !browseActive ? (
          <section className="welcome no-print">
            <h2>How to use this desk</h2>
            <ol>
              <li>Search by title first. Author and ISBN also work.</li>
              <li>A posted title opens an In collection card with approved ISBNs and the period it was posted.</li>
              <li>If it is not on the list, the desk will say so immediately.</li>
              <li>Use posted period or level chips to browse when you are not searching.</li>
            </ol>
          </section>
        ) : null}

        {!searching ? listPanel : null}
      </main>
      <Footer />
    </div>
  );
}
