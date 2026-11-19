import { type Plugin, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localApi } from "./src/node/localapi.js";

/** The local API (src/node/localapi.ts): nui-designer.ini, the installs found here, and the configured folders' files,
 * for the dev server and `pnpm preview`. A static build opened without them falls back to the browser's pickers. */
const localApiPlugin = (): Plugin => ({
  name: "nui-designer-local-api",
  configureServer(server) {
    server.middlewares.use(localApi());
  },
  configurePreviewServer(server) {
    server.middlewares.use(localApi());
  },
});

export default defineConfig({
  root: "src/app",
  base: "./",
  publicDir: false,
  plugins: [react(), localApiPlugin()],
  // The samples are read from fixtures/, outside the app's root.
  server: { fs: { allow: ["../.."] } },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    // React and opentype.js are needed at start (the canvas parses the skin's fonts), so they are not lazy; as their own
    // chunks they stay cached when the app changes. The skin editor and the export dialogs are lazy (App.tsx).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "opentype", test: /node_modules[\\/]opentype\.js[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    // Half the cores: the run's length is export.test's one long round trip either way, and the drawing tests stay
    // about twice as fast when another job shares the machine (on an 8-core box, every core busy timed tests out).
    maxWorkers: "50%",
  },
});
