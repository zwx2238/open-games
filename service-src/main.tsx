import { markServiceReady } from "@local-agent-bridge/embedded-service-sdk";
import {
  ExternalLink,
  GitFork,
  Maximize2,
  Play,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { games } from "./games";
import "./styles.css";

const filterOptions = [
  { label: "All games", value: "all" },
  { label: "Independent forks", value: "featured" },
  { label: "100 GAMES collection", value: "collection" },
  ...Array.from(new Set(games.map((game) => game.category)))
    .sort((left, right) => left.localeCompare(right))
    .map((category) => ({
      label: category,
      value: `category:${category}`,
    })),
];

function App() {
  const [selectedId, setSelectedId] = useState(games[0]?.id ?? "");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selected = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0],
    [selectedId],
  );
  const visibleGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return games
      .map((game, index) => ({ game, index }))
      .filter(({ game }) => {
        const matchesFilter = filter === "all"
          || (filter === "featured" && game.featured)
          || (filter === "collection" && !game.featured)
          || (
            filter.startsWith("category:")
            && game.category === filter.slice("category:".length)
          );
        if (!matchesFilter) return false;
        if (!normalizedQuery) return true;
        return [
          game.title,
          game.author,
          game.description,
          game.category,
          game.group,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      });
  }, [filter, query]);

  if (!selected) return null;

  const startGame = () => {
    setPlayingId(selected.id);
    setFrameKey((value) => value + 1);
  };

  const selectGame = (id: string) => {
    setSelectedId(id);
    setPlayingId(null);
  };

  const fullscreen = async () => {
    await frameRef.current?.requestFullscreen();
  };

  return (
    <main className={`shell ${playingId ? "is-playing" : ""}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">OG</span>
          <div>
            <h1>Open Games</h1>
            <p>
              {games.length} source-built {games.length === 1 ? "game" : "games"}
            </p>
          </div>
        </div>
        <a
          className="icon-button"
          href="https://github.com/zwx2238/open-games"
          target="_blank"
          rel="noreferrer"
          title="Open service source"
          aria-label="Open service source"
        >
          <GitFork size={18} />
        </a>
      </header>

      <div className="workspace">
        <aside className="catalog-panel">
          <div className="catalog-tools">
            <label className="search-field">
              <Search aria-hidden="true" size={15} />
              <input
                aria-label="Search games"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search games"
                type="search"
                value={query}
              />
            </label>
            <select
              aria-label="Filter games"
              className="catalog-filter"
              onChange={(event) => setFilter(event.target.value)}
              value={filter}
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="catalog-count" aria-label={`${visibleGames.length} games shown`}>
              {visibleGames.length}
            </span>
          </div>
          <nav className="game-list" aria-label="Games">
            {visibleGames.map(({ game, index }) => (
              <button
                className={`game-row ${game.id === selected.id ? "is-selected" : ""}`}
                data-game-id={game.id}
                key={game.id}
                onClick={() => selectGame(game.id)}
                type="button"
              >
                <span className="game-index">{String(index + 1).padStart(3, "0")}</span>
                <span className="game-row-copy">
                  <strong>{game.title}</strong>
                  <small>{game.author}</small>
                </span>
                <span className="adapter">
                  {game.featured
                    ? "Independent"
                    : `${game.category} / ${String(game.collectionNumber).padStart(2, "0")}`}
                </span>
              </button>
            ))}
            {visibleGames.length === 0 ? (
              <p className="empty-results">No matches</p>
            ) : null}
          </nav>
        </aside>

        <section className="stage">
          {playingId === selected.id ? (
            <div className="player">
              <div className="player-toolbar">
                <strong>{selected.title}</strong>
                <div className="toolbar-actions">
                  <button
                    className="icon-button"
                    onClick={() => setFrameKey((value) => value + 1)}
                    title="Restart game"
                    aria-label="Restart game"
                    type="button"
                  >
                    <RotateCcw size={17} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={fullscreen}
                    title="Fullscreen"
                    aria-label="Fullscreen"
                    type="button"
                  >
                    <Maximize2 size={17} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => setPlayingId(null)}
                    title="Close game"
                    aria-label="Close game"
                    type="button"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <iframe
                key={`${selected.id}-${frameKey}`}
                ref={frameRef}
                className="game-frame"
                data-game-id={selected.id}
                src={selected.entry}
                title={selected.title}
                allow="autoplay; fullscreen; gamepad"
                referrerPolicy="no-referrer"
                sandbox="allow-downloads allow-pointer-lock allow-same-origin allow-scripts"
              />
            </div>
          ) : (
            <div className={`preview preview-${selected.id}`}>
              {selected.cover ? (
                <img className="preview-image" src={selected.cover} alt="" />
              ) : (
                <div className="preview-placeholder" aria-hidden="true" />
              )}
              <div className="preview-shade" />
              <div className="preview-content">
                <p className="eyebrow">{selected.edition}</p>
                <h2>{selected.title}</h2>
                <p className="description">{selected.description}</p>
                <dl className="facts">
                  <div><dt>Input</dt><dd>{selected.input}</dd></div>
                  <div><dt>Session</dt><dd>{selected.session}</dd></div>
                  <div><dt>Category</dt><dd>{selected.category}</dd></div>
                  <div><dt>License</dt><dd>{selected.license}</dd></div>
                </dl>
                <div className="primary-actions">
                  <button className="play-button" onClick={startGame} type="button">
                    <Play size={18} fill="currentColor" />
                    Play
                  </button>
                  <a
                    className="source-button"
                    href={selected.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={17} />
                    Source
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
markServiceReady();
