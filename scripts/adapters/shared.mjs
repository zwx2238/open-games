import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function installNpmDependencies(worktree) {
  await run(worktree, "npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
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
