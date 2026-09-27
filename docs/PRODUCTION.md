# NINE production deployment

NINE 2.10.2 uses SQLite through Node 24's built-in `node:sqlite`. For production, run the included Docker image with the `/app/.nine-data` persistent volume. Do not deploy the database onto ephemeral storage.

## Deploy

1. Copy `.env.production.example` to `.env.production`.
2. Set a strong `NINE_ADMIN_PASSWORD` and your market/news API keys.
3. Keep `NINE_LIVE_TRADING_ENABLED=false`.
4. Run `docker compose up -d --build`.
5. Verify `/api/health`.
6. Login with the configured admin account.

## Database backups

Back up the `nine-data` volume while NINE is stopped or use SQLite's online backup tooling. Preserve backups separately from the host.

## Live broker activation

Do not activate live execution until the final checklist is complete. NINE only supports a generic authenticated broker webhook adapter in this build; a broker-specific adapter must validate symbol, quantity, account permissions, order type, SL/TP semantics, idempotency and rejection handling before production use.
