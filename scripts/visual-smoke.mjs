#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 4181;
const baseUrl = `http://127.0.0.1:${port}`;
const output = path.join(root, ".runtime", "visual-smoke");
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
    await smokeViewport(browser, "desktop", { width: 1440, height: 900 });
    await smokeViewport(browser, "mobile", { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function smokeViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport });
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

  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`${name}: catalog failed to load`);
  await page.screenshot({
    path: path.join(output, `${name}-catalog.png`),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Play" }).click();
  const pigeonFrame = page.frameLocator('iframe[title="Pigeon Ascent"]');
  await pigeonFrame.locator("#canvas").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: path.join(output, `${name}-pigeon-ascent.png`),
    fullPage: true,
  });

  if (failures.length) {
    throw new Error(`${name}: ${failures.join("; ")}`);
  }
  await context.close();
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
