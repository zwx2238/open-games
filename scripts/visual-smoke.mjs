#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { chromium } from "playwright";

import games from "../games.json" with { type: "json" };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serviceUrl = `${baseUrl}/open-games/`;
const baseOrigin = new URL(baseUrl).origin;
const output = path.join(root, ".runtime", "visual-smoke");
const gameBatchSize = 6;
const sourceFilter = process.env.OPEN_GAMES_SMOKE_SOURCE;
const idFilter = new Set(
  (process.env.OPEN_GAMES_SMOKE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const runtimeGames = games.filter((game) => (
  (!sourceFilter || game.sourceId === sourceFilter)
  && (idFilter.size === 0 || idFilter.has(game.id))
));
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
let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream?.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  });
}

try {
  await waitForHealth();
  const browser = await chromium.launch({ headless: true });
  try {
    await smokeCatalog(browser, "desktop", { width: 1440, height: 900 });
    await smokeCatalog(browser, "mobile", { width: 390, height: 844 });
    const gameFailures = [];
    const gameWarnings = [];
    for (let index = 0; index < runtimeGames.length;) {
      const batchEnd = nextBatchEnd(runtimeGames, index);
      const batch = runtimeGames.slice(index, batchEnd);
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
        `[open-games] runtime smoke ${batchEnd}/${runtimeGames.length}`,
      );
      index = batchEnd;
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
  await stopServer();
}

async function smokeCatalog(browser, name, viewport) {
  const { context, failures, page } = await openPage(browser, viewport);
  try {
    const response = await page.goto(serviceUrl, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`${name}: catalog failed to load`);
    await page.locator(".game-card").first().waitFor();
    assert.equal(
      await page.locator(".showcase-grid .game-card").count(),
      games.filter((game) => game.editorialTier === "showcase").length,
      `${name}: showcase cards`,
    );
    const initialCatalogCards = await page.locator(".game-grid .game-card").count();
    assert.ok(
      initialCatalogCards > 0 && initialCatalogCards <= 60,
      `${name}: initial catalog batch`,
    );
    await page.getByText(`${games.length} 款游戏`, { exact: false }).waitFor();
    await assertResultCount(page, games.length, `${name}: all games`);

    await page.getByRole("button", { name: "筛选" }).click();
    await page.getByLabel("来源").selectOption({ label: "Mini Browser Games" });
    await assertResultCount(
      page,
      games.filter((game) => game.sourceTitle === "Mini Browser Games").length,
      `${name}: source filter`,
    );
    await page.getByLabel("来源").selectOption("all");

    await page.getByLabel("分层").selectOption("showcase");
    await assertResultCount(
      page,
      games.filter((game) => game.editorialTier === "showcase").length,
      `${name}: editorial tier filter`,
    );
    await page.getByLabel("分层").selectOption("all");

    await page.getByLabel("操作").selectOption("touch");
    await assertResultCount(
      page,
      games.filter((game) => game.inputs.includes("touch")).length,
      `${name}: input filter`,
    );
    await page.getByLabel("操作").selectOption("all");

    await page.getByLabel("性能").selectOption("high");
    await assertResultCount(
      page,
      games.filter((game) => game.performance === "high").length,
      `${name}: performance filter`,
    );
    await page.getByLabel("性能").selectOption("all");

    await page.getByLabel("设备").selectOption("mobile");
    await assertResultCount(
      page,
      games.filter((game) => game.devices.includes("mobile")).length,
      `${name}: device filter`,
    );
    await page.getByLabel("设备").selectOption("all");

    await page.getByLabel("运行").selectOption("network");
    await assertResultCount(
      page,
      games.filter((game) => game.runtime === "network").length,
      `${name}: runtime filter`,
    );
    await page.getByLabel("运行").selectOption("all");

    await page.getByLabel("运行").selectOption("hybrid");
    await assertResultCount(
      page,
      games.filter((game) => game.runtime === "hybrid").length,
      `${name}: hybrid runtime filter`,
    );
    await page.getByLabel("运行").selectOption("all");

    await page.getByLabel("搜索游戏").fill("GAUNTLET");
    await assertResultCount(page, 1, `${name}: search`);
    assert.equal(await page.locator(".game-card").count(), 1, `${name}: search card count`);
    await page.getByLabel("搜索游戏").fill("");

    const firstCard = page.locator(".showcase-grid .game-card").first();
    await firstCard.locator(".game-cover").evaluate((image) => {
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth < 100) {
        throw new Error("first card cover did not load");
      }
    });
    assert.ok((await firstCard.locator(".game-description").innerText()).length >= 8);
    assert.equal(await firstCard.locator(".game-facts div").count(), 6);
    assert.equal(await firstCard.locator(".card-notes p").count(), 1);
    await captureScreenshot(page, path.join(output, `${name}-catalog.png`));
    assertNoFailures(name, failures);
  } finally {
    await context.close();
  }
}

