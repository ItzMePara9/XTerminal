import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Installs the in-memory prisma mock before app modules are imported.
    setupFiles: ["test/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Serial: tests share one in-memory mock database per file.
    fileParallelism: false,
    pool: "forks",
  },
});
