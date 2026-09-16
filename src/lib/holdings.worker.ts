import {
  buildHoldingsIndex,
  lookupHoldingIsbn,
  searchHoldingsTokens,
  type HoldingsIndex,
} from "./holdings";
import { isbnQueryDigits, looksLikeIsbnQuery } from "./isbn";
import type { TitleRecord } from "../types";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

let index: HoldingsIndex | null = null;

function search(query: string): TitleRecord[] {
  if (!index) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (looksLikeIsbnQuery(trimmed)) {
    const hit = lookupHoldingIsbn(index, isbnQueryDigits(trimmed));
    return hit ? [hit] : [];
  }
  if (trimmed.length < 3) return [];
  return searchHoldingsTokens(index, trimmed, 12);
}

worker.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  if (data?.type === "load") {
    try {
      const response = await fetch(data.url);
      if (!response.ok) throw new Error(`Holdings file failed (${response.status})`);
      const compact = await response.json();
      index = buildHoldingsIndex(compact);
      worker.postMessage({ type: "ready", count: index.compact.n });
    } catch (error) {
      worker.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Holdings failed to load",
      });
    }
    return;
  }

  if (data?.type === "search") {
    worker.postMessage({ type: "results", id: data.id, results: search(String(data.query || "")) });
    return;
  }

  if (data?.type === "lookup") {
    const title = index ? lookupHoldingIsbn(index, String(data.isbn || "")) : null;
    worker.postMessage({ type: "lookup", id: data.id, title });
  }
};
