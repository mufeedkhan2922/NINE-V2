#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_DIR="$ROOT/services/kronos"
ENV_DIR="${NINE_KRONOS_VENV:-$SERVICE_DIR/.venv}"
KRONOS_DIR="${KRONOS_REPO_PATH:-/tmp/nine-kronos/Kronos}"
PORT="${NINE_KRONOS_PORT:-8765}"
DEVICE="${NINE_KRONOS_DEVICE:-cpu}"
PYTHON_BIN="${NINE_KRONOS_PYTHON:-}"

command -v git >/dev/null || { echo "git is required"; exit 1; }

# Kronos itself supports Python 3.10+, but the pinned scientific stack is
# most predictable on Python 3.12. Prefer it explicitly instead of silently
# creating a venv from a newer Codespaces Python (for example 3.14).
if [[ -n "$PYTHON_BIN" ]]; then
  command -v "$PYTHON_BIN" >/dev/null || { echo "NINE_KRONOS_PYTHON=$PYTHON_BIN was not found"; exit 1; }
elif command -v python3.12 >/dev/null; then
  PYTHON_BIN="$(command -v python3.12)"
elif command -v python3.11 >/dev/null; then
  PYTHON_BIN="$(command -v python3.11)"
else
  if command -v python3 >/dev/null; then
    SYSTEM_PYTHON="$(command -v python3)"
    SYSTEM_VERSION="$("$SYSTEM_PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  else
    SYSTEM_VERSION="missing"
  fi

  if [[ "$SYSTEM_VERSION" == "3.12" || "$SYSTEM_VERSION" == "3.11" ]]; then
    PYTHON_BIN="$SYSTEM_PYTHON"
  elif command -v sudo >/dev/null && command -v apt-get >/dev/null; then
    echo "Python 3.12 is not installed; installing the Codespaces runtime prerequisites..."
    sudo apt-get update
    sudo apt-get install -y python3.12 python3.12-venv
    PYTHON_BIN="$(command -v python3.12)"
  else
    echo "Kronos needs Python 3.11/3.12 for the pinned runtime."
    echo "Install Python 3.12 (and python3.12-venv), or set NINE_KRONOS_PYTHON to a compatible interpreter."
    exit 1
  fi
fi

"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info[:2] not in {(3, 11), (3, 12)}:
    raise SystemExit(
        f"Kronos sidecar requires Python 3.11/3.12 in NINE; found {sys.version.split()[0]}."
    )
print(f"Using Python {sys.version.split()[0]}")
PY

if [[ ! -d "$KRONOS_DIR/model" ]]; then
  mkdir -p "$(dirname "$KRONOS_DIR")"
  git clone https://github.com/shiyu-coder/Kronos.git "$KRONOS_DIR"
fi

# Recreate a venv if an older run created it with an incompatible Python.
if [[ -x "$ENV_DIR/bin/python" ]]; then
  VENV_VERSION="$("$ENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  TARGET_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$VENV_VERSION" != "$TARGET_VERSION" ]]; then
    echo "Rebuilding Kronos venv ($VENV_VERSION -> $TARGET_VERSION)..."
    rm -rf "$ENV_DIR"
  fi
fi

"$PYTHON_BIN" -m venv "$ENV_DIR"
source "$ENV_DIR/bin/activate"

python -m pip install --disable-pip-version-check --upgrade pip

# Do not pull hundreds of MB of CUDA libraries into a CPU Codespace.
# PyTorch documents separate CPU wheels; install that build first so the
# subsequent Kronos requirements (torch>=2.0) keep the already-satisfied CPU build.
if [[ "$DEVICE" == "cpu" ]]; then
  python -m pip install --disable-pip-version-check --upgrade "torch>=2.0"     --index-url https://download.pytorch.org/whl/cpu
else
  python -m pip install --disable-pip-version-check --upgrade "torch>=2.0"
fi

python -m pip install --disable-pip-version-check -r "$SERVICE_DIR/requirements.txt"
python -m pip install --disable-pip-version-check -r "$KRONOS_DIR/requirements.txt"

export KRONOS_REPO_PATH="$KRONOS_DIR"
export NINE_KRONOS_DEVICE="$DEVICE"
export NINE_KRONOS_MODEL="${NINE_KRONOS_MODEL:-Kronos-small}"

echo "NINE Kronos sidecar starting: model=$NINE_KRONOS_MODEL device=$NINE_KRONOS_DEVICE port=$PORT"

cd "$ROOT"
exec uvicorn services.kronos.server:app --host 127.0.0.1 --port "$PORT"
