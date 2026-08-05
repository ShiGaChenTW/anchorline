import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { Icon } from "@/components/primitives";

type EditableRowProps = {
  depth: number;
  kind: "file" | "folder";
  initialValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

export function EditableRow({ depth, kind, initialValue, onSubmit, onCancel }: EditableRowProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // select basename without the .md extension for fast rename
    const dot = initialValue.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initialValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    if (trimmed === initialValue) {
      onCancel();
      return;
    }
    onSubmit(trimmed);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const Glyph = kind === "folder" ? Folder : FileText;
  const padLeft = 8 + depth * 12 + (kind === "file" ? 4 : 0);

  return (
    <li className="mdv-tree__item">
      <div
        className={`mdv-tree__row mdv-tree__row--editing mdv-tree__row--${kind}`}
        style={{ paddingLeft: `${padLeft}px` }}
      >
        {kind === "folder" ? (
          <span className="mdv-tree__chevron" aria-hidden>
            <Icon icon={ChevronRight} size={12} strokeWidth={2} />
          </span>
        ) : null}
        <span className="mdv-tree__icon">
          <Icon icon={Glyph} size={13} strokeWidth={1.5} />
        </span>
        <input
          ref={inputRef}
          className="mdv-tree__edit-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={submit}
          onKeyDown={onKey}
          aria-label={`${kind} name`}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </li>
  );
}
