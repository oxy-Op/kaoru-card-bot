# Kaoru Web Admin

Next.js admin panel for Kaoru bot operations (curation, audit, users, character/edition management).

## Development

From repo root:

```bash
npm run web:dev
```

Or from `web/`:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment

The web app uses env vars from the repo root (`../.env`) in this setup:

- `DATABASE_URL`
- `REDIS_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `AUTH_SECRET` (or `NEXTAUTH_SECRET`)
- `NEXTAUTH_URL`
- `IMAGE_DIR`

## Build / Check

```bash
npm run lint
npm run build
```

## Auth Notes

- Discord OAuth redirect URI for local:
  - `http://localhost:3000/api/auth/callback/discord`
- Only users present in `admin_users` can sign in.
- Panel permissions are from `admin_users.role` (`owner > admin > curator > viewer`).
