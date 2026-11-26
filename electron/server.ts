/**
 * The desktop app's page server: the built editor (dist/) and the same local API `pnpm dev` mounts
 * (src/node/localapi.ts), on a random 127.0.0.1 port. The window never opens this port itself: it loads
 * app://nui-designer/, whose handler (main.ts) forwards here, so the page keeps one origin (its autosave, recent
 * windows and settings in the browser's storage) whatever port this gets. Requests without the per-run token are
 * refused, so no other program on this computer can use the port.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { type LocalApiOptions, localApi } from "../src/node/localapi.js";

export const TOKEN_HEADER = "x-nui-designer-token";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export interface PageServer {
  origin: string;
  token: string;
  close(): void;
}

export async function servePage(dist: string, o: LocalApiOptions): Promise<PageServer> {
  const token = randomBytes(24).toString("hex");
  const api = localApi(o);
  const root = normalize(dist + sep);
  const server: Server = createServer((req, res) => {
    if (req.headers[TOKEN_HEADER] !== token) {
      res.writeHead(403).end();
      return;
    }
    api(req, res, () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = normalize(join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
      if (!p.startsWith(root) || (req.method !== "GET" && req.method !== "HEAD")) {
        res.writeHead(404).end();
        return;
      }
      readFile(p).then(
        (body) => res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(req.method === "HEAD" ? undefined : body),
        () => res.writeHead(404).end(),
      );
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, token, close: () => server.close() };
}
