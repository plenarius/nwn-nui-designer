/**
 * The one modal dialog: a native `<dialog>` opened with `showModal()`, so the browser keeps Tab inside it and makes the
 * page behind it inert. Mounting it opens it and unmounting closes it: the caller's state is the only record of
 * whether it is open. Escape (the native `cancel`), the Close button and a press on the backdrop all call `onClose`,
 * once. Focus moves to the element marked `data-autofocus`, or else to the first control (the Close button); when the
 * dialog goes, focus returns to the element that had it before, if that is still on the page.
 */
import { type ReactNode, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Icon } from "./icons.js";

// The open dialogs, newest last: what is drawn above the page (the toasts go into the newest, or they would sit
// under its backdrop and be inert).
let open: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** The newest open dialog, or null. */
export function useTopModal(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribe, () => open[open.length - 1] ?? null);
}

export function Modal({ title, icon, className, onClose, children }: { title: ReactNode; icon: string; className?: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const d = ref.current!;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    let done = false;
    const request = () => {
      if (done) return;
      done = true;
      close.current();
    };
    // Escape: let the browser close it (Chrome does not always let `cancel` be cancelled), then tell the caller. A
    // `close` event while the dialog is open again is stale: React's StrictMode (the dev server) runs this effect,
    // its cleanup (which closes the dialog and queues that event) and the effect again, and the queued event would
    // otherwise shut the dialog it just reopened.
    const onNativeClose = () => {
      if (!d.open) request();
    };
    // A press outside the dialog's box lands on the dialog itself (its ::backdrop).
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) {
        // Not the mousedown that follows, which would move focus to whatever is under the pointer once it is gone.
        e.preventDefault();
        request();
      }
    };
    d.addEventListener("close", onNativeClose);
    d.addEventListener("pointerdown", onPointerDown);
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    open = [...open, d];
    changed();
    return () => {
      d.removeEventListener("close", onNativeClose);
      d.removeEventListener("pointerdown", onPointerDown);
      if (d.open) d.close();
      open = open.filter((x) => x !== d);
      changed();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={ref} className={`modal${className ? ` ${className}` : ""}`} aria-labelledby={titleId}>
      <div className="modal-head">
        <Icon name={icon} size={18} />
        <h2 id={titleId}>{title}</h2>
        <button className="icon-btn" onClick={() => close.current()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
