import type { MouseEvent } from "react";

/**
 * `onMouseDown` for the page navigation, tabs and segmented toggles: a mouse click doesn't move focus
 * to them. Focused by a click, they would get their keyboard focus ring as soon as any key is pressed
 * afterwards (the app has shortcuts), since browsers then treat the focus as keyboard focus. Tab still
 * focuses them, with the ring.
 */
export function keepFocus(e: MouseEvent) {
  e.preventDefault();
}
