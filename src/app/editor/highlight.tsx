/** A small syntax highlighter for the export view: NWScript and JSON, by regular expressions, line by line. */
import type { JSX } from "react";

const NSS = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(#include\b)|\b(const|string|json|int|float|void|object|return|if|else|for|while)\b|\b(TRUE|FALSE|NUI_[A-Z0-9_]+)\b|\b([A-Z][A-Za-z0-9]*_[A-Z0-9_]+)\b|\b(Nui[A-Za-z]+|Json[A-Za-z]+)(?=\()|(-?\b\d+(?:\.\d+)?\b)/g;
const JSN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/g;

function line(text: string, lang: "nss" | "json"): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = new RegExp(lang === "nss" ? NSS : JSN);
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let cls = "";
    if (lang === "nss") cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "k" : m[5] ? "n" : m[6] ? "v" : m[7] ? "f" : "n";
    else cls = m[1] ? (m[2] ? "p" : "s") : m[3] ? "k" : "n";
    out.push(
      <span key={k++} className={`hl-${cls}`}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The text with spans; big texts (over 400 kB) plain, so a huge window does not stall the dialog. */
export function Highlighted({ text, lang }: { text: string; lang: "nss" | "json" }) {
  if (text.length > 400_000) return <>{text}</>;
  return (
    <>
      {text.split("\n").map((l, i) => (
        <span key={i}>
          {line(l, lang)}
          {"\n"}
        </span>
      ))}
    </>
  );
}
