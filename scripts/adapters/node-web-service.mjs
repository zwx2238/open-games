import fs from "node:fs";
import path from "node:path";

import {
  copyDirectory,
  installProductionPackageDependencies,
  requireFile,
} from "./shared.mjs";
import {
  copyReviewedRuntimeEntries,
  validateRuntimePath,
} from "./static-root.mjs";

const packageManagers = new Set(["npm"]);
const staticRoots = new Set(["public"]);

export async function buildNodeWebService({
  game,
  output,
  outputRoot,
  worktree,
}) {
  const packageManager = game.packageManager;
  if (!packageManagers.has(packageManager)) {
    throw new Error(
      `${game.id} packageManager must be one of: ${[...packageManagers].join(", ")}`,
    );
  }
  const staticRootName = game.serviceStaticRoot ?? "public";
  if (!staticRoots.has(staticRootName)) {
    throw new Error(`${game.id} serviceStaticRoot must be public`);
  }
  const runtimeEntry = validateNodeRuntimeEntry(game.serviceEntry, game.id);
  const runtimeFiles = validateRuntimeList(
    game.serviceRuntimeFiles,
    `${game.id} serviceRuntimeFiles`,
  );
  const runtimeDirectories = validateRuntimeList(
    game.serviceRuntimeDirectories,
    `${game.id} serviceRuntimeDirectories`,
  );
  if (!runtimeFiles.includes(runtimeEntry)) {
    throw new Error(`${game.id} serviceRuntimeFiles must include ${runtimeEntry}`);
  }
  if (!runtimeFiles.includes("package.json") || !runtimeFiles.includes("package-lock.json")) {
    throw new Error(`${game.id} Node service must include package.json and package-lock.json`);
  }

  const staticRoot = path.join(worktree, staticRootName);
  requireFile(path.join(staticRoot, "index.html"));
  assertNoSymlinkTree(staticRoot, staticRootName);
  fs.rmSync(output, { recursive: true, force: true });
  copyDirectory(staticRoot, output);

  const runtimeRoot = path.join(outputRoot, "runtimes", game.id);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  copyReviewedRuntimeEntries({
    game: {
      id: game.id,
      runtimeDirectories,
      runtimeFiles,
    },
    output: runtimeRoot,
    worktree,
  });
  requireFile(path.join(runtimeRoot, runtimeEntry));
  await installProductionPackageDependencies(runtimeRoot, packageManager);

  return {
    runtime: {
      id: game.id,
      basePath: `/games/${game.id}`,
      entry: runtimeEntry,
      publicBasePath: `/open-games/games/${game.id}`,
    },
  };
}

export function validateNodeRuntimeEntry(value, gameId = "game") {
  const entry = validateRuntimePath(value, `${gameId} serviceEntry`);
  if (!["server.js", "server.mjs", "server.cjs"].includes(entry)) {
    throw new Error(`${gameId} serviceEntry must be server.js, server.mjs, or server.cjs`);
  }
  return entry;
}

function validateRuntimeList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const entries = value.map((entry, index) => validateRuntimePath(entry, `${label}[${index}]`));
  if (entries.length !== new Set(entries).size) {
    throw new Error(`${label} contains duplicate paths`);
  }
  return entries;
}

function assertNoSymlinkTree(directory, relativeDirectory) {
  const stats = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`service static root must be a directory: ${relativeDirectory}`);
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`service static root must not contain symlinks: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      assertNoSymlinkTree(path.join(directory, entry.name), relativePath);
    }
  }
}
