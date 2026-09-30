export const TOAST_EVENT = "claude-replay:toast";

export function toastError(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}
