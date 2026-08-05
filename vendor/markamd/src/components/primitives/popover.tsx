import { useEffect, useRef, type ReactNode } from "react";

type PopoverProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "left" | "right";
};

/**
 * Anchored popover (inline, positioned relative to a parent). Closes on
 * outside click or Esc. Use for menus attached to title-bar buttons.
 * For centered modals/overlays, use {@link Overlay} instead.
 */
export function Popover({ open, onClose, anchorRef, children, align = "right" }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div ref={ref} className={`mdv-popover mdv-popover--${align}`} role="menu">
      {children}
    </div>
  );
}
