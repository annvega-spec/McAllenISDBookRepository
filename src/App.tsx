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
import { lookupOwnedIsbn, prepareOwned } from "./lib/owned";
import type { CollectionData, OwnedCatalog, SourceFilter, TitleRecord } from "./types";

const PAGE_SIZE = 40;

export default function App() {
  const [data, setData] = useState<CollectionData | null>(null);
  const [ownedRaw, setOwnedRaw] = useState<OwnedCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}data/collection.json`).then((response) => {
        if (!response.ok) throw new Error("Could not load the posted title list.");
        return response.json() as Promise<CollectionData>;
      }),
      fetch(`${base}data/owned.json`)
        .then((response) => (response.ok ? (response.json() as Promise<OwnedCatalog>) : null))
        .catch(() => null),
    ])
      .then(([collection, owned]) => {
        setData(collection);
        setOwnedRaw(owned);
      })
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
          <p className="search-kicker">Loading collection</p>
          <h2>Opening the collection desk…</h2>
          <p>The posted list and owned ISBN index are loading in this browser. No server is required after that.</p>
        </section>
        <Footer />
      </div>
    );
  }

  return <Desk data={data} ownedRaw={ownedRaw} />;
}

function Desk({ data, ownedRaw }: { data: CollectionData; ownedRaw: OwnedCatalog | null }) {
  const owned = useMemo(() => prepareOwned(ownedRaw), [ownedRaw]);
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("all");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounced = useDebouncedValue(query, 120);
  const pending = query.trim() !== debounced.trim();
  const searching = debounced.trim().length > 0 && !pending;
  const filteredBrowse = useMemo(
    () => (searching ? [] : filterTitles(data, batch, level, source)),
    [data, searching, batch, level, source],
  );

  const results = useMemo(
    () => (searching ? searchTitles(data, debounced, { limit: 60, batch, level, source, owned }) : []),
    [data, searching, debounced, batch, level, source, owned],
  );

  const classified = useMemo(() => classifySearch(results), [results]);
  const selected = useMemo<TitleRecord | null>(() => {
    if (!selectedId) return classified.match?.title ?? null;
    const fromNamed = data.titles.find((title) => title.id === selectedId);
    if (fromNamed) return fromNamed;
    const fromResults = results.find((item) => item.title.id === selectedId)?.title;
    if (fromResults) return fromResults;
    if (selectedId.startsWith("owned-")) {
      return lookupOwnedIsbn(owned, selectedId.slice("owned-".length));
    }
    return classified.match?.title ?? null;
  }, [data.titles, selectedId, classified.match, results, owned]);

  useEffect(() => {
    setSelectedId(null);
    setVisibleCount(PAGE_SIZE);
  }, [debounced, batch, level, source]);

  const browseActive = batch !== "all" || level !== "all" || source !== "all";
  const listItems = searching
    ? classified.match
      ? classified.close
      : classified.list.slice(0, 40)
    : filteredBrowse.slice(0, visibleCount).map((title) => ({ title, score: 0, reason: "title" as const }));

  const showNoMatch = searching && !classified.match && classified.list.length === 0;
  const showSuggestionsOnly =
    searching && !classified.match && classified.list.length > 0 && classified.list[0].score < 0.62;

  const searchHint = pending
    ? "Searching…"
    : !query.trim()
      ? "Ask HAVE IT by title, author, or ISBN. Follett holdings match by ISBN; named lists also match by title."
      : classified.match
        ? "HAVE IT — this title is on a posted list, in the owned collection, and/or on an eBook order list."
        : showNoMatch
          ? "Do not have it — no posted, owned, or eBook-order match."
          : `${results.length} matching title${results.length === 1 ? "" : "s"}`;

  const verdict = (
    <>
      {selected && (searching || selectedId) ? (
        <MatchCard title={selected} onClose={selectedId ? () => setSelectedId(null) : undefined} />
      ) : null}

      {showNoMatch ? (
        <NoMatch
          query={debounced}
          suggestions={searchTitles(data, debounced, { limit: 5, minScore: 0.18, batch, level, source, owned })}
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
        {searching && !pending ? verdict : null}
        {searching && !pending ? listPanel : null}
        <StatsStrip data={data} />
        <FilterBar
          data={data}
          batch={batch}
          level={level}
          source={source}
          onBatch={setBatch}
          onLevel={setLevel}
          onSource={setSource}
        />
        {!searching && !pending ? verdict : null}

        {!searching && !browseActive && !query.trim() ? (
          <section className="welcome no-print">
            <h2>How to use this desk</h2>
            <ol>
              <li>Search to see if we HAVE IT. Title and author search the named lists; ISBN also checks Follett holdings.</li>
              <li>A match card can show more than one status: posted for community review, in collection / owned, and eBook order list.</li>
              <li>If it is not on any of those lists, the desk will say so immediately.</li>
              <li>Use source, list, or level chips to browse named titles when you are not searching.</li>
              <li>New Excel files still go in the data/incoming folder; the five files already imported stay there for the next rebuild.</li>
            </ol>
          </section>
        ) : null}

        {!searching && !pending ? listPanel : null}
      </main>
      <Footer generatedAt={data.generatedAt} sourceCount={data.sourceFiles?.length} ownedCount={data.owned?.count} />
    </div>
  );
}
