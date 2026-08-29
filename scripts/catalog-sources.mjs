import fs from "node:fs";
import path from "node:path";

const inputOrder = ["touch", "mouse", "keyboard", "gamepad"];
const inputLabels = {
  touch: "触控",
  mouse: "鼠标",
  keyboard: "键盘",
  gamepad: "手柄",
};
const deviceOrder = ["desktop", "mobile"];

export function readSourcesRegistry(root) {
  const registry = readJson(path.join(root, "catalog", "sources.json"));
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.sources)) {
    throw new Error("source registry has an unsupported schema");
  }
  const ids = new Set();
  for (const source of registry.sources) {
    assertString(source.id, "source id");
    assertString(source.title, `${source.id} title`);
    assertString(source.kind, `${source.id} kind`);
    if (ids.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  return registry.sources.filter((source) => source.enabled !== false);
}

export function loadSourceGames(root, source) {
  const loaders = {
    "local-catalog": loadLocalCatalog,
    "100games": load100Games,
    "mini-browser-games": loadMiniBrowserGames,
    "sausi-games": loadSausiGames,
    "littlejs-arcade": loadLittleJsArcade,
  };
  const loader = loaders[source.kind];
  if (!loader) throw new Error(`unsupported source kind: ${source.kind}`);
  const games = loader(root, source);
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error(`${source.id} did not produce any games`);
  }
  return games.map((game) => normalizeGame(game, source));
}

function loadLocalCatalog(root, source) {
  const games = readJson(resolveInside(root, source.catalogPath));
  if (!Array.isArray(games)) throw new Error(`${source.id} catalog must be an array`);
  return games;
}

function load100Games(root, source) {
  const sourceRoot = resolveSourceRoot(root, source);
  const catalog = readJson(resolveInside(sourceRoot, source.catalogPath));
  if (catalog?.schemaVersion !== 2 || !Array.isArray(catalog.games)) {
    throw new Error("100games catalog has an unsupported schema");
  }
  const games = catalog.games.filter((game) => game.playable !== false);
  if (games.length !== catalog.inventory?.playable) {
    throw new Error(
      `100games playable inventory mismatch: ${games.length}/${catalog.inventory?.playable}`,
    );
  }
  return games.map((game) => ({
    id: `100g-${game.id}`,
    title: game.title,
    author: game.author,
    description: game.description,
    sourcePath: source.sourcePath,
    sourceSubpath: game.directory,
    sourceEntry: game.entry,
    sourceUrl: `${catalog.source.repository}/tree/main/${game.directory}`,
    upstreamUrl: `${catalog.source.upstream}/tree/main/${game.directory}`,
    adapter: "static-single-html",
    entry: `games/100g-${game.id}/index.html`,
    cover: `covers/100g-${game.id}.png`,
    coverSource: game.coverSource,
    notices: [
      {
        target: "notices/100games-LICENSE.txt",
        source: "LICENSE",
      },
    ],
    license: game.license,
    edition: `100 GAMES #${String(game.number).padStart(2, "0")} / ${game.category}`,
    inputs: parseInputText(game.input),
    session: game.session,
    category: game.category,
    group: "100 GAMES",
    language: game.language,
    quality: game.quality,
    status: game.status,
    runtime: "offline",
    tags: game.contentTags,
    technology: "Vanilla HTML5 Canvas",
    featured: false,
    collectionNumber: game.number,
  }));
}

