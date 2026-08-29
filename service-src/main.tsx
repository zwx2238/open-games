import { markServiceReady } from "@local-agent-bridge/embedded-service-sdk";
import {
  ArrowLeft,
  ExternalLink,
  GitFork,
  Maximize2,
  Play,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { games, type Game } from "./games";
import "./styles.css";

const pageSize = 60;
const editorialTierOrder = new Map([
  ["showcase", 0],
  ["curated", 1],
  ["catalog", 2],
  ["degraded", 3],
  ["archived", 4],
]);
const qualityOrder = new Map([
  ["Curated", 0],
  ["SSS", 1],
  ["SS", 2],
  ["S", 3],
  ["Top Pick", 4],
  ["A", 5],
  ["Verified", 6],
  ["Cataloged", 7],
  ["Upstream Issues", 8],
  ["Experimental", 9],
  ["E", 10],
]);

const editorialTierLabels: Record<string, string> = {
  showcase: "展示级",
  curated: "精选",
  catalog: "完整目录",
  degraded: "上游缺陷",
  archived: "归档",
};

const statusLabels: Record<string, string> = {
  active: "活跃",
  archived: "归档",
  degraded: "上游缺陷",
  experimental: "实验",
};

const runtimeLabels: Record<string, string> = {
  offline: "离线可玩",
  network: "需要联网",
  hybrid: "离线 / 联网混合",
};

const performanceLabels: Record<string, string> = {
  standard: "普通设备",
  high: "较高性能",
};

const inputLabels: Record<string, string> = {
  touch: "触控",
  mouse: "鼠标",
  keyboard: "键盘",
  gamepad: "手柄",
};

const deviceLabels: Record<string, string> = {
  desktop: "桌面",
  mobile: "手机",
};

function App() {
  const [playingId, setPlayingId] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.hash.slice(1)).get("play");
    return games.some((game) => game.id === id) ? id : null;
  });
  const [frameKey, setFrameKey] = useState(0);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [inputFilter, setInputFilter] = useState("all");
  const [performanceFilter, setPerformanceFilter] = useState("all");
  const [editorialTierFilter, setEditorialTierFilter] = useState("all");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [sort, setSort] = useState("editorial");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const playingGame = useMemo(
    () => games.find((game) => game.id === playingId) ?? null,
    [playingId],
  );
  const filterOptions = useMemo(() => ({
    categories: uniqueSorted(games.map((game) => game.category)),
    inputs: uniqueSorted(games.flatMap((game) => game.inputs)),
    sources: uniqueSorted(games.map((game) => game.sourceTitle)),
  }), []);
  const showcaseCount = useMemo(
    () => games.filter((game) => game.editorialTier === "showcase").length,
    [],
  );
  const forkCount = useMemo(
    () => new Set(games.map((game) => game.sourcePath)).size,
    [],
  );

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return games
      .filter((game) => {
        if (sourceFilter !== "all" && game.sourceTitle !== sourceFilter) return false;
        if (categoryFilter !== "all" && game.category !== categoryFilter) return false;
        if (deviceFilter !== "all" && !game.devices.includes(deviceFilter)) return false;
        if (inputFilter !== "all" && !game.inputs.includes(inputFilter)) return false;
        if (performanceFilter !== "all" && game.performance !== performanceFilter) return false;
        if (
          editorialTierFilter !== "all"
          && game.editorialTier !== editorialTierFilter
        ) return false;
        if (runtimeFilter !== "all" && game.runtime !== runtimeFilter) return false;
        if (!normalizedQuery) return true;
        return [
          game.title,
          game.author,
          game.description,
          game.category,
          game.group,
          game.sourceTitle,
          game.technology,
          game.runtimeNote,
          ...game.tags,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      })
      .toSorted((left, right) => compareGames(left, right, sort));
  }, [
    categoryFilter,
    deviceFilter,
    editorialTierFilter,
    inputFilter,
    performanceFilter,
    query,
    runtimeFilter,
    sort,
    sourceFilter,
  ]);

  const filtersActive = Boolean(
    query
    || sourceFilter !== "all"
    || categoryFilter !== "all"
    || deviceFilter !== "all"
    || inputFilter !== "all"
    || performanceFilter !== "all"
    || editorialTierFilter !== "all"
    || runtimeFilter !== "all"
    || sort !== "editorial",
  );
  const showcaseGames = filtersActive
    ? []
    : filteredGames.filter((game) => game.editorialTier === "showcase");
  const catalogGames = filtersActive
    ? filteredGames
    : filteredGames.filter((game) => game.editorialTier !== "showcase");
  const visibleGames = catalogGames.slice(0, visibleCount);
  const hasMore = visibleCount < catalogGames.length;
  const displayedCount = showcaseGames.length + visibleGames.length;

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [
    categoryFilter,
    deviceFilter,
    editorialTierFilter,
    inputFilter,
    performanceFilter,
    query,
    runtimeFilter,
    sort,
    sourceFilter,
  ]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + pageSize, catalogGames.length));
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [catalogGames.length, hasMore]);

  const play = (game: Game) => {
    window.history.replaceState(null, "", `#play=${encodeURIComponent(game.id)}`);
    setPlayingId(game.id);
    setFrameKey((value) => value + 1);
  };

  const closePlayer = () => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setPlayingId(null);
  };

  const clearFilters = () => {
    setQuery("");
    setSourceFilter("all");
    setCategoryFilter("all");
    setDeviceFilter("all");
    setInputFilter("all");
    setPerformanceFilter("all");
    setEditorialTierFilter("all");
    setRuntimeFilter("all");
    setSort("editorial");
  };

  if (playingGame) {
    return (
      <main className="player-shell">
        <header className="player-toolbar">
          <button
            className="icon-button"
            onClick={closePlayer}
            title="返回游戏目录"
            aria-label="返回游戏目录"
            type="button"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="player-title">
            <strong>{playingGame.title}</strong>
            <span>{playingGame.sourceTitle}</span>
          </div>
          <div className="toolbar-actions">
            <a
              className="icon-button"
              href={playingGame.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title="查看游戏源码"
              aria-label="查看游戏源码"
            >
              <ExternalLink size={18} />
            </a>
            <button
              className="icon-button"
              onClick={() => setFrameKey((value) => value + 1)}
              title="重新开始"
              aria-label="重新开始"
              type="button"
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => frameRef.current?.requestFullscreen()}
              title="全屏"
              aria-label="全屏"
              type="button"
            >
              <Maximize2 size={18} />
            </button>
          </div>
        </header>
        <iframe
          key={`${playingGame.id}-${frameKey}`}
          ref={frameRef}
          className="game-frame"
          data-game-id={playingGame.id}
          src={gameEntryUrl(playingGame.entry)}
          title={playingGame.title}
          allow="autoplay; fullscreen; gamepad"
          referrerPolicy="no-referrer"
          sandbox="allow-downloads allow-pointer-lock allow-popups allow-same-origin allow-scripts"
        />
      </main>
    );
  }

  return (
    <main className="catalog-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">OG</span>
          <div>
            <h1>Open Games</h1>
            <p>
              {games.length} 款游戏 · {forkCount} 个源码 Fork · {showcaseCount} 款展示级
            </p>
          </div>
        </div>
        <a
          className="icon-button"
          href="https://github.com/zwx2238/open-games"
          target="_blank"
          rel="noreferrer"
          title="查看 Open Games 源码"
          aria-label="查看 Open Games 源码"
        >
          <GitFork size={19} />
        </a>
      </header>

      <section className="catalog-content">
        <div className="filter-panel">
          <label className="search-field">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="搜索游戏"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、玩法、标签或来源"
              type="search"
              value={query}
            />
          </label>
          <FilterSelect
            label="分层"
            value={editorialTierFilter}
            onChange={setEditorialTierFilter}
            options={[
              { label: "展示级", value: "showcase" },
              { label: "精选", value: "curated" },
              { label: "完整目录", value: "catalog" },
              { label: "上游缺陷", value: "degraded" },
              { label: "归档", value: "archived" },
            ]}
          />
          <FilterSelect
            label="类型"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={filterOptions.categories.map((value) => ({ label: value, value }))}
          />
          <FilterSelect
            label="设备"
            value={deviceFilter}
            onChange={setDeviceFilter}
            options={[
              { label: "桌面", value: "desktop" },
              { label: "手机", value: "mobile" },
            ]}
          />
          <FilterSelect
            label="操作"
            value={inputFilter}
            onChange={setInputFilter}
            options={filterOptions.inputs.map((value) => ({
              label: inputLabels[value] ?? value,
              value,
            }))}
          />
          <FilterSelect
            label="性能"
            value={performanceFilter}
            onChange={setPerformanceFilter}
            options={[
              { label: "普通设备", value: "standard" },
              { label: "较高性能", value: "high" },
            ]}
          />
          <FilterSelect
            label="来源"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={filterOptions.sources.map((value) => ({ label: value, value }))}
          />
          <FilterSelect
            label="运行"
            value={runtimeFilter}
            onChange={setRuntimeFilter}
            options={[
              { label: "离线可玩", value: "offline" },
              { label: "需要联网", value: "network" },
              { label: "离线 / 联网混合", value: "hybrid" },
            ]}
          />
          <FilterSelect
            label="排序"
            value={sort}
            onChange={setSort}
            includeAll={false}
            options={[
              { label: "编辑优先", value: "editorial" },
              { label: "名称", value: "title" },
              { label: "来源", value: "source" },
            ]}
          />
          <button
            className="icon-button reset-button"
            disabled={!filtersActive}
            onClick={clearFilters}
            title="清除筛选"
            aria-label="清除筛选"
            type="button"
          >
            <RotateCcw size={17} />
          </button>
        </div>

        <div className="result-line">
          <strong>{filteredGames.length}</strong>
          <span>款符合条件</span>
          <span className="result-divider" aria-hidden="true" />
          <span>{displayedCount} 款已显示</span>
        </div>

        {showcaseGames.length > 0 ? (
          <section className="showcase-section" aria-labelledby="showcase-title">
            <div className="section-heading">
              <h2 id="showcase-title">精品先看</h2>
              <span>{showcaseGames.length} 款</span>
            </div>
            <div className="showcase-grid">
              {showcaseGames.map((game) => (
                <GameCard
                  game={game}
                  key={game.id}
                  onPlay={() => play(game)}
                  variant="showcase"
                />
              ))}
            </div>
          </section>
        ) : null}

        {visibleGames.length > 0 ? (
          <section className="catalog-results" aria-labelledby="catalog-title">
            {!filtersActive ? (
              <div className="section-heading catalog-heading">
                <h2 id="catalog-title">完整目录</h2>
                <span>{catalogGames.length} 款</span>
              </div>
            ) : null}
            <div className="game-grid" aria-label={filtersActive ? "筛选结果" : "完整游戏目录"}>
              {visibleGames.map((game) => (
                <GameCard game={game} key={game.id} onPlay={() => play(game)} />
              ))}
            </div>
          </section>
        ) : showcaseGames.length === 0 ? (
          <p className="empty-results">没有符合当前条件的游戏。</p>
        ) : null}
        <div
          className="load-sentinel"
          ref={loadMoreRef}
          aria-label={hasMore ? "正在加载更多游戏" : "全部游戏已显示"}
        >
          {hasMore ? "加载更多" : ""}
        </div>
      </section>
    </main>
  );
}

