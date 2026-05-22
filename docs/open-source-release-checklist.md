# Open Source Release Checklist

Use this before pushing the repository public.

## 1) Secret Hygiene

- Ensure `.env` is not committed.
- Rotate secrets if they were ever exposed:
  - `DISCORD_TOKEN`
  - `DISCORD_CLIENT_SECRET`
  - `AUTH_SECRET` / `NEXTAUTH_SECRET`
  - `ALT_TOKEN`
- Keep only placeholders in `.env.example`.

## 2) Private Data Hygiene

- Backup-first rule for destructive cleanups:
  - run `npm run db:backup` before DB deletions
  - copy sensitive local files into `backups/` before removing originals
- Do not publish private operational artifacts:
  - local reports (e.g. `comparison-report.json`)
  - private third-party datasets and internal research notes not meant for OSS
- Keep large image datasets outside git (`data/images`, `data/cache`).

## 3) Contributor Readiness

- Root `README.md` explains bot + web quickstart.
- `web/README.md` is project-specific (not Next.js template).
- `CONTRIBUTING.md` includes local setup, tests, and PR process.
- `LICENSE` exists at repo root.

## 4) Validation Before Public Push

- `npm run build`
- `npm run test:pure`
- `cd web && npm run lint && npm run build`
- Run DB safety scripts on non-production DB first:
  - `npm run db:backup`
  - `npm run editions:prune -- --dry-run`

## 5) Optional Secret Scanning

Use one of the following tools before release:

- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [TruffleHog](https://github.com/trufflesecurity/trufflehog)

Treat any findings as blockers until reviewed.
