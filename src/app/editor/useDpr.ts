import { useSyncExternalStore } from "react";

/** window.devicePixelRatio, kept current: it changes with the browser's zoom and when the window moves screens. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, () => window.devicePixelRatio || 1, () => 1);
}

function subscribe(changed: () => void): () => void {
  // A resolution query matches only the current ratio: when it stops matching, listen again for the new one.
  let mq: MediaQueryList | null = null;
  const listen = () => {
    mq?.removeEventListener("change", onChange);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener("change", onChange);
  };
  const onChange = () => {
    listen();
    changed();
  };
  listen();
  return () => mq?.removeEventListener("change", onChange);
}
