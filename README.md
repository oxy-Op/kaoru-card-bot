# Kaoru

Anime card collecting Discord bot (TypeScript + discord.js v14) with a Next.js admin panel.

This repository is designed for open-source self-hosting. Keep private datasets (large image stores, third-party proprietary data, internal research) outside git.

## Monorepo Layout

- `src/` — bot runtime, commands, services, db schema, cache layer
- `scripts/` — migrations, seeds, and maintenance utilities
- `tests/` — Vitest integration and logic tests
- `web/` — Next.js admin panel
- `docs/` — architecture and feature docs

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- `pg_dump` installed (for `npm run db:backup`)

## Quickstart (Local)

1) Copy env:

```bash
cp .env.example .env
```

2) Start infra:

```bash
docker compose up -d
```

3) Install deps:

```bash
npm install
cd web && npm install && cd ..
```

4) Migrate DB:

```bash
npm run db:migrate
```

5) Run bot and web:

```bash
npm run dev
npm run web:dev
```

Bot and panel read environment from the repo root `.env`.

## Useful Commands

- `npm run build` — bot TypeScript build
- `npm run test` — full test suite
- `npm run test:pure` — lighter subset
- `npm run web:build` — admin panel production build
- `npm run db:backup` — timestamped SQL dump to `backups/`
- `npm run editions:prune -- --dry-run` — preview cleanup (keep only edition 1)
- `CONFIRM_DESTRUCTIVE=yes npm run editions:prune -- --execute` — apply destructive cleanup

## Open-Source Boundary

Recommended public/private split:

- Public: framework code, renderer, schema, Redis/cache layer, economy/anti-bot logic, docs
- Private: large image database, operational configs, internal research/intel, proprietary datasets

See:

- `docs/open-source-release-checklist.md`
- `docs/HOW_TO_PLAY.md`
- `docs/commands-reference.md`

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (`LICENSE`)
