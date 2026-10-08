import { compile } from "svelte/compiler";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  // Use the mobile compiler with the repository's Vitest/Vite version.
  plugins: [
    {
      name: "svelte-test-components",
      transform(source, id) {
        if (!id.endsWith(".svelte")) return;
        return {
          code: compile(source, { filename: id, generate: "client", dev: true })
            .js.code,
          map: null,
        };
      },
    },
  ],
  resolve: { conditions: ["browser"], dedupe: ["svelte", "moment", "zod"] },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"] },
});
