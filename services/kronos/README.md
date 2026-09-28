# NINE Kronos Forecast Sidecar

This sidecar runs the official open-source Kronos model outside the Next.js process and exposes a small HTTP API to NINE.

Official sources:
- https://github.com/shiyu-coder/Kronos
- https://huggingface.co/NeoQuasar/Kronos-small

Kronos is a Python/PyTorch model, while NINE is a Next.js/TypeScript workstation. The sidecar keeps inference isolated and makes CPU/CUDA/MPS selection explicit.

## Start

From the NINE repository root:

```bash
bash services/kronos/start.sh
```

The startup script is intentionally self-healing for GitHub Codespaces:
- prefers Python 3.12 (then 3.11);
- installs Python 3.12 + venv support through apt when neither is available and sudo/apt are available;
- recreates an incompatible existing Kronos venv instead of reusing Python 3.14;
- installs the CPU-only PyTorch wheel when `NINE_KRONOS_DEVICE=cpu`, avoiding the large CUDA dependency download seen on CPU Codespaces;
- clones the official Kronos repository when it is missing.

You can override the interpreter if required:

```bash
export NINE_KRONOS_PYTHON=python3.12
```

Then configure NINE:

```bash
export NINE_KRONOS_ENDPOINT=http://127.0.0.1:8765/api/predict
export NINE_KRONOS_MODEL=Kronos-small
export NINE_KRONOS_DEVICE=cpu
```

Restart Next.js after changing environment variables.

## Controls

```text
NINE_KRONOS_PYTHON=python3.12
NINE_KRONOS_MODEL=Kronos-small
NINE_KRONOS_HORIZON=12
NINE_KRONOS_SAMPLES=20
NINE_KRONOS_TEMPERATURE=1.0
NINE_KRONOS_TOP_P=0.9
NINE_KRONOS_TIMEOUT_MS=90000
NINE_KRONOS_CACHE_MS=15000
NINE_KRONOS_DIRECTION_DEADBAND_PCT=0.05
```

Kronos-small uses a 512-candle context; NINE defaults to it for the first integration. The model weights are downloaded from Hugging Face on first load.

## Runtime behavior

The service is bound to `127.0.0.1` and is XAUUSD-only. NINE consumes the forecast as evidence, not as an execution signal. Kronos inference is asynchronous and cached by the latest candle so the dashboard does not block on model generation.

## Safety

NINE treats the output as forecast evidence only. It cannot authorize a trade, bypass validation, or bypass Sentinel. Keep the sidecar bound to localhost and do not place broker credentials in its environment.

The sidecar is zero-shot and uncalibrated. Before any forecast weight is introduced into decision scoring, NINE should run XAUUSD walk-forward evaluation for MAE/RMSE, directional accuracy, interval coverage/width, persistence baseline comparison, timeframe, and regime.
