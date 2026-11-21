/**
 * The screens the previews and the frame check draw: every .gui layout as the client places it, and the panels the
 * client builds in code (no .gui) laid out by hand on their hooks. Lists are filled with sample rows (the first
 * selected, the second hovered) and get their scrollbar; one button of a layout is shown pressed and one hovered;
 * every bar the client fills is drawn at each of its levels (roles.ts FILL_BARS).
 *
 * Approximate where the client decides in code: the number of rows and their texts, which tab is selected, the
 * scrollbar thumb's length, and every text label's font size and exact place.
 */
import type { GuiLayout, GuiObject } from "../guilayout.js";
import type { Mdl } from "../mdl.js";
import { FILL_BARS } from "../roles.js";
import { type ModelSource, hooksOf, modelBounds } from "./render.js";
import { Scene, fitY, rotZ } from "./scene.js";

export interface ScreenSource {
  models: ModelSource;
  layout(name: string): GuiLayout | null;
  /** Every .gui layout's name. */
  layouts(): string[];
  /** A string reference's text ("" when unknown). */
  text(strref: number): string;
}

export interface Screen {
  key: string;
  title: string;
  make(): Scene;
}

type Hooks = Map<string, [number, number]>;

const WHITE: [number, number, number] = [255, 255, 255];
const GOLD: [number, number, number] = [235, 215, 170];
const SAMPLE_ROWS = ["Aldric the Bold", "Brienne of Tarth", "Corwin Ashvale", "Dara Moonwhisper", "Eldon Greymantle", "Fiora Thistledown", "Garrick Stonehelm", "Hesper Vane"];

/** The row model the client puts in a layout's list. */
function rowModelFor(gui: string, listModel: string): string {
  if (listModel.includes("skill")) return "ctl_cg_btn_skill";
  if (listModel.includes("lstspel") || gui.includes("spell") || gui.includes("feat")) return "ctl_cg_btn_feat";
  if (gui.startsWith("pre_")) return "ctl_pre_btn_char";
  if (gui.startsWith("serverlist")) return "ctl_srv_hilit";
  return "ctl_cg_btn_class";
}

export class Screens {
  constructor(private readonly src: ScreenSource) {}

  private m(name: string): Mdl | null {
    return this.src.models(name);
  }

  private hooks(model: string, x = 0, y = 0, anim: string | null = null): Hooks {
    const m = this.m(model);
    return m ? hooksOf(m, x, y, anim) : new Map();
  }

  private bounds(model: string, anim: string | null = null) {
    const m = this.m(model);
    return m ? modelBounds(m, anim) : null;
  }

  private put(sc: Scene, model: string, x: number, y: number, anim: string | null = null, z = 0): Hooks {
    sc.model(model, x, y, anim, z);
    return this.hooks(model, x, y, anim);
  }

  /** Text whose left (ah 0) or right (ah 1) end and vertical middle are at (x, y). */
  private label(sc: Scene, s: string, x: number, y: number, w = 1.3, h = 0.2, ah = 0, col = WHITE, size = 13, z = 20): void {
    sc.text(s, x - w * ah, y - h / 2, w, h, ah, 0.5, col, size, z);
  }

  /** Controls placed one after another, each at the previous one's next hook (tabs, rows). */
  private chain(sc: Scene, models: string[], x: number, y: number, anims: (string | null)[], z: number): [number, number, Hooks][] {
    const out: [number, number, Hooks][] = [];
    models.forEach((m, i) => {
      const h = this.put(sc, m, x, y, anims[i] ?? null, z);
      out.push([x, y, h]);
      const nx = h.get("next") ?? h.get("next01") ?? h.get("nextlink");
      if (nx) [x, y] = nx;
    });
    return out;
  }

  private rows(sc: Scene, model: string, x: number, y: number, texts: string[], z: number): void {
    const anims = texts.map((_, i) => (i === 0 ? "down" : i === 1 ? "hilite" : "up"));
    this.chain(sc, texts.map(() => model), x, y, anims, z).forEach(([rx, ry, h], i) => {
      const t = h.get("text") ?? h.get("text0") ?? [rx + 0.1, ry + 0.17];
      this.label(sc, texts[i]!, t[0], t[1], 2.4, 0.3);
    });
  }

