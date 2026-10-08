import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { build } from "esbuild";
import { resolve } from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "activity-widget-engine",
      apply: "build",
      async closeBundle() {
        await build({
          entryPoints: [resolve(import.meta.dirname, "src/widget-engine.ts")],
          outfile: resolve(import.meta.dirname, "dist/widget-engine.js"),
          bundle: true,
          platform: "browser",
          format: "iife",
          target: "es2020",
          minify: true,
        });
      },
    },
  ],
  resolve: { dedupe: ["moment", "zod"] },
});
