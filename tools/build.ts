import * as esbuild from "esbuild";
import process from "node:process";

const minify = process.argv.includes("--minify");

await esbuild.build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  outdir: "dist/server",
  platform: "node",
  format: "esm",
  target: "node22",
  minify,
  packages: "external", // don't bundle node_modules — Devvit provides them at runtime
  logLevel: "info",
});

console.log("Build complete.");
