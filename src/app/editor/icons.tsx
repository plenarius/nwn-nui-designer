/** Small line icons (16 x 16, currentColor), drawn for this project. */
import type { JSX } from "react";

const P: Record<string, JSX.Element> = {
  row: (
    <>
      <rect x="1.5" y="3.5" width="3.5" height="9" rx="1" />
      <rect x="6.25" y="3.5" width="3.5" height="9" rx="1" />
      <rect x="11" y="3.5" width="3.5" height="9" rx="1" />
    </>
  ),
  col: (
    <>
      <rect x="3.5" y="1.5" width="9" height="3.5" rx="1" />
      <rect x="3.5" y="6.25" width="9" height="3.5" rx="1" />
      <rect x="3.5" y="11" width="9" height="3.5" rx="1" />
    </>
  ),
  group: (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
      <rect x="4" y="4" width="8" height="8" rx="1" strokeDasharray="2 1.5" />
    </>
  ),
  list: (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
      <path d="M4 5h8M4 8h8M4 11h8" />
    </>
  ),
  spacer: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="1" strokeDasharray="2 1.5" />
      <path d="M4 8h8M5.5 6.5 4 8l1.5 1.5M10.5 6.5 12 8l-1.5 1.5" />
    </>
  ),
  label: <path d="M3.5 13 8 3l4.5 10M5.2 9.5h5.6" />,
  text: <path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h7" />,
  button: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="2" />
      <path d="M5 8h6" />
    </>
  ),
  button_image: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="m4 11 3-3 2 2 1.5-1.5L12 11" />
      <circle cx="10.5" cy="5.5" r="1" />
    </>
  ),
  button_select: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="2" />
      <rect x="3.5" y="6" width="5" height="4" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  check: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m4.5 8.2 2.3 2.3 4.7-5" />
    </>
  ),
  tabbar: (
    <>
      <path d="M1.5 13.5h13M2.5 13.5V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v8M7.5 7.5h5a1 1 0 0 1 1 1v5" />
    </>
  ),
  options: (
    <>
      <circle cx="4.5" cy="5" r="2.5" />
      <circle cx="4.5" cy="5" r="0.8" fill="currentColor" />
      <circle cx="4.5" cy="11.5" r="2.5" />
      <path d="M9 5h5.5M9 11.5h5.5" />
    </>
  ),
  combo: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="m9.5 7 1.75 1.75L13 7" />
    </>
  ),
  slider: (
    <>
      <path d="M1.5 8h13" />
      <rect x="6" y="4.5" width="3" height="7" rx="1" fill="var(--panel)" />
    </>
  ),
  sliderf: (
    <>
      <path d="M1.5 8h13" />
      <circle cx="10" cy="8" r="2.6" fill="var(--panel)" />
    </>
  ),
  textedit: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M5 6v4" />
    </>
  ),
  color_picker: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="9" cy="5" r="1" fill="currentColor" />
      <circle cx="11" cy="8.5" r="1" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="m3.5 11.5 3.5-4 2.5 2.5 1.5-1.5 2 3" />
      <circle cx="11" cy="5.5" r="1.2" />
    </>
  ),
  progress: (
    <>
      <rect x="1.5" y="5.5" width="13" height="5" rx="1.5" />
      <rect x="2.5" y="6.5" width="6.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  chart: <path d="M2 14V2M2 14h12M5 11V8M8 11V5M11 11V7" />,
  drawing: (
    <>
      <path d="m10.5 2.5 3 3-7.5 7.5H3v-3z" />
      <path d="m9 4 3 3" />
    </>
  ),
  window: (
    <>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
      <path d="M1.5 5.5h13" />
    </>
  ),
  undo: <path d="M5.5 3 2.5 6l3 3M3 6h6.5a4 4 0 0 1 0 8H7" />,
  redo: <path d="m10.5 3 3 3-3 3M13 6H6.5a4 4 0 0 0 0 8H9" />,
  new: <path d="M9.5 1.5H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.5zM9.5 1.5v4h4M8 7.5v5M5.5 10h5" />,
  open: <path d="M1.5 4V3a1 1 0 0 1 1-1h3.5l1.5 2H13a1 1 0 0 1 1 1v1.5M1.5 4v9h11l2-6.5H3.5L1.5 13" />,
  save: (
    <>
      <path d="M2.5 2.5h9l2 2v9h-11z" />
      <path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4" />
    </>
  ),
  export: <path d="M8 10.5V1.5M4.5 5 8 1.5 11.5 5M2.5 9.5v4h11v-4" />,
  import: <path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2.5 9.5v4h11v-4" />,
  zoomIn: (
    <>
      <circle cx="7" cy="7" r="5" />
      <path d="m10.5 10.5 4 4M5 7h4M7 5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="5" />
      <path d="m10.5 10.5 4 4M5 7h4" />
    </>
  ),
  fit: <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />,
  trash: <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />,
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </>
  ),
  up: <path d="M8 13V3M4 7l4-4 4 4" />,
  down: <path d="M8 3v10M4 9l4 4 4-4" />,
  unwrap: <path d="M2 2v12M14 2v12M5.5 8h5M7 6l-2 2 2 2M9 6l2 2-2 2" />,
  link: <path d="M6.5 9.5 9.5 6.5M7 4.5l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5 7.5 13a2.8 2.8 0 0 1-4-4L5 7.5" />,
  unlink: <path d="M7 4.5l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5 7.5 13a2.8 2.8 0 0 1-4-4L5 7.5M2 2l12 12" />,
  close: <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />,
  error: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4.5M8 11.2v.3" />
    </>
  ),
  warning: <path d="M8 1.8 14.8 13.5H1.2zM8 6v3.8M8 11.6v.3" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4.5M8 4.6v.3" />
    </>
  ),
  chevron: <path d="m6 4 4 4-4 4" />,
  chevronDown: <path d="m4 6 4 4 4-4" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  folder: <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />,
  keyboard: (
    <>
      <rect x="1" y="4" width="14" height="8" rx="1.5" />
      <path d="M4 7h.5M7 7h.5M10 7h.5M12 7h.5M4.5 9.5h7" />
    </>
  ),
  eye: (
    <>
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  rules: <path d="M3 4.5h1.5M3 8h1.5M3 11.5h1.5M7 4.5h6M7 8h6M7 11.5h6" />,
  sparkle: <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.5 3.5l2.2 2.2M10.3 10.3l2.2 2.2M12.5 3.5l-2.2 2.2M5.7 10.3l-2.2 2.2" />,
  grip: <path d="M6 3.5h.1M10 3.5h.1M6 8h.1M10 8h.1M6 12.5h.1M10 12.5h.1" strokeWidth="2.2" strokeLinecap="round" />,
  notes: <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 5.5h2" />,
  brush: <path d="M13.5 1.5 7 8l1 1 6.5-6.5zM7 8c-2 0-3 1-3 2.5S3 13 1.5 14c2.5.5 6.5 0 6.5-4z" />,
  font: <path d="M2 13.5 5.5 3h1L10 13.5M3.2 10h5.6M11 8.5c.5-.7 1.2-1 2-1 1.3 0 2 .8 2 2v4M15 10.5c-3 0-4 .7-4 1.7 0 .9.7 1.3 1.6 1.3 1.2 0 2.4-1 2.4-2" />,
  // Align: a line on the edge (or centre) and two bars of different lengths against it.
  alignLeft: <path d="M2 1.5v13M4.5 4.5h8M4.5 10.5h5M4.5 3.5v2M4.5 9.5v2" />,
  alignHCenter: <path d="M8 1.5v13M3.5 4.5h9M5 10.5h6" />,
  alignRight: <path d="M14 1.5v13M11.5 4.5h-8M11.5 10.5h-5M11.5 3.5v2M11.5 9.5v2" />,
  alignTop: <path d="M1.5 2h13M4.5 4.5v8M10.5 4.5v5M3.5 4.5h2M9.5 4.5h2" />,
  alignVCenter: <path d="M1.5 8h13M4.5 3.5v9M10.5 5v6" />,
  alignBottom: <path d="M1.5 14h13M4.5 11.5v-8M10.5 11.5v-5M3.5 11.5h2M9.5 11.5h2" />,
  // Equal gaps: three boxes with the room between them marked.
  gapsH: (
    <>
      <rect x="1" y="4.5" width="3" height="7" rx="0.5" />
      <rect x="6.5" y="4.5" width="3" height="7" rx="0.5" />
      <rect x="12" y="4.5" width="3" height="7" rx="0.5" />
      <path d="M4.5 2.5h1.5M10 2.5h1.5" />
    </>
  ),
  gapsV: (
    <>
      <rect x="4.5" y="1" width="7" height="3" rx="0.5" />
      <rect x="4.5" y="6.5" width="7" height="3" rx="0.5" />
      <rect x="4.5" y="12" width="7" height="3" rx="0.5" />
      <path d="M2.5 4.5V6M2.5 10v1.5" />
    </>
  ),
  // Equal sizes: two boxes of one width (height) with the size marked over (beside) them.
  sizesH: (
    <>
      <rect x="1.5" y="6" width="5.5" height="7" rx="0.5" />
      <rect x="9" y="6" width="5.5" height="7" rx="0.5" />
      <path d="M1.5 3h5.5M9 3h5.5M1.5 2v2M7 2v2M9 2v2M14.5 2v2" />
    </>
  ),
  sizesV: (
    <>
      <rect x="6" y="1.5" width="7" height="5.5" rx="0.5" />
      <rect x="6" y="9" width="7" height="5.5" rx="0.5" />
      <path d="M3 1.5V7M3 9v5.5M2 1.5h2M2 7h2M2 9h2M2 14.5h2" />
    </>
  ),
  // Match size: a small box and a large one, an arrow growing the small one.
  matchW: (
    <>
      <rect x="1.5" y="2" width="13" height="4.5" rx="0.5" />
      <rect x="1.5" y="9.5" width="7" height="4.5" rx="0.5" />
      <path d="M10.5 11.75h4M13 10.25l1.5 1.5-1.5 1.5" />
    </>
  ),
  matchH: (
    <>
      <rect x="2" y="1.5" width="4.5" height="13" rx="0.5" />
      <rect x="9.5" y="1.5" width="4.5" height="7" rx="0.5" />
      <path d="M11.75 10.5v4M10.25 13l1.5 1.5 1.5-1.5" />
    </>
  ),
  matchBoth: (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="0.5" />
      <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" strokeDasharray="2 1.5" />
      <path d="M9.5 9.5l3.5 3.5M13 10v3h-3" />
    </>
  ),
  bind: <path d="M5 3.5c-2 0-2 1-2 2.5S2 8 1.5 8C2 8 3 8.5 3 10s0 2.5 2 2.5M11 3.5c2 0 2 1 2 2.5S14 8 14.5 8c-.5 0-1.5.5-1.5 2s0 2.5-2 2.5" />,
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const p = P[name] ?? P.spacer;
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}

/** The icon of an element type (toggles drawn as tabs). */
export function typeIcon(t: string): string {
  if (t === "toggles") return "tabbar";
  return t in P ? t : "spacer";
}
