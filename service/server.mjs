#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "@local-agent-bridge/node-sidecar-runtime";

import { createOpenGamesServiceRuntime } from "./runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number.parseInt(process.env.OPEN_GAMES_SERVICE_PORT || "", 10);

export const serviceRuntime = createOpenGamesServiceRuntime({
  distRoot: path.join(root, "service-dist"),
  host: process.env.OPEN_GAMES_SERVICE_HOST?.trim() || "127.0.0.1",
  port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3981,
});
export const createServiceServer = serviceRuntime.createServer;

if (isMainModule(import.meta.url)) {
  const running = await serviceRuntime.start();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await running.stop();
      process.exit(0);
    });
  }
}
