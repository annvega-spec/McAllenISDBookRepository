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
import { collapseCollection } from "./lib/group";
import { buildHoldingsIndex, lookupHoldingIsbn, type CompactHoldings, type HoldingsIndex } from "./lib/holdings";
import { classifySearch, filterTitles, searchTitles } from "./lib/search";
import type { CollectionData, TitleRecord } from "./types";

const PAGE_SIZE = 40;

export default function App() {
  const [data, setData] = useState<CollectionData | null>(null);
  const [holdings, setHoldings] = useState<CompactHoldings | null>(null);
  const [holdingsReady, setHoldingsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const collectionUrl = `${import.meta.env.BASE_URL}data/collection.json`;
    fetch(collectionUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the posted title list.");
        return response.json() as Promise<CollectionData>;
      })
      .then((collection) => {
        setData(collection);
        const holdingsUrl = `${import.meta.env.BASE_URL}${collection.holdingsFile || "data/holdings.json"}`;
        return fetch(holdingsUrl).then((response) => {
          if (!response.ok) {
            setHoldingsReady(true);
            return null;
          }
          return response.json() as Promise<CompactHoldings>;
        });
      })
      .then((compact) => {
        if (compact) setHoldings(compact);
        setHoldingsReady(true);
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
          <p className="search-kicker">Loading the collection</p>
          <h2>Opening the collection desk…</h2>
          <p>Posted titles load first. District holdings follow so ISBN lookup stays fast.</p>
        </section>
        <Footer />
      </div>
    );
  }

  return <Desk data={data} holdings={holdings} holdingsReady={holdingsReady} />;
}

function Desk({
  data: raw,
  holdings,
  holdingsReady,
}: {
  data: CollectionData;
  holdings: CompactHoldings | null;
  holdingsReady: boolean;
}) {
  const data = useMemo(() => collapseCollection(raw), [raw]);
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("all");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounced = useDebouncedValue(query, 120);
  const pending = query.trim() !== debounced.trim();
  const searching = debounced.trim().length > 0 && !pending;
  const holdingsIndex = useMemo<HoldingsIndex | null>(
    () => (holdings ? buildHoldingsIndex(holdings) : null),
    [holdings],
  );
  const filteredBrowse = useMemo(
    () => (searching ? [] : filterTitles(data, batch, level)),
    [data, searching, batch, level],
  );

  const results = useMemo(
    () => (searching ? searchTitles(data, debounced, { limit: 60, batch, level, holdingsIndex }) : []),
    [data, searching, debounced, batch, level, holdingsIndex],
  );

  const classified = useMemo(() => classifySearch(results), [results]);
  const selected = useMemo<TitleRecord | null>(() => {
    if (!selectedId) return classified.match?.title ?? null;
    if (selectedId.startsWith("h:") && holdingsIndex) {
      const fromResults = results.find((item) => item.title.id === selectedId)?.title;
      if (fromResults) return fromResults;
      return lookupHoldingIsbn(holdingsIndex, selectedId.slice(2)) ?? classified.match?.title ?? null;
    }
    return data.titles.find((title) => title.id === selectedId) ?? classified.match?.title ?? null;
  }, [data.titles, selectedId, classified.match, holdingsIndex, results]);

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

  const searchHint = pending
    ? "Searching…"
    : !holdingsReady
      ? "Posted titles are ready. District holdings are still loading for ISBN lookup."
      : !query.trim()
        ? "HAVE IT / DON'T HAVE IT — title, author, or ISBN. Follett holdings without a title are still found by ISBN or author."
        : classified.match
          ? classified.match.title.inCollection && classified.match.title.posted !== false
            ? "HAVE IT — in the collection and posted for review."
            : classified.match.title.inCollection
              ? "HAVE IT — in the collection."
              : "HAVE IT — posted for HB 900 / SB 13 review."
          : showNoMatch
            ? "DON'T HAVE IT — no posted title or district holding matched this search."
            : `${results.length} matching title${results.length === 1 ? "" : "s"}`;

  const verdict = (
    <>
      {selected && (searching || selectedId) ? (
        <MatchCard title={selected} onClose={selectedId ? () => setSelectedId(null) : undefined} />
      ) : null}

      {showNoMatch ? (
        <NoMatch
          query={debounced}
          suggestions={searchTitles(data, debounced, { limit: 5, minScore: 0.18, batch, level, holdingsIndex })}
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
        <FilterBar data={data} batch={batch} level={level} onBatch={setBatch} onLevel={setLevel} />
        {!searching && !pending ? verdict : null}

        {!searching && !browseActive && !query.trim() ? (
          <section className="welcome no-print">
            <h2>How to use this desk</h2>
            <ol>
              <li>Search one list: posted review titles and Follett Destiny holdings.</li>
              <li>HAVE IT means the title is posted for review, already in the collection, or both.</li>
              <li>DON&apos;T HAVE IT means it is not on the posted list and not in the district holdings file.</li>
              <li>If Follett has no title, the card still shows ISBN and author.</li>
              <li>Additional Excel files go in the data/incoming folder; see the README to add them.</li>
            </ol>
          </section>
        ) : null}

        {!searching && !pending ? listPanel : null}
      </main>
      <Footer generatedAt={data.generatedAt} sourceCount={data.sourceFiles?.length} />
    </div>
  );
}
