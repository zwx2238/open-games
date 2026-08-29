import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import games from "../games.json" with { type: "json" };
import collection from "../games/100games/catalog.json" with { type: "json" };
import littleJsCatalog from "../games/littlejs-arcade/open-games.catalog.json" with { type: "json" };
import miniTiers from "../games/mini-browser-games/GAME_TIERS.json" with { type: "json" };
import sausiCompatibility from "../games/sausi-games/open-games.compatibility.json" with { type: "json" };
import sausiCatalog from "../games/sausi-games/games/registry.json" with { type: "json" };
import featuredGames from "../catalog/featured-games.json" with { type: "json" };
import showcaseGames from "../catalog/showcase-games.json" with { type: "json" };
import { validateRuntimePath } from "./adapters/static-root.mjs";
import { readSourcesRegistry } from "./catalog-sources.mjs";
import { generateGamesCatalog } from "./generate-games.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRegistry = readSourcesRegistry(root);
const supportedAdapters = new Set([
  "godot3-html5",
  "littlejs-single-html",
  "rollup-web",
  "static-directory",
  "static-kaplay",
  "static-root",
  "static-single-file",
  "static-single-html",
  "vite-single-html",
  "vite-static",
]);

test("game metadata mirrors every enabled source inventory", () => {
  assert.deepEqual(games, generateGamesCatalog({ write: false }));
  assert.equal(
    games.length,
    collection.inventory.playable
      + Object.values(miniTiers.tiers).flat().length
      + sausiCatalog.games.length
      + littleJsCatalog.games.length
      + featuredGames.length
      + showcaseGames.length,
  );
  assert.equal(games.length, 442);
  assert.equal(games.filter((game) => game.sourceId === "showcase-forks").length, 8);
  assert.equal(new Set(games.map((game) => game.sourcePath)).size, 17);
  assert.equal(
    games.filter((game) => game.sourceId === "100games").length,
    collection.inventory.playable,
  );
  assert.equal(
    games.filter((game) => game.sourceId === "mini-browser-games").length,
    Object.values(miniTiers.tiers).flat().length,
  );
  assert.equal(
    games.filter((game) => game.sourceId === "sausi-games").length,
    sausiCatalog.games.length,
  );
  assert.equal(
    games.filter((game) => game.sourceId === "sausi-games" && game.status === "degraded").length,
    Object.keys(sausiCompatibility.issues).length,
  );
  assert.equal(
    games.filter((game) => game.sourceId === "sausi-games" && game.quality === "Verified").length,
    sausiCatalog.games.length - Object.keys(sausiCompatibility.issues).length,
  );
  assert.equal(
    games.filter((game) => game.sourceId === "littlejs-arcade").length,
    littleJsCatalog.games.length,
  );
  assert.equal(collection.games.filter((game) => game.playable).length, collection.games.length);
  for (const id of ["100g-five", "100g-slots", "100g-keno", "100g-antonym", "100g-bid"]) {
    assert.ok(games.some((game) => game.id === id), `${id} must remain visible`);
  }

  const sourceCounts = Object.groupBy(games, (game) => game.sourceId);
  for (const source of sourceRegistry) {
    assert.ok(sourceCounts[source.id]?.length, `${source.id} must produce games`);
  }

  const ids = new Set();
  const entries = new Set();
  for (const game of games) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(game.id), `duplicate id: ${game.id}`);
    assert.ok(!entries.has(game.entry), `duplicate entry: ${game.entry}`);
    ids.add(game.id);
    entries.add(game.entry);
    assert.ok(supportedAdapters.has(game.adapter), `unsupported adapter: ${game.adapter}`);
    assert.ok(!("command" in game));
    assert.ok(!("archive" in game));
    assert.ok(game.description.length >= 8, `${game.id} description is too short`);
    assert.ok(game.inputs.length > 0, `${game.id} must expose input metadata`);
    assert.ok(game.devices.includes("desktop"), `${game.id} must expose desktop support`);
    assert.ok(
      ["showcase", "curated", "catalog", "degraded", "archived"].includes(
        game.editorialTier,
      ),
      `${game.id} editorial tier`,
    );
    assert.ok(
      ["vibe-coded", "ai-assisted", "not-disclosed"].includes(game.creationMethod),
      `${game.id} creation method`,
    );
    assert.ok(["standard", "high"].includes(game.performance), `${game.id} performance`);
    assert.ok(["offline", "network", "hybrid"].includes(game.runtime), `${game.id} runtime`);
    assert.ok(game.creationNote.length >= 6, `${game.id} creation note`);
    assert.ok(game.runtimeNote.length >= 6, `${game.id} runtime note`);
    assert.ok(game.notices.length > 0, `${game.id} must expose license notices`);
    assert.ok(
      fs.statSync(path.join(root, game.sourcePath), { throwIfNoEntry: false })?.isDirectory(),
      `${game.id} source checkout`,
    );
    if (game.sourceEntry) {
      assert.ok(
        fs.statSync(
          path.join(root, game.sourcePath, game.sourceEntry),
          { throwIfNoEntry: false },
        )?.isFile(),
        `${game.id} source entry`,
      );
    }
    for (const notice of game.notices) {
      assert.ok(
        fs.statSync(
          path.join(root, game.sourcePath, notice.source),
          { throwIfNoEntry: false },
        )?.isFile(),
        `${game.id} notice ${notice.source}`,
      );
    }
  }
});

test("static-root adapter only accepts reviewed runtime paths", () => {
  assert.equal(validateRuntimePath("index.html"), "index.html");
  assert.equal(validateRuntimePath("vendor/three.min.js"), "vendor/three.min.js");
  for (const invalid of [
    "",
    ".",
    "..",
    "../index.html",
    "/tmp/index.html",
    "src\\main.js",
    ".git/config",
    ".github/workflows/deploy.yml",
    "node_modules/three/index.js",
    "tests/smoke.js",
    "docs/manual.html",
    "tools/build.js",
  ]) {
    assert.throws(() => validateRuntimePath(invalid));
  }
});

test("service build contains all source-built games, covers, and notices", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "service-dist", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.service, "open-games");
  assert.deepEqual(
    manifest.games.map((game) => game.id),
    games.map((game) => game.id),
  );

  const sourceCommits = new Map();
  for (const game of games) {
    const built = manifest.games.find((item) => item.id === game.id);
    assert.match(built?.commit ?? "", /^[0-9a-f]{40}$/);
    assert.equal(built?.sourceId, game.sourceId);
    assert.ok(
      fs.statSync(path.join(root, "service-dist", game.entry), { throwIfNoEntry: false })?.isFile(),
      `${game.id} built entry`,
    );
    assert.ok(
      fs.statSync(path.join(root, "service-dist", game.cover), { throwIfNoEntry: false })?.isFile(),
      `${game.id} built cover`,
    );
    const previous = sourceCommits.get(game.sourcePath);
    if (previous) assert.equal(previous, built.commit, `${game.sourcePath} commit mismatch`);
    sourceCommits.set(game.sourcePath, built.commit);
  }

  for (const notice of new Set(
    games.flatMap((game) => game.notices.map((item) => item.target)),
  )) {
    assert.ok(
      fs.statSync(path.join(root, "service-dist", notice), { throwIfNoEntry: false })?.isFile(),
      `built notice ${notice}`,
    );
  }
});
