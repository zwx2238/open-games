import fs from "node:fs";
import path from "node:path";

// UI builds only write top-level bundles; game assets remain immutable.
export function reuseBuildAssets(source, destination) {
  const sourceRoot = fs.realpathSync(source);
  function copy(from, to, linkFiles) {
    const stat = fs.lstatSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        copy(path.join(from, name), path.join(to, name), linkFiles);
      }
    } else if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(from);
      if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error(`cached asset symlink escapes build: ${from}`);
      }
      const target = path.join(destination, path.relative(sourceRoot, resolved));
      fs.symlinkSync(path.relative(path.dirname(to), target), to);
    } else if (stat.isFile()) {
      if (linkFiles) fs.linkSync(from, to);
      else fs.copyFileSync(from, to);
    } else {
      throw new Error(`unsupported cached asset: ${from}`);
    }
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (name === "index.html" || name === "manifest.json") continue;
    copy(path.join(source, name), path.join(destination, name),
      ["games", "covers", "notices", "runtimes"].includes(name));
  }
}
