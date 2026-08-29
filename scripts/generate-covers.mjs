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

  const server = await createCoverStaticServer(stagingDir);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("cover server did not expose a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const failures = [];

  try {
    for (const [index, item] of pending.entries()) {
      try {
        await captureCoverWithRetry(baseUrl, item);
      } catch (error) {
        failures.push(
          `${item.game.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if ((index + 1) % 3 === 0 || index + 1 === pending.length) {
        console.log(`[open-games] generated covers ${index + 1}/${pending.length}`);
      }
    }
  } finally {
    server.closeAllConnections?.();
    await withTimeout(
      new Promise((resolve) => server.close(resolve)),
      5_000,
      "cover server close timed out",
    ).catch(() => {});
  }

  if (failures.length > 0) {
    throw new Error(`cover generation failed:\n${failures.join("\n")}`);
  }
}

async function captureCoverWithRetry(baseUrl, item) {
  const failures = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const channel = attempt === 2 ? "chrome" : undefined;
    const browserServer = await chromium.launchServer({
      args: ["--disable-dev-shm-usage"],
      ...(channel ? { channel } : {}),
      headless: true,
    });
    const browserProcess = browserServer.process();
    let browser;
    try {
      browser = await withTimeout(
        chromium.connect(browserServer.wsEndpoint()),
        15_000,
        "browser connection timed out",
      );
      await withTimeout(
        captureCover(browser, baseUrl, item),
        100_000,
        "cover capture attempt timed out",
      );
      return;
    } catch (error) {
      fs.rmSync(item.cacheFile, { force: true });
      failures.push(error instanceof Error ? error.message : String(error));
      if (attempt < 2) {
        console.warn(`[open-games] retrying cover ${item.game.id} after attempt ${attempt}`);
      }
    } finally {
      if (browser) {
        await withTimeout(browser.close(), 5_000, "browser close timed out").catch(() => {});
      }
      if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
        browserProcess.kill("SIGKILL");
      }
      await waitForProcessExit(browserProcess, 5_000);
    }
  }
  throw new Error(failures.join("\nretry: "));
}

async function captureCover(browser, baseUrl, { cacheFile, game, target }) {
  const page = await browser.newPage({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: game.language === "Chinese" ? "zh-CN" : "en-US",
    serviceWorkers: "block",
    viewport: { width: 640, height: 360 },
  });
  try {
    const response = await page.goto(`${baseUrl}/open-games/${game.entry}`, {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok()) {
      throw new Error(`entry returned HTTP ${response?.status() ?? "unknown"}`);
    }
    await page.waitForFunction(() => {
      const body = document.body;
      const canvas = document.querySelector("canvas");
      const svg = document.querySelector("svg");
      const image = document.querySelector("img");
      const canvasArea = canvas instanceof HTMLCanvasElement
        ? canvas.width * canvas.height
        : 0;
      const imageReady = image instanceof HTMLImageElement
        ? image.complete && image.naturalWidth > 20
        : false;
      return (
        (body?.children.length ?? 0) > 0
        && (
          (body?.innerText.trim().length ?? 0) > 0
          || canvasArea >= 10_000
          || svg instanceof SVGElement
          || imageReady
        )
      );
    }, null, { timeout: 45_000 });
    await page.waitForTimeout(1_000);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    await captureScreenshot(page, cacheFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(cacheFile, target);
  } finally {
    await withTimeout(page.close(), 5_000, "page close timed out").catch(() => {});
  }
}

async function captureScreenshot(page, output) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await withTimeout(
      session.send("Page.captureScreenshot", {
        captureBeyondViewport: false,
        format: "jpeg",
        quality: 72,
      }),
      45_000,
      "CDP screenshot timed out",
    );
    fs.writeFileSync(output, Buffer.from(result.data, "base64"));
  } finally {
    await withTimeout(session.detach(), 5_000, "CDP detach timed out").catch(() => {});
  }
}

export async function createCoverStaticServer(root) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relative = pathname
        .replace(/^\/services\/open-games(?:\/|$)/, "")
        .replace(/^\/open-games(?:\/|$)/, "")
        .replace(/^\/+/, "");
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
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Origin-Agent-Cluster": "?1",
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

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await withTimeout(
    new Promise((resolve) => child.once("exit", resolve)),
    timeoutMs,
    "browser process exit timed out",
  ).catch(() => {});
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
