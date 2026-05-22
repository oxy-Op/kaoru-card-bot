import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    testTimeout: 120_000, // summon tests do many DB ops
    hookTimeout: 30_000,
    pool: "forks",        // isolate from main process
    fileParallelism: false, // tests share a DB — run sequentially
  },
});
