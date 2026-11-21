/**
 * The role of every texture the original GUI can draw, and how a theme treats it. Names and texel rectangles only:
 * the art itself is always read from the user's own install.
 *
 * treatment:
 *   redraw   chrome: drawn again in the skin's style (flat faces, single rules), never recoloured
 *   flat     chrome that is already flat cells or flat marks (colour cells, item-slot outlines, the X marks)
 *   icon     an icon or symbol on chrome (stat icons, slot silhouettes, radial icons): kept, or its ground recoloured
 *   hold     left for a person (content art, baked text and logos, cursors, bitmap fonts)
 *   scene    a 3D texture a GUI scene model uses (main menu, credits): not GUI art
 *   missing  named by a model, layout, txi or the client, but the game has no such texture
 *   unused   in a GUI archive but drawn by nothing (no model, layout, txi or client name uses it)
 *
 * The lists come from a survey of the EE 8193.37 client and its stock GUI. A texture a hak adds, or one a later
 * client draws, has no role until someone looks at it: the inventory marks it uncategorised and the coverage check
 * fails until the user's own roles file (old-gui-roles.json) names it.
 */

export type Group = "chrome" | "icon" | "content" | "text" | "cursor" | "font" | "scene" | "none";
export type Treatment = "redraw" | "flat" | "icon" | "hold" | "scene" | "missing" | "unused";
/** What a chrome texture is on screen: the redraw and the checks treat each kind its own way. */
export type Kind =
  | "button"
  | "panel"
  | "edit"
  | "tab"
  | "cells"
  | "scrollbar"
  | "slider"
  | "checkbox"
  | "bar"
  | "row"
  | "item-cell"
  | "radial"
  | "shape"
  | "icon"
  | "content"
  | "text"
  | "cursor"
  | "font"
  | "scene"
  | "none";

