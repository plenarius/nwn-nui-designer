/** A module's hak order from a file on disk: module.ifo.json, a binary module.ifo or a .mod (core/res/hakorder.ts). */
import { type HakOrder, readHakOrder } from "../core/res/hakorder.js";
import { NodeFileSource } from "./filesource.js";

/** A hak order file that is missing, unreadable or not a module file; its message starts with the path. */
export class HakOrderError extends Error {}

/** The hak order in the file at path; throws a HakOrderError that starts with the path and says what is wrong. */
export async function readHakOrderFile(path: string): Promise<HakOrder> {
  let src: NodeFileSource;
  try {
    src = new NodeFileSource(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new HakOrderError(`${path}: ${code === "ENOENT" ? "no such file" : e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return await readHakOrder(src);
  } catch (e) {
    throw new HakOrderError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
