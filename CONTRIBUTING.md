# Contributing to Kaoru

## Local Setup

1. `cp .env.example .env`
2. `docker compose up -d`
3. `npm install`
4. `cd web && npm install && cd ..`
5. `npm run db:migrate`
6. Run app(s):
   - bot: `npm run dev`
   - web: `npm run web:dev`

## Development Workflow

- Keep changes scoped and focused.
- Prefer additive migrations/scripts over ad-hoc data edits.
- For destructive data scripts, provide `--dry-run` first.
- Update docs when behavior changes.

## Validation Before PR

- `npm run build`
- `npm run test:pure`
- `cd web && npm run lint && npm run build`

If your changes touch economy/trade/summon flows, run related targeted tests too:

- `npm run test:economy`
- `npm run test:trade`
- `npm run test:summon`

## Style Notes

- TypeScript strictness: avoid `any` unless unavoidable.
- Keep command handlers thin; push logic to services.
- Use `drizzle-orm` query builders consistently.
- Avoid committing `.env`, local reports, dumps, or generated runtime data.

## Security / Privacy

- Never commit secrets.
- Do not commit private image datasets, third-party proprietary data, or operational intel docs.
- Follow `docs/open-source-release-checklist.md` before release work.
