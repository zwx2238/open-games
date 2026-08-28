import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import games from "../games.json" with { type: "json" };
import collection from "../games/100games/catalog.json" with { type: "json" };
import { generateGamesCatalog } from "./generate-games.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("game metadata selects fixed reviewed adapters", () => {
  assert.deepEqual(games, generateGamesCatalog({ write: false }));
  assert.equal(games.length, 100);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(
        Object.groupBy(games, (game) => game.adapter),
      ).map(([adapter, adapterGames]) => [adapter, adapterGames.length]),
    ),
    {
      "godot3-html5": 1,
      "static-kaplay": 1,
      "rollup-web": 1,
      "vite-single-html": 1,
      "vite-static": 1,
      "static-single-html": 95,
    },
  );
  assert.equal(collection.games.length, 100);
  assert.equal(collection.games.filter((game) => game.selected).length, 95);
  assert.deepEqual(
    collection.games.filter((game) => !game.selected).map((game) => game.title),
    ["FIVE", "SLOTS", "KENO", "ANTONYM", "BID"],
  );
  for (const game of games) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.ok(!("command" in game));
    assert.ok(!("archive" in game));
    assert.ok(fs.statSync(path.join(root, game.sourcePath), { throwIfNoEntry: false })?.isDirectory());
    assert.ok(
      fs.statSync(
        path.join(root, game.sourcePath, game.noticeSource),
        { throwIfNoEntry: false },
      )?.isFile(),
    );
    if (game.sourceSubpath) {
      assert.ok(
        fs.statSync(
          path.join(root, game.sourcePath, game.sourceSubpath, "index.html"),
          { throwIfNoEntry: false },
        )?.isFile(),
      );
    }
  }
});

test("service build contains all source-built games and notices", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "service-dist", "manifest.json"), "utf8"));
  assert.equal(manifest.service, "open-games");
  assert.deepEqual(
    manifest.games.map((game) => game.id),
    games.map((game) => game.id),
  );
  for (const game of games) {
    assert.match(
      manifest.games.find((item) => item.id === game.id)?.commit ?? "",
      /^[0-9a-f]{40}$/,
    );
    assert.ok(fs.statSync(path.join(root, "service-dist", game.entry), { throwIfNoEntry: false })?.isFile());
  }
  for (const notice of new Set(games.map((game) => game.notice))) {
    assert.ok(
      fs.statSync(
        path.join(root, "service-dist", notice),
        { throwIfNoEntry: false },
      )?.isFile(),
    );
  }
  for (const game of games) {
    if (game.cover) {
      assert.ok(
        fs.statSync(
          path.join(root, "service-dist", game.cover),
          { throwIfNoEntry: false },
        )?.isFile(),
      );
    }
  }
  const collectionCommits = new Set(
    manifest.games
      .filter((game) => game.adapter === "static-single-html")
      .map((game) => game.commit),
  );
  assert.equal(collectionCommits.size, 1);
  for (const game of games.filter((item) => item.adapter === "static-single-html")) {
    const html = fs.readFileSync(path.join(root, "service-dist", game.entry), "utf8");
    assert.ok(!html.includes("fonts.googleapis.com"));
    assert.ok(!html.includes("googletagmanager.com"));
  }
});
