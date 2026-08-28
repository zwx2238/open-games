import fs from "node:fs";
import path from "node:path";

import { requireFile } from "./shared.mjs";

export async function buildStaticSingleHtml({ game, output, worktree }) {
  if (!game.sourceSubpath) {
    throw new Error(`${game.id} is missing sourceSubpath`);
  }
  const sourceRoot = path.resolve(worktree);
  const gameRoot = path.resolve(sourceRoot, game.sourceSubpath);
  if (!gameRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceSubpath escapes its source checkout`);
  }
  const entry = path.join(gameRoot, "index.html");
  requireFile(entry);
  fs.copyFileSync(entry, path.join(output, "index.html"));
}
