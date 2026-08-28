import fs from "node:fs";
import path from "node:path";

import { requireFile } from "./shared.mjs";

export async function buildStaticSingleFile({ game, output, worktree }) {
  if (!game.sourceEntry) throw new Error(`${game.id} is missing sourceEntry`);
  const sourceRoot = path.resolve(worktree);
  const entry = path.resolve(sourceRoot, game.sourceEntry);
  if (!entry.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceEntry escapes its source checkout`);
  }
  requireFile(entry);
  fs.copyFileSync(entry, path.join(output, "index.html"));
}
