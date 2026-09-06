import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import games from "../games.json" with { type: "json" };
import collection from "../games/100games/catalog.json" with { type: "json" };
import curatedGames from "../catalog/curated-games.json" with { type: "json" };
import littleJsCatalog from "../games/littlejs-arcade/open-games.catalog.json" with { type: "json" };
import miniTiers from "../games/mini-browser-games/GAME_TIERS.json" with { type: "json" };
import sausiCompatibility from "../games/sausi-games/open-games.compatibility.json" with { type: "json" };
import sausiCatalog from "../games/sausi-games/games/registry.json" with { type: "json" };
import featuredGames from "../catalog/featured-games.json" with { type: "json" };
import showcaseGames from "../catalog/showcase-games.json" with { type: "json" };
import { resolveGodot3Image } from "./adapters/godot3-html5.mjs";
import { validateNodeRuntimeEntry } from "./adapters/node-web-service.mjs";
import {
  validatePackageBuildScript,
  validatePackageRegistry,
} from "./adapters/shared.mjs";
import { validateRuntimePath } from "./adapters/static-root.mjs";
import {
  validateBuildBasePath,
  validateBuildOutput,
} from "./adapters/web-package.mjs";
import { readSourcesRegistry } from "./catalog-sources.mjs";
import { generateGamesCatalog } from "./generate-games.mjs";
import {
  createOpenGamesServiceRuntime,
  validateRuntimeManifest,
} from "../service/runtime.mjs";
import { createCoverStaticServer } from "./generate-covers.mjs";
import { reuseBuildAssets } from "./reuse-build-assets.mjs";

