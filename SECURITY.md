# Security

## Reporting a problem

Report security problems privately, through GitHub's private vulnerability reporting:
[open a report](https://github.com/plenarius/nwn-nui-designer/security/advisories/new). Do not open a public issue
for them. The report stays private between you and the maintainer until a fix is out.

## Supported versions

Only the latest `main` is supported. Fixes go there; there are no maintained older releases.

## What the local API promises

The designer runs on your computer. `pnpm dev` and `pnpm preview` start Vite's server with the local API
([`src/node/localapi.ts`](src/node/localapi.ts)), which reads your game, hak and override folders for the editor.
It promises this:

- **Only this computer.** A request under `/api/local/` is refused (403) unless it comes from a loopback address
  (`127.x.x.x` or `::1`) *and* its `Host` header names `localhost`, `127.x.x.x` or `[::1]` (with any port). The second
  check stops DNS rebinding: a web page elsewhere that points its own name at 127.0.0.1 still sends its own name.
- **Only three requests.** `GET /api/local/state` (the settings, the installs found, the file lists),
  `PUT /api/local/settings` and `GET`/`HEAD /api/local/file`. Any other request under `/api/local/` is a 404.
- **Settings are changed only by the editor itself.** The `PUT` must be `application/json` (which a page on another
  site cannot send without a CORS preflight), and when it carries an `Origin`, that origin's host must equal the
  `Host` header. The body is limited to 64 KiB; unknown fields are dropped, and each
  folder is checked before `nui-designer.ini` is written.
- **Files only inside the configured folders.** A file request names a root (`game`, `hak`, `ovr:N` or `windows`,
  the folders in the settings) and a path under it. `confine()` refuses:
  - an empty path, an absolute path, a path with a NUL byte, a backslash or a colon (`:`, so no drive letters and no
    NTFS streams such as `x.tga::$DATA`);
  - any empty, `.` or `..` part;
  - anything that is not a regular file once resolved.

  It then resolves the root and the file with the native `realpath` (following symlinks and Windows junctions), and
  serves the file only if its real path is inside the root's real path. **A symlink that leads out of the folder is
  refused**; one that stays inside it is followed. A refused path gets the same 404 as a missing file.
- **Read only.** The API never writes, deletes or moves a file, except `nui-designer.ini` itself through the settings
  request.

What it does not promise:

- **Do not expose the server to a network.** Vite listens on `localhost` by default. With `--host`, the local API
  still refuses other computers, but Vite itself would serve the checkout's files (`server.fs.allow` in
  `vite.config.ts`) to anyone who can reach the port.
- **A static build** (`pnpm build`, opened without the server) has no local API: it reads only the folders you pick
  in the browser.
- The command-line tools (`pnpm render`, `pnpm check`, `pnpm skin`) read and write the paths you give them, as any
  command-line tool does.

Window files, projects and skins are data: opening one does not run code. The NWScript the designer exports runs on
your own server; read it before you use it.
