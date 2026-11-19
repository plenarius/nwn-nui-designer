// A port of nwn-module tools/nui-preview/test_layout.py: the layout solver on small layouts whose client layout is
// known.
import { describe, expect, it } from "vitest";
import { UnsatisfiableLayout, clearLayoutCache, marginOf, paddingOf, solveContent, solveFresh, solveRowTemplate } from "../src/core/layout/layout.js";
import type { JsonObject } from "../src/core/model/types.js";
import { checkRequiredSizes } from "../src/core/render/check.js";

function button(w?: number, h?: number, kw: JsonObject = {}): JsonObject {
  const e: JsonObject = { type: "button", label: "x", ...kw };
  if (w !== undefined) e.width = w;
  if (h !== undefined) e.height = h;
  return e;
}

function row(children: JsonObject[], w?: number, h?: number, margin?: number): JsonObject {
  const e: JsonObject = { type: "row", children };
  if (w !== undefined) e.width = w;
  if (h !== undefined) e.height = h;
  if (margin !== undefined) e.margin = margin;
  return e;
}

function col(children: JsonObject[], w?: number, h?: number, margin?: number): JsonObject {
  return { ...row(children, w, h, margin), type: "col" };
}

function expectRect(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));
}

describe("layout", () => {
  it("row places children with margins", () => {
    const s = solveContent([row([button(100, 32), button(50, 32)], 400, 36, 0)], 400, 36, "");
    const [a, b] = s.nodes[0]!.children;
    expectRect(a!.rect, [2, 2, 100, 32]);
    expectRect(b!.rect, [106, 2, 50, 32]);
  });

  it("kit footprints", () => {
    // nui_i_kit: a row 36 high holds 32 high controls with their 2 + 2 margins; a column stacks footprints.
    const s = solveContent(
      [col([row([button(106, 32)], 920, 36, 0), row([button(106, 32)], 920, 36, 0)], 920, 72, 0)],
      944,
      600,
      "",
    );
    const [top, bottom] = s.nodes[0]!.children;
    expectRect(top!.rect.slice(0, 2), [0, 0]);
    expectRect(bottom!.rect.slice(0, 2), [0, 36]);
    expectRect(bottom!.children[0]!.rect, [2, 38, 106, 32]);
  });

  it("unsized button is 150 wide", () => {
    const s = solveContent([row([button(undefined, 30)], 600, 34, 0)], 600, 34, "");
    expect(s.nodes[0]!.children[0]!.rect[2]).toBeCloseTo(150, 6);
  });

  // docs/CLIENT-BEHAVIOUR.md#default-sizes: each widget alone in a roomy column, no width or height of its own.
  const alone = (e: JsonObject) => solveContent([col([e], 600, 400, 0)], 600, 400, "").nodes[0]!.children[0]!.rect;
  it.each([
    ["button", 150, 50],
    ["button_image", 150, 50],
    ["slider", 150, 35],
    ["sliderf", 150, 35],
    ["progress", 150, 35],
    ["combo", 150, 35],
  ])("an unsized %s is %d x %d, strong: it beats its column's fit", (type, w, h) => {
    const [, , rw, rh] = alone({ type });
    expect(rw).toBeCloseTo(w, 6);
    expect(rh).toBeCloseTo(h, 6);
  });

  it("an unsized check is 35 high (strong), its 150 width weak: the column's fit wins", () => {
    const [, , w, h] = alone({ type: "check" });
    expect(h).toBeCloseTo(35, 6);
    expect(w).toBeCloseTo(596, 6);
    // In a row the check's width is not pulled by anything else: its weak 150 holds.
    const r = solveContent([row([{ type: "check" }, { type: "spacer" }], 600, 39, 0)], 600, 39, "").nodes[0]!.children[0]!.rect;
    expect(r[2]).toBeCloseTo(150, 6);
  });

  it("an unsized text edit is 35 high and takes its column's width", () => {
    const [, , w, h] = alone({ type: "textedit" });
    expect(h).toBeCloseTo(35, 6);
    expect(w).toBeCloseTo(596, 6);
  });

  it("a required width or height overrides the default; a label has none", () => {
    expect(alone({ type: "button", width: 80, height: 20 }).slice(2)).toEqual([80, 20]);
    const [, , w, h] = alone({ type: "label" });
    expect(w).toBeCloseTo(596, 6);
    expect(h).toBeCloseTo(396, 6);
  });

  it("a default height is strong: a column too short overflows rather than squeezing the button", () => {
    const s = solveContent([col([button(100), button(100)], 200, 60, 0)], 200, 60, "");
    expect(s.nodes[0]!.children.map((c) => c.rect[3])).toEqual([50, 50]);
    expect(s.extent()[1]).toBeCloseTo(108, 6);
  });

  it("horizontal options: one 150 x 35 entry per label, margin 2 each (SelectList::MakeButtons)", () => {
    const s = solveContent([row([{ type: "options", direction: 0, elements: ["A", "B", "C"] }, { type: "spacer" }], 600, 100, 0)], 600, 100, "");
    const o = s.nodes[0]!.children[0]!;
    expect(o.children.map((c) => c.rect)).toEqual([
      [2, 2, 150, 35],
      [156, 2, 150, 35],
      [310, 2, 150, 35],
    ]);
    expectRect(o.rect.slice(0, 3), [0, 0, 462]);
    expect(o.children[0]!.path).toBe("/row[0]/options/entry 0");
  });

  it("vertical toggles: entries 39 apart, as wide as the column", () => {
    const s = solveContent([col([{ type: "tabbar", direction: 1, elements: ["A", "B"] }, { type: "spacer" }], 300, 400, 0)], 300, 400, "");
    const t = s.nodes[0]!.children[0]!;
    expect(t.children.map((c) => c.rect)).toEqual([
      [2, 2, 296, 35],
      [2, 41, 296, 35],
    ]);
  });

  it("the Options window: label and 2-entry options, then a Close button, overflow a 392 x 72 body", () => {
    const root = col([row([{ type: "label", value: "Theme" }, { type: "options", direction: 0, elements: ["Ink", "Bronze"] }]), { type: "button", label: "Close" }]);
    const s = solveContent([root], 392, 72, "");
    const [r, b] = s.extent();
    // 39 + 4 (the row) + 50 + 4 (the button).
    expect(b).toBeCloseTo(97, 6);
    expect(r).toBeLessThanOrEqual(392);
    const [line, close] = s.nodes[0]!.children;
    expect(line!.children[1]!.rect[2]).toBeCloseTo(308, 6);
    expect(close!.rect.slice(2)).toEqual([150, 50]);
  });

  it("a SelectList's entry margins are required: options 3 high cannot hold an entry, and the check says so", () => {
    const o = { type: "options", direction: 0, elements: ["A"], height: 3 };
    expect(() => solveFresh([col([o])], 400, 100, "")).toThrow(UnsatisfiableLayout);
    expect(checkRequiredSizes(col([o])).map((p) => p.kind)).toEqual(["unsolvable size"]);
    expect(checkRequiredSizes(col([{ ...o, height: 4 }]))).toEqual([]);
  });

  it("spacers share the rest", () => {
    const s = solveContent([row([{ type: "spacer" }, button(100, 30), { type: "spacer" }], 404, 34, 0)], 404, 34, "");
    const [left, b, right] = s.nodes[0]!.children;
    expect(left!.rect[2]).toBeCloseTo(right!.rect[2], 3);
    // A spacer has no margin (Widgets::spacer): the button starts its own 2 px after the spacer's edge.
    expect(left!.rect[0]).toBeCloseTo(0, 3);
    expect(b!.rect[0]).toBeCloseTo(left!.rect[2] + 2, 3);
  });

  it("a spacer, a tabbar and options have margin 0; every other widget 2 (docs/CLIENT-BEHAVIOUR.md#layout)", () => {
    expect(marginOf({ type: "spacer" })).toBe(0);
    expect(marginOf({ type: "tabbar" })).toBe(0);
    expect(marginOf({ type: "options" })).toBe(0);
    for (const t of ["button", "label", "row", "col", "group", "list", "text", "image", "check", "combo", "progress"]) {
      expect(marginOf({ type: t })).toBe(2);
    }
    expect(paddingOf({ type: "row" })).toBe(0);
  });

  it("an explicit margin or padding of 0 or more wins for every widget; -1 means not set", () => {
    expect(marginOf({ type: "spacer", margin: 3 })).toBe(3);
    expect(marginOf({ type: "button", margin: 0 })).toBe(0);
    expect(marginOf({ type: "button", margin: -1 })).toBe(2);
    expect(marginOf({ type: "spacer", margin: -1 })).toBe(0);
    expect(paddingOf({ type: "row", padding: 4 })).toBe(4);
    expect(paddingOf({ type: "row", padding: -1 })).toBe(0);
  });

  it("the deity window's root row: the right pane sits 4 px further left than with a 2 px spacer margin", () => {
    const g = (w: number): JsonObject => ({ type: "group", children: [], width: w, height: 100 });
    const s = solveContent([row([g(260), { type: "spacer", width: 16 }, g(530)], undefined, 104)], 820, 104, "");
    const [left, sp, right] = s.nodes[0]!.children;
    expectRect(left!.rect, [2, 2, 260, 100]);
    expectRect(sp!.rect.slice(0, 3), [264, 0, 16]);
    // 2 + 260 + 2 + 16 + 2 (was 286 with the spacer's old 2 + 2).
    expect(right!.rect[0]).toBeCloseTo(282, 6);
  });

  it("tabbar and options lie flush in their row", () => {
    const s = solveContent([row([{ type: "tabbar", width: 200, height: 30 }, { type: "options", width: 100, height: 30 }], 400, 30, 0)], 400, 30, "");
    const [t, o] = s.nodes[0]!.children;
    expectRect(t!.rect, [0, 0, 200, 30]);
    expectRect(o!.rect, [200, 0, 100, 30]);
  });

  it("list row cells", () => {
    const [a, b] = solveRowTemplate(
      [
        [{ type: "label" }, 0, true],
        [{ type: "label" }, 90, false],
      ],
      350,
      24,
      "",
    );
    expectRect(a!.rect, [2, 0, 256, 24]);
    expectRect(b!.rect, [262, 0, 86, 24]);
  });

  it("extent of a top span is its children", () => {
    const s = solveContent([row([button(100, 32)], 500, 36, 0)], 300, 600, "");
    const [r, b] = s.extent();
    expect(r).toBeCloseTo(104, 6);
    expect(b).toBeCloseTo(36, 6);
  });

  it("names the element whose required constraint is refused (test_unsolvable_layout_names_the_element)", () => {
    // A button taller than its row: the client refuses the window ("The constraint can not be satisfied").
    let err: unknown;
    try {
      solveContent([col([row([button(160, 40)], undefined, 34)])], 400, 100, "");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsatisfiableLayout);
    expect((err as UnsatisfiableLayout).path).toBe("/col[0]/row[0]/button");
  });
});

