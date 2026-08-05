import { useEffect, type ReactNode } from "react";

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  /** controls width preset — "palette" = 560px, "modal" = 580px */
  variant?: "palette" | "modal";
};

/**
 * Backdrop + centered floating panel + esc-close + outside-click-close.
 * Shared by CommandPalette and HelpOverlay.
 */
export function Overlay({ open, onClose, children, ariaLabel, variant = "palette" }: OverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="mdv-overlay__backdrop" onClick={onClose} aria-hidden />
      <div
        className={`mdv-overlay mdv-overlay--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}
