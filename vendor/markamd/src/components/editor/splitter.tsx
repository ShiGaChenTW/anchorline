import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePersistedState } from "@/hooks";
import { STORAGE_KEYS } from "@/lib/storage";

type SplitterProps = {
  left: ReactNode;
  right: ReactNode;
  storageKey?: string;
  minRatio?: number;
  maxRatio?: number;
  defaultRatio?: number;
};

export function Splitter({
  left,
  right,
  storageKey = STORAGE_KEYS.splitterRatio,
  minRatio = 0.2,
  maxRatio = 0.8,
  defaultRatio = 0.5,
}: SplitterProps) {
  const [ratio, setRatio] = usePersistedState<number>(storageKey, defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = (e.clientX - rect.left) / rect.width;
      const clamped = Math.min(maxRatio, Math.max(minRatio, next));
      setRatio(clamped);
    },
    [maxRatio, minRatio, setRatio],
  );

  const stopDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer may already be released
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const leftPct = `${ratio * 100}%`;
  const rightPct = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className="mdv-splitter"
      style={{ gridTemplateColumns: `${leftPct} 1px ${rightPct}` }}
    >
      <div className="mdv-splitter__pane">{left}</div>
      <div
        className="mdv-splitter__handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      />
      <div className="mdv-splitter__pane">{right}</div>
    </div>
  );
}
