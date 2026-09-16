import { useCallback, useEffect, useRef, useState } from "react";
import type { TitleRecord } from "./types";

type Status = "idle" | "loading" | "ready" | "error";

export function useHoldingsWorker(file?: string) {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, (value: unknown) => void>());
  const [status, setStatus] = useState<Status>(file ? "loading" : "idle");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!file) {
      setStatus("idle");
      return;
    }

    setStatus("loading");
    const worker = new Worker(new URL("./lib/holdings.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "ready") {
        setCount(data.count);
        setStatus("ready");
        return;
      }
      if (data?.type === "error") {
        setStatus("error");
        return;
      }
      if (data?.id && pending.current.has(data.id)) {
        pending.current.get(data.id)?.(data);
        pending.current.delete(data.id);
      }
    };
    worker.onerror = () => setStatus("error");

    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const url = new URL(file.replace(/^\//, ""), base).href;
    worker.postMessage({ type: "load", url });

    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.current.clear();
    };
  }, [file]);

  const request = useCallback((payload: Record<string, unknown>) => {
    return new Promise<unknown>((resolve) => {
      const worker = workerRef.current;
      if (!worker) {
        resolve(null);
        return;
      }
      const id = crypto.randomUUID();
      pending.current.set(id, resolve);
      worker.postMessage({ ...payload, id });
    });
  }, []);

  const search = useCallback(
    async (query: string): Promise<TitleRecord[]> => {
      if (status !== "ready") return [];
      const data = (await request({ type: "search", query })) as { results?: TitleRecord[] } | null;
      return data?.results ?? [];
    },
    [request, status],
  );

  const lookup = useCallback(
    async (isbn: string): Promise<TitleRecord | null> => {
      if (status !== "ready" || !isbn) return null;
      const data = (await request({ type: "lookup", isbn })) as { title?: TitleRecord | null } | null;
      return data?.title ?? null;
    },
    [request, status],
  );

  return { status, count, search, lookup };
}
