/**
 * The built editor (dist/) for the browser tests, on a local port. With `api`, it also serves the local API
 * (src/node/localapi.ts) over a settings file of the test's own (never the repository's nui-designer.ini), with no
 * install detection and no environment, so the run is the same on every machine. Without it, /api/local/ answers
 * with an HTML page, as a static host would: the editor then falls back to the browser's pickers.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { localApi } from "../src/node/localapi.js";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf" };

export interface EditorServer {
  port: number;
  /** Turns the local API on or off for the next requests. */
  api: boolean;
  close(): void;
}

export async function serveEditor(dist: string, o: { iniPath?: string; api?: boolean } = {}): Promise<EditorServer> {
  const api = o.iniPath ? localApi({ iniPath: o.iniPath, env: {}, detect: false }) : null;
  const state = { api: !!(o.api ?? api) };
  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0]!;
    if (url.startsWith("/api/local/") && !(state.api && api)) {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>static</title>");
      return;
    }
    const serve = () => {
      const p = join(dist, decodeURIComponent(url).replace(/^\/$/, "/index.html"));
      let body: Buffer;
      try {
        body = readFileSync(p);
      } catch {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(body);
    };
    if (api && state.api) api(req, res, serve);
    else serve();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    get api() {
      return state.api;
    },
    set api(v: boolean) {
      state.api = v;
    },
    close: () => server.close(),
  };
}
