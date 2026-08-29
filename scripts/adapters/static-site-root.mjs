import fs from "node:fs";
import path from "node:path";

import { requireFile } from "./shared.mjs";
import { validateRuntimePath } from "./static-root.mjs";

const forbiddenNames = new Set([
  ".git",
  ".github",
  "node_modules",
  "test",
  "tests",
  "tools",
]);

export async function buildStaticSiteRoot({ game, output, worktree }) {
  const sourceRoot = path.resolve(worktree);
  const siteRoot = game.sourceSubpath
    ? resolveInside(sourceRoot, validateRuntimePath(game.sourceSubpath, `${game.id} sourceSubpath`))
    : sourceRoot;
  const excludedPaths = validateExcludedPaths(game.runtimeExclude ?? [], game.id);
  const sourceEntry = game.sourceEntry ?? (
    game.sourceSubpath ? `${game.sourceSubpath}/index.html` : "index.html"
  );
  const entry = resolveInside(sourceRoot, validateRuntimePath(sourceEntry, `${game.id} sourceEntry`));
  if (entry !== siteRoot && !entry.startsWith(`${siteRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceEntry must stay inside sourceSubpath`);
  }
  requireFile(entry);

  copyReviewedTree(siteRoot, output, "", excludedPaths);
  const relativeEntry = path.relative(siteRoot, entry);
  const builtEntry = path.join(output, relativeEntry);
  requireFile(builtEntry);
  if (relativeEntry !== "index.html") {
    if (path.dirname(relativeEntry) === ".") {
      fs.copyFileSync(builtEntry, path.join(output, "index.html"));
    } else {
      fs.writeFileSync(
        path.join(output, "index.html"),
        [
          "<!doctype html>",
          '<meta charset="utf-8">',
          `<script>location.replace(${JSON.stringify(`./${relativeEntry}`)})</script>`,
          "",
        ].join("\n"),
      );
    }
  }
  requireFile(path.join(output, "index.html"));
}

function validateExcludedPaths(value, gameId) {
  if (!Array.isArray(value)) {
    throw new Error(`${gameId} runtimeExclude must be an array`);
  }
  const entries = value.map((entry, index) => {
    const label = `${gameId} runtimeExclude[${index}]`;
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
    if (path.isAbsolute(entry) || entry.includes("\\")) {
      throw new Error(`${label} must be a relative POSIX path: ${entry}`);
    }
    if (entry.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`${label} contains an invalid path segment: ${entry}`);
    }
    return entry;
  });
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${gameId} runtimeExclude contains duplicate paths`);
  }
  return new Set(entries);
}

function copyReviewedTree(source, output, relativeDirectory, excludedPaths) {
  const sourceStats = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStats?.isDirectory()) {
    throw new Error(`static site root does not exist: ${source}`);
  }
  if (sourceStats.isSymbolicLink()) {
    throw new Error(`static site root must not be a symlink: ${source}`);
  }
  fs.mkdirSync(output, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (forbiddenNames.has(entry.name.toLowerCase()) || isExcluded(relativePath, excludedPaths)) {
      continue;
    }
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(output, entry.name);
    const stats = fs.lstatSync(sourcePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`static site runtime must not contain symlinks: ${relativePath}`);
    }
    if (stats.isDirectory()) {
      copyReviewedTree(sourcePath, targetPath, relativePath, excludedPaths);
    } else if (stats.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function isExcluded(relativePath, excludedPaths) {
  for (const excludedPath of excludedPaths) {
    if (relativePath === excludedPath || relativePath.startsWith(`${excludedPath}/`)) {
      return true;
    }
  }
  return false;
}

function resolveInside(base, relativePath) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`runtime path escapes source checkout: ${relativePath}`);
  }
  return resolved;
}
