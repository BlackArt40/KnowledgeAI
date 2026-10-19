import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const sharedLibDir = fileURLToPath(new URL("../src/lib", import.meta.url));

export default defineConfig({
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
