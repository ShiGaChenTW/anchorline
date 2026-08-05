import { FileText } from "lucide-react";
import inspectUrl from "@/assets/mascot/inspect.png";

type DropOverlayProps = {
  active: boolean;
};

export function DropOverlay({ active }: DropOverlayProps) {
  if (!active) return null;
  return (
    <div className="mdv-drop" role="status" aria-live="polite">
      <div className="mdv-drop__panel">
        <img
          src={inspectUrl}
          alt=""
          aria-hidden
          width={120}
          height={120}
          draggable={false}
          className="mdv-drop__art"
        />
        <div className="mdv-drop__icon-row">
          <FileText size={16} strokeWidth={1.5} />
          <span>drop your markdown here</span>
        </div>
        <span className="mdv-drop__hint">.md · .markdown · .mdx</span>
      </div>
    </div>
  );
}
