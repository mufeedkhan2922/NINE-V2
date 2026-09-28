#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_DIR="$ROOT/services/kronos"
ENV_DIR="${NINE_KRONOS_VENV:-$SERVICE_DIR/.venv}"
KRONOS_DIR="${KRONOS_REPO_PATH:-/tmp/nine-kronos/Kronos}"
PORT="${NINE_KRONOS_PORT:-8765}"

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }

python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Kronos requires Python 3.10+; use Python 3.12 for the NINE sidecar.")
PY

if [[ ! -d "$KRONOS_DIR/model" ]]; then
  mkdir -p "$(dirname "$KRONOS_DIR")"
  git clone https://github.com/shiyu-coder/Kronos.git "$KRONOS_DIR"
fi

python3 -m venv "$ENV_DIR"
source "$ENV_DIR/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r "$SERVICE_DIR/requirements.txt"
python -m pip install -r "$KRONOS_DIR/requirements.txt"

export KRONOS_REPO_PATH="$KRONOS_DIR"
export NINE_KRONOS_DEVICE="${NINE_KRONOS_DEVICE:-cpu}"
export NINE_KRONOS_MODEL="${NINE_KRONOS_MODEL:-Kronos-small}"

cd "$ROOT"
exec uvicorn services.kronos.server:app --host 127.0.0.1 --port "$PORT"
