/**
 * The window switcher's lists (src/app/editor/switcher.ts): the recent windows kept in this browser (newest first, one
 * per file, at most RECENT_MAX, no copy too big to keep), the search, and the windows folder's order.
 */
import { describe, expect, it } from "vitest";
import { COPY_MAX_CHARS, RECENT_MAX, type RecentWindow, addRecent, baseName, byName, matches, sourceKey } from "../src/app/editor/switcher.js";

const rec = (key: string, extra: Partial<RecentWindow> = {}): RecentWindow => ({ key, name: key, openedAt: 0, source: { kind: "windows", path: key }, ...extra });

describe("the window switcher", () => {
  it("keeps one entry per file, newest first, at most RECENT_MAX", () => {
    let l: RecentWindow[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i++) l = addRecent(l, rec(`w${i}`));
    expect(l).toHaveLength(RECENT_MAX);
    expect(l[0]!.key).toBe(`w${RECENT_MAX + 2}`);
    l = addRecent(l, rec("w5", { title: "again" }));
    expect(l.map((r) => r.key).filter((k) => k === "w5")).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: "w5", title: "again" });
  });

  it("does not keep a copy too big for the list, nor an older one of the same file", () => {
    const l = addRecent([rec("copy:big.json"), rec("x")], rec("copy:big.json", { source: { kind: "copy", text: "x".repeat(COPY_MAX_CHARS + 1) } }));
    expect(l.map((r) => r.key)).toEqual(["x"]);
  });

  it("keys a window by where it came from", () => {
    expect(sourceKey({ kind: "windows", path: "shop.jui" }, "shop.jui")).toBe("windows:shop.jui");
    expect(sourceKey({ kind: "copy", text: "{}" }, "shop.jui")).toBe("copy:shop.jui");
    expect(sourceKey({ kind: "handle", handle: { name: "shop.nuidesign.json" } as never }, "shop.nuidesign.json")).toBe("file:shop.nuidesign.json");
    expect(baseName("dumps/shop.nuidesign.json")).toBe("shop");
    expect(baseName("gods.jui")).toBe("gods");
  });

  it("searches every word in the name and the title, ignoring case", () => {
    expect(matches("", "furnshop")).toBe(true);
    expect(matches("FURN", "furnshop")).toBe(true);
    expect(matches("furn arrange", "furnplace@acts-arrange", "Arrange furniture")).toBe(true);
    expect(matches("shop gods", "furnshop", "Furniture shop")).toBe(false);
    expect(matches("furniture", "furnshop", "Furniture shop")).toBe(true);
  });

  it("sorts the folder by name, numbers in order", () => {
    expect(byName([{ path: "b10.jui" }, { path: "B2.json" }, { path: "a.jui" }]).map((f) => f.path)).toEqual(["a.jui", "B2.json", "b10.jui"]);
  });
});
