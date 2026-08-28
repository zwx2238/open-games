import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { chromium } from "playwright";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export async function ensureGeneratedCovers({
  games,
  stagingDir,
  cacheDir,
  commitsByGame,
}) {
  const generatedGames = games.filter((game) => game.generateCover);
  const pending = [];

  for (const game of generatedGames) {
    const commit = commitsByGame.get(game.id);
    if (!commit) throw new Error(`missing source commit for cover: ${game.id}`);
    const cacheFile = path.join(cacheDir, game.sourceId, commit, `${game.id}.jpg`);
    const target = path.join(stagingDir, game.cover);
    if (fs.statSync(cacheFile, { throwIfNoEntry: false })?.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(cacheFile, target);
      continue;
    }
    pending.push({ cacheFile, game, target });
  }

  if (pending.length === 0) {
    console.log(`[open-games] reused ${generatedGames.length} generated covers`);
    return;
  }

  const server = await createStaticServer(stagingDir);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("cover server did not expose a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const batchSize = 6;

  try {
    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      const results = await Promise.allSettled(
        batch.map((item) => captureCover(browser, baseUrl, item)),
      );
      results.forEach((result, resultIndex) => {
        if (result.status === "rejected") {
          failures.push(
            `${batch[resultIndex].game.id}: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          );
        }
      });
      console.log(
        `[open-games] generated covers ${Math.min(index + batch.length, pending.length)}/${pending.length}`,
      );
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    throw new Error(`cover generation failed:\n${failures.join("\n")}`);
  }
}

async function captureCover(browser, baseUrl, { cacheFile, game, target }) {
  const page = await browser.newPage({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: game.language === "Chinese" ? "zh-CN" : "en-US",
    reducedMotion: "reduce",
    viewport: { width: 640, height: 360 },
  });
  try {
    const response = await page.goto(`${baseUrl}/${game.entry}`, {
      timeout: 20_000,
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok()) {
      throw new Error(`entry returned HTTP ${response?.status() ?? "unknown"}`);
    }
    await page.waitForTimeout(900);
    const signal = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const body = document.body;
      return {
        bodyChildren: body?.children.length ?? 0,
        bodyText: body?.innerText.trim().length ?? 0,
        canvasArea: canvas instanceof HTMLCanvasElement
          ? canvas.width * canvas.height
          : 0,
      };
    });
    if (signal.bodyChildren === 0 || (signal.bodyText === 0 && signal.canvasArea < 10_000)) {
      throw new Error("page did not expose a visible render signal");
    }
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    await page.screenshot({
      path: cacheFile,
      type: "jpeg",
      quality: 72,
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(cacheFile, target);
  } finally {
    await page.close();
  }
}

async function createStaticServer(root) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "");
      const resolved = path.resolve(resolvedRoot, relative || "index.html");
      if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const stats = fs.statSync(resolved, { throwIfNoEntry: false });
      const file = stats?.isDirectory() ? path.join(resolved, "index.html") : resolved;
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(path.extname(file).toLowerCase())
          ?? "application/octet-stream",
      });
      fs.createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}