export interface Role {
  group: Group;
  kind: Kind;
  role: string;
  treatment: Treatment;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Button atlases: up, down, hover (and disabled) frames that the models' animations read. */
export const BUTTON_ATLAS = words(`
ct_btn_srv_int1 ct_btn_srv_int2 ct_btn_srv_int3 ct_btn_srv_int4 ct_btn_srv_int5 ct_btn_srv_lan1 ct_btn_srv_lan2
ct_btn_srv_lst ct_btn_srv_lst1 ct_btn_srv_lst2 ctl_att ctl_att_01 ctl_btn_152x22 ctl_btn_169x39 ctl_btn_64x24
ctl_btn_btr ctl_btn_ctr ctl_btn_dm ctl_btn_dm_make ctl_btn_dm_task ctl_btn_inv_st ctl_btn_inv_st1 ctl_btn_lvlup
ctl_btn_pre_118 ctl_btn_pre_150 ctl_btn_pre_178 ctl_btn_pre_340 ctl_btn_pre_360 ctl_cg_btn_app ctl_class
ctl_ig_btn_pvpre ctl_opt_btn_key ctl_pre_btn_save ctl_skill`);

/** Panel and frame art: thin rules on a dark field, drawn about 1:1. */
export const PANEL = words(`
cg_main_bkg08 cg_main_bkg09 ctl_cg_att ctl_cg_bigportrt ctl_cg_edit_age ctl_cg_edit_fam ctl_cg_edit_fnam
ctl_cg_edit_s ctl_cg_edt_bio ctl_cg_fam ctl_cg_numbox3 ctl_cg_playmod ctl_cg_portraits ctl_cg_skill ctl_cg_spellhlp
ctl_cg_spells ctl_cg_spinfo ctl_con_prtl_inf ctl_edt_gen ctl_edt_mod_in1 ctl_edt_mod_info ctl_opt_gen ctl_opt_vid_1
ctl_pre_load ctl_pre_load1 ctl_pre_loadm ctl_pre_mod_desc ctl_pre_motd ctl_pre_movies ctl_pre_new1 ctl_pre_saveinfo
dth_deathopts edit_box_150x24 edit_box_276x25 gui_bart_prtrait gui_inv_contain gui_loadstatus gui_pre_bkgnd01
gui_pre_bkgnd02 gui_pre_newg gui_resting gui_spell_bk gui_srv_lst_pnl inv_box_ok inv_stacksplit pb_pnl_member
pnl_cg_clericd pnl_chr_appear pnl_con_prtl_inf pnl_con_vid_mode pnl_connectstat pnl_enable_mp pnl_feats1 pnl_help
pnl_opt_gen pnl_opt_key pnl_opt_key_page pnl_party_bar pnl_playmod pnl_playmod1 pnl_pre_cdkey pnl_select pnl_srv_lst
pnl_srv_lst_lan pnl_srv_lst_lan1 pnl_util_ok pnl_util_okt pre_load pre_load_01 qb_but gui_spell_hilite
gui_spell_splv gui_spell_splvl2 gui_pre_bkgnd5 gui_actionqueue`);

/** Shapes cut out by alpha (tabs, the creation arrows, radial pieces): the shape filled, a rule along its edge. */
export const SHAPE = words(`
gui_ig_chartabs gui_ig_chartabs2 gui_ig_jourtabs gui_inv_sto_tab gui_inv_tab gui_pre_playtabs gui_srv_lst_tab
ctl_cg_btn_right gui_rad_ring gui_spellmenu gui_radialmenu gui_textbubble`);

/** Small pixel-art controls, drawn by hand. */
export const SMALL = words(`
gui_scrollbar gui_slider gui_chr_arrowbtn ctl_chk_pre ctl_btn_x gui_spl_btn_up gui_spl_btn_down gui_inv_hilite
gui_inv_unhilite gui_inv_bkgnd gui_inv_bkgnd2 ctl_cg_btn_help pb_but_pvp pb_but_rest pb_but_spell gui_map_pieces
gui_invm_hl gui_invm_unhl gui_invm_ocupied ctl_btn_jnl_inv`);

/** Colour-cell strips with grey ramps, stretched into the bevels and fills of many panels. */
export const SWATCH = words("gui_boxes gui_boxes_chrgen gui_boxes_chrsht gui_boxes_dialog gui_boxes_ingame gui_boxes_pregam gui_ig_main");

/** Flat already: single-colour cells and flat marks. */
export const FLAT = words(`
gui_replace01 gui_replace02 gui_replace03 gui_replace04 gui_replace05 gui_replace06 gui_lightning gui_transprnt
gui_transprnt2 gui_pregame_bkg gui_rgbc gui_gring01 gui_pre_chkbox gui_ig_xbutton gui_inv_1x1_ol gui_inv_1x2_ol
gui_inv_2x1_ol gui_inv_2x2_ol gui_inv_2x4_ol gui_invm_hl_xid gui_invm_hl_xuse gui_pointer01`);

const ROLE_OF: Record<string, [Kind, string]> = {
  gui_scrollbar: ["scrollbar", "scrollbar track, thumb and ends"],
  gui_slider: ["slider", "slider track and thumb"],
  gui_chr_arrowbtn: ["button", "arrow buttons (up/down)"],
  ctl_chk_pre: ["button", "close-button face (ctl_btn_x draws it)"],
  ctl_btn_x: ["button", "close button"],
  ctl_btn_jnl_inv: ["checkbox", "checkbox box and mark (ctl_btn_xch), eye and gold button frames; tab icons kept"],
  gui_spl_btn_up: ["button", "arrow button"],
  gui_spl_btn_down: ["button", "arrow button"],
  gui_inv_hilite: ["item-cell", "item cell, highlighted"],
  gui_inv_unhilite: ["item-cell", "item cell"],
  gui_inv_bkgnd: ["item-cell", "item grid cell"],
  gui_inv_bkgnd2: ["item-cell", "item grid cell"],
  gui_invm_hl: ["item-cell", "item cell, highlighted"],
  gui_invm_unhl: ["item-cell", "item cell"],
  gui_invm_ocupied: ["item-cell", "item cell, occupied"],
  gui_invm_hl_xid: ["item-cell", "item cell, unidentified (signal blue)"],
  gui_invm_hl_xuse: ["item-cell", "item cell, unusable (signal red)"],
  ctl_cg_btn_help: ["button", "help button"],
  pb_but_pvp: ["button", "party-bar button (3 states)"],
  pb_but_rest: ["button", "party-bar button (3 states)"],
  pb_but_spell: ["button", "party-bar button (3 states)"],
  gui_map_pieces: ["button", "map pin buttons (3 states) and pins"],
  gui_ig_chartabs: ["tab", "tab strip"],
  gui_ig_chartabs2: ["tab", "tab strip"],
  gui_ig_jourtabs: ["tab", "tab strip"],
  gui_inv_sto_tab: ["tab", "tab"],
  gui_inv_tab: ["tab", "tab"],
  gui_pre_playtabs: ["tab", "tab strip"],
  gui_srv_lst_tab: ["tab", "tab"],
  ctl_cg_btn_right: ["button", "creation arrow buttons"],
  gui_rad_ring: ["radial", "radial ring"],
  gui_spellmenu: ["radial", "radial spell menu"],
  gui_radialmenu: ["radial", "radial menu pieces"],
  gui_textbubble: ["shape", "speech bubble corner"],
  gui_pre_chkbox: ["checkbox", "checkbox mark"],
  gui_ig_xbutton: ["button", "close X (2 states)"],
  gui_rgbc: ["cells", "signal colour cells"],
  gui_gring01: ["cells", "ring/selection swatch"],
  gui_pointer01: ["cells", "debug pointer swatch"],
  gui_loadstatus: ["bar", "progress bar: frame and fill (load screen)"],
  gui_resting: ["bar", "progress bar: frame and fill (rest popup)"],
  gui_actionqueue: ["panel", "action queue frame (icon kept)"],
  qb_but: ["button", "quickbar slot frames"],
  gui_spell_hilite: ["row", "spell cell, highlighted"],
  gui_spell_splv: ["row", "spell level cell"],
  gui_spell_splvl2: ["row", "spell level cell"],
  gui_pre_bkgnd5: ["panel", "drop shadow behind a panel"],
  edit_box_150x24: ["edit", "edit box"],
  edit_box_276x25: ["edit", "edit box"],
  gui_inv_contain: ["panel", "container bar with arrows"],
  pb_pnl_member: ["panel", "party member frame"],
  pnl_party_bar: ["panel", "party bar frame (icon column kept)"],
  gui_bart_prtrait: ["panel", "portrait frame (barter)"],
};

/** Textures kept as icons or held art that a control reads a different cell of for its states: each holds only
 * icons or symbols, no frame. Any other such texture fails the state-icon check: a control's state frames are chrome. */
export const STATE_ICONS: Record<string, string> = {
  gui_ig_faces: "the Player List's attitude faces (friendly / hostile), on the button's own frame",
  gui_inv_icons: "the inventory side tabs' icons, on the tabs' frames (gui_inv_tab)",
  gui_map_pieces2: "the map pins' gems (held content art), on transparent ground",
  gui_ime_toggle: "the IME toggle's baked letters (held text)",
};

/** Pictures inside chrome textures, kept as they are: [left, top, right, bottom] in texels, top-down. */
export const PICTURES: Record<string, [number, number, number, number]> = {
  ctl_edt_mod_in1: [121, 339, 393, 456],
  ctl_edt_mod_info: [121, 311, 393, 429],
  ctl_pre_new1: [121, 85, 393, 429],
  dth_deathopts: [52, 80, 460, 472],
  gui_srv_lst_pnl: [6, 6, 152, 40],
  gui_actionqueue: [0, 0, 33, 30],
};

/** Icons painted in an atlas that also holds a control's frames: kept, around the frames a redraw draws. */
export const ICONS: Record<string, [number, number, number, number][]> = {
  // the journal's and the store's tab icons, the eye and gold icons inside the inventory's two buttons; the
  // checkbox (ctl_btn_xch) and the buttons' frames are chrome
  ctl_btn_jnl_inv: [
    [25, 0, 48, 29],
    [48, 0, 128, 52],
    [0, 52, 48, 128],
    [52, 56, 83, 87],
    [52, 94, 83, 125],
    [93, 56, 124, 87],
    [93, 94, 124, 125],
  ],
};

const HOLD: Record<string, "content" | "text"> = {
  gui_banner: "content",
  gui_compass3: "content",
  gui_pal_hair01: "content",
  gui_pal_skin: "content",
  gui_pal_tattoo: "content",
  gui_cg_color_tmp: "content",
  gui_pre_bknd1: "content",
  gui_pre_bknd2: "content",
  gui_pre_bknd3: "content",
  pal_armor01: "content",
  pal_armor02: "content",
  pal_cloth01: "content",
  pal_hair01: "content",
  pal_leath01: "content",
  pal_skin01: "content",
  pal_tattoo01: "content",
  gui_map_pieces2: "content",
  gui_pre_logo: "text",
  gui_xp1_logo: "text",
  gui_xp2_logo: "text",
  gui_saveproxy: "text",
  beamdoge: "text",
  load_legal: "text",
  load_legal2: "text",
  gui_ime_toggle: "text",
  gui_icon_metamag: "text",
  extcredits_f_0: "text",
  extcredits_s_0: "text",
  xp1credits_f_0: "text",
  xp1credits_s_0: "text",
  xp2credits_f_0: "text",
  xp2credits_s_0: "text",
  load: "text",
  ls_load: "text",
  ls_save: "text",
};

const SCENE = new Set(words("black blood c_horse chrome1 fog05 fog06 fog_genm fxpa_dot02 gi_cloak01 grass ipm_chest001 mide01_a09 nulltex shinywater solid_noise wave"));

const ICON_PREFIX =
  /^(ir_|dm_|isk_|ife_|ief_|is_|ra_|po_|inv_slot_|gui_chrsht_|gui_party_|gui_ig_.*face|gui_ig_faces|gui_inv_statico|gui_inv_sto_icon|gui_inv_icons|gui_char_icons|gui_shield|gui_inv_armor_sm|gui_map_arrow|gui_partylocator|gui_partystatus|gui_walk|gui_spl_|gi_|it_|iit_|iw|ia|im)/;

const BUTTONS = new Set(BUTTON_ATLAS);
const PANELS = new Set(PANEL);
const SHAPES = new Set(SHAPE);
const SMALLS = new Set(SMALL);
const SWATCHES = new Set(SWATCH);
const FLATS = new Set(FLAT);

/** A user's own decision for a texture (old-gui-roles.json): it beats the built-in tables. */
export interface RoleOverride {
  group: Group;
  treatment: Treatment;
  kind?: Kind;
  role?: string;
  /** For a kept icon or held texture a control reads per state: what it holds (the state-icon check). */
  stateIcon?: string;
}

/** The built-in role of a texture that is drawn and exists, or null when none of the tables knows it. */
export function builtinRole(name: string): Role | null {
  const n = name.toLowerCase();
  const of = (dk: Kind, dr: string): [Kind, string] => ROLE_OF[n] ?? [dk, dr];
  if (BUTTONS.has(n)) return { group: "chrome", kind: "button", role: "button atlas: normal, pressed/selected, hover (and disabled) frames", treatment: "redraw" };
  if (PANELS.has(n)) {
    const [kind, role] = of("panel", "panel / frame art (window fill and rules)");
    return { group: "chrome", kind, role, treatment: "redraw" };
  }
  if (SHAPES.has(n)) {
    const [kind, role] = of("shape", "shaped control");
    return { group: "chrome", kind, role, treatment: "redraw" };
  }
  if (SWATCHES.has(n)) return { group: "chrome", kind: "cells", role: "colour-cell strip (fills, rules, selected rows, bevel shading of many panels)", treatment: "redraw" };
  if (SMALLS.has(n)) {
    const [kind, role] = of("button", "small control");
    return { group: "chrome", kind, role, treatment: "redraw" };
  }
  if (FLATS.has(n)) {
    const [kind, role] = of("cells", "colour-cell strip (fills, rules, selection cells)");
    return { group: "chrome", kind, role, treatment: "flat" };
  }
  if (n.startsWith("fnt_")) return { group: "font", kind: "font", role: "bitmap font", treatment: "hold" };
  if (n.startsWith("gui_mp_") || n.startsWith("mousetexture") || n.startsWith("pointer")) return { group: "cursor", kind: "cursor", role: "mouse cursor", treatment: "hold" };
  const h = HOLD[n];
  if (h) return { group: h, kind: h, role: h === "content" ? "content art" : "baked text or logo", treatment: "hold" };
  if (n.startsWith("load") || n.startsWith("ls_") || n.startsWith("lscreen")) return { group: "content", kind: "content", role: "load screen picture", treatment: "hold" };
  if (/^cloak_\d+$/.test(n)) return { group: "scene", kind: "scene", role: "3D texture the client names (cloaks)", treatment: "scene" };
  if (SCENE.has(n)) return { group: "scene", kind: "scene", role: "3D texture of a GUI scene model (main menu, credits)", treatment: "scene" };
  if (ICON_PREFIX.test(n)) return { group: "icon", kind: "icon", role: "icon", treatment: "icon" };
  return null;
}

/** Every bar the client fills in code: a model with a "percentage" animation, or a texture whose role is a
 * progress bar. Previews draw each at every level (0 = empty, 1 = full); the fill-bar check fails on a bar the
 * user's game has that is not listed here with at least three levels from empty to full. */
export interface FillBar {
  model: string;
  texture: string;
  screen: string;
  what: string;
  levels: number[];
}

export const FILL_BARS: FillBar[] = [
  { model: "ctl_loadstatus", texture: "gui_loadstatus", screen: "load_bar", what: "load screen (area transition, module load)", levels: [0, 0.4, 1] },
  { model: "ctl_timedevntbar", texture: "gui_resting", screen: "rest_bar", what: "rest popup (Resting...)", levels: [0, 0.4, 1] },
  { model: "ctl_playr_health", texture: "gui_boxes_ingame", screen: "player_health", what: "the player's health bar on the party bar portrait", levels: [0, 0.4, 1] },
  { model: "ctl_party_health", texture: "gui_boxes_ingame", screen: "party_health", what: "a party member's health bar", levels: [0, 0.4, 1] },
];

/** The client's names for the old GUI's TrueType fonts. EE remaps every font a .gui or the code names (fnt_galahad14,
 * fnt_console, fnt_dialog, ...) to one of these three files. */
export const OLD_GUI_FONTS = {
  fnt_maintext: "titles and labels (fnt_galahad14 and the other title fonts), about 17 px",
  fnt_default: "everything else (fnt_console, chat, lists, dialog), about 14 px",
  fnt_default_hr: "dialog and floating text with the large-font option, about 16 px",
} as const;
