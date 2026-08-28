# Open Games Agent Instructions

- This repository is an independent, read-only Hub web service.
- Third-party games must remain Git submodules pointing at forks owned by the
  deployment operator.
- Do not copy third-party source into this repository and do not add archive
  download or upload flows.
- Build commands belong to reviewed adapters under `scripts/adapters/`; game
  metadata must never contain arbitrary shell commands.
- Compatibility changes belong in the corresponding game fork.
- Keep `service-dist/` and `.runtime/` untracked.
- After changes, run `pnpm run check`, commit and push this repository, then
  restart it through the main repository's `just open-games-restart`.
