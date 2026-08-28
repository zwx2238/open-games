#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

import games from "../games.json" with { type: "json" };
import { buildGodot3Html5 } from "./adapters/godot3-html5.mjs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "service-dist");
const stagingDir = path.join(root, "service-dist.tmp");
const previousDir = path.join(root, "service-dist.old");
const runtimeDir = path.join(root, ".runtime");
const worktreesDir = path.join(runtimeDir, "worktrees");
const entryPoint = path.join(root, "service-src", "main.tsx");
const adapters = new Map([
  ["godot3-html5", buildGodot3Html5],
]);

await execFileAsync("git", ["submodule", "update", "--init", "--recursive", "--checkout"], {
  cwd: root,
  maxBuffer: 16 * 1024 * 1024,
});

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.rmSync(previousDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.mkdirSync(worktreesDir, { recursive: true });

const builtGames = [];

try {
  for (const game of games) {
    const source = path.join(root, game.sourcePath);
    const commit = await gitOutput(source, ["rev-parse", "HEAD"]);
    const status = await gitOutput(source, ["status", "--porcelain"]);
    if (status) throw new Error(`${game.id} source checkout is dirty`);
    const adapter = adapters.get(game.adapter);
    if (!adapter) throw new Error(`unknown game adapter: ${game.adapter}`);

    const worktree = path.join(worktreesDir, `${game.id}-${commit}`);
    await removeWorktree(source, worktree);
    await execFileAsync("git", ["worktree", "add", "--detach", worktree, commit], {
      cwd: source,
      maxBuffer: 16 * 1024 * 1024,
    });

    const output = path.join(stagingDir, "games", game.id);
    fs.mkdirSync(output, { recursive: true });
    try {
      console.log(`[open-games] building ${game.id} from ${commit}`);
      await adapter({ game, output, source, worktree });
    } finally {
      await removeWorktree(source, worktree);
    }

    builtGames.push({
      id: game.id,
      commit,
      adapter: game.adapter,
      entry: game.entry,
    });
  }

  const result = await build({
    absWorkingDir: root,
    bundle: true,
    entryNames: "app-[hash]",
    entryPoints: [entryPoint],
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "css" },
    logLevel: "warning",
    metafile: true,
    minify: true,
    outdir: stagingDir,
    platform: "browser",
    splitting: true,
    target: ["es2020"],
    write: true,
  });

  const outputs = Object.entries(result.metafile.outputs);
  const entryJs = outputs.find(([name, meta]) => (
    name.endsWith(".js")
    && meta.entryPoint
    && path.resolve(root, meta.entryPoint) === entryPoint
  ));
  const entryCss = outputs.find(([name]) => name.endsWith(".css"));
  if (!entryJs || !entryCss) {
    throw new Error("Open Games service build did not produce JavaScript and CSS entries");
  }

  const outputName = ([name]) => (
    path.relative(stagingDir, path.resolve(root, name)).split(path.sep).join("/")
  );
  const entryJsName = outputName(entryJs);
  const entryCssName = outputName(entryCss);
  const template = fs.readFileSync(path.join(root, "service", "index.template.html"), "utf8");
  fs.writeFileSync(
    path.join(stagingDir, "index.html"),
    template.replace("__APP_CSS__", entryCssName).replace("__APP_JS__", entryJsName),
  );

  const coversDir = path.join(stagingDir, "covers");
  fs.mkdirSync(coversDir, { recursive: true });
  fs.copyFileSync(
    path.join(root, "games", "pigeon-ascent", "resource", "cover.png"),
    path.join(coversDir, "pigeon-ascent.png"),
  );
  const noticesDir = path.join(stagingDir, "notices");
  fs.mkdirSync(noticesDir, { recursive: true });
  for (const [source, target] of [
    ["games/pigeon-ascent/LICENSE", "pigeon-ascent-LICENSE.txt"],
  ]) {
    fs.copyFileSync(path.join(root, source), path.join(noticesDir, target));
  }

  const manifest = {
    service: "open-games",
    version: await gitOutput(root, ["rev-parse", "HEAD"]).catch(() => "uncommitted"),
    builtAt: new Date().toISOString(),
    games: builtGames,
  };
  fs.writeFileSync(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (fs.existsSync(outdir)) fs.renameSync(outdir, previousDir);
  fs.renameSync(stagingDir, outdir);
  fs.rmSync(previousDir, { recursive: true, force: true });
  console.log(`[open-games] built ${builtGames.length} games`);
} catch (error) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  if (!fs.existsSync(outdir) && fs.existsSync(previousDir)) {
    fs.renameSync(previousDir, outdir);
  }
  throw error;
}

async function gitOutput(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function removeWorktree(source, worktree) {
  if (fs.existsSync(worktree)) {
    await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
      cwd: source,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(() => {
      fs.rmSync(worktree, { recursive: true, force: true });
    });
  }
  await execFileAsync("git", ["worktree", "prune"], {
    cwd: source,
    maxBuffer: 16 * 1024 * 1024,
  });
}
