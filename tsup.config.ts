import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    outDir: "dist",
  },
  {
    entry: ["src/cli/index.ts"],
    format: ["cjs"],
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist/cli",
    sourcemap: true,
    noExternal: [/.*/],
    platform: "node",
  },
]);
