import fs from "node:fs";
import path from "node:path";

import { copyDirectory, requireFile } from "./shared.mjs";

export async function buildStaticDirectory({ game, output, worktree }) {
  if (!game.sourceSubpath || !game.sourceEntry) {
    throw new Error(`${game.id} is missing sourceSubpath or sourceEntry`);
  }
  const sourceRoot = path.resolve(worktree);
  const gameRoot = path.resolve(sourceRoot, game.sourceSubpath);
  const entry = path.resolve(sourceRoot, game.sourceEntry);
  if (!gameRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceSubpath escapes its source checkout`);
  }
  if (!entry.startsWith(`${gameRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceEntry must stay inside sourceSubpath`);
  }
  requireFile(entry);
  copyDirectory(gameRoot, output);
  requireFile(path.join(output, "index.html"));
}