  /** The list scrollbar between a list's scrollmin and scrollmax hooks: the track stretched over the length and the
   * thumb (top cap, middle, bottom cap) over the `thumb` fraction of it, from the top. */
  scrollbar(sc: Scene, x: number, yTop: number, yBot: number, z: number, thumb: [number, number] = [0, 0.35]): void {
    const top = Math.max(yTop, yBot);
    const bot = Math.min(yTop, yBot);
    const L = top - bot;
    const t0 = top - thumb[0] * L;
    const t1 = top - thumb[1] * L;
    const cap = 0.02;
    sc.model("scrollbar_simple", x - 0.02, 0, "size", z, {
      xform: {
        planebkg: fitY(top, bot, 0, -0.05),
        thumbtop: fitY(t0, t0 - cap, -0.48),
        thumbmain: fitY(t0 - cap, t1 + cap, -0.48),
        thumbbot: fitY(t1 + cap, t1, -0.48),
      },
    });
  }

  private fillList(sc: Scene, gui: string, listModel: string, x: number, y: number, z: number): void {
    const wm = this.hooks(listModel);
    if (!wm.size) return;
    const top = wm.get("top") ?? wm.get("listitem") ?? [0, 0];
    const bot = wm.get("bottom");
    const li = wm.get("listitem") ?? top;
    const row = rowModelFor(gui, listModel);
    const rb = this.bounds(row);
    if (!rb) return;
    const rh = rb[3] - rb[1];
    const yTop = li[1];
    const t0 = wm.get("text0");
    if (t0 && t0[1] > yTop + 0.2) sc.listHeads.push([x + t0[0], y + t0[1], top[0] - t0[0]]);
    const yBot = bot ? bot[1] : yTop - 5 * rh;
    const n = Math.max(1, Math.min(8, Math.floor((yTop - yBot) / rh)));
    const rw = this.hooks(row);
    for (let i = 0; i < n; i++) {
      const ry = y + yTop - i * rh - rb[3];
      const rx = x + li[0] - rb[0];
      sc.model(row, rx, ry, i === 0 ? "down" : i === 1 ? "hilite" : "up", z + 0.5);
      const tx = (rw.get("label0") ?? rw.get("text") ?? rw.get("text0"))?.[0] ?? rb[0] + 0.1;
      sc.text(SAMPLE_ROWS[i % SAMPLE_ROWS.length]!, rx + tx, ry + rb[1], rb[2] - tx - 0.1, rh, 0, 0.5, WHITE, 13, z + 10);
    }
    const smin = wm.get("scrollmin");
    const smax = wm.get("scrollmax");
    if (smin && smax) this.scrollbar(sc, x + smin[0], y + smin[1], y + smax[1], z + 0.6);
  }

