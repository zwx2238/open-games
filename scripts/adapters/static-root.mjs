import fs from "node:fs";
import path from "node:path";

import { copyDirectory, requireFile } from "./shared.mjs";

const forbiddenSegments = new Set([
  ".git",
  ".github",
  "docs",
  "node_modules",
  "test",
  "tests",
  "tools",
]);

export async function buildStaticRoot({ game, output, worktree }) {
  copyReviewedRuntimeEntries({ game, output, worktree, requireIndex: true });
  requireFile(path.join(output, "index.html"));
}

export function copyReviewedRuntimeEntries({
  game,
  output,
  worktree,
  requireIndex = false,
}) {
  const files = validateRuntimeEntries(
    game.runtimeFiles ?? [],
    `${game.id} runtimeFiles`,
    !requireIndex,
  );
  const directories = validateRuntimeEntries(
    game.runtimeDirectories ?? [],
    `${game.id} runtimeDirectories`,
    true,
  );
  if (requireIndex && !files.includes("index.html")) {
    throw new Error(`${game.id} static-root runtimeFiles must include index.html`);
  }
  rejectOverlappingEntries(game.id, files, directories);

  for (const relativeFile of files) {
    const source = resolveRuntimePath(worktree, relativeFile);
    rejectSymlink(source, relativeFile);
    requireFile(source);
    const target = path.join(output, relativeFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  for (const relativeDirectory of directories) {
    const source = resolveRuntimePath(worktree, relativeDirectory);
    rejectSymlinkTree(source, relativeDirectory);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${game.id} runtime directory does not exist: ${relativeDirectory}`);
    }
    copyDirectory(source, path.join(output, relativeDirectory));
  }
}

export function validateRuntimePath(value, label = "runtime path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (path.isAbsolute(value) || value.includes("\\")) {
    throw new Error(`${label} must be a relative POSIX path: ${value}`);
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => (
      segment.length === 0
      || segment === "."
      || segment === ".."
      || forbiddenSegments.has(segment.toLowerCase())
    ))
  ) {
    throw new Error(`${label} contains a forbidden path segment: ${value}`);
  }
  return value;
}

function validateRuntimeEntries(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const entries = value.map((entry, index) => validateRuntimePath(entry, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${label} contains duplicate paths`);
  }
  return entries;
}

function rejectOverlappingEntries(gameId, files, directories) {
  for (const file of files) {
    for (const directory of directories) {
      if (file === directory || file.startsWith(`${directory}/`)) {
        throw new Error(`${gameId} runtime paths overlap: ${directory} contains ${file}`);
      }
    }
  }
  for (const [index, directory] of directories.entries()) {
    if (
      directories.some((candidate, candidateIndex) => (
        candidateIndex !== index
        && directory.startsWith(`${candidate}/`)
      ))
    ) {
      throw new Error(`${gameId} runtime directories overlap: ${directory}`);
    }
  }
}

function resolveRuntimePath(worktree, relativePath) {
  const sourceRoot = path.resolve(worktree);
  const resolved = path.resolve(sourceRoot, relativePath);
  if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`runtime path escapes source checkout: ${relativePath}`);
  }
  return resolved;
}

function rejectSymlink(file, relativePath) {
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`runtime path must not be a symlink: ${relativePath}`);
  }
}

function rejectSymlinkTree(directory, relativeDirectory) {
  const stats = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (stats?.isSymbolicLink()) {
    throw new Error(`runtime path must not be a symlink: ${relativeDirectory}`);
  }
  if (!stats?.isDirectory()) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`runtime path must not contain symlinks: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      rejectSymlinkTree(path.join(directory, entry.name), relativePath);
    }
  }
}
