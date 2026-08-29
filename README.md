# Open Games

Self-hosted browser games built directly from operator-owned Git forks.

## Source model

- Every source is a Git submodule pointing to a fork under the deployment
  operator's namespace.
- `catalog/sources.json` is the source registry. A source can provide one game
  or any number of cataloged games; there is no per-source or total game limit.
- Collection loaders derive every game entry from the locked source inventory.
  Adding a collection does not require hand-writing one platform record per
  game.
- The catalog currently spans 17 operator-owned Forks. Six logical catalog
  sources expose those repositories as individual games or generated
  collections.
- The superproject gitlink locks the exact source commit.
- `service:build` creates detached worktrees, runs one reviewed build adapter
  per source format, and publishes only browser build outputs into
  `service-dist/`.
- No game archive, source copy, upload API, or runtime build command is
  accepted.

## Current inventory

| Source | Games | Import model |
| --- | ---: | --- |
| Showcase Forks | 8 | Individually reviewed high-completion browser games |
| Independent Forks | 5 | One reviewed adapter per repository |
| 100 GAMES | 100 | Generated from the fork's complete catalog |
| Mini Browser Games | 124 | Generated from quality tiers and source metadata |
| Games Hub | 142 | Generated from `games/registry.json` |
| LittleJS Arcade | 63 | Generated from the fork's local-game catalog |
| **Total** | **442** | All entries locked to fork commits |

The default view places the eight showcase games first, with Chinese gameplay
summaries, device support, session length, creation-method disclosure, network
boundaries, and performance requirements. The remaining 434 games stay in the
complete catalog and become part of the same result list whenever search or a
filter is active.

Source-internal quality remains available in generated metadata, but the
primary catalog order uses an editorial tier: `showcase`, `curated`, `catalog`,
`degraded`, or `archived`. Archived, experimental, English-only, casino
themed, and upstream-incomplete games remain visible instead of being removed.

The current Games Hub fork has 109 runtime-verified games and 33 games whose
pages render but whose upstream source omits referenced image or audio assets.
Those 33 entries are marked `degraded` and remain directly filterable instead
of being hidden or presented as verified.

## Commands

```bash
pnpm install
pnpm run service:build
pnpm run service:serve
pnpm run check
pnpm run visual-smoke
```

The Godot adapter uses a digest-pinned `barichello/godot-ci` container image.
The npm adapters install from each locked `package-lock.json` with lifecycle
scripts disabled, then invoke only the build command fixed in the reviewed
adapter.

The `static-root` adapter publishes only explicitly listed runtime files and
directories. It rejects absolute paths, traversal, symlinks, repository
metadata, dependency trees, tests, docs, and tools rather than copying an
entire checkout.

`visual-smoke` launches every catalog entry. Verified games fail the run on
browser errors; degraded entries must still render and accept interaction, and
their known upstream resource failures are written to
`.runtime/visual-smoke/warnings.json`.
