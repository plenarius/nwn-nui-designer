/**
 * Which textures of the original (MDL-panel) GUI the reskin handles, and which it leaves to a person. Names only:
 * the art itself is read from the user's own install and never kept in this repository.
 *
 * The lists come from Layonara's survey of the client (EE 8193.37): 722 GUI models in use draw 211 textures, of which
 * 193 exist. docs/RESKIN-EVERYTHING.md explains each group.
 */

export type Group = "swatch" | "frame" | "pregame" | "control";

export interface AutoTexture {
  name: string;
  group: Group;
  /** recolour: every pixel mapped (frames, states and layout kept); redraw: drawn from the skin's NUI textures. */
  action: "recolour" | "redraw";
  /** Keep the stock alpha even with an opaque skin (highlight cells drawn over or under item icons). */
  keepAlpha?: boolean;
  /** Pixels (left, top, right, bottom; top-down, exclusive) copied unchanged: a picture inside a frame. */
  protect?: [number, number, number, number];
}

/** The 14 colour-swatch strips: cells of colour stretched over nearly every box, bevel and divider. */
export const SWATCHES = [
  "gui_boxes",
  "gui_boxes_chrgen",
  "gui_boxes_chrsht",
  "gui_boxes_ingame",
  "gui_ig_main",
  "gui_lightning",
  "gui_replace01",
  "gui_replace02",
  "gui_replace03",
  "gui_replace04",
  "gui_replace05",
  "gui_replace06",
  "gui_rgbc",
  "gui_textbubble",
];

/** In-game buttons, frames and controls (whole-panel art drawn 1:1, buttons with their up / down / hover frames). */
export const FRAMES = [
  "ctl_att",
  "ctl_btn_64x24",
  "ctl_btn_dm",
  "ctl_btn_dm_make",
  "ctl_btn_dm_task",
  "ctl_btn_inv_st",
  "ctl_btn_inv_st1",
  "ctl_btn_lvlup",
  "ctl_cg_btn_app",
  "ctl_chk_pre",
  "ctl_con_prtl_inf",
  "ctl_edt_gen",
  "ctl_edt_mod_in1",
  "ctl_ig_btn_pvpre",
  "ctl_pre_btn_save",
  "edit_box_150x24",
  "edit_box_276x25",
  "gui_gring01",
  "gui_pre_chkbox",
  "gui_spell_splvl2",
  "inv_stacksplit",
  "qb_but",
  // options and key-binding pages, the small OK dialog, the CD-key page
  "ctl_opt_btn_key",
  "ctl_opt_gen",
  "ctl_opt_vid_1",
  "pnl_con_vid_mode",
  "pnl_opt_key",
  "pnl_opt_key_page",
  "pnl_pre_cdkey",
  "pnl_util_ok",
  // tab strips and inventory cells (tiled), highlight cells
  "gui_ig_jourtabs",
  "gui_inv_bkgnd2",
  "gui_inv_sto_tab",
  "gui_inv_tab",
  "gui_inv_hilite",
  "gui_inv_unhilite",
  "gui_invm_hl",
  "gui_invm_ocupied",
  "gui_invm_unhl",
  "gui_loadstatus",
];

/** Character select (the vault), the pre-game pages and the creation wizard. */
export const PREGAME = [
  "ctl_att_01",
  "ctl_btn_pre_118",
  "ctl_btn_pre_178",
  "ctl_btn_pre_360",
  "ctl_cg_att",
  "ctl_cg_bigportrt",
  "ctl_cg_edit_age",
  "ctl_cg_edit_fam",
  "ctl_cg_edit_fnam",
  "ctl_cg_edit_s",
  "ctl_cg_edt_bio",
  "ctl_cg_fam",
  "ctl_cg_numbox3",
  "ctl_cg_portraits",
  "ctl_cg_skill",
  "ctl_cg_spinfo",
  "ctl_class",
  "ctl_pre_load1",
  "ctl_skill",
  "gui_ig_chartabs",
  "gui_ig_chartabs2",
  "gui_pre_bkgnd01",
  "gui_pre_bkgnd02",
  "gui_pre_playtabs",
  "pnl_chr_appear",
  "pnl_con_prtl_inf",
  "pnl_feats1",
  "pnl_help",
  "pnl_select",
  "ctl_cg_btn_right",
  "ctl_cg_btn_help",
  "ctl_btn_169x39",
  "ctl_cg_playmod",
  "pnl_playmod",
  "pnl_playmod1",
  "pre_load_01",
  "pnl_cg_clericd",
  "ctl_cg_spellhlp",
  "ctl_cg_spells",
  "gui_spell_hilite",
  "pnl_util_okt",
  "pnl_connectstat",
  "pnl_opt_gen",
];

/** The old scrollbar, its arrow buttons and the options slider: redrawn from the skin's NUI pieces. */
export const CONTROLS = ["gui_scrollbar", "gui_chr_arrowbtn", "gui_slider"];

const PROTECT: Record<string, [number, number, number, number]> = {
  // the painted town (bridge and harbour) inside the module-description frame
  ctl_edt_mod_in1: [120, 338, 392, 456],
};

/** Inventory highlight cells: translucent on purpose (the item shows through). */
const KEEP_ALPHA = new Set(["gui_inv_hilite", "gui_inv_unhilite", "gui_invm_hl", "gui_invm_ocupied", "gui_invm_unhl"]);

export const AUTO: AutoTexture[] = [
  ...SWATCHES.map((name) => ({ name, group: "swatch" as const, action: "recolour" as const })),
  ...FRAMES.map((name) => ({
    name,
    group: "frame" as const,
    action: "recolour" as const,
    ...(PROTECT[name] ? { protect: PROTECT[name] } : {}),
    ...(KEEP_ALPHA.has(name) ? { keepAlpha: true } : {}),
  })),
  ...PREGAME.map((name) => ({ name, group: "pregame" as const, action: "recolour" as const })),
  ...CONTROLS.map((name) => ({ name, group: "control" as const, action: "redraw" as const })),
];

export type ManualClass = "icon" | "picture" | "baked text" | "cursor" | "font" | "content";

export interface ManualTexture {
  name: string;
  class: ManualClass;
  why: string;
}

const manual = (cls: ManualClass, why: string, names: string) => names.split(/\s+/).filter(Boolean).map((name) => ({ name, class: cls, why }));

/** The textures in use that the reskin does not change: a person decides (and draws) these. */
export const MANUAL: ManualTexture[] = [
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
