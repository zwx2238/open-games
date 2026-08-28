#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import games from "../games.json" with { type: "json" };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 4181;
const baseUrl = `http://127.0.0.1:${port}`;
const baseOrigin = new URL(baseUrl).origin;
const output = path.join(root, ".runtime", "visual-smoke");
const gameBatchSize = 4;
const gameSignals = new Map([
  ["pigeon-ascent", { selector: "#canvas", type: "canvas" }],
  [
    "pixel-princess-platformer",
    { readySelector: "body.at-menu", selector: "#game", type: "canvas" },
  ],
  ["stolen-sword", { selector: "canvas", type: "canvas" }],
  ["dark-sun-dungeon", { selector: "#root", type: "text" }],
  ["bagel-mvp", { selector: "canvas", type: "canvas" }],
]);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const server = spawn(process.execPath, ["service/server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    OPEN_GAMES_SERVICE_HOST: "127.0.0.1",
    OPEN_GAMES_SERVICE_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForHealth();
  const browser = await chromium.launch({ headless: true });
  try {
    await smokeCatalog(browser, "desktop", { width: 1440, height: 900 });
    await smokeCatalog(browser, "mobile", { width: 390, height: 844 });
    for (let index = 0; index < games.length; index += gameBatchSize) {
      const batch = games.slice(index, index + gameBatchSize);
      await Promise.all(
        batch.flatMap((game) => [
          smokeGame(browser, game, "desktop", { width: 1440, height: 900 }),
          smokeGame(browser, game, "mobile", mobileViewport(game.id)),
        ]),
      );
      console.log(
        `[open-games] visual smoke ${Math.min(index + batch.length, games.length)}/${games.length}`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function smokeCatalog(browser, name, viewport) {
  const { context, failures, page } = await openPage(browser, viewport);
  try {
    assert.equal(
      await page.locator(".game-row").count(),
      games.length,
      `${name}: catalog game count`,
    );
    await page.getByText(`${games.length} source-built games`, { exact: true }).waitFor();
    await page.getByLabel("Filter games").selectOption("featured");
    assert.equal(await page.locator(".game-row").count(), 5, `${name}: featured filter count`);
    await page.getByLabel("Filter games").selectOption("collection");
    assert.equal(await page.locator(".game-row").count(), 95, `${name}: collection filter count`);
    await page.getByLabel("Filter games").selectOption("all");
    await page.getByLabel("Search games").fill("GAUNTLET");
    assert.equal(await page.locator(".game-row").count(), 1, `${name}: search result count`);
    await page.getByLabel("Search games").fill("");
    await page.screenshot({
      path: path.join(output, `${name}-catalog.png`),
      fullPage: true,
    });
    assertNoFailures(name, failures);
  } finally {
    await context.close();
  }
}

async function smokeGame(browser, game, name, viewport) {
  const { context, failures, page } = await openPage(browser, viewport);
  const label = `${name}-${game.id}`;
  try {
    await page.locator(`[data-game-id="${game.id}"]`).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const frame = page.frameLocator(`iframe[data-game-id="${game.id}"]`);
    const signal = gameSignals.get(game.id)
      ?? (
        game.adapter === "static-single-html"
          ? { selector: "canvas", type: "canvas" }
          : null
      );
    if (!signal) throw new Error(`missing visual smoke signal for ${game.id}`);

    const target = frame.locator(signal.selector).first();
    await target.waitFor({ state: "visible", timeout: 30_000 });
    await waitForRenderSignal(target, signal.type);
    if (signal.readySelector) {
      await frame.locator(signal.readySelector).waitFor({
        state: "attached",
        timeout: 30_000,
      });
    }
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error(`${label}: game render target has no bounding box`);
    const interactionPoint = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2,
    };
    if (name === "mobile") {
      await page.touchscreen.tap(interactionPoint.x, interactionPoint.y);
    } else {
      await page.mouse.click(interactionPoint.x, interactionPoint.y);
    }
    if (name === "desktop" && game.catalogCoverSource) {
      await target.screenshot({
        path: path.join(output, `cover-${game.id}.png`),
      });
    }
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: path.join(output, `${label}.png`),
      fullPage: true,
    });
    assertNoFailures(label, failures);
  } finally {
    await context.close();
  }
}

async function openPage(browser, viewport) {
  const context = await browser.newContext({
    hasTouch: viewport.width < 900,
    isMobile: viewport.width < 900,
    viewport,
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response ${response.status()}: ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["blob:", "data:"].includes(url.protocol) && url.origin !== baseOrigin) {
      failures.push(`external request: ${request.url()}`);
    }
  });

  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error("catalog failed to load");
  return { context, failures, page };
}

async function waitForRenderSignal(locator, type) {
  await locator.evaluate(async (element, signalType) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (signalType === "text") {
        if ((element.textContent ?? "").trim().length > 20) return;
      } else if (
        element instanceof HTMLCanvasElement
        && element.width >= 100
        && element.height >= 100
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${signalType} render signal`);
  }, type);
}

function assertNoFailures(label, failures) {
  assert.deepEqual(failures, [], `${label}: browser failures`);
}

function mobileViewport(gameId) {
  if (gameId === "pixel-princess-platformer") {
    return { width: 844, height: 390 };
  }
  return { width: 390, height: 844 };
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("visual smoke server exited early");
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // Keep polling while the sidecar starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("visual smoke server did not become healthy");
}
