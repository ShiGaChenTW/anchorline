import type { HTMLAttributes, ReactNode } from "react";

type KbdProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

/**
 * Visual keyboard-key chip. Use for shortcut hints in help overlay,
 * command palette items, and tooltips.
 *
 * <Kbd>⌘</Kbd> <Kbd>K</Kbd>
 */
export function Kbd({ children, className, ...rest }: KbdProps) {
  const classes = ["mdv-kbd"];
  if (className) classes.push(className);
  return (
    <kbd {...rest} className={classes.join(" ")}>
      {children}
    </kbd>
  );
}
