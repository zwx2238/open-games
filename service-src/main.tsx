import { markServiceReady } from "@local-agent-bridge/embedded-service-sdk";
import {
  ExternalLink,
  GitFork,
  Maximize2,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { games } from "./games";
import "./styles.css";

function App() {
  const [selectedId, setSelectedId] = useState(games[0]?.id ?? "");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selected = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0],
    [selectedId],
  );

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
    <main className="shell">
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
        <nav className="game-list" aria-label="Games">
          {games.map((game, index) => (
            <button
              className={`game-row ${game.id === selected.id ? "is-selected" : ""}`}
              key={game.id}
              onClick={() => selectGame(game.id)}
              type="button"
            >
              <span className="game-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="game-row-copy">
                <strong>{game.title}</strong>
                <small>{game.author}</small>
              </span>
              <span className="adapter">{game.adapter}</span>
            </button>
          ))}
        </nav>

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
