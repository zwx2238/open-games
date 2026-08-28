import fs from "node:fs";
import path from "node:path";

import { copyDirectory, copyFiles } from "./shared.mjs";

const FILES = [
  "index.html",
  "manifest.webmanifest",
  "style.css",
  "sw.js",
];

const DIRECTORIES = [
  "assets",
  "src",
  "vendor",
];

export async function buildStaticKaplay({ worktree, output }) {
  copyFiles(worktree, output, FILES);
  for (const directory of DIRECTORIES) {
    const source = path.join(worktree, directory);
    const target = path.join(output, directory);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`static Kaplay source is missing ${directory}`);
    }
    copyDirectory(source, target);
  }
}
