import fs from "node:fs";
import path from "node:path";

import {
  copyDirectory,
  installNpmDependencies,
  requireFile,
  run,
} from "./shared.mjs";

export async function buildRollupWeb({ worktree, output }) {
  await installNpmDependencies(worktree);
  await run(
    worktree,
    "npm",
    ["exec", "--", "rollup", "-c", "build/rollup.config.js"],
    { NODE_ENV: "development" },
  );

  const dist = path.join(worktree, "dist");
  requireFile(path.join(dist, "index.html"));
  requireFile(path.join(dist, "bundle.js"));
  fs.rmSync(output, { recursive: true, force: true });
  copyDirectory(dist, output);
}
