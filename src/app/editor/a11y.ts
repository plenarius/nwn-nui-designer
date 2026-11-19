/**
 * Keyboard access for elements that act as buttons but cannot be <button>s (a header row that holds other controls, a
 * list item): role, tab stop, and Enter or Space to activate, as a button has.
 */
import type { KeyboardEvent } from "react";

export function pressable(onPress: () => void, extra: { expanded?: boolean; label?: string } = {}) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-expanded": extra.expanded,
    "aria-label": extra.label,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      // Only the element's own keys: a select or input inside it keeps Enter and Space.
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      onPress();
    },
  };
}
