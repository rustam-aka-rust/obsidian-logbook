import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";

const prod = process.argv[2] === "production";

// Куда копировать собранные артефакты для локального теста.
// Берём из env OBSIDIAN_PLUGIN_DIR или из git-ignored файла `.obsidian-plugin-dir`.
// Если не задано — просто собираем main.js в корне репозитория (без копирования).
function resolveVaultPluginDir() {
  if (process.env.OBSIDIAN_PLUGIN_DIR) return process.env.OBSIDIAN_PLUGIN_DIR.trim();
  try {
    return readFileSync(".obsidian-plugin-dir", "utf8").trim();
  } catch {
    return "";
  }
}

const VAULT_PLUGIN_DIR = resolveVaultPluginDir();

const banner = `/* Logbook plugin — build artifact, do not edit directly. */`;

async function copyAssets() {
  if (!VAULT_PLUGIN_DIR) return;
  if (!existsSync(VAULT_PLUGIN_DIR)) {
    await mkdir(VAULT_PLUGIN_DIR, { recursive: true });
  }
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    if (existsSync(f)) await copyFile(f, `${VAULT_PLUGIN_DIR}/${f}`);
  }
}

const copyPlugin = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await copyAssets();
      if (VAULT_PLUGIN_DIR) console.log("✔ build → " + VAULT_PLUGIN_DIR);
      else console.log("✔ build (main.js в корне; путь копирования не задан)");
    });
  },
};

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [copyPlugin],
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
