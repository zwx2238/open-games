# Open Games

Curated, self-hosted browser games built directly from forked Git source.

## Source model

- Every source is a Git submodule pointing to a fork under the deployment
  operator's namespace.
- A source can provide one game or a reviewed collection catalog. The
  superproject gitlink locks the exact source commit.
- `service:build` creates detached worktrees, runs one reviewed build adapter
  per source format, and publishes only browser build outputs into
  `service-dist/`.
- No game archive, source copy, upload API, or runtime build command is
  accepted.

## Included games

| Game | Fork | Adapter |
| --- | --- | --- |
| Pigeon Ascent | `zwx2238/pigeonAscent` | Godot 3.2.3 HTML5 |
| Pixel Princess Platformer | `zwx2238/pixel-princess-platformer` | Reviewed static Kaplay site |
| Stolen Sword | `zwx2238/stolen-sword` | Rollup browser build |
| 暗日地下城 | `zwx2238/dark-sun-dungeon` | Vite single-file HTML build |
| POP! | `zwx2238/BagelMVP` | Vite static build |
| 100 GAMES curated collection (95 selected) | `zwx2238/100games` | Reviewed static single-HTML adapter |

## Commands

```bash
pnpm install
pnpm run service:build
pnpm run service:serve
pnpm run check
```

The Godot adapter uses a digest-pinned `barichello/godot-ci` container image.
The npm adapters install from each locked `package-lock.json` with lifecycle
scripts disabled, then invoke only the build command fixed in the reviewed
adapter.