  /** A .gui layout as the client places it: each object on its parent's hook, one button pressed and one hovered,
   * lists filled, labels with their text. */
  fromGui(name: string): Scene {
    const sc = new Scene(this.src.models);
    const g = this.src.layout(name);
    if (!g) return sc;
    const state = { pressed: false, hover: false };
    const titles: [string, [number, number, number], number][] = [];
    const caption = (o: GuiObject): [string, [number, number, number]] => {
      const s = o.text || (o.strref !== 0xffffffff && o.strref >= 0 ? this.src.text(o.strref) : "");
      return [s, o.color.map((c) => 255 * c) as [number, number, number]];
    };
    const walk = (o: GuiObject, px: number, py: number, parentModel: string | null, depth: number) => {
      let hx = 0;
      let hy = 0;
      const pm = parentModel ? this.m(parentModel) : null;
      if (pm && o.hook && o.hook.toLowerCase() !== pm.name) {
        const h = hooksOf(pm).get(o.hook.toLowerCase());
        if (h) [hx, hy] = h;
      }
      const x = px + hx + o.x;
      const y = py + hy + o.y;
      const z = depth + o.z * 0.01;
      const mdl = o.model && this.m(o.model) ? o.model : null;
      if (mdl) {
        let anim: string | null = null;
        if ([9, 1, 2].includes(o.type)) {
          if (!state.pressed && o.type === 9) [anim, state.pressed] = ["down", true];
          else if (!state.hover && o.type === 9) [anim, state.hover] = ["hilite", true];
          else anim = "up";
        }
        sc.model(mdl, x, y, anim, z);
        const tag = o.tag.toLowerCase();
        if ((o.type === 8 || (o.type === 3 && this.hooks(mdl).has("listitem"))) && !/help|desc|text/.test(tag)) this.fillList(sc, name, mdl, x, y, z);
        const [s, col] = caption(o);
        if (s && [9, 1, 2].includes(o.type)) {
          const b = this.bounds(mdl);
          if (b) sc.text(s, x + b[0], y + b[1], b[2] - b[0], b[3] - b[1], 0.5, 0.5, col, 14, z + 10);
        }
      }
      const [lx, ly, lw, lh] = o.label;
      if (o.type === 5 || ([0, 6].includes(o.type) && lw)) {
        let [s, col] = caption(o);
        if (Math.abs(ly) < 20 && lw) {
          if (!s) s = lw > 1 ? "Sample text" : "";
          sc.text(s, x + lx, y + ly - lh, lw, lh, o.alignH, 1 - o.alignV, col, 14, z + 10);
        } else if (s && lw) titles.push([s, col, z]);
      }
      for (const c of o.children) walk(c, x, y, mdl ?? parentModel, depth + 1);
    };
    for (const r of g.roots) walk(r, 0, 0, null, 0);
    titles.forEach(([s, col, z], i) => {
      const h = sc.listHeads[i];
      if (h) sc.text(s, h[0], h[1] - 0.2, h[2], 0.2, 0, 0.5, col, 14, z + 10);
    });
    return sc;
  }

  /** Panel models with no .gui, at given offsets: each dummy hook named like a model gets that model (two levels),
   * a list's scroll hooks get a scrollbar. */
  fromModels(models: [string, number, number][]): Scene {
    const sc = new Scene(this.src.models);
    const attach = (name: string, x: number, y: number, z: number, depth: number) => {
      const m = this.m(name);
      if (!m) return;
      sc.model(name, x, y, m.anims.has("up") || m.anims.has("down") ? "up" : null, z);
      const wm = hooksOf(m);
      for (const nd of m.nodes) {
        if (nd.kind !== "dummy" || nd.name === m.name || nd.name === name) continue;
        const t = wm.get(nd.name)!;
        if (depth < 2 && this.m(nd.name)) attach(nd.name, x + t[0], y + t[1], z + 1, depth + 1);
      }
      const smin = wm.get("scrollmin");
      const smax = wm.get("scrollmax");
      if (smin && smax) this.scrollbar(sc, x + smin[0], y + smin[1], y + smax[1], z + 0.6);
    };
    for (const [n, x, y] of models) attach(n, x, y, 0, 0);
    return sc;
  }

  private first(sc: Scene, model: string): { x: number; y: number } | null {
    const it = sc.items.find((i) => i.kind === "model" && i.name === model);
    return it && it.kind === "model" ? { x: it.x, y: it.y } : null;
  }

  // --- panels the client builds in code -------------------------------------------------------------------------

