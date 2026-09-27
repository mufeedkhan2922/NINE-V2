# NINE — AI Trading Desk 2.10.2

NINE is a controlled trading intelligence desk built around three agents:

- **Atlas** — macro/news context
- **Chartist** — technical and SMC analysis
- **Sentinel** — risk and execution gate

## Architecture

- Real SQLite persistence through Node 22's built-in `node:sqlite`
- Immutable execution ledger with database triggers
- Paper trading account and event history
- Deterministic candle replay/backtesting
- Server-sent event (SSE) market stream
- Advanced liquidity/FVG/OB/MSS/CHoCH/premium-discount/session analysis
- Optional Finnhub news layer for Atlas
- Broker adapter interface with a disabled-by-default webhook adapter
- Cookie-based authenticated trading endpoints
- Automated core-engine test suite
- Docker production configuration with persistent database volume

## Run locally

NINE requires **Node.js 24+** because the database uses `node:sqlite`.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Set at least `TWELVE_DATA_API_KEY` and `NINE_ADMIN_PASSWORD` before using the dashboard.

## Tests

```bash
npm test
```

The test suite covers technical analysis, SMC/Chartist, risk controls and replay/backtesting.

## Production

See `docs/PRODUCTION.md` and `docs/LIVE_TRADING_CHECKLIST.md`.

Live execution remains disabled until explicitly enabled on the server. A broker-specific adapter still needs to be verified against the exact broker API before real-money use.
