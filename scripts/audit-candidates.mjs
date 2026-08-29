#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";

import { buildStaticRoot } from "./adapters/static-root.mjs";
import { buildStaticSiteRoot } from "./adapters/static-site-root.mjs";
import { buildWebPackage } from "./adapters/web-package.mjs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const planFile = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, ".runtime", "candidate-plan.json");
const outputRoot = path.join(root, ".runtime", "candidate-builds");
const screenshotRoot = path.join(root, ".runtime", "candidate-screenshots");
const reportFile = path.join(root, ".runtime", "candidate-report.json");
const adapters = new Map([
  ["static-root", buildStaticRoot],
  ["static-site-root", buildStaticSiteRoot],
  ["web-package", buildWebPackage],
]);
const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
if (!Array.isArray(plan) || plan.length === 0) {
  throw new Error("candidate plan must be a non-empty array");
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.rmSync(screenshotRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
fs.mkdirSync(screenshotRoot, { recursive: true });

const buildResults = await runPool(plan, 3, buildCandidate);
const builtCandidates = buildResults
  .filter((result) => result.ok)
  .map((result) => result.candidate);
const visualResults = await auditVisuals(builtCandidates);
const report = {
  generatedAt: new Date().toISOString(),
  planFile: path.relative(root, planFile),
  builds: buildResults,
  visuals: visualResults,
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `[open-games] candidate audit: ${builtCandidates.length}/${plan.length} built, `
  + `${visualResults.filter((result) => result.ok).length}/${visualResults.length} visual checks passed`,
);
console.log(`[open-games] report: ${reportFile}`);

async function buildCandidate(candidate) {
  const adapter = adapters.get(candidate.adapter);
  if (!adapter) {
    return failure(candidate, `unsupported adapter: ${candidate.adapter}`);
  }
  const worktree = resolveInside(root, candidate.sourcePath);
  const output = path.join(outputRoot, candidate.id);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  try {
    await adapter({
      game: candidate,
      output,
      outputRoot,
      source: worktree,
      worktree,
    });
    return { ok: true, id: candidate.id, candidate };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    return failure(candidate, error);
  }
}

async function auditVisuals(candidates) {
  if (candidates.length === 0) return [];
  const server = createStaticServer(outputRoot);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("candidate server failed");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    return await runPool(
      candidates.flatMap((candidate) => (
        (candidate.devices ?? ["desktop"]).map((device) => ({ candidate, device }))
      )),
      1,
      ({ candidate, device }) => auditViewport(browser, baseUrl, candidate, device),
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function auditViewport(browser, baseUrl, candidate, device) {
  const viewport = viewports[device];
  if (!viewport) return failure(candidate, `unsupported viewport: ${device}`, { device });
  const context = await browser.newContext({
    hasTouch: device === "mobile",
    isMobile: device === "mobile",
    viewport,
  });
  const page = await context.newPage();
  const browserErrors = [];
  const externalRequests = new Set();
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      browserErrors.push(`response ${response.status()}: ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["blob:", "data:"].includes(url.protocol) && url.origin !== new URL(baseUrl).origin) {
      externalRequests.add(url.origin);
    }
  });
  const label = `${candidate.id}-${device}`;
  try {
    const response = await page.goto(
      `${baseUrl}/services/open-games/games/${candidate.id}/index.html`,
      {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
      },
    );
    if (!response?.ok()) throw new Error(`entry failed with ${response?.status() ?? "no response"}`);
    if (!candidate.skipRenderSignal) {
      await waitForRenderSignal(page);
    }
    await page.waitForTimeout(candidate.startupDelayMs ?? 1500);
    const startSelectors = candidate.startSelectors
      ?? (candidate.startSelector ? [candidate.startSelector] : []);
    for (const selector of startSelectors) {
      const start = page.locator(selector).first();
      await start.waitFor({
        state: candidate.forceStart ? "attached" : "visible",
        timeout: candidate.startTimeoutMs ?? 15_000,
      });
      if (candidate.forceStart) {
        await start.evaluate((element) => {
          if (element instanceof HTMLElement) {
            element.click();
            return;
          }
          element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      } else {
        await start.click({ timeout: 5000 });
      }
      await page.waitForTimeout(candidate.startStepDelayMs ?? 1000);
    }
    if (startSelectors.length > 0) {
      await page.waitForTimeout(candidate.afterStartDelayMs ?? 1500);
    }
    const screenshot = path.join(screenshotRoot, `${label}.png`);
    await captureScreenshot(page, screenshot);
    const variation = await imageVariation(screenshot);
    const bodyMetrics = {
      height: viewport.height,
      textLength: null,
      width: viewport.width,
    };
    return {
      ok: browserErrors.length === 0 && variation >= 0.015,
      id: candidate.id,
      device,
      browserErrors,
      externalRequests: [...externalRequests],
      screenshot: path.relative(root, screenshot),
      variation,
      bodyMetrics,
    };
  } catch (error) {
    return failure(candidate, error, {
      browserErrors,
      device,
      externalRequests: [...externalRequests],
    });
  } finally {
    await context.close();
  }
}

async function imageVariation(screenshot) {
  const { stdout } = await execFileAsync(
    "identify",
    ["-format", "%[fx:standard_deviation]", screenshot],
    { encoding: "utf8" },
  );
  const value = Number.parseFloat(stdout);
  return Number.isFinite(value) ? value : 0;
}

async function captureScreenshot(page, screenshot) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png",
    });
    fs.writeFileSync(screenshot, Buffer.from(result.data, "base64"));
  } finally {
    await session.detach();
  }
}

async function waitForRenderSignal(page) {
  await page.locator("body").evaluate(async (body) => {
    const deadline = Date.now() + 30_000;
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
    throw new Error("timed out waiting for render signal");
  });
}

function createStaticServer(directory) {
  return http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = decodeURIComponent(url.pathname)
        .replace(/^\/services\/open-games\/games(?:\/|$)/, "")
        .replace(/^\/+/, "");
      const file = resolveInside(directory, relativePath || "index.html");
      const stats = fs.statSync(file, { throwIfNoEntry: false });
      if (!stats?.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.setHeader("Content-Type", contentType(file));
      fs.createReadStream(file).pipe(response);
    } catch {
      response.writeHead(400).end("Bad request");
    }
  });
}

function contentType(file) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".m4a": "audio/mp4",
    ".mjs": "text/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function runPool(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

function failure(candidate, error, extra = {}) {
  return {
    ok: false,
    id: candidate.id,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  };
}

function resolveInside(base, relativePath) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`path escapes audit root: ${relativePath}`);
  }
  return resolved;
}