  characterRecord(): Scene {
    const sc = new Scene(this.src.models);
    const h = this.put(sc, "pnl_chrsht", 0, 0);
    const at = (k: string, hk: Hooks = h) => hk.get(k) ?? [0, 0];
    this.label(sc, "Character Record", at("title0")[0], at("title0")[1] - 0.09, 2.5, 0.2, 0, GOLD, 14);
    const pg = this.put(sc, "pnl_chrsht_char", ...at("pages"), null, 1);
    this.chain(sc, ["ctl_chr_btn_tab1", "ctl_chr_btn_tab2", "ctl_chr_btn_tab3", "ctl_chr_btn_tab4"], ...at("tabs"), ["checkedup", "up", "up", "up"], 2);
    this.put(sc, "ctl_btn_x", ...at("xbutton"), "up", 3);
    for (const [key, nm, val, mod] of [
      ["strength", "Strength", "16", "+3"],
      ["dexterity", "Dexterity", "14", "+2"],
      ["constitution", "Constitution", "15", "+2"],
      ["intelligence", "Intelligence", "10", "+0"],
      ["wisdom", "Wisdom", "12", "+1"],
      ["charisma", "Charisma", "8", "-1"],
    ] as const) {
      const k3 = key.slice(0, 3);
      if (pg.has(`l${key}0`)) this.label(sc, nm, ...at(`l${key}0`, pg));
      if (pg.has(`${k3}stat0`)) this.label(sc, val, at(`${k3}stat0`, pg)[0] + 0.2, at(`${k3}stat0`, pg)[1] - 0.1, 0.4, 0.2, 0.5);
      if (pg.has(`${k3}mod0`)) this.label(sc, mod, at(`${k3}mod0`, pg)[0] + 0.14, at(`${k3}mod0`, pg)[1] - 0.1, 0.3, 0.2, 0.5);
    }
    const lst = pg.get("list");
    if (lst) this.rows(sc, "ctl_chr_btn_feat", lst[0] + 0.06, lst[1] - 0.38, ["Fortitude  +6", "Reflex  +3", "Will  +2", "Base attack  +5"], 4);
    const smin = pg.get("scrollmin");
    const smax = pg.get("scrollmax");
    if (smin && smax) this.scrollbar(sc, smin[0], smin[1], smax[1], 5, [0, 0.4]);
    sc.fixed = [-0.05, -4.75, 3.65, 0.05];
    return sc;
  }

  /** Character select's right panel: three text tabs on the panel's tabs hook (the first selected), the Character
   * Record's icon tabs under its title. */
  characterSelect(selected = 0): Scene {
    const sc = this.fromGui("pre_playmod");
    const base = this.first(sc, "pnl_pre_playmod");
    if (!base) return sc;
    const h = this.hooks("pnl_pre_playmod", base.x, base.y);
    const tabs = h.get("tabs");
    if (!tabs) return sc;
    const [tx, ty] = tabs;
    const placed = this.chain(sc, ["ctl_pre_btn_tab", "ctl_pre_btn_tab", "ctl_pre_btn_tab"], tx, ty - 0.29, [0, 1, 2].map((i) => (i === selected ? "checkedup" : "up")), 3);
    placed.forEach(([, , th], i) => {
      const t = th.get("text");
      if (t) this.label(sc, ["Character Info", "Server Info", "Player List"][i]!, t[0], t[1], 1.1, 0.2, 0.5);
    });
    this.label(sc, "Character Record, Aldric the Bold", tx + 0.05, ty - 0.42, 3.0, 0.2);
    this.chain(sc, ["ctl_chr_btn_tab1", "ctl_chr_btn_tab2", "ctl_chr_btn_tab3", "ctl_chr_btn_tab4"], tx, ty - 0.86, ["checkedup", "up", "up", "up"], 3);
    return sc;
  }

  /** Character select's Show Pregenerated Characters checkbox (ctl_btn_xch) in one state, close up. */
  pregenCheckbox(anim: string): Scene {
    const sc = this.characterSelect();
    sc.items = sc.items.map((it) => (it.kind === "model" && it.name === "ctl_btn_xch" ? { ...it, anim } : it));
    const b = this.first(sc, "ctl_btn_xch");
    if (b) sc.fixed = [b.x - 0.1, b.y - 0.04, b.x + 3.6, b.y + 0.3];
    return sc;
  }

  inventory(): Scene {
    const sc = this.fromGui("inv_panel");
    const base = this.first(sc, "pnl_inv");
    if (!base) return sc;
    const h = this.hooks("pnl_inv", base.x, base.y);
    const eq = this.fromGui("inv_equip");
    const e0 = this.first(eq, "pnl_equip");
    const equip = h.get("equip");
    if (e0 && equip) for (const it of eq.items) if (it.kind === "model") sc.items.push({ ...it, x: it.x + equip[0] - e0.x, y: it.y + equip[1] - e0.y, z: it.z + 2 });
    const rep = h.get("repository");
    if (rep) {
      sc.model("inv_box_10x6", rep[0], rep[1], null, 2);
      ["inv_box_1x1_ol", "inv_box_2x2_ol", "inv_box_1x2_ol"].forEach((t, i) => sc.model(t, rep[0] + i * 0.99, rep[1] + 1.32 - (t.includes("2x2") || t.includes("1x2") ? 0.33 : 0), null, 3));
    }
    const tabs = h.get("tabs");
    if (tabs) this.chain(sc, ["ctl_inv_btn_tab", "ctl_inv_btn_tab", "ctl_inv_btn_tab", "ctl_inv_btn_tab"], ...tabs, ["checkedup", "up", "up", "up"], 3);
    this.label(sc, "Inventory", base.x + 0.1, base.y - 0.1, 2.0, 0.2, 0, GOLD, 14);
    return sc;
  }

