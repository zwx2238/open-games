#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { chromium } from "playwright";

import games from "../games.json" with { type: "json" };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 4181;
const baseUrl = `http://127.0.0.1:${port}`;
const baseOrigin = new URL(baseUrl).origin;
const output = path.join(root, ".runtime", "visual-smoke");
const gameBatchSize = 6;
const sourceFilter = process.env.OPEN_GAMES_SMOKE_SOURCE;
const runtimeGames = sourceFilter
  ? games.filter((game) => game.sourceId === sourceFilter)
  : games;
const sampleIds = new Set(
  Object.values(Object.groupBy(runtimeGames, (game) => game.sourceId))
    .flatMap((sourceGames) => sourceGames.slice(0, 2).map((game) => game.id)),
);
if (runtimeGames.length === 0) {
  throw new Error(`no games matched OPEN_GAMES_SMOKE_SOURCE=${sourceFilter}`);
}

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
    const gameFailures = [];
    const gameWarnings = [];
    for (let index = 0; index < runtimeGames.length; index += gameBatchSize) {
      const batch = runtimeGames.slice(index, index + gameBatchSize);
      const results = await Promise.allSettled(
        batch.map((game) => smokeGame(browser, game)),
      );
      results.forEach((result, batchIndex) => {
        if (result.status === "rejected") {
          gameFailures.push({
            game: batch[batchIndex],
            reason: result.reason,
          });
        } else if (result.value.length > 0) {
          gameWarnings.push({
            game: batch[batchIndex],
            failures: result.value,
          });
        }
      });
      console.log(
        `[open-games] runtime smoke ${Math.min(index + batch.length, runtimeGames.length)}/${runtimeGames.length}`,
      );
    }
    if (gameWarnings.length > 0) {
      fs.writeFileSync(
        path.join(output, "warnings.json"),
        `${JSON.stringify(
          gameWarnings.map(({ game, failures }) => ({
            id: game.id,
            sourceId: game.sourceId,
            title: game.title,
            failures,
          })),
          null,
          2,
        )}\n`,
      );
    }
    if (gameFailures.length > 0) {
      const reportFile = path.join(output, "failures.json");
      fs.writeFileSync(
        reportFile,
        `${JSON.stringify(
          gameFailures.map(({ game, reason }) => ({
            id: game.id,
            sourceId: game.sourceId,
            title: game.title,
            error: formatError(reason),
          })),
          null,
          2,
        )}\n`,
      );
      throw new Error(
        `runtime smoke failed for ${gameFailures.length}/${runtimeGames.length} games; see ${reportFile}`,
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
    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`${name}: catalog failed to load`);
    await page.locator(".game-card").first().waitFor();
    const initialCards = await page.locator(".game-card").count();
    assert.ok(initialCards > 0 && initialCards <= 60, `${name}: initial card batch`);
    await page.getByText(`${games.length} 款游戏`, { exact: false }).waitFor();
    await assertResultCount(page, games.length, `${name}: all games`);

    await page.getByLabel("来源").selectOption({ label: "Mini Browser Games" });
    await assertResultCount(
      page,
      games.filter((game) => game.sourceTitle === "Mini Browser Games").length,
      `${name}: source filter`,
    );
    await page.getByLabel("来源").selectOption("all");

    await page.getByLabel("质量").selectOption("SSS");
    await assertResultCount(
      page,
      games.filter((game) => game.quality === "SSS").length,
      `${name}: quality filter`,
    );
    await page.getByLabel("质量").selectOption("all");

    await page.getByLabel("状态").selectOption("archived");
    await assertResultCount(
      page,
      games.filter((game) => game.status === "archived").length,
      `${name}: status filter`,
    );
    await page.getByLabel("状态").selectOption("all");

    await page.getByLabel("状态").selectOption("degraded");
    await assertResultCount(
      page,
      games.filter((game) => game.status === "degraded").length,
      `${name}: degraded status filter`,
    );
    await page.getByLabel("状态").selectOption("all");

    await page.getByLabel("运行").selectOption("network");
    await assertResultCount(
      page,
      games.filter((game) => game.runtime === "network").length,
      `${name}: runtime filter`,
    );
    await page.getByLabel("运行").selectOption("all");

    await page.getByLabel("搜索游戏").fill("GAUNTLET");
    await assertResultCount(page, 1, `${name}: search`);
    assert.equal(await page.locator(".game-card").count(), 1, `${name}: search card count`);
    await page.getByLabel("搜索游戏").fill("");

    const firstCard = page.locator(".game-card").first();
    await firstCard.locator(".game-cover").evaluate((image) => {
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth < 100) {
        throw new Error("first card cover did not load");
      }
    });
    assert.ok((await firstCard.locator(".game-description").innerText()).length >= 8);
    assert.equal(await firstCard.locator(".game-facts div").count(), 4);
    await page.screenshot({
      path: path.join(output, `${name}-catalog.png`),
    });
    assertNoFailures(name, failures);
  } finally {
    await context.close();
  }
}