function loadMiniBrowserGames(root, source) {
  const sourceRoot = resolveSourceRoot(root, source);
  const readme = fs.readFileSync(path.join(sourceRoot, "README.md"), "utf8");
  const audit = fs.readFileSync(path.join(sourceRoot, "GAME_AUDIT.md"), "utf8");
  const tiers = readJson(path.join(sourceRoot, "GAME_TIERS.json")).tiers;
  const metadata = new Map([
    ...parseMiniReadme(readme),
    ...parseMiniArchive(audit),
  ].map((game) => [game.file, game]));
  const games = [];
  const seen = new Set();

  for (const [quality, files] of Object.entries(tiers)) {
    if (!Array.isArray(files)) throw new Error(`mini-browser-games tier ${quality} is invalid`);
    for (const file of files) {
      if (seen.has(file)) throw new Error(`duplicate mini-browser-games entry: ${file}`);
      seen.add(file);
      const sourceFile = resolveInside(sourceRoot, file);
      requireFile(sourceFile);
      const html = fs.readFileSync(sourceFile, "utf8");
      const item = metadata.get(file);
      const id = slugify(path.basename(file, ".html"));
      const status = quality === "E" ? "archived" : "active";
      const category = item?.category ?? "历史归档";
      games.push({
        id: `mbg-${id}`,
        title: item?.title ?? extractTitle(html, id),
        author: "wangzifan396-wzf",
        description: item?.description ?? "可直接在浏览器运行的单文件小游戏。",
        sourcePath: source.sourcePath,
        sourceEntry: file,
        sourceUrl: `${source.repository}/blob/main/${file}`,
        upstreamUrl: `${source.upstream}/blob/main/${file}`,
        adapter: "static-single-file",
        entry: `games/mbg-${id}/index.html`,
        cover: `covers/mbg-${id}.jpg`,
        generateCover: true,
        notices: [
          {
            target: "notices/mini-browser-games-LICENSE.txt",
            source: "LICENSE",
          },
        ],
        license: "MIT",
        edition: `${quality} / ${category}`,
        inputs: detectInputs([html]),
        session: ["SSS", "SS"].includes(quality) ? "10-60 min" : "5-30 min",
        category,
        group: "Mini Browser Games",
        language: normalizeLanguage(html),
        quality,
        status,
        runtime: "offline",
        tags: [category, quality],
        contentTags: casinoTags(file),
        technology: "Single-file HTML",
        featured: ["SSS", "SS"].includes(quality),
      });
    }
  }

  return games;
}

function loadSausiGames(root, source) {
  const sourceRoot = resolveSourceRoot(root, source);
  const catalog = readJson(resolveInside(sourceRoot, source.catalogPath));
  if (catalog?.version !== 1 || !Array.isArray(catalog.games)) {
    throw new Error("sausi-games catalog has an unsupported schema");
  }
  const compatibility = readJson(resolveInside(sourceRoot, source.compatibilityPath));
  if (
    compatibility?.schemaVersion !== 1
    || !compatibility.issues
    || Array.isArray(compatibility.issues)
    || typeof compatibility.issues !== "object"
  ) {
    throw new Error("sausi-games compatibility catalog has an unsupported schema");
  }
  const categoryLabels = new Map(
    catalog.categories.map((category) => [category.id, category.label]),
  );
  const catalogSlugs = new Set(catalog.games.map((game) => game.slug));
  for (const [slug, issues] of Object.entries(compatibility.issues)) {
    if (!catalogSlugs.has(slug)) {
      throw new Error(`sausi-games compatibility references unknown game: ${slug}`);
    }
    if (!Array.isArray(issues) || issues.length === 0) {
      throw new Error(`sausi-games compatibility issues are invalid: ${slug}`);
    }
    for (const issue of issues) assertString(issue, `${slug} compatibility issue`);
  }

  return catalog.games.map((game) => {
    const sourceEntry = game.path;
    const entryFile = resolveInside(sourceRoot, sourceEntry);
    requireFile(entryFile);
    const sourceSubpath = path.dirname(sourceEntry);
    const sourceDirectory = path.dirname(entryFile);
    const texts = readTextAssets(sourceDirectory);
    const id = slugify(game.slug);
    const compatibilityIssues = compatibility.issues[game.slug] ?? [];
    return {
      id: `sausi-${id}`,
      title: game.name,
      author: "Saurabh Singh",
      description: game.description,
      sourcePath: source.sourcePath,
      sourceSubpath,
      sourceEntry,
      sourceUrl: `${source.repository}/tree/main/${sourceSubpath}`,
      upstreamUrl: `${source.upstream}/tree/main/${sourceSubpath}`,
      adapter: "static-directory",
      entry: `games/sausi-${id}/index.html`,
      cover: `covers/sausi-${id}.jpg`,
      generateCover: true,
      notices: [
        {
          target: "notices/sausi-games-LICENSE.txt",
          source: "LICENSE",
        },
      ],
      license: "MIT",
      edition: `${categoryLabels.get(game.category) ?? game.category} / ${game.tech}`,
      inputs: detectInputs(texts),
      session: "2-15 min",
      category: categoryLabels.get(game.category) ?? game.category,
      group: "Games Hub",
      language: normalizeLanguage(fs.readFileSync(entryFile, "utf8")),
      quality: compatibilityIssues.length > 0 ? "Upstream Issues" : "Verified",
      status: compatibilityIssues.length > 0 ? "degraded" : "active",
      runtime: detectNetworkRequirement(texts) ? "network" : "offline",
      tags: [...game.tags, ...compatibilityIssues],
      technology: game.tech,
      featured: false,
    };
  });
}