  store(): Scene {
    const sc = this.fromGui("ingame_store");
    const base = this.first(sc, "pnl_store");
    const tabs = base ? this.hooks("pnl_store", base.x, base.y).get("tabs") : undefined;
    if (tabs) this.chain(sc, [1, 2, 3, 4, 5].map((i) => `ctl_inv_sto_tab${i}`), ...tabs, ["checkedup", "up", "up", "up", "up"], 3);
    return sc;
  }

  private iconOn(sc: Scene, tex: string, hook: [number, number] | undefined, z: number): void {
    const ICON = 0.3;
    if (hook) sc.image(tex, hook[0] - ICON / 2, hook[1] + ICON / 2, ICON, ICON, z);
  }

  private spellBoxes(sc: Scene, x: number, y: number, icons: (string | null)[], z: number, hover: number | null = null): void {
    const models = icons.map((_, i) => (i === 0 ? "ctl_spelbx_first" : "ctl_spelbx_next"));
    this.chain(sc, models, x, y, icons.map((_, i) => (i === hover ? "hilite" : "default")), z).forEach(([, , h], i) => {
      if (icons[i]) this.iconOn(sc, icons[i]!, h.get("icon"), z + 1);
    });
  }

  /** A wizard's spellbook: the memorized row of the selected level, the ten level buttons with their medallions (the
   * cantrips selected), the known spells as tree rows with their icons, the second hovered. */
  wizardSpells(): Scene {
    const LEVEL_ICONS = ["ir_cantrips", ...[1, 2, 3, 4, 5, 6].map((i) => `ir_level${i}`), "ir_level789", "ir_level789", "ir_level789"];
    const sc = new Scene(this.src.models);
    const h = this.put(sc, "pnl_spellbook", 0, 0);
    const t = h.get("title");
    if (t) this.label(sc, "Wizard Spells", t[0], t[1] - 0.04, 2.0, 0.2, 0, GOLD, 14);
    const xb = h.get("xbutton");
    if (xb) this.put(sc, "ctl_btn_x", ...xb, "up", 3);
    const tabs = h.get("tabs");
    if (tabs) this.spellBoxes(sc, tabs[0], tabs[1] + 0.33, ["is_firebal", "is_acidarrow", null, null, null, null, null, null, null], 2, 1);
    const f = h.get("plane33");
    if (f) {
      let x = f[0] - (0.33 * 10 + 0.01) / 2;
      for (let lv = 0; lv < 10; lv++) {
        const anim = lv === 0 ? "checkedup" : "uncheckedup";
        sc.model("ctl_btn_spellevl", x, f[1] - 0.17, anim, 2, { swap: { gui_replace01: LEVEL_ICONS[lv]! } });
        x = this.hooks("ctl_btn_spellevl", x, f[1] - 0.17, anim).get("next")?.[0] ?? x + 0.33;
      }
      const y = f[1] - 0.17 - 0.12;
      const known: [string, string][] = [
        ["is_burnhands", "Burning Hands"],
        ["is_magvest", "Magic Vestment"],
        ["is_mirrimage", "Mirror Image"],
        ["is_bless", "Bless"],
      ];
      this.chain(sc, known.map(() => "ctl_treebtn_spel"), 0, y, ["up", "hilite", "up", "up"], 3).forEach(([, ry, rh], i) => {
        this.iconOn(sc, known[i]![0], rh.get("icon"), 4);
        const tx = rh.get("text0");
        if (tx) this.label(sc, known[i]![1], tx[0], ry - 0.165, 2.0, 0.2);
      });
      this.scrollbar(sc, 3.43, y, -4.6, 5, [0, 0.3]);
    }
    return sc;
  }

