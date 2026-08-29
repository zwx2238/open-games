import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageBuildScripts = new Set(["build", "build:app", "build:game", "build:web"]);
const packageRegistries = new Set(["https://registry.npmjs.org"]);

export async function installNpmDependencies(worktree) {
  await run(worktree, "npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
}

export async function installPackageDependencies(
  worktree,
  packageManager,
  { registry } = {},
) {
  const env = registry
    ? { npm_config_registry: validatePackageRegistry(registry) }
    : {};
  if (packageManager === "yarn" && usesModernYarn(worktree)) {
    await run(worktree, "corepack", [
      "yarn",
      "install",
      "--immutable",
      "--mode=skip-build",
    ], env);
    return;
  }
  const installs = {
    npm: ["npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]],
    pnpm: ["pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]],
    bun: ["bun", ["install", "--frozen-lockfile", "--ignore-scripts"]],
    yarn: ["corepack", ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"]],
  };
  const install = installs[packageManager];
  if (!install) {
    throw new Error(`unsupported package manager: ${packageManager}`);
  }
  await run(worktree, install[0], install[1], (
    packageManager === "yarn" && !usesModernYarn(worktree)
      ? { COREPACK_ENABLE_PROJECT_SPEC: "0", ...env }
      : env
  ));
}

export async function installProductionPackageDependencies(
  worktree,
  packageManager,
) {
  if (packageManager !== "npm") {
    throw new Error(`unsupported production package manager: ${packageManager}`);
  }
  await run(worktree, "npm", [
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
}

export async function initializePackageSubmodules(worktree) {
  await run(worktree, "git", ["submodule", "sync", "--recursive"]);
  await run(worktree, "git", [
    "submodule",
    "update",
    "--init",
    "--recursive",
    "--checkout",
    "--depth",
    "1",
  ]);
}

export async function runPackageBuild(
  worktree,
  packageManager,
  { env = {}, script = "build" } = {},
) {
  validatePackageBuildScript(script);
  const builds = {
    npm: ["npm", ["run", script]],
    pnpm: ["pnpm", ["run", script]],
    bun: ["bun", ["run", script]],
    yarn: ["corepack", ["yarn", script]],
  };
  const build = builds[packageManager];
  if (!build) {
    throw new Error(`unsupported package manager: ${packageManager}`);
  }
  await run(worktree, build[0], build[1], {
    ...(packageManager === "yarn" && !usesModernYarn(worktree)
      ? { COREPACK_ENABLE_PROJECT_SPEC: "0" }
      : {}),
    ...env,
  });
}

export function validatePackageBuildScript(script) {
  if (!packageBuildScripts.has(script)) {
    throw new Error(`unsupported package build script: ${script}`);
  }
  return script;
}

export function validatePackageRegistry(registry) {
  if (!packageRegistries.has(registry)) {
    throw new Error(`unsupported package registry: ${registry}`);
  }
  return registry;
}

function usesModernYarn(worktree) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(worktree, "package.json"), "utf8"),
  );
  const match = /^yarn@(\d+)/.exec(packageJson.packageManager ?? "");
  return match ? Number.parseInt(match[1], 10) >= 2 : false;
}

export async function run(worktree, command, args, env = {}) {
  await execFileAsync(command, args, {
    cwd: worktree,
    env: {
      ...process.env,
      CI: "1",
      HUSKY: "0",
      ...env,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function copyDirectory(source, output) {
  fs.cpSync(source, output, { recursive: true });
}

export function copyFiles(worktree, output, entries) {
  for (const entry of entries) {
    const source = path.join(worktree, entry);
    const target = path.join(output, entry);
    requireFile(source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

export function requireFile(file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`game build did not produce ${file}`);
  }
}
