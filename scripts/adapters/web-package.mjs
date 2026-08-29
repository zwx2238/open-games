import fs from "node:fs";
import path from "node:path";

import {
  copyDirectory,
  initializePackageSubmodules,
  installPackageDependencies,
  requireFile,
  runPackageBuild,
} from "./shared.mjs";
import {
  copyReviewedRuntimeEntries,
  validateRuntimePath,
} from "./static-root.mjs";

const packageManagers = new Set(["npm", "pnpm", "bun", "yarn"]);
const buildOutputs = new Set([
  ".app",
  "apps/web/build/client",
  "build",
  "client/dist",
  "deploy",
  "dist",
  "dist/client",
  "docs",
  "out",
  "packages/game/dist",
  "public",
]);

export async function buildWebPackage({ game, output, worktree }) {
  const packageManager = game.packageManager;
  if (!packageManagers.has(packageManager)) {
    throw new Error(
      `${game.id} packageManager must be one of: ${[...packageManagers].join(", ")}`,
    );
  }
  const packageRoot = game.packageSubpath
    ? resolveInside(
        worktree,
        validateRuntimePath(game.packageSubpath, `${game.id} packageSubpath`),
      )
    : path.resolve(worktree);
  const buildOutput = game.buildOutput ?? "dist";
  validateBuildOutput(buildOutput, game.id);

  requireFile(path.join(packageRoot, "package.json"));
  if (game.nestedSubmodules === true) {
    await initializePackageSubmodules(packageRoot);
  } else if (game.nestedSubmodules != null && game.nestedSubmodules !== false) {
    throw new Error(`${game.id} nestedSubmodules must be a boolean`);
  }
  await installPackageDependencies(packageRoot, packageManager, {
    registry: game.packageRegistry,
  });
  const buildBasePath = validateBuildBasePath(game.buildBasePath ?? "./", game.id);
  await runPackageBuild(packageRoot, packageManager, {
    script: game.buildScript ?? "build",
    env: {
      APP_URL: "./",
      BASE_URL: "./",
      NEXT_PUBLIC_OPEN_GAMES_BASE_PATH: buildBasePath,
      NEXT_PUBLIC_OPEN_GAMES_SELF_HOSTED: "1",
      PUBLIC_URL: ".",
      PUBLIC_OPEN_GAMES_BASE_PATH: buildBasePath,
      PUBLIC_OPEN_GAMES_SELF_HOSTED: "1",
      VITE_BASE_PATH: buildBasePath,
      VITE_OPEN_GAMES_SELF_HOSTED: "1",
    },
  });

  const builtRoot = resolveInside(packageRoot, buildOutput);
  requireFile(path.join(builtRoot, "index.html"));
  fs.rmSync(output, { recursive: true, force: true });
  copyDirectory(builtRoot, output);
  copyReviewedRuntimeEntries({
    game,
    output,
    worktree: packageRoot,
  });
  requireFile(path.join(output, "index.html"));
}

export function validateBuildOutput(buildOutput, gameId = "game") {
  if (!buildOutputs.has(buildOutput)) {
    throw new Error(
      `${gameId} buildOutput must be one of: ${[...buildOutputs].join(", ")}`,
    );
  }
  return buildOutput;
}

function resolveInside(base, relativePath) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`package path escapes source checkout: ${relativePath}`);
  }
  return resolved;
}

export function validateBuildBasePath(value, gameId) {
  if (value === "./") return value;
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${gameId} buildBasePath must be ./ or an absolute URL path`);
  }
  const normalized = value.replace(/\/+$/, "");
  const expected = `/open-games/games/${gameId}`;
  if (normalized !== expected) {
    throw new Error(`${gameId} buildBasePath must be ./ or ${expected}`);
  }
  return normalized;
}