  /** Memorize Spells: one tree row per level with its medallion, expanded levels followed by their slots. */
  memorizeSpells(): Scene {
    const LEVEL_ICONS = ["ir_cantrips", ...[1, 2, 3, 4, 5, 6].map((i) => `ir_level${i}`), "ir_level789", "ir_level789", "ir_level789"];
    const NAMES = ["Cantrips", "First Level", "Second Level", "Third Level", "Fourth Level", "Fifth Level", "Sixth Level", "Seventh Level", "Eighth Level", "Ninth Level"];
    const sc = new Scene(this.src.models);
    const h = this.put(sc, "pnl_spellmemoriz", 0, 0);
    const t = h.get("title");
    if (t) this.label(sc, "Memorize Spells", t[0], t[1] - 0.04, 2.0, 0.2, 0, GOLD, 14);
    const xb = h.get("xbutton");
    if (xb) this.put(sc, "ctl_btn_x", ...xb, "up", 3);
    const tv = h.get("treeview");
    const view = h.get("view0");
    if (!tv) return sc;
    let [x, y] = tv;
    const slots: Record<number, (string | null)[]> = {
      0: [null, null, null, null],
      4: ["is_barkskin", "is_barkskin", "is_barkskin", "is_clarirty", "is_aid"],
      5: ["is_bullstr", "is_firebal", "is_firebal", "is_firebal", "is_firebal"],
    };
    for (let lv = 0; lv < 10; lv++) {
      if (view && y - 0.4 < view[1]) break;
      const anim = lv === 5 ? "hilite" : lv in slots ? "checkedup" : "uncheckedup";
      sc.model("ctl_treebtn_root", x, y, anim, 2, { swap: { gui_replace01: LEVEL_ICONS[lv]! } });
      const rh = this.hooks("ctl_treebtn_root", x, y, anim);
      const tx = rh.get("text");
      if (tx) this.label(sc, NAMES[lv]!, tx[0], tx[1], 2.0, 0.2);
      y = rh.get("nextlink")?.[1] ?? y - 0.33;
      if (slots[lv]) {
        this.spellBoxes(sc, x + 0.33, y, slots[lv]!, 2);
        y -= 0.33;
      }
    }
    const smin = h.get("scrollmin");
    const smax = h.get("scrollmax");
    if (smin && smax) this.scrollbar(sc, smin[0], smin[1], smax[1], 5, [0, 0.6]);
    return sc;
  }

  journal(): Scene {
    const sc = new Scene(this.src.models);
    const h = this.put(sc, "pnl_jnl_panel", 0, 0);
    const pages = h.get("pages");
    const pg = pages ? this.put(sc, "pnl_jnl_page1", ...pages, null, 1) : new Map<string, [number, number]>();
    const tabs = h.get("tabs");
    if (tabs) this.chain(sc, ["ctl_jnl_btn_tab", "ctl_jnl_btn_tab2", "ctl_jnl_btn_tab3"], ...tabs, ["checkedup", "up", "up"], 2);
    const tv = pg.get("treeview");
    if (tv) this.rows(sc, "ctl_jnl_questbtn", tv[0], tv[1], ["The Missing Caravan", "Wolves of the North Road", "A Letter for Erin"], 3);
    const smin = pg.get("scrollmin");
    const smax = pg.get("scrollmax");
    if (smin && smax) this.scrollbar(sc, smin[0], smin[1], smax[1], 4, [0, 0.25]);
    sc.fixed = [-0.05, -4.65, 3.65, 0.35];
    return sc;
  }