function nextBatchEnd(runtimeGames, index) {
  if (runtimeGames[index].performance === "high") return index + 1;
  let batchEnd = index;
  while (
    batchEnd < runtimeGames.length
    && batchEnd - index < gameBatchSize
    && runtimeGames[batchEnd].performance !== "high"
  ) {
    batchEnd += 1;
  }
  return batchEnd;
}

async function smokeGame(browser, game) {
  const viewport = game.devices.includes("mobile")
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 };
  const { context, failures, page } = await openPage(
    browser,
    viewport,
    {
      allowExternal: game.runtime !== "offline",
      ignoreHeadlessWebGpuLoss: game.id === "murmur",
    },
  );
  const label = `${game.devices.includes("mobile") ? "mobile" : "desktop"}-${game.id}`;
  try {
    const response = await page.goto(`${serviceUrl}#play=${encodeURIComponent(game.id)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!response?.ok()) throw new Error(`${label}: service entry failed to load`);
    const frameElement = page.locator(`iframe[data-game-id="${game.id}"]`);
    await frameElement.waitFor({ state: "visible", timeout: 30_000 });
    const inputPoint = await frameElement.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
    const frame = page.frameLocator(`iframe[data-game-id="${game.id}"]`);
    await waitForStableRenderSignal(frame);
    await page.waitForTimeout(750);
    if (game.adapter === "node-web-service") {
      await smokeNodeWebService(frame, game);
    }

    await exerciseGame(page, inputPoint, game);
    await page.waitForTimeout(450);

    if (sampleIds.has(game.id)) {
      await captureScreenshot(page, path.join(output, `${label}.jpg`), {
        format: "jpeg",
        quality: 72,
      });
    }
    if (game.status !== "degraded") assertNoFailures(label, failures);
    return failures;
  } catch (error) {
    if (failures.length === 0) throw error;
    throw new Error(`${formatError(error)}\n${failures.join("\n")}`);
  } finally {
    await context.close();
  }
}

async function smokeNodeWebService(frame, game) {
  if (game.id !== "gamenest") return;
  await frame.locator("#quickCreate").click();
  await frame.locator("#roomBadge").waitFor({ state: "visible", timeout: 10_000 });
  await frame.locator("#roomBadge").evaluate(async (badge) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((badge.textContent ?? "").trim() !== "----") return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("GameNest did not create a WebSocket room");
  });
}

async function openPage(
  browser,
  viewport,
  { allowExternal = false, ignoreHeadlessWebGpuLoss = false } = {},
) {
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
      && !message.text().startsWith("Unable to preventDefault inside passive event listener")
      && !(
        ignoreHeadlessWebGpuLoss
        && message.text().startsWith("THREE.THREE.WebGPURenderer: WebGL Device Lost:")
      )
    ) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.stack ?? error.message}`));
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

async function exerciseGame(page, point, game) {
  if (game.devices.includes("mobile")) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
  if (game.inputs.includes("keyboard")) {
    await page.keyboard.press("Space");
  }
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

async function waitForStableRenderSignal(frame) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitForRenderSignal(frame.locator("body").first());
      return;
    } catch (error) {
      if (
        attempt === 2
        || !formatError(error).includes("Execution context was destroyed")
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function assertNoFailures(label, failures) {
  assert.deepEqual(failures, [], `${label}: browser failures`);
}

function formatError(error) {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}

async function captureScreenshot(page, outputPath, {
  format = "png",
  quality,
} = {}) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await withTimeout(
      session.send("Page.captureScreenshot", {
        captureBeyondViewport: false,
        format,
        ...(quality === undefined ? {} : { quality }),
      }),
      30_000,
      "CDP screenshot timed out",
    );
    fs.writeFileSync(outputPath, Buffer.from(result.data, "base64"));
  } finally {
    await withTimeout(
      session.detach(),
      5_000,
      "CDP detach timed out",
    ).catch(() => {});
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`visual smoke server exited early:\n${serverOutput.trim()}`);
    }
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

async function getAvailablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      probe.off("error", reject);
      resolve();
    });
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("failed to reserve a visual smoke port");
  }
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
