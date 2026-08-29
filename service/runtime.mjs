import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  cacheControl,
  safeStaticPath,
  sendJson,
} from "@local-agent-bridge/node-sidecar-runtime";
import httpProxy from "http-proxy";

const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
  [".wasm", "application/wasm"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);
const ISOLATION_HEADERS = {
  "cross-origin-embedder-policy": "credentialless",
  "cross-origin-opener-policy": "same-origin",
  "origin-agent-cluster": "?1",
};

export function createOpenGamesServiceRuntime({
  distRoot,
  host,
  port,
  serviceId = "open-games",
  spawnChild = spawn,
}) {
  const resolvedDistRoot = path.resolve(distRoot);
  const manifest = readManifest(resolvedDistRoot);
  const runtimes = validateRuntimeManifest(manifest.runtimes ?? [], resolvedDistRoot);
  const runtimeStates = new Map(
    runtimes.map((runtime) => [runtime.id, {
      child: null,
      definition: runtime,
      error: null,
      port: null,
      stopping: false,
    }]),
  );
  const proxy = httpProxy.createProxyServer({
    changeOrigin: false,
    xfwd: true,
    ws: true,
  });
  proxy.on("error", (error, _req, resOrSocket) => {
    if (resOrSocket && "writeHead" in resOrSocket && !resOrSocket.headersSent) {
      sendJson(resOrSocket, 502, { ok: false, error: `game runtime proxy failed: ${error.message}` });
      return;
    }
    resOrSocket?.destroy?.();
  });
  proxy.on("proxyRes", (proxyRes) => {
    Object.assign(proxyRes.headers, ISOLATION_HEADERS);
  });

  const status = () => {
    const runtimeStatus = [...runtimeStates.values()].map((state) => ({
      id: state.definition.id,
      ready: Number.isInteger(state.port),
      ...(state.error ? { error: state.error } : {}),
    }));
    return {
      degraded: runtimeStatus.some((runtime) => !runtime.ready),
      ok: true,
      running: true,
      service: serviceId,
      version: typeof manifest.version === "string" ? manifest.version : "unknown",
      ...(typeof manifest.builtAt === "string" ? { builtAt: manifest.builtAt } : {}),
      runtimes: runtimeStatus,
    };
  };

  const createServer = () => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
        const pathname = normalizeServicePath(url.pathname);
        const runtime = findRuntime(runtimeStates, pathname);
        if (runtime) {
          if (!runtime.port) {
            sendJson(res, 503, { ok: false, error: `${runtime.definition.id} runtime unavailable` });
            return;
          }
          req.url = `${pathname}${url.search}`;
          proxy.web(req, res, {
            target: `http://127.0.0.1:${runtime.port}`,
          });
          return;
        }
        if (pathname === "/health" || pathname === "/service") {
          const payload = status();
          sendJson(res, payload.ok ? 200 : 503, payload);
          return;
        }
        serveStatic(req, res, resolvedDistRoot, pathname);
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
      const pathname = normalizeServicePath(url.pathname);
      const runtime = findRuntime(runtimeStates, pathname);
      if (!runtime?.port) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      req.url = `${pathname}${url.search}`;
      proxy.ws(req, socket, head, {
        target: `http://127.0.0.1:${runtime.port}`,
      });
    });
    return server;
  };

  const start = async () => {
    await Promise.all([...runtimeStates.values()].map(async (state) => {
      try {
        await startRuntime(state, spawnChild);
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        await stopRuntime(state);
        console.error(`[${state.definition.id}] failed to start: ${state.error}`);
      }
    }));
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      await Promise.all([...runtimeStates.values()].map(stopRuntime));
      proxy.close();
      throw error;
    }
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : port;
    console.log(`[${serviceId}] listening on http://${host}:${listeningPort}`);

    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await closeServer(server);
      await Promise.all([...runtimeStates.values()].map(stopRuntime));
      proxy.close();
    };
    return { port: listeningPort, server, stop };
  };

  return {
    createServer,
    runtimes: runtimeStates,
    start,
    status,
  };
}

