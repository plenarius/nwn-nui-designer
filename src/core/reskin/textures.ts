/**
 * Which textures of the original (MDL-panel) GUI the reskin handles, and which it leaves to a person. Names only:
 * the art itself is read from the user's own install and never kept in this repository.
 *
 * The chrome is the role tables' (src/core/oldgui/roles.ts, from a survey of the EE 8193.37 client): it is redrawn.
 * docs/RESKIN-EVERYTHING.md explains each group.
 */
import { REDRAWN, ICON_GROUNDS } from "../oldgui/draw/index.js";
import { builtinRole } from "../oldgui/roles.js";

/** The contact sheets' groups: colour-cell strips, in-game chrome, the pre-game pages, the hand-drawn controls, and the
 * icon atlases whose ground is recoloured. */
export type Group = "swatch" | "frame" | "pregame" | "control" | "icon";

export interface AutoTexture {
  name: string;
  group: Group;
  /** redraw: drawn again in the skin's style (src/core/oldgui/draw); recolour: every pixel mapped (flat colour cells,
   * and the dark ground of the icons the tabs carry). */
  action: "recolour" | "redraw";
  /** Keep the stock alpha even with an opaque skin. */
  keepAlpha?: boolean;
}

/** Flat colour cells: already one colour per cell, so a colour map is all they need. */
export const FLAT_CELLS = ["gui_replace01", "gui_replace02", "gui_replace03", "gui_replace04", "gui_replace05", "gui_replace06", "gui_rgbc", "gui_lightning", "gui_gring01", "gui_pre_chkbox"];

/** The pre-game pages: character select, the creation wizard, the server list, load and save. */
const PREGAME = /^(ct_btn_srv|pnl_srv|gui_srv|ctl_pre|pre_load|ctl_btn_pre|cg_main|gui_pre|pnl_enable|ctl_edt_mod|ctl_cg|pnl_cg|pnl_chr_appear|pnl_con_prtl|ctl_con_prtl|pnl_playmod|ctl_class|ctl_skill|ctl_att|pnl_feats|pnl_help|pnl_select|ctl_btn_169x39|pnl_util_okt|pnl_connectstat|pnl_opt_gen|gui_ig_chartabs|gui_spell_hilite)/;

function groupOf(name: string): Group {
  const kind = builtinRole(name)?.kind;
  if (kind === "cells") return "swatch";
  if (kind && ["scrollbar", "slider", "checkbox", "bar", "item-cell", "radial", "tab", "shape"].includes(kind)) return "control";
  if (["gui_chr_arrowbtn", "ctl_chk_pre", "ctl_btn_x", "gui_spl_btn_up", "gui_spl_btn_down", "ctl_cg_btn_help", "pb_but_pvp", "pb_but_rest", "pb_but_spell", "gui_map_pieces"].includes(name)) return "control";
  return PREGAME.test(name) ? "pregame" : "frame";
}

/** Everything the reskin writes: the chrome redrawn, the flat cells and the icon grounds recoloured. */
export const AUTO: AutoTexture[] = [
  ...REDRAWN.map((name) => ({ name, group: groupOf(name), action: "redraw" as const })),
  ...FLAT_CELLS.map((name) => ({ name, group: "swatch" as const, action: "recolour" as const })),
  ...ICON_GROUNDS.map((name) => ({ name, group: "icon" as const, action: "recolour" as const, keepAlpha: true })),
];

export type ManualClass = "icon" | "picture" | "baked text" | "cursor" | "font" | "content";

export interface ManualTexture {
  name: string;
  class: ManualClass;
  why: string;
}

const manual = (cls: ManualClass, why: string, names: string) => names.split(/\s+/).filter(Boolean).map((name) => ({ name, class: cls, why }));

/** The textures in use that the reskin does not change: a person decides (and draws) these. */
const ALL_MANUAL: ManualTexture[] = [
  ...manual(
    "icon",
    "painted icons and button glyphs: a recolour of gold to the accent may do, anything more is new art",
    `ctl_btn_ctr ctl_btn_jnl_inv ctl_btn_x gui_actionqueue gui_char_icons gui_chrsht_cha gui_chrsht_con gui_chrsht_dex
     gui_chrsht_int gui_chrsht_str gui_chrsht_wis gui_compass3 gui_ig_faces gui_ig_happyface gui_ig_madface
     gui_inv_contain gui_inv_icons gui_inv_statico gui_inv_sto_icon gui_map_arrow gui_map_pieces gui_map_pieces2
     gui_party_leader gui_party_states gui_partylocator gui_rad_ring gui_radialmenu gui_resting gui_shield
     gui_spellmenu gui_spl_btn_down gui_spl_btn_up gui_walk inv_box_ok pb_but_pvp pb_but_rest pb_but_spell
     pb_pnl_member pnl_party_bar gui_icon_metamag gui_pointer01 gui_invm_hl_xid gui_invm_hl_xuse`,
  ),
  ...manual(
    "icon",
    "inventory slot silhouettes (drawn by the client's code)",
    "inv_slot_amulet inv_slot_armor inv_slot_arrow inv_slot_belt inv_slot_bolts inv_slot_boots inv_slot_cloak inv_slot_gloves inv_slot_helm inv_slot_left inv_slot_right inv_slot_ring inv_slot_sling",
  ),
  ...manual("picture", "the engraved weapons banner on every creation page: a picture", "gui_banner"),
  ...manual("baked text", "a logo or legal text painted into the image", "gui_pre_logo load_legal load_legal2"),
  ...manual(
    "cursor",
    "mouse cursors (up/down pairs): optional for a theme",
    `gui_mp_arwalk00 gui_mp_arwalk01 gui_mp_arwalk02 gui_mp_arwalk03 gui_mp_arwalk04 gui_mp_arwalk05 gui_mp_arwalk06
     gui_mp_arwalk07 gui_mp_arwalk08 gui_mp_arwalk09 gui_mp_arwalk10 gui_mp_arwalk11 gui_mp_arwalk12 gui_mp_arwalk13
     gui_mp_arwalk14 gui_mp_arwalk15 gui_mp_defaultd gui_mp_defaultu gui_mp_examined gui_mp_examineu gui_mp_noactiond
     gui_mp_noactionu gui_mp_nocreatd gui_mp_nocreatu gui_mp_nodisarmd gui_mp_nodisarmu gui_mp_nomagicd
     gui_mp_nomagicu gui_mp_pushpind gui_mp_pushpinu`,
  ),
  ...manual("font", "bitmap fonts: glyph atlases tied to their .txi metrics", "fnt_console fnt_floaty_smal fnt_galahad14"),
  ...manual(
    "content",
    "content, not chrome: colour pickers, menu backgrounds, splash and pause art",
    "gui_pal_hair01 gui_pal_skin gui_pal_tattoo gui_pre_bknd1 gui_pre_bknd2 gui_pre_bknd3 gui_saveproxy po_levelup po_pause po_timestop",
  ),
];

const THEMED = new Set(AUTO.map((t) => t.name));
export const MANUAL: ManualTexture[] = ALL_MANUAL.filter((m) => !THEMED.has(m.name));
