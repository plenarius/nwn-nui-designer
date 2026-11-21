/** NWN resource types (neverwinter.nim's restype.nim): the ones the viewer needs, and a few more so
 * a folder of loose files maps its extensions. */
export const RES_TYPES: Readonly<Record<string, number>> = {
  bmp: 1,
  tga: 3,
  wav: 4,
  plt: 6,
  ini: 7,
  txt: 10,
  mdl: 2002,
  nss: 2009,
  ncs: 2010,
  mod: 2011,
  are: 2012,
  ifo: 2014,
  "2da": 2017,
  gui: 2047,
  txi: 2022,
  dds: 2033,
  hak: 2061,
  wbm: 2071,
  mtr: 2072,
  ktx: 2073,
  ttf: 2074,
  tml: 2076,
  gif: 2079,
  png: 2080,
  jpg: 2081,
  jui: 2083,
  erf: 9997,
  bif: 9998,
  key: 9999,
};

export const TYPE_EXT: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(RES_TYPES).map(([k, v]) => [v, k]),
);

/** The resource type of an extension ("tga" -> 3), or undefined. Own keys only: "constructor" is not a type. */
export function resType(ext: string): number | undefined {
  const e = ext.toLowerCase();
  return Object.hasOwn(RES_TYPES, e) ? RES_TYPES[e] : undefined;
}

/** "nui_skin.tml" -> ["nui_skin", 2076], or null for an extension NWN does not know. */
export function splitResName(file: string): [resref: string, type: number] | null {
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  const t = resType(file.slice(dot + 1));
  if (t === undefined) return null;
  return [file.slice(0, dot).toLowerCase(), t];
}

export function resKey(resref: string, type: number): string {
  return `${resref.toLowerCase()}.${type}`;
}
