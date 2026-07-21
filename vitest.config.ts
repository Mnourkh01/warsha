import { defineConfig } from "vitest/config";

// Standalone config for unit tests - no Tauri/Tailwind plugins, pure logic in node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
