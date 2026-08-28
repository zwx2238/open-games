import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import games from "../games.json" with { type: "json" };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("game metadata selects fixed reviewed adapters", () => {
  assert.equal(games.length, 1);
  assert.deepEqual(
    games.map((game) => game.adapter),
    ["godot3-html5"],
  );
  for (const game of games) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.ok(!("command" in game));
    assert.ok(!("archive" in game));
    assert.ok(fs.statSync(path.join(root, game.sourcePath), { throwIfNoEntry: false })?.isDirectory());
    assert.ok(fs.statSync(path.join(root, game.sourcePath, "LICENSE"), { throwIfNoEntry: false })?.isFile());
  }
});

test("service build contains the source-built game and notices", () => {
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
  for (const notice of ["pigeon-ascent-LICENSE.txt"]) {
    assert.ok(fs.statSync(path.join(root, "service-dist", "notices", notice), { throwIfNoEntry: false })?.isFile());
  }
});