function loadLittleJsArcade(root, source) {
  const sourceRoot = resolveSourceRoot(root, source);
  const catalog = readJson(resolveInside(sourceRoot, source.catalogPath));
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.games)) {
    throw new Error("LittleJS Arcade catalog has an unsupported schema");
  }
  const categoryLabels = {
    arcade: "Arcade",
    board: "Board",
    construction: "Action & Classics",
    extra: "Experimental",
    physics: "Physics",
    puzzle: "Puzzle",
    shooter: "Shooter",
    sports: "Sports",
    strategy: "Strategy",
  };

  return catalog.games.map((game) => {
    const sourceEntry = `games/${game.file}`;
    const entryFile = resolveInside(sourceRoot, sourceEntry);
    requireFile(entryFile);
    const html = fs.readFileSync(entryFile, "utf8");
    const id = slugify(game.id);
    const notices = [
      {
        target: "notices/littlejs-LICENSE.txt",
        source: "LICENSE",
      },
    ];
    if (game.file === "emojiSurvivors.html") {
      notices.push({
        target: "notices/littlejs-TWEMOJI-LICENSE.txt",
        source: "games/TWEMOJI-LICENSE.txt",
      });
    }
    return {
      id: `littlejs-${id}`,
      title: game.title,
      author: "Frank Force / contributors",
      description: game.description,
      sourcePath: source.sourcePath,
      sourceEntry,
      sourceUrl: `${catalog.source.repository}/blob/main/${sourceEntry}`,
      upstreamUrl: `${catalog.source.upstream}/blob/main/${sourceEntry}`,
      adapter: "littlejs-single-html",
      entry: `games/littlejs-${id}/index.html`,
      cover: `covers/littlejs-${id}.jpg`,
      generateCover: true,
      notices,
      license: game.license,
      edition: `${game.quality} / ${categoryLabels[game.category] ?? game.category}`,
      inputs: detectInputs([html], game.gamepad ? ["gamepad"] : []),
      session: "2-30 min",
      category: categoryLabels[game.category] ?? game.category,
      group: "LittleJS Arcade",
      language: "Language-light",
      quality: game.quality,
      status: game.status,
      runtime: "offline",
      tags: [...game.tags, ...game.keywords],
      technology: "LittleJS",
      featured: game.topRank !== null,
    };
  });
}

function normalizeGame(game, source) {
  const inputs = uniqueStrings(
    Array.isArray(game.inputs) && game.inputs.length > 0
      ? game.inputs
      : parseInputText(game.input ?? ""),
  ).sort((left, right) => inputOrder.indexOf(left) - inputOrder.indexOf(right));
  const status = game.status ?? "active";
  const runtime = game.runtime ?? "offline";
  const devices = uniqueStrings(
    Array.isArray(game.devices) && game.devices.length > 0
      ? game.devices
      : [
          "desktop",
          ...(inputs.includes("touch") ? ["mobile"] : []),
        ],
  ).sort((left, right) => deviceOrder.indexOf(left) - deviceOrder.indexOf(right));
  const normalized = {
    ...game,
    sourceId: game.sourceId ?? source.id,
    sourceTitle: game.sourceTitle ?? source.title,
    inputs,
    input: inputs.map((input) => inputLabels[input] ?? input).join(" / ") || "未知",
    devices,
    quality: game.quality ?? (game.featured ? "Curated" : "Cataloged"),
    editorialTier: game.editorialTier ?? inferEditorialTier(game, source, status),
    status,
    runtime,
    runtimeNote: game.runtimeNote ?? (
      runtime === "offline"
        ? "自部署后可离线运行。"
        : "玩法或素材包含外部网络依赖。"
    ),
    creationMethod: game.creationMethod ?? "not-disclosed",
    creationNote: game.creationNote ?? "上游未披露创作方式。",
    performance: game.performance ?? "standard",
    tags: uniqueStrings([...(game.tags ?? []), ...(game.contentTags ?? [])]),
    contentTags: uniqueStrings(game.contentTags ?? []),
    technology: game.technology ?? game.adapter,
  };
  if (!normalized.notices && normalized.notice && normalized.noticeSource) {
    normalized.notices = [
      { target: normalized.notice, source: normalized.noticeSource },
    ];
  }
  return normalized;
}

function inferEditorialTier(game, source, status) {
  if (status === "degraded") return "degraded";
  if (status === "archived") return "archived";
  if (source.id === "independent-forks" || game.featured) return "curated";
  return "catalog";
}