test("UI-only assets share immutable files but isolate generated UI", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "open-games-assets-"));
  try {
    const source = path.join(temporary, "current");
    const destination = path.join(temporary, "next");
    fs.mkdirSync(path.join(source, "games", "test"), { recursive: true });
    fs.writeFileSync(path.join(source, "games/test/index.html"), "game");
    fs.writeFileSync(path.join(source, "app-old.js"), "old-ui");
    fs.writeFileSync(path.join(source, "index.html"), "old-index");
    fs.writeFileSync(path.join(source, "manifest.json"), "{}");
    fs.symlinkSync("index.html", path.join(source, "games/test/link.html"));
    reuseBuildAssets(source, destination);
    assert.equal(fs.statSync(path.join(source, "games/test/index.html")).ino,
      fs.statSync(path.join(destination, "games/test/index.html")).ino);
    assert.notEqual(fs.statSync(path.join(source, "app-old.js")).ino,
      fs.statSync(path.join(destination, "app-old.js")).ino);
    assert.equal(fs.existsSync(path.join(destination, "index.html")), false);
    assert.equal(fs.existsSync(path.join(destination, "manifest.json")), false);
    fs.writeFileSync(path.join(destination, "app-old.js"), "new-ui");
    fs.rmSync(source, { recursive: true });
    assert.equal(fs.readFileSync(path.join(destination, "games/test/link.html"), "utf8"), "game");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("UI-only reuse rejects symlinks outside the build", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "open-games-assets-"));
  try {
    const source = path.join(temporary, "current");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(temporary, "external"), "outside");
    fs.symlinkSync("../external", path.join(source, "link"));
    assert.throws(() => reuseBuildAssets(source, path.join(temporary, "next")), /escapes build/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRegistry = readSourcesRegistry(root);
const supportedAdapters = new Set([
  "godot3-html5",
  "littlejs-single-html",
  "node-web-service",
  "rollup-web",
  "static-directory",
  "static-kaplay",
  "static-root",
  "static-site-root",
  "static-single-file",
  "static-single-html",
  "vite-single-html",
  "vite-static",
  "web-package",
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
      + curatedGames.length
      + showcaseGames.length,
  );
  assert.equal(games.filter((game) => game.sourceId === "showcase-forks").length, 8);
  assert.equal(
    games.filter((game) => game.sourceId === "curated-forks").length,
    curatedGames.length,
  );
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
    assert.ok(Array.isArray(game.notices), `${game.id} notices`);
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

test("static-site-root adapter accepts reviewed exclusions only", async () => {
  const fixture = path.join(root, ".runtime", "test-static-site-root");
  const worktree = path.join(fixture, "source");
  const output = path.join(fixture, "output");
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.mkdirSync(path.join(worktree, "assets"), { recursive: true });
  fs.mkdirSync(path.join(worktree, "tests"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "index.html"), "<canvas></canvas>");
  fs.writeFileSync(path.join(worktree, "assets", "game.js"), "export {};");
  fs.writeFileSync(path.join(worktree, "tests", "smoke.js"), "throw new Error();");
  const { buildStaticSiteRoot } = await import("./adapters/static-site-root.mjs");
  await buildStaticSiteRoot({
    game: {
      id: "fixture",
      runtimeExclude: ["README.md"],
      sourceEntry: "index.html",
    },
    output,
    worktree,
  });
  assert.ok(fs.existsSync(path.join(output, "index.html")));
  assert.ok(fs.existsSync(path.join(output, "assets", "game.js")));
  assert.ok(!fs.existsSync(path.join(output, "tests")));
  fs.rmSync(fixture, { recursive: true, force: true });
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

test("godot3-html5 adapter only accepts reviewed engine versions", () => {
  assert.equal(
    resolveGodot3Image({}),
    "barichello/godot-ci@sha256:0c6bc591f79f15a86e769c62cb5231017b2787d5e9a3803152837b1a2e6b3f48",
  );
  assert.equal(
    resolveGodot3Image({ godotVersion: "3.6.2" }),
    "barichello/godot-ci@sha256:026e1f652dd1d718073bb5c32372b3a5d73e7ad7bfe13b9052423604fca6918f",
  );
  assert.throws(
    () => resolveGodot3Image({ godotVersion: "latest" }),
    /unsupported reviewed Godot 3 version/,
  );
});

test("web-package adapter only accepts reviewed build scripts and outputs", () => {
  assert.equal(validatePackageBuildScript("build"), "build");
  assert.equal(validatePackageBuildScript("build:app"), "build:app");
  assert.equal(validatePackageBuildScript("build:game"), "build:game");
  assert.equal(validatePackageBuildScript("build:web"), "build:web");
  assert.throws(
    () => validatePackageBuildScript("postinstall"),
    /unsupported package build script/,
  );
  assert.equal(validateBuildOutput("dist"), "dist");
  assert.equal(validateBuildOutput("packages/game/dist"), "packages/game/dist");
  assert.throws(
    () => validateBuildOutput("../../tmp", "fixture"),
    /fixture buildOutput must be one of/,
  );
  assert.equal(
    validatePackageRegistry("https://registry.npmjs.org"),
    "https://registry.npmjs.org",
  );
  assert.throws(
    () => validatePackageRegistry("https://registry.example.com"),
    /unsupported package registry/,
  );
  assert.equal(validateBuildBasePath("./", "fixture"), "./");
  assert.equal(
    validateBuildBasePath("/services/open-games/games/fixture/", "fixture"),
    "/services/open-games/games/fixture",
  );
  assert.throws(
    () => validateBuildBasePath("/open-games/games/fixture", "fixture"),
    /fixture buildBasePath must be/,
  );
});

test("node-web-service adapter only accepts reviewed Node entries", () => {
  assert.equal(validateNodeRuntimeEntry("server.js", "fixture"), "server.js");
  assert.equal(validateNodeRuntimeEntry("server.mjs", "fixture"), "server.mjs");
  assert.throws(
    () => validateNodeRuntimeEntry("scripts/start.js", "fixture"),
    /fixture serviceEntry must be/,
  );
  assert.throws(
    () => validateNodeRuntimeEntry("../server.js", "fixture"),
    /forbidden path segment/,
  );
});

test("service runtime manifest rejects path and identity escapes", () => {
  const fixtureRoot = path.join(root, ".runtime", "test-runtime-manifest");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixtureRoot, "runtimes", "fixture"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "runtimes", "fixture", "server.js"), "");
  assert.deepEqual(
    validateRuntimeManifest([
      {
        id: "fixture",
        basePath: "/games/fixture",
        publicBasePath: "/open-games/games/fixture",
        entry: "server.js",
      },
    ], fixtureRoot).map(({ id, basePath, publicBasePath, entry }) => ({
      id,
      basePath,
      publicBasePath,
      entry,
    })),
    [{
      id: "fixture",
      basePath: "/games/fixture",
      publicBasePath: "/open-games/games/fixture",
      entry: "server.js",
    }],
  );
  assert.throws(
    () => validateRuntimeManifest([{
      id: "fixture",
      basePath: "/games/other",
      publicBasePath: "/open-games/games/fixture",
      entry: "server.js",
    }], fixtureRoot),
    /runtime basePath must be/,
  );
  assert.throws(
    () => validateRuntimeManifest([{
      id: "fixture",
      basePath: "/games/fixture",
      publicBasePath: "/open-games/games/fixture",
      entry: "../server.js",
    }], fixtureRoot),
    /relative POSIX file path/,
  );
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test("failed game runtime degrades only its route", async () => {
  const fixtureRoot = path.join(root, ".runtime", "test-runtime-failure");
  const runtimeRoot = path.join(fixtureRoot, "runtimes", "fixture");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "games", "static-fixture"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "index.html"), "<h1>catalog</h1>");
  fs.writeFileSync(
    path.join(fixtureRoot, "games", "static-fixture", "index.html"),
    "<script type=\"module\" src=\"./app.mjs\"></script>",
  );
  fs.writeFileSync(
    path.join(fixtureRoot, "games", "static-fixture", "app.mjs"),
    "document.body.dataset.ready = '1';",
  );
  fs.writeFileSync(path.join(runtimeRoot, "server.js"), "");
  fs.writeFileSync(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify({
      service: "open-games",
      runtimes: [{
        id: "fixture",
        basePath: "/games/fixture",
        publicBasePath: "/open-games/games/fixture",
        entry: "server.js",
      }],
    }),
  );

  const spawnChild = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.stdout = null;
    child.stderr = null;
    child.kill = () => {
      child.exitCode = 1;
      queueMicrotask(() => child.emit("exit", 1, null));
    };
    queueMicrotask(() => child.emit("error", new Error("fixture failed")));
    return child;
  };
  const runtime = createOpenGamesServiceRuntime({
    distRoot: fixtureRoot,
    host: "127.0.0.1",
    port: 0,
    spawnChild,
  });
  const running = await runtime.start();
  try {
    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      degraded: true,
      ok: true,
      running: true,
      runtimes: [{
        error: "fixture failed",
        id: "fixture",
        ready: false,
      }],
      service: "open-games",
      version: "unknown",
    });
    const catalogResponse = await fetch(`http://127.0.0.1:${running.port}/`);
    assert.equal(catalogResponse.status, 200);
    assert.equal(
      catalogResponse.headers.get("cross-origin-embedder-policy"),
      "credentialless",
    );
    assert.equal(
      catalogResponse.headers.get("cross-origin-opener-policy"),
      "same-origin",
    );
    assert.match(await catalogResponse.text(), /catalog/);
    for (const prefix of ["", "/open-games", "/services/open-games"]) {
      const gameResponse = await fetch(
        `http://127.0.0.1:${running.port}${prefix}/games/fixture/`,
      );
      assert.equal(gameResponse.status, 503);
      const aliasedCatalog = await fetch(
        `http://127.0.0.1:${running.port}${prefix}/`,
      );
      assert.equal(aliasedCatalog.status, 200);
      assert.match(await aliasedCatalog.text(), /catalog/);
      const directoryEntry = await fetch(
        `http://127.0.0.1:${running.port}${prefix}/games/static-fixture/`,
      );
      assert.equal(directoryEntry.status, 200);
      assert.match(await directoryEntry.text(), /app\.mjs/);
      const moduleResponse = await fetch(
        `http://127.0.0.1:${running.port}${prefix}/games/static-fixture/app.mjs`,
      );
      assert.equal(moduleResponse.status, 200);
      assert.equal(
        moduleResponse.headers.get("content-type"),
        "text/javascript; charset=utf-8",
      );
    }
  } finally {
    await running.stop();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("service startup failure stops already-running game runtimes", async () => {
  const fixtureRoot = path.join(root, ".runtime", "test-runtime-listen-failure");
  const runtimeRoot = path.join(fixtureRoot, "runtimes", "fixture");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "index.html"), "<h1>catalog</h1>");
  fs.writeFileSync(path.join(runtimeRoot, "server.js"), "");
  fs.writeFileSync(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify({
      service: "open-games",
      runtimes: [{
        id: "fixture",
        basePath: "/games/fixture",
        publicBasePath: "/open-games/games/fixture",
        entry: "server.js",
      }],
    }),
  );

  const occupied = http.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const address = occupied.address();
  assert.ok(address && typeof address === "object");
  const signals = [];
  const spawnChild = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = null;
    child.stderr = null;
    child.kill = (signal) => {
      signals.push(signal);
      child.exitCode = 0;
      child.signalCode = signal;
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    queueMicrotask(() => child.emit("message", { type: "ready", port: 34567 }));
    return child;
  };
  const runtime = createOpenGamesServiceRuntime({
    distRoot: fixtureRoot,
    host: "127.0.0.1",
    port: address.port,
    spawnChild,
  });
  try {
    await assert.rejects(runtime.start(), { code: "EADDRINUSE" });
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(runtime.runtimes.get("fixture").child, null);
    assert.equal(runtime.runtimes.get("fixture").port, null);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("cover server resolves service and public base paths", async () => {
  const fixtureRoot = path.join(root, ".runtime", "test-cover-server");
  const gameRoot = path.join(fixtureRoot, "games", "fixture");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(gameRoot, { recursive: true });
  fs.writeFileSync(path.join(gameRoot, "app.js"), "export {};");
  const server = await createCoverStaticServer(fixtureRoot);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    for (const prefix of ["/services/open-games", "/open-games"]) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}${prefix}/games/fixture/app.js`,
      );
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cross-origin-embedder-policy"),
        "credentialless",
      );
      assert.equal(
        response.headers.get("cross-origin-opener-policy"),
        "same-origin",
      );
      assert.equal(await response.text(), "export {};");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("service build contains all source-built games, covers, and notices", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "service-dist", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.service, "open-games");
  assert.ok(Array.isArray(manifest.runtimes));
  assert.deepEqual(
    manifest.runtimes.map(({ id, basePath, publicBasePath, entry }) => ({
      id,
      basePath,
      publicBasePath,
      entry,
    })),
    [{
      id: "gamenest",
      basePath: "/games/gamenest",
      publicBasePath: "/open-games/games/gamenest",
      entry: "server.js",
    }],
  );
  for (const runtimePath of [
    "server.js",
    "startup-port.js",
    "package.json",
    "package-lock.json",
    "node_modules",
    "bots",
    "games",
    "lang",
    "public",
  ]) {
    assert.ok(
      fs.statSync(
        path.join(root, "service-dist", "runtimes", "gamenest", runtimePath),
        { throwIfNoEntry: false },
      ),
      `gamenest runtime ${runtimePath}`,
    );
  }
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
