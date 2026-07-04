import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // bundle the workspace package so dist/ is self-contained apart from node_modules
  noExternal: ["@projectsns/core"],
});
