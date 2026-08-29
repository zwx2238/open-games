#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

import { buildGodot3Html5 } from "./adapters/godot3-html5.mjs";
import { buildLittleJsSingleHtml } from "./adapters/littlejs-single-html.mjs";
import { buildNodeWebService } from "./adapters/node-web-service.mjs";
import { buildRollupWeb } from "./adapters/rollup-web.mjs";
import { buildStaticDirectory } from "./adapters/static-directory.mjs";
import { buildStaticSingleHtml } from "./adapters/static-single-html.mjs";
import { buildStaticSingleFile } from "./adapters/static-single-file.mjs";
import { buildStaticKaplay } from "./adapters/static-kaplay.mjs";
import { buildStaticRoot } from "./adapters/static-root.mjs";
import { buildStaticSiteRoot } from "./adapters/static-site-root.mjs";
import { buildViteSingleHtml } from "./adapters/vite-single-html.mjs";
import { buildViteStatic } from "./adapters/vite-static.mjs";
import { buildWebPackage } from "./adapters/web-package.mjs";
import { ensureGeneratedCovers } from "./generate-covers.mjs";
import { generateGamesCatalog } from "./generate-games.mjs";

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
  ["littlejs-single-html", buildLittleJsSingleHtml],
  ["node-web-service", buildNodeWebService],
  ["rollup-web", buildRollupWeb],
  ["static-directory", buildStaticDirectory],
  ["static-single-html", buildStaticSingleHtml],
  ["static-single-file", buildStaticSingleFile],
  ["static-kaplay", buildStaticKaplay],
  ["static-root", buildStaticRoot],
  ["static-site-root", buildStaticSiteRoot],
  ["vite-single-html", buildViteSingleHtml],
  ["vite-static", buildViteStatic],
  ["web-package", buildWebPackage],
]);

await execFileAsync("git", ["submodule", "update", "--init", "--recursive", "--checkout"], {
  cwd: root,
  maxBuffer: 16 * 1024 * 1024,
});
const games = generateGamesCatalog();

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.rmSync(previousDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.mkdirSync(worktreesDir, { recursive: true });
fs.mkdirSync(path.join(stagingDir, "covers"), { recursive: true });
fs.mkdirSync(path.join(stagingDir, "notices"), { recursive: true });

const builtGames = [];
const serviceRuntimes = [];
const copiedNotices = new Set();
const commitsByGame = new Map();

try {
  for (const [sourcePath, sourceGames] of groupBySource(games)) {
    const source = path.join(root, sourcePath);
    const commit = await gitOutput(source, ["rev-parse", "HEAD"]);
    const status = await gitOutput(source, ["status", "--porcelain"]);
    if (status) throw new Error(`${sourcePath} source checkout is dirty`);

    const worktree = path.join(
      worktreesDir,
      `${sourcePath.replaceAll(/[^a-z0-9]+/gi, "-")}-${commit}`,
    );
    await removeWorktree(source, worktree);
    await execFileAsync("git", ["worktree", "add", "--detach", worktree, commit], {
      cwd: source,
      maxBuffer: 16 * 1024 * 1024,
    });

    try {
      console.log(
        `[open-games] building ${sourceGames.length} game(s) from ${sourcePath} at ${commit}`,
      );
      for (const game of sourceGames) {
        const adapter = adapters.get(game.adapter);
        if (!adapter) throw new Error(`unknown game adapter: ${game.adapter}`);
        const output = path.join(stagingDir, "games", game.id);
        fs.mkdirSync(output, { recursive: true });
        const adapterResult = await adapter({
          game,
          output,
          outputRoot: stagingDir,
          source,
          worktree,
        });
        if (adapterResult?.runtime) {
          serviceRuntimes.push({
            ...adapterResult.runtime,
            commit,
            sourceId: game.sourceId,
          });
        }
        if (game.coverSource) {
          copyAsset(
            worktree,
            game.coverSource,
            game.cover ? path.join(stagingDir, game.cover) : null,
          );
        } else if (game.catalogCoverSource) {
          copyAsset(
            root,
            game.catalogCoverSource,
            game.cover ? path.join(stagingDir, game.cover) : null,
          );
        }
        for (const notice of game.notices) {
          if (copiedNotices.has(notice.target)) continue;
          copyAsset(worktree, notice.source, path.join(stagingDir, notice.target));
          copiedNotices.add(notice.target);
        }
        commitsByGame.set(game.id, commit);
        builtGames.push({
          id: game.id,
          sourceId: game.sourceId,
          commit,
          adapter: game.adapter,
          entry: game.entry,
          cover: game.cover,
        });
      }
    } finally {
      await removeWorktree(source, worktree);
    }
  }

  await ensureGeneratedCovers({
    games,
    stagingDir,
    cacheDir: path.join(runtimeDir, "covers"),
    commitsByGame,
  });

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

  const manifest = {
    service: "open-games",
    version: await gitOutput(root, ["rev-parse", "HEAD"]).catch(() => "uncommitted"),
    builtAt: new Date().toISOString(),
    games: builtGames,
    runtimes: serviceRuntimes,
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

function copyAsset(base, relativeSource, target) {
  if (!relativeSource || !target) return;
  const source = path.resolve(base, relativeSource);
  const basePrefix = `${path.resolve(base)}${path.sep}`;
  if (!source.startsWith(basePrefix)) {
    throw new Error(`asset escapes its source root: ${relativeSource}`);
  }
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`game asset does not exist: ${relativeSource}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function groupBySource(games) {
  const groups = new Map();
  for (const game of games) {
    const group = groups.get(game.sourcePath) ?? [];
    group.push(game);
    groups.set(game.sourcePath, group);
  }
  return groups;
}