  /** The Player List as the client fills it: its six icon buttons, one in each state; rows of players, the first
   * selected and the second hovered, each with its attitude button. */
  playerList(): Scene {
    const sc = this.fromGui("ingame_pvp");
    const g = this.src.layout("ingame_pvp");
    const base = this.first(sc, "pnl_ig_pvp");
    if (!g || !base) return sc;
    const ICONS: Record<string, string> = { tellbutton: "ir_partychat", leavebutton: "ir_leave", invitebutton: "ir_invite", transferbutton: "ir_transleader", bootbutton: "ir_boot", banbutton: "ir_ban" };
    const STATE: Record<string, string> = { tellbutton: "up", leavebutton: "hilite", invitebutton: "down", transferbutton: "disabled", bootbutton: "disabled", banbutton: "up" };
    const order = g.objects.filter((o) => o.model === "ctl_ig_btn_icon").map((o) => ({ tag: o.tag.toLowerCase(), x: o.x, y: o.y }));
    sc.items = sc.items.map((it) => {
      if (it.kind !== "model" || it.name !== "ctl_ig_btn_icon") return it;
      const o = order.find((q) => Math.abs(base.x + q.x - it.x) < 1e-4 && Math.abs(base.y + q.y - it.y) < 1e-4);
      return o && ICONS[o.tag] ? { ...it, anim: STATE[o.tag]!, swap: { gui_replace01: ICONS[o.tag]! } } : it;
    });
    const list = this.hooks("pnl_ig_pvp", base.x, base.y).get("playerlist");
    if (!list) return sc;
    const lh = this.hooks("ctl_ig_plyr_list", ...list);
    const li = lh.get("listitem");
    const rb = this.bounds("ctl_ig_btn_pvp");
    if (!li || !rb) return sc;
    let [x, y] = li;
    y -= rb[3];
    for (const [nm, row, att] of [
      ["Aldric the Bold", "down", "up"],
      ["Brienne of Tarth", "hilite", "hilite"],
      ["Corwin Ashvale", "up", "down"],
      ["Dara Moonwhisper", "up", "checkedup"],
    ] as const) {
      const rh = this.put(sc, "ctl_ig_btn_pvp", x, y, row, 3);
      const t0 = rh.get("text0");
      if (t0) this.label(sc, nm, t0[0], t0[1] - 0.1, 1.4, 0.2);
      const ab = rh.get("attitudebutton");
      if (ab) {
        const ah = this.put(sc, "ctl_ig_btn_attit", ...ab, att, 4);
        const at = ah.get("text");
        if (at) this.label(sc, "Friendly", at[0], at[1], 0.55, 0.2, 0, WHITE, 12);
      }
      const re = rh.get("reaction");
      if (re) this.label(sc, "Neutral", re[0], re[1], 0.6, 0.2, 1, WHITE, 12);
      const nx = rh.get("next");
      if (!nx) break;
      [x, y] = nx;
    }
    const smin = lh.get("scrollmin");
    const smax = lh.get("scrollmax");
    if (smin && smax) this.scrollbar(sc, smin[0], smin[1], smax[1], 5, [0, 0.5]);
    return sc;
  }

  // --- bars the client fills -----------------------------------------------------------------------------------

  private loadBar(level: number): Scene {
    const sc = this.fromGui("load_screen");
    sc.items = sc.items.map((it) => (it.kind === "model" && it.name === "ctl_loadstatus" ? { ...it, anim: `percentage@${level}` } : it));
    const p = this.first(sc, "pnl_loadscreen");
    const b = this.first(sc, "ctl_loadstatus");
    if (p && b) sc.fixed = [p.x - 4.2, b.y - 0.25, p.x + 4.2, p.y + 2.1];
    return sc;
  }

  private restBar(level: number): Scene {
    const sc = new Scene(this.src.models);
    const h = this.put(sc, "pnl_plrtimedevnt", 0, 0);
    const st = h.get("status");
    // the status hook is turned on its side: the bar runs left to right
    if (st) sc.model("ctl_timedevntbar", st[0], st[1], `percentage@${level}`, 1, { xform: { plane235: rotZ(-90) } });
    const cb = h.get("cancelbutton");
    if (cb) this.put(sc, "ctl_btn_x", ...cb, "up", 2);
    const t0 = h.get("text0");
    if (t0) this.label(sc, "Resting...", t0[0], t0[1] - 0.1, 1.2, 0.2);
    return sc;
  }

  private healthBar(panel: string, bar: string, level: number): Scene {
    const sc = new Scene(this.src.models);
    const hp = this.put(sc, panel, 0, 0).get("health");
    if (hp) sc.model(bar, hp[0], hp[1], `percentage@${level}`, 1);
    return sc;
  }

  // --- the list ------------------------------------------------------------------------------------------------

