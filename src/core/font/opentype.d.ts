// The part of opentype.js (MIT, https://github.com/opentypejs/opentype.js) this project uses; 2.0 ships no types.
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "Q" | "C" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Path {
    commands: PathCommand[];
  }
  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, unknown>;
    tables: {
      head: { flags: number };
      hhea: { ascender: number; descender: number; lineGap: number };
      os2?: {
        sTypoAscender: number;
        sTypoDescender: number;
        usWinAscent: number;
        usWinDescent: number;
        fsSelection: number;
        fsType?: number;
      };
      [k: string]: unknown;
    };
    charToGlyph(ch: string): Glyph;
    charToGlyphIndex(ch: string): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