describe("layout cache", () => {
  // Random layouts as golden/layout_fuzz.ts makes them: nested spans, missing and conflicting sizes, margins, padding,
  // aspect and spacers, where the solver's pivoting picks between equally good solutions.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  function leaf(): JsonObject {
    const e: JsonObject = { type: pick(["label", "button", "spacer", "image", "spacer"]) };
    if (rnd() < 0.6) e.width = pick([20, 32, 50, 100, 150, 220]);
    if (rnd() < 0.7) e.height = pick([16, 24, 30, 32, 40]);
    if (rnd() < 0.15) e.margin = pick([0, 1, 4, 8]);
    if (rnd() < 0.08) e.aspect = pick([0.5, 1, 2]);
    return e;
  }
  function span(depth: number): JsonObject {
    const kids: JsonObject[] = [];
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) kids.push(depth < 3 && rnd() < 0.4 ? span(depth + 1) : leaf());
    const e: JsonObject = { type: pick(["row", "col"]), children: kids };
    if (rnd() < 0.3) e.width = pick([100, 200, 300, 500]);
    if (rnd() < 0.3) e.height = pick([40, 100, 200, 400]);
    if (rnd() < 0.15) e.padding = pick([0, 2, 6]);
    return e;
  }
  const rects = (s: { nodes: { rect: number[]; children: unknown[] }[] }) => {
    const out: number[] = [];
    const go = (n: { rect: number[]; children: unknown[] }) => {
      out.push(...n.rect);
      for (const c of n.children) go(c as typeof n);
    };
    s.nodes.forEach(go);
    return out;
  };

  // Its own timeout: 120 random layouts, each solved at 10 sizes twice (fresh and cached): seconds of CPU on a slow or busy machine.
  it("solves every size exactly as a solver built for it, in any order of sizes", () => {
    clearLayoutCache();
    for (let i = 0; i < 120; i++) {
      const root = span(0);
      // A group's two solves (with and without its scrollbar), a window drag, and sizes coming back.
      const sizes: [number, number][] = [];
      for (let k = 0; k < 5; k++) {
        const w = pick([0, 37.5, 120, 300, 412, 640.25]);
        const h = pick([0, 50, 210.5, 400, 600]);
        sizes.push([w, h], [w - 12, h]);
      }
      for (const [w, h] of sizes) {
        let fresh: number[] | Error;
        let cached: number[] | Error;
        try {
          fresh = rects(solveFresh([root], w, h, ""));
        } catch (e) {
          fresh = e as Error;
        }
        try {
          cached = rects(solveContent([root], w, h, ""));
        } catch (e) {
          cached = e as Error;
        }
        if (fresh instanceof Error || cached instanceof Error) {
          expect(String(cached)).toBe(String(fresh));
          continue;
        }
        expect(cached.length).toBe(fresh.length);
        // Equal to the bit (Object.is: -0 and 0 apart).
        cached.forEach((v, j) => {
          if (!Object.is(v, fresh[j])) expect([i, w, h, j, v]).toEqual([i, w, h, j, fresh[j]]);
        });
      }
    }
  }, 30_000);

  it("hands back the same result for the same element, path and size, and a new one for a changed element", () => {
    clearLayoutCache();
    const r = row([button(100, 32), button(50, 32)]);
    const a = solveContent([r], 400, 36, "");
    expect(solveContent([r], 400, 36, "")).toBe(a);
    expect(solveContent([r], 400, 36, "/g")).not.toBe(a);
    const b = solveContent([r], 300, 36, "");
    expect(b).not.toBe(a);
    expect(rects(b)).toEqual(rects(solveFresh([r], 300, 36, "")));
    // An edit copies the element: the copy is solved anew.
    const r2 = { ...r, children: [button(120, 32), button(50, 32)] };
    expect(solveContent([r2], 400, 36, "").nodes[0]!.children[0]!.rect[2]).toBeCloseTo(120, 6);
    expect(solveContent([r], 400, 36, "")).toBe(a);
  });

  it("does not change a cached solve when list rows move their copies", () => {
    clearLayoutCache();
    const cell = button(60, 20);
    const first = solveRowTemplate([[button(40, 20), 40, false], [cell, 0, true]], 200, 24, "/list/row 0");
    const again = solveRowTemplate([[button(40, 20), 40, false], [cell, 0, true]], 200, 24, "/list/row 0");
    expect(again.map((n) => n.rect)).toEqual(first.map((n) => n.rect));
    // The second cell starts at 40: its copy moved, the cached solve of the cell did not.
    expect(first[1]!.rect[0]).toBeCloseTo(40 + 2, 6);
    expect(rects(solveContent([cell], 160, 24, "/list/row 0/cell 1"))).toEqual(rects(solveFresh([cell], 160, 24, "/list/row 0/cell 1")));
  });

  it("keeps a refused layout's error", () => {
    clearLayoutCache();
    const bad = col([row([button(160, 40)], undefined, 34)]);
    for (let i = 0; i < 2; i++) expect(() => solveContent([bad], 400, 100, "")).toThrow(UnsatisfiableLayout);
  });
});
