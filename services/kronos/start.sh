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

find_python() {
  if [[ -n "$PYTHON_BIN" ]]; then
    command -v "$PYTHON_BIN" >/dev/null || { echo "NINE_KRONOS_PYTHON=$PYTHON_BIN was not found"; exit 1; }
    return
  fi
  if command -v python3.12 >/dev/null; then
    PYTHON_BIN="$(command -v python3.12)"
    return
  fi
  if command -v python3.11 >/dev/null; then
    PYTHON_BIN="$(command -v python3.11)"
    return
  fi
  if command -v python3 >/dev/null; then
    SYSTEM_PYTHON="$(command -v python3)"
    SYSTEM_VERSION="$("$SYSTEM_PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    if [[ "$SYSTEM_VERSION" == "3.12" || "$SYSTEM_VERSION" == "3.11" ]]; then
      PYTHON_BIN="$SYSTEM_PYTHON"
      return
    fi
  fi
  if command -v apt-get >/dev/null; then
    echo "Python 3.12 is not installed; installing Codespaces runtime prerequisites..."
    if command -v sudo >/dev/null; then
      sudo apt-get update
      sudo apt-get install -y python3.12 python3.12-venv
    elif [[ "$(id -u)" == "0" ]]; then
      apt-get update
      apt-get install -y python3.12 python3.12-venv
    else
      echo "Cannot install Python 3.12 automatically (sudo/root unavailable)."
      echo "Install Python 3.12 + python3.12-venv or set NINE_KRONOS_PYTHON."
      exit 1
    fi
    PYTHON_BIN="$(command -v python3.12)"
    return
  fi
  echo "Kronos requires Python 3.11/3.12 for the NINE sidecar."
  echo "Install Python 3.12 + python3.12-venv or set NINE_KRONOS_PYTHON."
  exit 1
}

find_python

"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info[:2] not in {(3, 11), (3, 12)}:
    raise SystemExit(
        f"Kronos sidecar requires Python 3.11/3.12; found {sys.version.split()[0]}."
    )
print(f"Using Python {sys.version.split()[0]}")
PY

if [[ ! -f "$KRONOS_DIR/model/kronos.py" ]]; then
  mkdir -p "$(dirname "$KRONOS_DIR")"
  if [[ -d "$KRONOS_DIR/.git" ]]; then
    echo "Kronos checkout exists but is incomplete; refreshing it..."
    git -C "$KRONOS_DIR" fetch --depth 1 origin master
    git -C "$KRONOS_DIR" reset --hard origin/master
  else
    rm -rf "$KRONOS_DIR"
    git clone --depth 1 https://github.com/shiyu-coder/Kronos.git "$KRONOS_DIR"
  fi
fi

if [[ -x "$ENV_DIR/bin/python" ]]; then
  VENV_VERSION="$("$ENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  TARGET_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$VENV_VERSION" != "$TARGET_VERSION" ]]; then
    echo "Rebuilding Kronos venv ($VENV_VERSION -> $TARGET_VERSION)..."
    rm -rf "$ENV_DIR"
  fi
fi

"$PYTHON_BIN" -m venv "$ENV_DIR" || {
  echo "venv creation failed; ensure python3.12-venv is installed."
  exit 1
}
source "$ENV_DIR/bin/activate"

python -m pip install --disable-pip-version-check --upgrade pip

if [[ "$DEVICE" == "cpu" ]]; then
  python -m pip install --disable-pip-version-check --upgrade "torch>=2.0,<3"     --index-url https://download.pytorch.org/whl/cpu
else
  python -m pip install --disable-pip-version-check --upgrade "torch>=2.0,<3"
fi

python -m pip install --disable-pip-version-check -r "$SERVICE_DIR/requirements.txt"
python -m pip install --disable-pip-version-check -r "$KRONOS_DIR/requirements.txt"

export KRONOS_REPO_PATH="$KRONOS_DIR"
export NINE_KRONOS_DEVICE="$DEVICE"
export NINE_KRONOS_MODEL="${NINE_KRONOS_MODEL:-Kronos-small}"

echo "Running Kronos dependency smoke test..."
python - <<'PY'
import importlib.util
import sys
import torch
print(f"torch={torch.__version__}")
print(f"cuda_available={torch.cuda.is_available()}")
if importlib.util.find_spec("fastapi") is None:
    raise SystemExit("fastapi import check failed")
if importlib.util.find_spec("pandas") is None:
    raise SystemExit("pandas import check failed")
if importlib.util.find_spec("einops") is None:
    raise SystemExit("einops import check failed")
sys.path.insert(0, "$KRONOS_DIR")
from model import Kronos, KronosPredictor, KronosTokenizer
print("Kronos model imports: OK")
PY

if [[ ! -f "$KRONOS_DIR/model/kronos.py" ]]; then
  echo "Kronos model source is missing after setup: $KRONOS_DIR/model/kronos.py"
  exit 1
fi

echo "NINE Kronos sidecar starting: model=$NINE_KRONOS_MODEL device=$NINE_KRONOS_DEVICE port=$PORT"
cd "$ROOT"
exec uvicorn services.kronos.server:app --host 127.0.0.1 --port "$PORT"
