// Bundles the three extension entry points and copies static assets into
// dist/ - the directory Chrome's "Load unpacked" points at.
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production";

const common = {
  bundle: true,
  platform: "browser",
  target: "chrome114",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function buildAll() {
  await mkdir(dist, { recursive: true });

  // Background service worker: manifest declares "type": "module", so ESM is fine.
  const backgroundCtx = await esbuild.context({
    ...common,
    entryPoints: [path.join(root, "src/background/index.ts")],
    outfile: path.join(dist, "background.js"),
    format: "esm",
  });

  // Content script: injected on demand via chrome.scripting.executeScript.
  // MV3 content scripts are not ES modules even when injected dynamically,
  // so this must be a plain IIFE bundle.
  const contentCtx = await esbuild.context({
    ...common,
    entryPoints: [path.join(root, "src/content/index.ts")],
    outfile: path.join(dist, "content.js"),
    format: "iife",
  });

  // Side panel: a normal extension page loaded via <script type="module">.
  const sidepanelCtx = await esbuild.context({
    ...common,
    entryPoints: [path.join(root, "src/sidepanel/index.ts")],
    outfile: path.join(dist, "sidepanel.js"),
    format: "esm",
  });

  const contexts = [backgroundCtx, contentCtx, sidepanelCtx];

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStatic();
    console.log("Watching for changes... (Ctrl+C to stop)");
    // Keep the process alive; esbuild's watch mode runs in the background.
    await new Promise(() => {});
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    await copyStatic();
    console.log(`Build complete: ${dist}`);
  }
}

async function copyStatic() {
  await cp(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
  await cp(path.join(root, "src/sidepanel/index.html"), path.join(dist, "sidepanel.html"));
  await cp(path.join(root, "src/sidepanel/sidepanel.css"), path.join(dist, "sidepanel.css"));

  const iconsDir = path.join(root, "icons");
  if (existsSync(iconsDir)) {
    await cp(iconsDir, path.join(dist, "icons"), { recursive: true });
  }

  // pdf.js needs its worker script available as a standalone file at runtime.
  const pdfWorkerSrc = path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  if (existsSync(pdfWorkerSrc)) {
    await cp(pdfWorkerSrc, path.join(dist, "pdf.worker.min.mjs"));
  } else {
    console.warn("WARNING: pdfjs-dist worker file not found - PDF parsing will fail at runtime.");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
