# Open Games

Curated, self-hosted browser games built directly from forked Git source.

## Source model

- Every game is a Git submodule pointing to a fork under the deployment
  operator's namespace.
- The superproject gitlink locks the exact game commit.
- `service:build` creates detached worktrees, runs one reviewed build adapter
  per game, and publishes only browser build outputs into `service-dist/`.
- No game archive, source copy, upload API, or runtime build command is
  accepted.

## Included games

| Game | Fork | Adapter |
| --- | --- | --- |
| Pigeon Ascent | `zwx2238/pigeonAscent` | Godot 3.2.3 HTML5 |

## Commands

```bash
pnpm install
pnpm run service:build
pnpm run service:serve
pnpm run check
```

The Godot adapter uses a digest-pinned `barichello/godot-ci` container image.
