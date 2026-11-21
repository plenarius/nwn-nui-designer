/**
 * The original GUI's texture inventory: one row per texture the old GUI could draw, with its role, how a theme
 * treats it, whether anything draws it, and where it is used. Built from the user's own game (collect.ts) and kept
 * beside the user's theme as two text files, so the checks run later without the game (in a CI job, say):
 *
 *   old-gui-inventory.tsv   the rows
 *   old-gui-cells.json      every UV cell each drawn texture is sampled in, and its size
 *
 * Both hold names and numbers only, no art.
 */
import { type Cell, cellsFor, stateControls } from "./cells.js";
import type { Collection } from "./collect.js";
import { type Group, type Kind, type RoleOverride, type Treatment, builtinRole } from "./roles.js";
import { txiSummary } from "./txi.js";

export interface InventoryRow {
  resref: string;
  group: Group | "uncategorised";
  kind: Kind;
  role: string;
  treatment: Treatment | "";
  /** Something draws it (a model, a layout, a txi or the client names it) and the game has it. */
  drawn: boolean;
  /** "dds", "tga", ... ("" when missing), and its size "WxH". */
  format: string;
  size: string;
  /** Where it is read from (a hak or archive). */
  source: string;
  /** "filter 0, mipmap 0, clamp 3" and the like. */
  txi: string;
  models: string[];
  layouts: string[];
  client: boolean;
  txiFrom: string[];
  /** Controls that read a different cell of it per state ("model/node"). */
  stateControls: string[];
  /** The role came from the user's roles file. */
  own: boolean;
  /** The user's note for a kept icon a control reads per state. */
  stateIcon: string;
}

export interface CellsFile {
  about: string;
  /** texture -> its size and cells. */
  textures: Record<string, { size: [number, number]; cells: Cell[] }>;
}

export interface Inventory {
  rows: InventoryRow[];
  cells: CellsFile;
}

/** The user's own roles (old-gui-roles.json): { "textures": { name: RoleOverride } }. */
export interface RolesFile {
  textures: Record<string, RoleOverride>;
}

export function buildInventory(c: Collection, own: RolesFile | null = null): Inventory {
  const rows: InventoryRow[] = [];
  const cells: CellsFile["textures"] = {};
  for (const name of [...c.textures.keys()].sort()) {
    const t = c.textures.get(name)!;
    const used = t.models.size > 0 || t.layouts.size > 0 || t.client || t.txiFrom.size > 0;
    const builtin = builtinRole(name);
    const o = own?.textures[name];
    let group: InventoryRow["group"];
    let kind: Kind;
    let role: string;
    let treatment: InventoryRow["treatment"];
    if (!t.format) {
      [group, kind, role, treatment] = ["none", "none", "named by a model, layout, txi or the client, but the game has no such texture", "missing"];
    } else if (o) {
      [group, kind, role, treatment] = [o.group, o.kind ?? builtin?.kind ?? "none", o.role ?? builtin?.role ?? "", o.treatment];
    } else if (!used) {
      [group, kind, role, treatment] = [builtin?.group ?? "none", builtin?.kind ?? "none", builtin?.role ?? "in a GUI archive, drawn by nothing", "unused"];
    } else if (!builtin) {
      [group, kind, role, treatment] = ["uncategorised", "none", "", ""];
    } else {
      ({ group, kind, role, treatment } = builtin);
    }
    const uv = c.uv.get(name) ?? [];
    const drawn = used && !!t.format;
    let ctl: string[] = [];
    if (drawn && uv.length && t.width && t.height) {
      const cs = cellsFor(uv, t.width, t.height);
      cells[name] = { size: [t.width, t.height], cells: cs };
      ctl = [...stateControls(cs).keys()].sort();
    }
    rows.push({
      resref: name,
      group,
      kind,
      role,
      treatment,
      drawn,
      format: t.format,
      size: t.width ? `${t.width}x${t.height}` : "",
      source: t.source,
      txi: txiSummary(t.txi),
      models: [...t.models].sort(),
      layouts: [...t.layouts].sort(),
      client: t.client,
      txiFrom: [...t.txiFrom].sort(),
      stateControls: ctl,
      own: !!o,
      stateIcon: o?.stateIcon ?? "",
    });
  }
  return {
    rows,
    cells: {
      about:
        "Every UV cell the original GUI's models sample from each drawn texture: [x0, y0, x1, y1, sx, sy, refs...], texels with y 0 at the top, sx and sy the screen pixels per texel along each axis (0 = stretched at run time), refs model/node/animation. Written by pnpm old-gui inventory from your game; names and numbers only.",
      textures: cells,
    },
  };
}