  /** Panel models with no .gui and no hand layout: drawn with what sits on their hooks. */
  static readonly MODEL_SCREENS: Record<string, [string, number, number][]> = {
    character_record_skills: [["pnl_chrsht_skils", 0, 0]],
    journal_panel: [["pnl_jnl_panel", 0, 0]],
    chat: [
      ["pnl_chat360", 0, 0],
      ["edit_chat_main", 0, -0.3],
    ],
    chat_big: [["pnl_chat_big", 0, 0]],
    dialogue: [["pnl_dialog", 0, 0]],
    party_bar: [["pnl_party_bar", 0, 0]],
    quickbar: [["pnl_quick_bar", 0, 0]],
    radial_menu: [
      ["gui_ra_circle112", 0, 0],
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`gui_ra_multisub${i + 1}`, 1.4 * Math.cos(i * 0.785), 1.4 * Math.sin(i * 0.785)] as [string, number, number]),
      ["gui_radialband", -1.2, -1.9],
      ["gui_ra_more", 1.9, 0],
      ["gui_ra_spl_focus", -2.6, 0],
    ],
    dm_taskbar: [["pnl_dm_taskbar", 0, 0]],
    compass: [["pnl_compass", 0, 0]],
    action_queue: [
      ["ctl_actionqueue", 0, 0],
      ["ctl_actionqueue", 0.5, 0],
      ["ctl_actionqueue", 1.0, 0],
    ],
    ingame_options: [["pnl_ig_options", 0, 0]],
    level_up_summary_panel: [["pnl_lvlup_sum", 0, 0]],
    store_panel: [["pnl_store", 0, 0]],
    barter_panel: [["pnl_barter", 0, 0]],
    container_panel: [["pnl_container", 0, 0]],
    examine_item_panel: [["pnl_examine_item", 0, 0]],
    map_panel: [["pnl_map_area", 0, 0]],
    main_menu_panel: [["pnl_mainmenu", 0, 0]],
    loadscreen_panel: [["pnl_loadscreen", 0, 0]],
  };

  /** Every screen: each .gui layout, the hand-laid panels, the Player List filled, the bars at each level, and the
   * panel models with no layout. */
  all(): Screen[] {
    const out: Screen[] = this.src
      .layouts()
      .sort()
      .map((g) => ({ key: g, title: `${g} (.gui)`, make: () => this.fromGui(g) }));
    const hand: [string, string, () => Scene][] = [
      ["character_select", "character select (on its hooks)", () => this.characterSelect()],
      ["character_record", "character record (on its hooks)", () => this.characterRecord()],
      ["inventory", "inventory (on its hooks)", () => this.inventory()],
      ["store", "store (on its hooks)", () => this.store()],
      ["barter", "barter", () => this.fromGui("ingame_barter")],
      ["spellbook", "spellbook (on its hooks)", () => this.wizardSpells()],
      ["spell_memorize", "memorize spells (on its hooks)", () => this.memorizeSpells()],
      ["journal", "journal (on its hooks)", () => this.journal()],
      ["pregen_checkbox_off", "character select checkbox: unchecked", () => this.pregenCheckbox("uncheckedup")],
      ["pregen_checkbox_on", "character select checkbox: checked", () => this.pregenCheckbox("checkedup")],
      ["pregen_checkbox_hover", "character select checkbox: checked, hovered", () => this.pregenCheckbox("checkedhilite")],
      ["player_list", "player list (filled)", () => this.playerList()],
    ];
    for (const [key, title, make] of hand) out.push({ key, title, make });
    const bars: Record<string, (lv: number) => Scene> = {
      load_bar: (lv) => this.loadBar(lv),
      rest_bar: (lv) => this.restBar(lv),
      player_health: (lv) => this.healthBar("pnl_party_bar", "ctl_playr_health", lv),
      party_health: (lv) => this.healthBar("pb_pnl_member", "ctl_party_health", lv),
    };
    for (const b of FILL_BARS) {
      const f = bars[b.screen];
      if (!f) continue;
      for (const lv of b.levels) out.push({ key: `${b.screen}_${Math.round(lv * 100)}`, title: `${b.what} at ${Math.round(lv * 100)} %`, make: () => f(lv) });
    }
    for (const [key, ms] of Object.entries(Screens.MODEL_SCREENS)) out.push({ key, title: key.replace(/_/g, " "), make: () => this.fromModels(ms) });
    return out;
  }
}
