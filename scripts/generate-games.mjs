#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function generateGamesCatalog({ write = true } = {}) {
  const featured = readJson(path.join(root, "catalog", "featured-games.json"));
  const collection = readJson(path.join(root, "games", "100games", "catalog.json"));
  validateCollection(collection);

  const collectionGames = collection.games
    .filter((game) => game.selected)
    .sort((left, right) => left.number - right.number)
    .map((game) => ({
      id: `100g-${game.id}`,
      title: game.title,
      author: game.author,
      description: game.description,
      sourcePath: "games/100games",
      sourceSubpath: game.directory,
      sourceUrl: `${collection.source.repository}/tree/main/${game.directory}`,
      upstreamUrl: `${collection.source.upstream}/tree/main/${game.directory}`,
      adapter: "static-single-html",
      entry: `games/100g-${game.id}/index.html`,
      cover: `covers/100g-${game.id}.png`,
      coverSource: game.coverSource,
      notice: "notices/100games-LICENSE.txt",
      noticeSource: "LICENSE",
      license: game.license,
      edition: `100 GAMES #${String(game.number).padStart(2, "0")} / ${game.category}`,
      input: game.input,
      session: game.session,
      category: game.category,
      group: "100 GAMES",
      language: game.language,
      featured: false,
      collectionNumber: game.number,
    }));

  const games = [...featured, ...collectionGames];
  validateGeneratedGames(games, featured.length, collectionGames.length);
  if (write) {
    fs.writeFileSync(
      path.join(root, "games.json"),
      `${JSON.stringify(games, null, 2)}\n`,
    );
  }
  return games;
}

function validateCollection(collection) {
  if (collection?.schemaVersion !== 1 || !Array.isArray(collection.games)) {
    throw new Error("100games catalog has an unsupported schema");
  }
  const selected = collection.games.filter((game) => game.selected);
  if (collection.games.length !== 100 || selected.length !== 95) {
    throw new Error(
      `100games catalog must contain 95 selected games out of 100, got ${selected.length}/${collection.games.length}`,
    );
  }
  for (const game of selected) {
    assertString(game.id, "collection game id");
    assertString(game.directory, `${game.id} directory`);
    assertString(game.entry, `${game.id} entry`);
    assertString(game.coverSource, `${game.id} coverSource`);
    assertString(game.title, `${game.id} title`);
    assertString(game.description, `${game.id} description`);
    if (!Number.isInteger(game.number)) {
      throw new Error(`${game.id} collection number must be an integer`);
    }
    if (!game.entry.startsWith(`${game.directory}/`)) {
      throw new Error(`${game.id} entry must stay inside its source directory`);
    }
    for (const relativeFile of [game.entry, game.coverSource]) {
      const file = resolveInside(path.join(root, "games", "100games"), relativeFile);
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`${game.id} catalog asset does not exist: ${relativeFile}`);
      }
    }
  }
}

function validateGeneratedGames(games, featuredCount, collectionCount) {
  if (featuredCount !== 5 || collectionCount !== 95 || games.length !== 100) {
    throw new Error(
      `generated catalog must contain 5 featured and 95 collection games, got ${featuredCount} + ${collectionCount}`,
    );
  }
  const ids = new Set();
  const entries = new Set();
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
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
