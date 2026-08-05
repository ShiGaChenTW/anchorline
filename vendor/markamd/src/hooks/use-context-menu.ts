import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FileEntry } from "@/lib";

export type ContextMenuTarget = {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
};

type UseContextMenuResult = {
  contextMenu: ContextMenuTarget | null;
  handleContextMenu: (e: ReactMouseEvent, entry: FileEntry) => void;
  closeContextMenu: () => void;
};

export function useContextMenu(): UseContextMenuResult {
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);

  const handleContextMenu = useCallback((e: ReactMouseEvent, entry: FileEntry) => {
    setContextMenu({ x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.isDir });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, handleContextMenu, closeContextMenu };
}
