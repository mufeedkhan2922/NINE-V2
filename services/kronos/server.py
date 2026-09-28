from __future__ import annotations

import os
import time
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
import pandas as pd
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

KRONOS_REPO = Path(os.getenv("KRONOS_REPO_PATH", "/tmp/nine-kronos/Kronos")).resolve()
DEFAULT_MODEL = os.getenv("NINE_KRONOS_MODEL", "Kronos-small")
DEFAULT_DEVICE = os.getenv("NINE_KRONOS_DEVICE", "cpu")

_model_cache: dict[str, tuple[Any, Any, Any, str]] = {}
_model_lock = Lock()

app = FastAPI(title="NINE Kronos Forecast Service", version="1.0.0")

class Candle(BaseModel):
    timestamp: int | float | str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

class PredictRequest(BaseModel):
    symbol: str = "XAUUSD"
    timeframe: str = "5min"
    model: str = DEFAULT_MODEL
    horizon: int = Field(default=12, ge=1, le=120)
    sampleCount: int = Field(default=20, ge=1, le=100)
    temperature: float = Field(default=1.0, gt=0.0, le=3.0)
    topP: float = Field(default=0.9, gt=0.0, le=1.0)
    candles: list[Candle] = Field(min_length=60, max_length=2048)

def choose_device() -> str:
    configured = DEFAULT_DEVICE.lower()
    if configured not in {"auto", "cpu", "cuda", "mps"}:
        return "cpu"
    if configured == "cuda":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if configured == "mps":
        return "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    if configured == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    return "cpu"

def model_config(model_name: str) -> tuple[str, str, int]:
    configs = {
        "Kronos-mini": ("NeoQuasar/Kronos-mini", "NeoQuasar/Kronos-Tokenizer-2k", 2048),
        "Kronos-small": ("NeoQuasar/Kronos-small", "NeoQuasar/Kronos-Tokenizer-base", 512),
        "Kronos-base": ("NeoQuasar/Kronos-base", "NeoQuasar/Kronos-Tokenizer-base", 512),
    }
    if model_name not in configs:
        raise ValueError(f"Unsupported Kronos model: {model_name}")
    return configs[model_name]

def load_model(model_name: str):
    if model_name in _model_cache:
        return _model_cache[model_name]
    if not KRONOS_REPO.exists():
        raise RuntimeError(f"Kronos repository not found at {KRONOS_REPO}. Run services/kronos/start.sh or set KRONOS_REPO_PATH.")
    import sys
    repo = str(KRONOS_REPO)
    if repo not in sys.path:
        sys.path.insert(0, repo)
    from model import Kronos, KronosPredictor, KronosTokenizer
    model_id, tokenizer_id, context_length = model_config(model_name)
    device = choose_device()
    with _model_lock:
        if model_name in _model_cache:
            return _model_cache[model_name]
        tokenizer = KronosTokenizer.from_pretrained(tokenizer_id)
        model = Kronos.from_pretrained(model_id)
        tokenizer.eval()
        model.eval()
        predictor = KronosPredictor(model, tokenizer, device=device, max_context=context_length)
        _model_cache[model_name] = (tokenizer, model, predictor, device)
        return _model_cache[model_name]

def parse_timestamp(value: int | float | str) -> pd.Timestamp:
    if isinstance(value, (int, float)):
        return pd.to_datetime(int(value), unit="ms", utc=True)
    return pd.to_datetime(value, utc=True)

def infer_step(candles: list[Candle], timeframe: str) -> pd.Timedelta:
    if len(candles) >= 2:
        stamps = [parse_timestamp(c.timestamp) for c in candles[-8:]]
        deltas = [stamps[i] - stamps[i - 1] for i in range(1, len(stamps)) if stamps[i] > stamps[i - 1]]
        if deltas:
            return min(deltas)
    fallback = {"1min": pd.Timedelta(minutes=1), "5min": pd.Timedelta(minutes=5), "15min": pd.Timedelta(minutes=15), "1h": pd.Timedelta(hours=1), "4h": pd.Timedelta(hours=4), "1day": pd.Timedelta(days=1)}
    return fallback.get(timeframe, pd.Timedelta(minutes=5))

def prepare_dataframe(candles: list[Candle]) -> pd.DataFrame:
    rows = [{"timestamps": parse_timestamp(c.timestamp), "open": float(c.open), "high": float(c.high), "low": float(c.low), "close": float(c.close), "volume": float(c.volume)} for c in candles]
    df = pd.DataFrame(rows).sort_values("timestamps").drop_duplicates("timestamps")
    if len(df) < 60:
        raise ValueError("At least 60 unique candles are required.")
    numeric = ["open", "high", "low", "close", "volume"]
    if df[numeric].isnull().any().any():
        raise ValueError("Candle payload contains NaN values.")
    if (df["high"] < df[["open", "close"]].max(axis=1)).any():
        raise ValueError("Invalid OHLC candle high.")
    if (df["low"] > df[["open", "close"]].min(axis=1)).any():
        raise ValueError("Invalid OHLC candle low.")
    df["amount"] = df["volume"] * df[["open", "high", "low", "close"]].mean(axis=1)
    return df.reset_index(drop=True)

@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "nine-kronos", "model": DEFAULT_MODEL, "device": choose_device(), "repoPath": str(KRONOS_REPO), "modelLoaded": DEFAULT_MODEL in _model_cache}

@app.post("/api/predict")
def predict(request: PredictRequest) -> dict[str, Any]:
    if request.symbol.upper() != "XAUUSD":
        raise HTTPException(status_code=400, detail="NINE Kronos service is XAUUSD-only.")
    started = time.perf_counter()
    try:
        _, _, predictor, device = load_model(request.model)
        df = prepare_dataframe(request.candles)
        _, _, max_context = model_config(request.model)
        context = df.tail(max_context).reset_index(drop=True)
        x_timestamp = context["timestamps"].reset_index(drop=True)
        step = infer_step(request.candles, request.timeframe)
        future_index = pd.date_range(start=x_timestamp.iloc[-1] + step, periods=request.horizon, freq=step)
        y_timestamp = pd.Series(future_index, name="timestamps")
        paths: list[np.ndarray] = []
        with torch.no_grad():
            for _ in range(request.sampleCount):
                pred = predictor.predict(
                    df=context[["open", "high", "low", "close", "volume", "amount"]],
                    x_timestamp=x_timestamp,
                    y_timestamp=y_timestamp,
                    pred_len=request.horizon,
                    T=request.temperature,
                    top_k=0,
                    top_p=request.topP,
                    sample_count=1,
                    verbose=False,
                )
                paths.append(pred["close"].to_numpy(dtype=float))
        path_matrix = np.stack(paths, axis=0)
        low = np.percentile(path_matrix, 5, axis=0)
        median = np.percentile(path_matrix, 50, axis=0)
        high = np.percentile(path_matrix, 95, axis=0)
        return {
            "ok": True, "version": "1.0.0", "symbol": "XAUUSD", "timeframe": request.timeframe,
            "model": request.model, "contextCandles": len(context), "horizonCandles": request.horizon,
            "sampleCount": request.sampleCount, "currentPrice": float(context["close"].iloc[-1]),
            "timestamps": [int(ts.timestamp() * 1000) for ts in future_index],
            "lowPath": low.tolist(), "medianPath": median.tolist(), "highPath": high.tolist(),
            "latencyMs": round((time.perf_counter() - started) * 1000, 1), "device": device,
            "warnings": [
                "Zero-shot forecast only; NINE does not interpret the forecast distribution as a trading probability.",
                "Kronos forecast is uncalibrated until XAUUSD walk-forward evaluation is completed.",
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
