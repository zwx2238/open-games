#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSourceGames, readSourcesRegistry } from "./catalog-sources.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function generateGamesCatalog({ write = true } = {}) {
  const sources = readSourcesRegistry(root);
  const games = sources.flatMap((source) => loadSourceGames(root, source));
  validateGeneratedGames(games, sources);
  if (write) {
    fs.writeFileSync(
      path.join(root, "games.json"),
      `${JSON.stringify(games, null, 2)}\n`,
    );
  }
  return games;
}

function validateGeneratedGames(games, sources) {
  const ids = new Set();
  const entries = new Set();
  const sourceCounts = Object.groupBy(games, (game) => game.sourceId);
  for (const source of sources) {
    if (!sourceCounts[source.id]?.length) {
      throw new Error(`enabled source produced no games: ${source.id}`);
    }
  }
  for (const game of games) {
    if (!/^[a-z0-9-]+$/.test(game.id)) {
      throw new Error(`invalid generated game id: ${game.id}`);
    }
    if (ids.has(game.id)) throw new Error(`duplicate generated game id: ${game.id}`);
    if (entries.has(game.entry)) throw new Error(`duplicate generated entry: ${game.entry}`);
    ids.add(game.id);
    entries.add(game.entry);
    if ("command" in game || "archive" in game) {
      throw new Error(`${game.id} contains forbidden executable metadata`);
    }
    for (const field of [
      "title",
      "author",
      "description",
      "sourceId",
      "sourceTitle",
      "sourcePath",
      "sourceUrl",
      "upstreamUrl",
      "adapter",
      "entry",
      "cover",
      "license",
      "input",
      "session",
      "category",
      "group",
      "language",
      "quality",
      "status",
      "runtime",
      "technology",
    ]) {
      assertString(game[field], `${game.id} ${field}`);
    }
    if (!Array.isArray(game.inputs) || game.inputs.length === 0) {
      throw new Error(`${game.id} must declare at least one input mode`);
    }
    if (!Array.isArray(game.notices) || game.notices.length === 0) {
      throw new Error(`${game.id} must declare source notices`);
    }
    const sourceRoot = resolveInside(root, game.sourcePath);
    if (!fs.statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${game.id} source checkout does not exist: ${game.sourcePath}`);
    }
    if (game.sourceEntry) {
      const sourceEntry = resolveInside(sourceRoot, game.sourceEntry);
      if (!fs.statSync(sourceEntry, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`${game.id} source entry does not exist: ${game.sourceEntry}`);
      }
    }
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function resolveInside(base, relativeFile) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativeFile);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`catalog path escapes source root: ${relativeFile}`);
  }
  return resolved;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const games = generateGamesCatalog();
  console.log(`[open-games] generated ${games.length} catalog entries`);
}
