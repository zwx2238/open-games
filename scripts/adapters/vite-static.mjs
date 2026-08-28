import fs from "node:fs";
import path from "node:path";

import {
  copyDirectory,
  installNpmDependencies,
  requireFile,
  run,
} from "./shared.mjs";

export async function buildViteStatic({ worktree, output }) {
  await installNpmDependencies(worktree);
  await run(worktree, "npm", ["run", "build"], {
    VITE_BASE_PATH: "./",
  });

  const dist = path.join(worktree, "dist");
  requireFile(path.join(dist, "index.html"));
  fs.rmSync(output, { recursive: true, force: true });
  copyDirectory(dist, output);
}
