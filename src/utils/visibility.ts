import { useSyncExternalStore } from "react";

const onVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

/** False while the tab is in the background. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(onVisibility, () => document.visibilityState === "visible", () => true);
}