const COLUMNS = ["resref", "group", "kind", "role", "treatment", "drawn", "format", "size", "source", "txi", "models", "layouts", "client", "txi_from", "state_controls", "own", "state_icon"] as const;

const MAX_LIST = 8;
const list = (xs: string[]) => xs.slice(0, MAX_LIST).join(" ") + (xs.length > MAX_LIST ? ` (+${xs.length - MAX_LIST})` : "");
const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");

/** The inventory as TSV (one row per texture, a header line first). */
export function inventoryTsv(rows: readonly InventoryRow[]): string {
  const out = [COLUMNS.join("\t")];
  for (const r of rows) {
    out.push(
      [
        r.resref,
        r.group,
        r.kind,
        r.role,
        r.treatment,
        r.drawn ? "yes" : "",
        r.format,
        r.size,
        r.source,
        r.txi,
        list(r.models),
        list(r.layouts),
        r.client ? "yes" : "",
        list(r.txiFrom),
        list(r.stateControls),
        r.own ? "yes" : "",
        r.stateIcon,
      ]
        .map(clean)
        .join("\t"),
    );
  }
  return `${out.join("\n")}\n`;
}

/** Reads an inventory TSV back (lists are cut to their first few names, with "(+N)" dropped). */
export function readInventoryTsv(text: string): InventoryRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const head = lines.shift()?.split("\t") ?? [];
  const missing = COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`not an old-GUI inventory (no ${missing.join(", ")} column)`);
  const col = (cells: string[], k: (typeof COLUMNS)[number]) => cells[head.indexOf(k)] ?? "";
  const names = (s: string) => s.split(" ").filter((x) => x && !/^\(\+\d+\)$/.test(x));
  return lines.map((l) => {
    const c = l.split("\t");
    return {
      resref: col(c, "resref"),
      group: col(c, "group") as InventoryRow["group"],
      kind: col(c, "kind") as Kind,
      role: col(c, "role"),
      treatment: col(c, "treatment") as InventoryRow["treatment"],
      drawn: col(c, "drawn") === "yes",
      format: col(c, "format"),
      size: col(c, "size"),
      source: col(c, "source"),
      txi: col(c, "txi"),
      models: names(col(c, "models")),
      layouts: names(col(c, "layouts")),
      client: col(c, "client") === "yes",
      txiFrom: names(col(c, "txi_from")),
      stateControls: names(col(c, "state_controls")),
      own: col(c, "own") === "yes",
      stateIcon: col(c, "state_icon"),
    };
  });
}

/** The cells file as JSON, one cell per line so a change reads as a small diff. */
export function cellsJson(f: CellsFile): string {
  const names = Object.keys(f.textures).sort();
  const body = names.map((n) => {
    const t = f.textures[n]!;
    return `  ${JSON.stringify(n)}: {"size": ${JSON.stringify(t.size)}, "cells": [\n${t.cells.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]}`;
  });
  return `{\n "about": ${JSON.stringify(f.about)},\n "textures": {\n${body.join(",\n")}\n }\n}\n`;
}

/** Counts of (treatment, drawn) for a summary line. */
export function inventoryCounts(rows: readonly InventoryRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.treatment || "uncategorised";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
