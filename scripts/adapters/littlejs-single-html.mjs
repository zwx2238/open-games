import fs from "node:fs";
import path from "node:path";

import { copyDirectory, requireFile } from "./shared.mjs";

export async function buildLittleJsSingleHtml({
  game,
  output,
  outputRoot,
  worktree,
}) {
  if (!game.sourceEntry) throw new Error(`${game.id} is missing sourceEntry`);
  const sourceRoot = path.resolve(worktree);
  const entry = path.resolve(sourceRoot, game.sourceEntry);
  if (!entry.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`${game.id} sourceEntry escapes its source checkout`);
  }
  requireFile(entry);

  const sharedRoot = path.join(outputRoot, "games", "_littlejs");
  if (!fs.existsSync(sharedRoot)) {
    fs.mkdirSync(sharedRoot, { recursive: true });
    copyDirectory(path.join(sourceRoot, "dist"), path.join(sharedRoot, "dist"));
    copyDirectory(path.join(sourceRoot, "templates"), path.join(sharedRoot, "templates"));
    fs.copyFileSync(
      path.join(sourceRoot, "games", "twemoji.ttf"),
      path.join(sharedRoot, "twemoji.ttf"),
    );
    const engineLoader = path.join(sharedRoot, "templates", "engineLoader.js");
    fs.writeFileSync(
      engineLoader,
      fs.readFileSync(engineLoader, "utf8")
        .replaceAll("../dist/", "../_littlejs/dist/"),
    );
  }

  const html = fs.readFileSync(entry, "utf8")
    .replaceAll("../dist/", "../_littlejs/dist/")
    .replaceAll("../templates/", "../_littlejs/templates/")
    .replaceAll("url(twemoji.ttf)", "url(../_littlejs/twemoji.ttf)");
  fs.writeFileSync(path.join(output, "index.html"), html);
}
