/**
 * The original GUI's textures as its models show them: row 0 is the top of the picture, texture v = 1. The client
 * reads both a DDS and a TGA bottom row first, whatever the TGA's origin flag says.
 */
import { decodeDds, flipRows } from "../res/dds.js";
import type { RGBAImage } from "../res/image.js";
import { decodeTga } from "../res/tga.js";

/** A GUI texture (dds or tga) in display order. */
export function decodeGuiTexture(bytes: Uint8Array, ext: string): RGBAImage {
  const e = ext.toLowerCase();
  if (e === "dds") return decodeDds(bytes);
  if (e === "tga") {
    const im = decodeTga(bytes);
    // decodeTga returns the picture top row first by its origin flag; the client ignores the flag (stored row 0 is v = 0)
    const topFirst = bytes.length > 17 && (bytes[17]! & 0x20) !== 0;
    return topFirst ? flipRows(im) : im;
  }
  throw new Error(`${ext}: not a GUI texture format (dds or tga)`);
}
