import { useEffect, useMemo, useState } from "react";
import { dirname, walkSupportedTextFiles, type FlatFileEntry } from "@/lib";

const MAX_RESULTS = 80;

type SearchResultsProps = {
  rootPath: string;
  query: string;
  activePath: string | null;
  treeVersion?: number;
  onSelect: (path: string) => void;
};

export function SearchResults({
  rootPath,
  query,
  activePath,
  treeVersion = 0,
  onSelect,
}: SearchResultsProps) {
  const [index, setIndex] = useState<FlatFileEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIndex(null);
    walkSupportedTextFiles(rootPath)
      .then((items) => {
        if (!cancelled) setIndex(items);
      })
      .catch(() => {
        if (!cancelled) setIndex([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, treeVersion]);

  const results = useMemo(() => {
    if (!index) return null;
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: FlatFileEntry[] = [];
    for (const e of index) {
      if (e.rel.toLowerCase().includes(q)) {
        out.push(e);
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [index, query]);

  if (!index) return <div className="mdv-tree__loading">indexing…</div>;
  if (results && results.length === 0) {
    return <div className="mdv-tree__empty">no matches</div>;
  }

  return (
    <ul className="mdv-search-results" role="listbox">
      {results?.map((r) => {
        const dir = dirname(r.rel);
        const isActive = r.path === activePath;
        return (
          <li key={r.path}>
            <button
              type="button"
              className={`mdv-search-result${isActive ? " is-active" : ""}`}
              title={r.path}
              onClick={() => onSelect(r.path)}
            >
              <span className="mdv-search-result__name">{r.name}</span>
              {dir && dir !== "/" ? (
                <span className="mdv-search-result__dir">{dir}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
