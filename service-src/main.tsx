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

const qualityLabels: Record<string, string> = {
  Curated: "精选",
  Verified: "已验证",
  Cataloged: "已收录",
  "Upstream Issues": "上游不完整",
  "Top Pick": "推荐",
  Experimental: "实验",
};

const statusLabels: Record<string, string> = {
  active: "活跃",
  archived: "归档",
  degraded: "上游缺陷",
  experimental: "实验",
};

const languageLabels: Record<string, string> = {
  Chinese: "中文",
  English: "英文",
  "Language-light": "少文字",
};

const runtimeLabels: Record<string, string> = {
  offline: "离线可玩",
  network: "需要联网",
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
  const [inputFilter, setInputFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [sort, setSort] = useState("quality");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const playingGame = useMemo(
    () => games.find((game) => game.id === playingId) ?? null,
    [playingId],
  );
  const filterOptions = useMemo(() => ({
    categories: uniqueSorted(games.map((game) => game.category)),
    languages: uniqueSorted(games.map((game) => game.language)),
    qualities: uniqueSorted(
      games.map((game) => game.quality),
      (left, right) => (
        (qualityOrder.get(left) ?? 99) - (qualityOrder.get(right) ?? 99)
        || left.localeCompare(right)
      ),
    ),
    sources: uniqueSorted(games.map((game) => game.sourceTitle)),
    statuses: uniqueSorted(games.map((game) => game.status)),
  }), []);

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return games
      .filter((game) => {
        if (sourceFilter !== "all" && game.sourceTitle !== sourceFilter) return false;
        if (categoryFilter !== "all" && game.category !== categoryFilter) return false;
        if (inputFilter !== "all" && !game.inputs.includes(inputFilter)) return false;
        if (languageFilter !== "all" && game.language !== languageFilter) return false;
        if (qualityFilter !== "all" && game.quality !== qualityFilter) return false;
        if (statusFilter !== "all" && game.status !== statusFilter) return false;
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
          ...game.tags,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      })
      .toSorted((left, right) => compareGames(left, right, sort));
  }, [
    categoryFilter,
    inputFilter,
    languageFilter,
    qualityFilter,
    query,
    runtimeFilter,
    sort,
    sourceFilter,
    statusFilter,
  ]);

  const visibleGames = filteredGames.slice(0, visibleCount);
  const hasMore = visibleCount < filteredGames.length;
  const filtersActive = Boolean(
    query
    || sourceFilter !== "all"
    || categoryFilter !== "all"
    || inputFilter !== "all"
    || languageFilter !== "all"
    || qualityFilter !== "all"
    || statusFilter !== "all"
    || runtimeFilter !== "all"
    || sort !== "quality",
  );

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [
    categoryFilter,
    inputFilter,
    languageFilter,
    qualityFilter,
    query,
    runtimeFilter,
    sort,
    sourceFilter,
    statusFilter,
  ]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + pageSize, filteredGames.length));
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredGames.length, hasMore]);

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
    setInputFilter("all");
    setLanguageFilter("all");
    setQualityFilter("all");
    setStatusFilter("all");
    setRuntimeFilter("all");
    setSort("quality");
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
          src={playingGame.entry}
          title={playingGame.title}
          allow="autoplay; fullscreen; gamepad"
          referrerPolicy="no-referrer"
          sandbox="allow-downloads allow-pointer-lock allow-same-origin allow-scripts"
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
            <p>{games.length} 款游戏 · {filterOptions.sources.length} 个源码来源</p>
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
            label="来源"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={filterOptions.sources.map((value) => ({ label: value, value }))}
          />
          <FilterSelect
            label="类型"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={filterOptions.categories.map((value) => ({ label: value, value }))}
          />
          <FilterSelect
            label="操作"
            value={inputFilter}
            onChange={setInputFilter}
            options={[
              { label: "触控", value: "touch" },
              { label: "鼠标", value: "mouse" },
              { label: "键盘", value: "keyboard" },
              { label: "手柄", value: "gamepad" },
            ]}
          />
          <FilterSelect
            label="语言"
            value={languageFilter}
            onChange={setLanguageFilter}
            options={filterOptions.languages.map((value) => ({
              label: languageLabels[value] ?? value,
              value,
            }))}
          />
          <FilterSelect
            label="质量"
            value={qualityFilter}
            onChange={setQualityFilter}
            options={filterOptions.qualities.map((value) => ({
              label: qualityLabels[value] ?? value,
              value,
            }))}
          />
          <FilterSelect
            label="状态"
            value={statusFilter}
            onChange={setStatusFilter}
            options={filterOptions.statuses.map((value) => ({
              label: statusLabels[value] ?? value,
              value,
            }))}
          />
          <FilterSelect
            label="运行"
            value={runtimeFilter}
            onChange={setRuntimeFilter}
            options={[
              { label: "离线可玩", value: "offline" },
              { label: "需要联网", value: "network" },
            ]}
          />
          <FilterSelect
            label="排序"
            value={sort}
            onChange={setSort}
            includeAll={false}
            options={[
              { label: "质量优先", value: "quality" },
              { label: "名称", value: "title" },
              { label: "来源", value: "source" },
              { label: "状态", value: "status" },
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
          <span>{visibleGames.length} 款已显示</span>
        </div>

        {visibleGames.length > 0 ? (
          <section className="game-grid" aria-label="游戏目录">
            {visibleGames.map((game) => (
              <GameCard game={game} key={game.id} onPlay={() => play(game)} />
            ))}
          </section>
        ) : (
          <p className="empty-results">没有符合当前条件的游戏。</p>
        )}
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

function GameCard({ game, onPlay }: { game: Game; onPlay: () => void }) {
  const visibleTags = game.tags
    .filter((tag) => ![game.category, game.quality].includes(tag))
    .slice(0, 3);
  return (
    <article className="game-card" data-game-id={game.id}>
      <div className="cover-frame">
        <img
          alt={`${game.title} 游戏画面`}
          className="game-cover"
          loading="lazy"
          src={game.cover}
        />
        <span className={`status-badge status-${game.status}`}>
          {statusLabels[game.status] ?? game.status}
        </span>
        <span className="quality-badge">
          {qualityLabels[game.quality] ?? game.quality}
        </span>
      </div>
      <div className="card-body">
        <div className="card-heading">
          <div>
            <h2>{game.title}</h2>
            <p>{game.sourceTitle}</p>
          </div>
          <span className="technology">{game.technology}</span>
        </div>
        <p className="game-description">{game.description}</p>
        <dl className="game-facts">
          <div><dt>类型</dt><dd>{game.category}</dd></div>
          <div><dt>操作</dt><dd>{game.input}</dd></div>
          <div><dt>语言</dt><dd>{languageLabels[game.language] ?? game.language}</dd></div>
          <div><dt>运行</dt><dd>{runtimeLabels[game.runtime] ?? game.runtime}</dd></div>
        </dl>
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
  if (sort === "status") {
    return left.status.localeCompare(right.status)
      || left.title.localeCompare(right.title);
  }
  return (qualityOrder.get(left.quality) ?? 99) - (qualityOrder.get(right.quality) ?? 99)
    || left.status.localeCompare(right.status)
    || left.title.localeCompare(right.title);
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