function GameCard({
  game,
  onPlay,
  variant = "catalog",
}: {
  game: Game;
  onPlay: () => void;
  variant?: "catalog" | "showcase";
}) {
  const isShowcase = variant === "showcase";
  const visibleTags = game.tags
    .filter((tag) => ![game.category, game.quality].includes(tag))
    .slice(0, isShowcase ? 4 : 3);
  return (
    <article
      className={`game-card game-card-${variant}`}
      data-editorial-tier={game.editorialTier}
      data-game-id={game.id}
    >
      <div className="cover-frame">
        <img
          alt={`${game.title} 游戏画面`}
          className="game-cover"
          loading="lazy"
          src={game.cover}
        />
        {game.status !== "active" ? (
          <span className={`status-badge status-${game.status}`}>
            {statusLabels[game.status] ?? game.status}
          </span>
        ) : null}
        <span className={`tier-badge tier-${game.editorialTier}`}>
          {editorialTierLabels[game.editorialTier] ?? game.editorialTier}
        </span>
        {isShowcase ? (
          <span className={`performance-badge performance-${game.performance}`}>
            {performanceLabels[game.performance] ?? game.performance}
          </span>
        ) : null}
      </div>
      <div className="card-body">
        <div className="card-heading">
          <div>
            <h2>{game.title}</h2>
            <p>{game.author} · {game.sourceTitle}</p>
          </div>
          <span className="technology">{game.technology}</span>
        </div>
        <p className="game-description">{game.description}</p>
        <dl className="game-facts">
          <div><dt>类型</dt><dd>{game.category}</dd></div>
          <div><dt>操作</dt><dd>{game.input}</dd></div>
          <div>
            <dt>设备</dt>
            <dd>{game.devices.map((device) => deviceLabels[device] ?? device).join(" / ")}</dd>
          </div>
          <div><dt>单局</dt><dd>{game.session}</dd></div>
          <div><dt>性能</dt><dd>{performanceLabels[game.performance] ?? game.performance}</dd></div>
          <div><dt>运行</dt><dd>{runtimeLabels[game.runtime] ?? game.runtime}</dd></div>
        </dl>
        {isShowcase ? (
          <div className="card-notes">
            <p><strong>自部署</strong><span>{game.runtimeNote}</span></p>
          </div>
        ) : null}
        {visibleTags.length > 0 ? (
          <div className="tag-list" aria-label="游戏标签">
            {visibleTags.map((tag) => (
              <span className="tag" key={tag}>{contentTagLabel(tag)}</span>
            ))}
          </div>
        ) : null}
        <footer className="card-actions">
          <button
            className="play-action"
            onClick={onPlay}
            title={`开始 ${game.title}`}
            type="button"
          >
            <Play fill="currentColor" size={18} />
            <span>开始</span>
          </button>
          <a
            className="icon-button"
            href={game.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={`查看 ${game.title} 源码`}
            aria-label={`查看 ${game.title} 源码`}
          >
            <GitFork size={17} />
          </a>
        </footer>
      </div>
    </article>
  );
}

function FilterSelect({
  includeAll = true,
  label,
  onChange,
  options,
  value,
}: {
  includeAll?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {includeAll ? <option value="all">全部</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function compareGames(left: Game, right: Game, sort: string) {
  if (sort === "title") return left.title.localeCompare(right.title);
  if (sort === "source") {
    return left.sourceTitle.localeCompare(right.sourceTitle)
      || left.title.localeCompare(right.title);
  }
  return (editorialTierOrder.get(left.editorialTier) ?? 99)
      - (editorialTierOrder.get(right.editorialTier) ?? 99)
    || (qualityOrder.get(left.quality) ?? 99) - (qualityOrder.get(right.quality) ?? 99)
    || left.status.localeCompare(right.status)
    || left.title.localeCompare(right.title);
}

function gameEntryUrl(entry: string) {
  return entry.endsWith("/index.html")
    ? entry.slice(0, -"index.html".length)
    : entry;
}

function uniqueSorted(
  values: string[],
  compare: (left: string, right: string) => number = (left, right) => left.localeCompare(right),
) {
  return [...new Set(values)].sort(compare);
}

function contentTagLabel(tag: string) {
  const labels: Record<string, string> = {
    auction: "竞价",
    bluffing: "博弈",
    casino: "博彩题材",
    english: "英文词汇",
    "missing-assets": "缺少上游资源",
    word: "文字",
  };
  return labels[tag] ?? tag;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
markServiceReady();
