import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const sharedLibDir = fileURLToPath(new URL("../src/lib", import.meta.url));

export default defineConfig({
  // Component tests import .vue single-file components; the production config
  // keeps its plugins in vite.config.ts, which Vitest does not merge when a
  // dedicated vitest.config.ts exists.
  plugins: [vue()],
  resolve: {
    alias: {
      "@": srcDir,
      "@shared": sharedLibDir,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
