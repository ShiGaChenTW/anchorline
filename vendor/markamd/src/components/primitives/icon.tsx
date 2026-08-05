import type { LucideIcon } from "lucide-react";

type IconProps = {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  title?: string;
};

/**
 * Lucide icon wrapper with consistent default size + stroke.
 * Pass `title` to make it visible to screen readers, omit for decorative use.
 *
 * <Icon icon={Save} size={14} strokeWidth={1.5} />
 */
export function Icon({ icon: Component, size = 16, strokeWidth = 1.75, title }: IconProps) {
  return (
    <Component
      size={size}
      strokeWidth={strokeWidth}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
