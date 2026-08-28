import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GODOT_IMAGE = "barichello/godot-ci@sha256:0c6bc591f79f15a86e769c62cb5231017b2787d5e9a3803152837b1a2e6b3f48";

export async function buildGodot3Html5({ worktree, output }) {
  fs.mkdirSync(output, { recursive: true });
  await execFileAsync("docker", [
    "run",
    "--rm",
    "-v",
    `${worktree}:/src`,
    "-v",
    `${output}:/build`,
    "-w",
    "/src",
    GODOT_IMAGE,
    "godot",
    "--path",
    "/src",
    "--export",
    "HTML5",
    "/build/index.html",
  ], {
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const file of ["index.html", "index.js", "index.pck", "index.wasm"]) {
    if (!fs.statSync(path.join(output, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Godot HTML5 build did not produce ${file}`);
    }
  }
}
