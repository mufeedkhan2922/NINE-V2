# NINE V2 — Free 24/7 deployment

## Recommended topology

Use an Oracle Cloud Always Free VM as the always-on host, GitHub as the source of truth/CI, and GitHub Actions as a five-minute secondary heartbeat.

- **Host:** Oracle Cloud Always Free Ampere A1 VM
- **Runtime:** Docker Compose
- **Persistence:** NINE's existing SQLite volume
- **Heartbeat:** `/api/cron/nine`
- **Scheduler:** GitHub Actions every 5 minutes
- **Alerts:** optional Telegram bot
- **Trading mode:** paper only; live execution remains disabled

Oracle documents the Ampere A1 Always Free allowance as 2 OCPUs and 12 GB RAM equivalent for an Always Free tenancy. Capacity can occasionally be unavailable in a region. See the official Always Free documentation before provisioning.

## 1. Create the Oracle VM

Create an Always Free compute VM in your Oracle Cloud home region.

Recommended shape:

- VM.Standard.A1.Flex
- 2 OCPUs
- 12 GB memory
- Ubuntu 24.04 or another supported ARM64 Linux image
- Public IPv4
- At least 47 GB boot volume

The NINE Docker image is based on Node 24 and should be built for the VM's ARM64 architecture.

## 2. Install Docker

On the VM, install Docker Engine and Docker Compose, then clone this repository.

Build and start:

```bash
git clone https://github.com/mufeedkhan2922/NINE-V2.git
cd NINE-V2
cp .env.example .env.production
nano .env.production
docker compose up -d --build
```

The compose file already uses `restart: unless-stopped` and a persistent `nine-data` volume.

## 3. Required environment

Set your existing provider credentials plus:

```text
NINE_CRON_SECRET=<long-random-secret>
```

Optional Telegram:

```text
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
```

Do not commit `.env.production`.

## 4. Verify NINE

From the VM:

```bash
curl http://127.0.0.1:3000/api/health
docker compose ps
docker compose logs --tail=100 nine
```

The health endpoint should report `ok: true`.

Expose HTTPS through a reverse proxy before using the cron endpoint from GitHub Actions. Do not expose SQLite or the Docker port directly to the public internet without an access layer.

## 5. Configure GitHub Actions

In the repository's GitHub Settings → Secrets and variables → Actions, add:

- `NINE_BASE_URL` — your HTTPS NINE base URL, without a trailing slash
- `NINE_CRON_SECRET` — exactly the same secret configured on the VM

The workflow `.github/workflows/nine-24-7-heartbeat.yml` calls:

```text
GET /api/cron/nine
Authorization: Bearer <NINE_CRON_SECRET>
```

The endpoint fetches XAUUSD market data, runs the existing NINE orchestration, advances the autonomous paper-trading lifecycle, and can send Telegram alerts for paper entries/closures.

## 6. What runs continuously

Every heartbeat:

1. Get validated XAUUSD market data.
2. Run the existing NINE orchestration.
3. Apply Chartist/Atlas/Sentinel logic.
4. Advance the XAUUSD autonomous **paper** loop.
5. Persist lifecycle/ledger state in SQLite.
6. Send an optional Telegram event.
7. Return a health/result payload.

The heartbeat does **not** enable live trading.

## 7. Important free-tier note

Oracle's Always Free compute is the part intended to provide the continuously running host. GitHub Actions is a secondary wake/check mechanism, not the primary server.

If the Oracle VM is unavailable, GitHub Actions alone cannot replace persistent SQLite state or guarantee a continuously running NINE process.