function parseMiniReadme(markdown) {
  const games = [];
  let category = "其他";
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## 游戏总览")) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (line.startsWith("## ") && !line.startsWith("### ")) break;
    if (line.startsWith("### ")) {
      category = line.slice(4).trim();
      continue;
    }
    const match = line.match(
      /^\|\s*([^|]+?)\s*\|\s*\[([^\]]+)\]\(([^)]+\.html)\)\s*\|\s*([^|]+?)\s*\|/,
    );
    if (!match) continue;
    games.push({
      quality: match[1].trim().replace("+", ""),
      title: match[2].trim(),
      file: path.basename(match[3]),
      description: match[4].trim(),
      category,
    });
  }
  return games;
}

function parseMiniArchive(markdown) {
  const games = [];
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("### E 级")) {
      inside = true;
      continue;
    }
    if (inside && line.startsWith("## ")) break;
    if (!inside) continue;
    const match = line.match(
      /^\|\s*[^|]+\|\s*`([^`]+\.html)`\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/,
    );
    if (!match) continue;
    games.push({
      quality: "E",
      title: match[2].trim(),
      file: match[1],
      description: match[3].trim(),
      category: "历史归档",
    });
  }
  return games;
}

function readTextAssets(directory) {
  const texts = [];
  for (const file of walk(directory)) {
    if (!/\.(?:css|html|js|json|mjs)$/i.test(file)) continue;
    texts.push(fs.readFileSync(file, "utf8"));
  }
  return texts;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function detectInputs(texts, forced = []) {
  const text = texts.join("\n");
  const inputs = [...forced];
  if (
    /touch(?:start|move|end)|touch-action|ontouch|pointer(?:down|move|up)|onclick|addEventListener\(\s*["']click/i.test(
      text,
    )
  ) {
    inputs.push("touch");
  }
  if (/mouse(?:down|move|up)|click|pointer(?:down|move|up)/i.test(text)) {
    inputs.push("mouse");
  }
  if (/key(?:down|up|press)|KeyboardEvent|event\.code|event\.key/i.test(text)) {
    inputs.push("keyboard");
  }
  if (/getGamepads|gamepad/i.test(text)) inputs.push("gamepad");
  if (inputs.length === 0) inputs.push("mouse");
  return uniqueStrings(inputs);
}

function detectNetworkRequirement(texts) {
  const text = texts.join("\n");
  return [
    /["']https?:\/\//i,
    /(?:src|href)\s*=\s*["']https?:\/\//i,
    /(?:url|@import\s+url)\(\s*["']?https?:\/\//i,
    /(?:fetch|load\.(?:audio|image|script)|new\s+Image)[^;\n]*https?:\/\//i,
    /\.(?:href|src)\s*=\s*["']https?:\/\//i,
  ].some((pattern) => pattern.test(text));
}

function normalizeLanguage(html) {
  const language = html.match(/<html[^>]*\blang=["']([^"']+)/i)?.[1]?.toLowerCase();
  if (language?.startsWith("zh")) return "Chinese";
  if (language?.startsWith("en")) return "English";
  return /[\u3400-\u9fff]/u.test(html.slice(0, 20_000)) ? "Chinese" : "Language-light";
}

function extractTitle(html, fallback) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || fallback;
}

function parseInputText(input) {
  const normalized = input.toLowerCase();
  return uniqueStrings([
    ...(normalized.includes("touch") || normalized.includes("finger") || normalized.includes("tap")
      ? ["touch"]
      : []),
    ...(normalized.includes("mouse") || normalized.includes("drag") ? ["mouse"] : []),
    ...(normalized.includes("keyboard") || normalized.includes("key") ? ["keyboard"] : []),
    ...(normalized.includes("gamepad") || normalized.includes("controller") ? ["gamepad"] : []),
  ]);
}

function casinoTags(file) {
  return /blackjack|charm-reels|river-holdem/i.test(file) ? ["casino"] : [];
}

function resolveSourceRoot(root, source) {
  assertString(source.sourcePath, `${source.id} sourcePath`);
  return resolveInside(root, source.sourcePath);
}

function resolveInside(base, relativeFile) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativeFile);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`catalog path escapes source root: ${relativeFile}`);
  }
  return resolved;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireFile(file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`catalog asset does not exist: ${file}`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/gi, "-")
    .replaceAll(/^-|-$/g, "")
    .toLowerCase();
}
