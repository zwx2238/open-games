import fs from "node:fs";
import path from "node:path";

import {
  installNpmDependencies,
  requireFile,
  run,
} from "./shared.mjs";

export async function buildViteSingleHtml({ worktree, output }) {
  await installNpmDependencies(worktree);
  await run(worktree, "npm", ["run", "build"]);

  const builtHtml = path.join(worktree, "dist", "dark-sun-dungeon.html");
  requireFile(builtHtml);
  fs.copyFileSync(builtHtml, path.join(output, "index.html"));
}
