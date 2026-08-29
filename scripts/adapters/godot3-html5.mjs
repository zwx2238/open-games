import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GODOT_VERSION = "3.2.3";
const GODOT_IMAGES = new Map([
  [
    DEFAULT_GODOT_VERSION,
    "barichello/godot-ci@sha256:0c6bc591f79f15a86e769c62cb5231017b2787d5e9a3803152837b1a2e6b3f48",
  ],
  [
    "3.6.2",
    "barichello/godot-ci@sha256:026e1f652dd1d718073bb5c32372b3a5d73e7ad7bfe13b9052423604fca6918f",
  ],
]);
const GODOT3_BUILD_SCRIPT = [
  "set -eu",
  "mkdir -p /root/.local/share/godot/templates",
  "for template_dir in /root/.local/share/godot/export_templates/*; do",
  "  [ -d \"$template_dir\" ] || continue",
  "  ln -sfn \"$template_dir\" \"/root/.local/share/godot/templates/$(basename \"$template_dir\")\"",
  "done",
  "godot --path /src --editor --quit",
  "godot --path /src --export HTML5 /build/index.html",
].join("\n");

export function resolveGodot3Image(game = {}) {
  const version = game.godotVersion ?? DEFAULT_GODOT_VERSION;
  const image = GODOT_IMAGES.get(version);
  if (!image) {
    throw new Error(`unsupported reviewed Godot 3 version: ${version}`);
  }
  return image;
}

export async function buildGodot3Html5({ game, worktree, output }) {
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
    resolveGodot3Image(game),
    "sh",
    "-lc",
    GODOT3_BUILD_SCRIPT,
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
