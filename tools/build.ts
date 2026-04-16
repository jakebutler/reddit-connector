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
  // Bundle all npm packages into the output — Devvit's runtime is a plain Node.js
  // environment and does not have @devvit/web or other deps available on disk.
  // Only true Node.js built-ins (node:http, node:crypto, etc.) stay external.
  external: ["node:*"],
  logLevel: "info",
});

console.log("Build complete.");