export function validateRuntimeManifest(value, distRoot) {
  if (!Array.isArray(value)) throw new Error("manifest runtimes must be an array");
  const ids = new Set();
  const prefixes = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`manifest runtimes[${index}] must be an object`);
    }
    const id = requiredId(entry.id, `manifest runtimes[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate runtime id: ${id}`);
    ids.add(id);
    const expectedBasePath = `/games/${id}`;
    if (entry.basePath !== expectedBasePath) {
      throw new Error(`${id} runtime basePath must be ${expectedBasePath}`);
    }
    if (prefixes.has(entry.basePath)) throw new Error(`duplicate runtime basePath: ${entry.basePath}`);
    prefixes.add(entry.basePath);
    const entryPath = validateRelativeFile(entry.entry, `${id} runtime entry`);
    const runtimeRoot = path.resolve(distRoot, "runtimes", id);
    const resolvedEntry = path.resolve(runtimeRoot, entryPath);
    if (!resolvedEntry.startsWith(`${runtimeRoot}${path.sep}`)) {
      throw new Error(`${id} runtime entry escapes its root`);
    }
    if (!fs.statSync(resolvedEntry, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${id} runtime entry does not exist: ${entryPath}`);
    }
    const expectedPublicBasePath = `/open-games/games/${id}`;
    if (entry.publicBasePath !== expectedPublicBasePath) {
      throw new Error(`${id} runtime publicBasePath must be ${expectedPublicBasePath}`);
    }
    return {
      basePath: entry.basePath,
      entry: entryPath,
      id,
      publicBasePath: entry.publicBasePath,
      runtimeRoot,
    };
  });
}

async function startRuntime(state, spawnChild) {
  const runtime = state.definition;
  const entry = path.join(runtime.runtimeRoot, runtime.entry);
  const child = spawnChild(process.execPath, [entry], {
    cwd: runtime.runtimeRoot,
    env: {
      ...process.env,
      BASE_PATH: runtime.basePath,
      HOST: "127.0.0.1",
      PORT: "0",
      PUBLIC_BASE_PATH: runtime.publicBasePath,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  state.child = child;
  state.error = null;
  state.port = null;
  state.stopping = false;
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${runtime.id}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${runtime.id}] ${chunk}`));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${runtime.id} runtime did not become ready`));
    }, 20_000);
    const finish = (callback, value) => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code, signal) => finish(
      reject,
      new Error(`${runtime.id} runtime exited before ready (${code ?? signal ?? "unknown"})`),
    );
    const onMessage = (message) => {
      if (
        !message
        || message.type !== "ready"
        || !Number.isInteger(message.port)
        || message.port <= 0
        || message.port > 65535
      ) {
        return;
      }
      state.port = message.port;
      finish(resolve);
    };
    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });

  child.once("exit", (code, signal) => {
    state.child = null;
    state.error = `${runtime.id} runtime exited (${code ?? signal ?? "unknown"})`;
    state.port = null;
  });
}

async function stopRuntime(state) {
  const child = state.child;
  if (!child) return;
  if (child.exitCode !== null) {
    state.child = null;
    state.port = null;
    return;
  }
  if (state.stopping) return;
  state.stopping = true;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  state.child = null;
  state.port = null;
  state.stopping = false;
}

function serveStatic(req, res, distRoot, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedPath = safeStaticPath(distRoot, relative);
  const filePath = fs.statSync(resolvedPath, { throwIfNoEntry: false })?.isDirectory()
    ? path.join(resolvedPath, "index.html")
    : resolvedPath;
  if (!filePath || !fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    sendJson(res, 404, { ok: false, error: "asset not found" });
    return;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "cache-control": cacheControl(filePath),
    "content-length": body.length,
    "content-type": MIME.get(path.extname(filePath).toLowerCase())
      || "application/octet-stream",
    ...ISOLATION_HEADERS,
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

function findRuntime(runtimeStates, pathname) {
  for (const state of runtimeStates.values()) {
    const prefix = state.definition.basePath;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return state;
  }
  return null;
}

function normalizeServicePath(pathname) {
  return pathname
    .replace(/^\/services\/open-games(?=\/|$)/, "")
    .replace(/^\/open-games(?=\/|$)/, "")
    || "/";
}

function requiredId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9-]+$/.test(value)) {
    throw new Error(`${label} must be a lowercase game id`);
  }
  return value;
}

function validateRelativeFile(value, label) {
  if (
    typeof value !== "string"
    || !value
    || path.isAbsolute(value)
    || value.includes("\\")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a relative POSIX file path`);
  }
  return value;
}

function readManifest(distRoot) {
  return JSON.parse(fs.readFileSync(path.join(distRoot, "manifest.json"), "utf8"));
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(resolve);
    server.closeAllConnections();
  });
}