async function smokeGame(browser, game) {
  const viewport = game.devices.includes("mobile")
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 };
  const { context, failures, page } = await openPage(
    browser,
    viewport,
    game.runtime === "network",
  );
  const label = `${game.devices.includes("mobile") ? "mobile" : "desktop"}-${game.id}`;
  try {
    const response = await page.goto(`${baseUrl}/#play=${encodeURIComponent(game.id)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!response?.ok()) throw new Error(`${label}: service entry failed to load`);
    const frameElement = page.locator(`iframe[data-game-id="${game.id}"]`);
    await frameElement.waitFor({ state: "visible", timeout: 30_000 });
    const frame = page.frameLocator(`iframe[data-game-id="${game.id}"]`);
    await waitForRenderSignal(frame.locator("body").first());
    await page.waitForTimeout(750);

    const frameBox = await frameElement.boundingBox();
    if (!frameBox) throw new Error(`${label}: iframe has no bounding box`);
    const point = {
      x: frameBox.x + frameBox.width / 2,
      y: frameBox.y + frameBox.height / 2,
    };
    if (game.devices.includes("mobile")) {
      await page.touchscreen.tap(point.x, point.y);
    } else {
      await page.mouse.click(point.x, point.y);
    }
    await page.waitForTimeout(450);

    if (sampleIds.has(game.id)) {
      await page.screenshot({
        path: path.join(output, `${label}.jpg`),
        type: "jpeg",
        quality: 72,
      });
    }
    if (game.status !== "degraded") assertNoFailures(label, failures);
    return failures;
  } finally {
    await context.close();
  }
}

async function openPage(browser, viewport, allowExternal = false) {
  const context = await browser.newContext({
    hasTouch: viewport.width < 900,
    isMobile: viewport.width < 900,
    viewport,
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && !message.text().startsWith("Texture key already in use:")
    ) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response ${response.status()}: ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      !allowExternal
      && !["blob:", "data:"].includes(url.protocol)
      && url.origin !== baseOrigin
    ) {
      failures.push(`external request: ${request.url()}`);
    }
  });
  return { context, failures, page };
}

async function assertResultCount(page, expected, label) {
  await page.locator(".result-line strong").waitFor();
  await page.waitForFunction(
    ({ expectedCount }) => (
      document.querySelector(".result-line strong")?.textContent === String(expectedCount)
    ),
    { expectedCount: expected },
  );
  assert.equal(await page.locator(".result-line strong").innerText(), String(expected), label);
}

async function waitForRenderSignal(locator) {
  await locator.evaluate(async (body) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const canvas = body.querySelector("canvas");
      const svg = body.querySelector("svg");
      const image = body.querySelector("img");
      const canvasArea = canvas instanceof HTMLCanvasElement
        ? canvas.width * canvas.height
        : 0;
      const imageReady = image instanceof HTMLImageElement
        ? image.complete && image.naturalWidth > 20
        : false;
      if (
        canvasArea >= 10_000
        || svg instanceof SVGElement
        || imageReady
        || (body.textContent ?? "").trim().length >= 12
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("timed out waiting for game render signal");
  });
}

function assertNoFailures(label, failures) {
  assert.deepEqual(failures, [], `${label}: browser failures`);
}

function formatError(error) {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
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
