# NINE final live-trading safety checklist

NINE is intentionally **paper-only by default**. Do not enable live execution until every applicable item is verified.

## Identity and access

- [ ] Strong admin password configured outside source control.
- [ ] Production HTTPS is enabled.
- [ ] Trading endpoints return 401 when unauthenticated.
- [ ] Session cookie is HttpOnly and Secure in production.
- [ ] Broker secret is stored only in server-side environment/secret storage.

## Market data

- [ ] Provider credentials are valid and within rate limits.
- [ ] XAUUSD symbol mapping is verified against the selected broker.
- [ ] Quote and candle timestamps are verified in UTC.
- [ ] Stale/suspicious feed blocks execution.
- [ ] Cross-timeframe and microstructure checks are passing.

## Strategy and Sentinel

- [ ] Chartist SMC logic is replay-tested on representative data.
- [ ] Atlas news/macro feed is configured or explicitly accepted as unavailable.
- [ ] Entry, SL and TP semantics match the broker.
- [ ] Risk is capped at or below the configured maximum.
- [ ] Daily loss and drawdown guards are verified.
- [ ] Sentinel approval is generated server-side immediately before execution.

## Broker adapter

- [ ] Broker-specific adapter validates instrument, side, quantity, tick size and order type.
- [ ] Idempotency is implemented so retries cannot duplicate an order.
- [ ] Broker response is authenticated and schema-validated.
- [ ] Rejections, fills, cancels and closes are written to the immutable ledger.
- [ ] SL/TP are confirmed at the broker after fill.
- [ ] Network timeout/retry behavior has been tested.

## Operational controls

- [ ] SQLite database is on persistent storage.
- [ ] Database backups have been restored successfully in a test environment.
- [ ] Health endpoint is monitored.
- [ ] Application logs are retained.
- [ ] A manual kill switch exists outside the application.
- [ ] Paper replay results have been reviewed before activation.

## Activation rule

Only after the checklist is complete should the operator set:

`NINE_LIVE_TRADING_ENABLED=true`

Even then, start with the smallest broker-supported size and monitor the immutable execution ledger.
