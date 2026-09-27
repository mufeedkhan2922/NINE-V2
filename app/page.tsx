"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Brain,
  CheckCircle2,
  CircleDollarSign,
  Command,
  Database,
  Gauge,
  LogOut,
  Mic,
  MicOff,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Radio,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type MarketSymbol = "XAUUSD" | "NIFTY" | "BANKNIFTY";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Position = {
  id: string;
  symbol: MarketSymbol;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN" | "CLOSED";
  realizedPnl?: number;
};

type User = {
  id: string;
  email: string;
  role: string;
} | null;

type Dashboard = {
  ok: boolean;
  version?: string;
  error?: string;
  symbol?: MarketSymbol;
  feed?: any;
  runtime?: any;
  market?: any;
  orchestration?: any;
  agents?: any;
  workstation?: any;
  decisionEngine?: any;
  paperLoop?: any;
  v27?: any;
  v29?: any;
  diagnostics?: any;
  strategyLab?: any;
  strategyMemory?: any[];
  paperReconciliation?: any;
  account?: any;
  chart?: Candle[];
  events?: any[];
  orders?: any[];
};

type BacktestResult = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  finalBalance: number;
  initialBalance: number;
  averageWin?: number;
  averageLoss?: number;
  expectancy?: number;
  sessionStats?: Record<string, { trades: number; wins: number; pnl: number }>;
  trades?: Array<{ id: string; index: number; side: "LONG" | "SHORT"; entryTime: number; exitTime: number; entryPrice: number; exitPrice: number; stopLoss: number; takeProfit: number; quantity: number; pnl: number; outcome: "WIN" | "LOSS"; reason: "TARGET" | "STOP" | "END" }>;
};

type CommandRecord = {
  id: number;
  text: string;
  message: string;
  timestamp: number;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const SYMBOLS: Array<{
  value: MarketSymbol;
  label: string;
  description: string;
}> = [
  { value: "XAUUSD", label: "XAUUSD", description: "Gold / USD" },
  { value: "NIFTY", label: "NIFTY", description: "NSE index" },
  { value: "BANKNIFTY", label: "BANKNIFTY", description: "NSE banking index" },
];

const NAV = [
  ["overview", "Command Center"],
  ["chartist", "Chartist"],
  ["learning-lab", "Learning Lab"],
  ["strategy-memory", "Strategy Memory"],
  ["atlas", "Atlas"],
  ["sentinel", "Sentinel"],
  ["backtest", "Backtest"],
  ["signals", "Audit"],
] as const;

function fmt(value: unknown, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
}

function signed(value: unknown, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : "—";
}

function tone(value: string | undefined) {
  const normalized = value?.toUpperCase();
  if (
    normalized === "BULLISH" ||
    normalized === "LONG" ||
    normalized === "BUY" ||
    normalized === "APPROVED" ||
    normalized === "HEALTHY" ||
    normalized === "LIVE"
  ) {
    return "positive";
  }
  if (
    normalized === "BEARISH" ||
    normalized === "SHORT" ||
    normalized === "SELL" ||
    normalized === "BLOCKED" ||
    normalized === "DEGRADED" ||
    normalized === "STALE"
  ) {
    return "negative";
  }
  return "neutral";
}

function StatusPill({
  value,
  prefix,
}: {
  value: string | undefined;
  prefix?: string;
}) {
  return (
    <span className={`status-pill ${tone(value)}`}>
      <span className="status-pill-dot" />
      {prefix ? `${prefix} ` : ""}
      {value ?? "—"}
    </span>
  );
}

function CandlestickChart({
  candles,
  live,
  chartist,
  setup,
  workstation,
  decisionEngine,
  height = 440,
}: {
  candles: Candle[];
  live: boolean;
  chartist?: any;
  setup?: any;
  workstation?: any;
  decisionEngine?: any;
  height?: number;
}) {
  const [timeframe, setTimeframe] = useState("1m");
  const [visibleCount, setVisibleCount] = useState(90);
  const [pan, setPan] = useState(0);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; index: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; candle: Candle } | null>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const timeframeSeconds: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
  };

  const aggregateCandles = (source: Candle[], seconds: number) => {
    if (seconds === 60 || source.length < 2) return source;
    const groups = new Map<number, Candle>();
    for (const candle of source) {
      const bucket = Math.floor(candle.time / (seconds * 1000)) * seconds * 1000;
      const current = groups.get(bucket);
      if (!current) {
        groups.set(bucket, { ...candle, time: bucket, volume: candle.volume ?? 0 });
      } else {
        current.high = Math.max(current.high, candle.high);
        current.low = Math.min(current.low, candle.low);
        current.close = candle.close;
        current.volume = (current.volume ?? 0) + (candle.volume ?? 0);
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.time - b.time);
  };

  const aggregated = useMemo(
    () => aggregateCandles(candles, timeframeSeconds[timeframe] ?? 60),
    [candles, timeframe],
  );

  const visible = useMemo(() => {
    if (!aggregated.length) return [];
    const count = Math.min(visibleCount, aggregated.length);
    const end = Math.max(count, aggregated.length - pan);
    return aggregated.slice(Math.max(0, end - count), end);
  }, [aggregated, visibleCount, pan]);

  useEffect(() => {
    setPan(0);
    setTooltip(null);
    setCrosshair(null);
  }, [timeframe, candles.length]);

  if (!candles.length) {
    return (
      <div className="chart-placeholder">
        <Database size={20} />
        <span>No validated candles available.</span>
        <small>Waiting for a fresh market snapshot.</small>
      </div>
    );
  }

  const width = 1500;
  const plotLeft = 58;
  const plotRight = 92;
  const plotTop = 30;
  const priceBottom = 322;
  const volumeTop = 338;
  const volumeBottom = 398;
  const plotWidth = width - plotLeft - plotRight;
  const priceHeight = priceBottom - plotTop;
  const step = plotWidth / Math.max(visible.length, 1);
  const bodyWidth = Math.max(3, Math.min(13, step * 0.62));
  const min = Math.min(...visible.map((c) => c.low));
  const max = Math.max(...visible.map((c) => c.high));
  const rawSpan = Math.max(max - min, 0.000001);
  const margin = rawSpan * 0.09;
  const chartMin = min - margin;
  const chartMax = max + margin;
  const span = Math.max(chartMax - chartMin, 0.000001);
  const maxVolume = Math.max(...visible.map((c) => c.volume ?? 0), 1);
  const x = (index: number) => plotLeft + index * step + step / 2;
  const y = (price: number) => plotTop + (1 - (price - chartMin) / span) * priceHeight;
  const latest = visible.at(-1);
  const price = latest?.close ?? min;
  const priceY = y(price);
  const tickCount = 6;
  const priceTicks = Array.from({ length: tickCount }, (_, index) => chartMax - (index / (tickCount - 1)) * span);
  const timeIndices = [0, Math.floor(visible.length * 0.2), Math.floor(visible.length * 0.4), Math.floor(visible.length * 0.6), Math.floor(visible.length * 0.8), visible.length - 1]
    .filter((value, index, array) => value >= 0 && array.indexOf(value) === index);
  const formatTime = (value: number) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  };
  const formatPrice = (value: number) => Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

  const mapClientToChart = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const chartX = ((clientX - rect.left) / rect.width) * width;
    const chartY = ((clientY - rect.top) / rect.height) * height;
    const rawIndex = (chartX - plotLeft) / step - 0.5;
    const index = Math.round(rawIndex);
    if (index < 0 || index >= visible.length) return null;
    return { chartX, chartY, index };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const delta = event.clientX - dragRef.current.startX;
      const rect = svgRef.current?.getBoundingClientRect();
      const pixelsPerCandle = rect ? (rect.width / width) * step : step;
      const deltaCandles = Math.round(-delta / Math.max(pixelsPerCandle, 1));
      const maxPan = Math.max(0, aggregated.length - visibleCount);
      setPan(Math.max(0, Math.min(maxPan, dragRef.current.startPan + deltaCandles)));
      return;
    }
    const mapped = mapClientToChart(event.clientX, event.clientY);
    if (!mapped) {
      setCrosshair(null);
      setTooltip(null);
      return;
    }
    const candle = visible[mapped.index];
    setCrosshair({ x: mapped.chartX, y: mapped.chartY, index: mapped.index });
    setTooltip({ x: Math.min(mapped.chartX + 14, width - 260), y: Math.max(10, mapped.chartY - 94), candle });
  };

  const zoom = (direction: number) => {
    setVisibleCount((current) => Math.max(35, Math.min(140, current + direction)));
    setPan((current) => Math.min(current, Math.max(0, aggregated.length - visibleCount)));
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 10 : -10);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { startX: event.clientX, startPan: pan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const zoneRects = (zones: any[] | undefined, className: string) =>
    (zones ?? []).slice(-4).map((zone: any, index: number) => {
      const top = y(Math.max(zone.high, zone.low));
      const bottom = y(Math.min(zone.high, zone.low));
      const leftIndex = visible.findIndex((c) => c.time >= zone.createdAt);
      const left = leftIndex >= 0 ? x(leftIndex) : plotLeft;
      return (
        <rect
          key={`${className}-${zone.createdAt}-${index}`}
          x={left}
          y={top}
          width={Math.max(20, width - plotRight - left)}
          height={Math.max(2, bottom - top)}
          className={`${className} ${zone.direction === "SHORT" ? "short" : "long"}`}
          rx="3"
        />
      );
    });

  const sessionBoundaries = visible.map((candle, index) => {
    if (index === 0) return null;
    const prevHour = new Date(visible[index - 1].time).getUTCHours();
    const hour = new Date(candle.time).getUTCHours();
    const changed = prevHour !== hour && [0, 7, 12, 21].includes(hour);
    if (!changed) return null;
    const label = hour === 0 ? "ASIA" : hour === 7 ? "LONDON" : hour === 12 ? "NEW YORK" : "OFF";
    return (
      <g key={`session-${candle.time}`}>
        <line x1={x(index)} x2={x(index)} y1={plotTop} y2={volumeBottom} className="session-line" />
        <text x={x(index) + 5} y={plotTop + 14} className="session-label">{label}</text>
      </g>
    );
  });

  return (
    <div className="market-chart-shell workstation-chart">
      <div className={`chart-feed-banner ${live ? "live" : "stale"}`}>
        <span className="chart-feed-dot" />
        <b>{live ? "LIVE VALIDATED DATA" : "LAST VALIDATED DATA"}</b>
        <span>{live ? "Fresh provider snapshot" : "Not a live execution feed"}</span>
      </div>

      <div className="chart-toolbar">
        <div className="chart-tool-group">
          <span className="chart-tool-label">TIMEFRAME</span>
          {Object.keys(timeframeSeconds).map((item) => (
            <button
              key={item}
              className={timeframe === item ? "chart-tool active" : "chart-tool"}
              onClick={() => setTimeframe(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="chart-tool-group">
          <span className="chart-tool-label">VIEW</span>
          <button className="chart-tool" type="button" onClick={() => zoom(-15)}>＋</button>
          <button className="chart-tool" type="button" onClick={() => zoom(15)}>－</button>
          <button className="chart-tool" type="button" onClick={() => { setVisibleCount(90); setPan(0); }}>RESET</button>
        </div>
        <div className="chart-overlay-status">
          <span>{visible.length} candles</span>
          <span>{chartist?.session ?? "OFF_SESSION"}</span>
          <span>{chartist?.higherTimeframeBias ?? "NONE"} HTF</span>
        </div>
      </div>

      <div className="chart-interaction-hint">Scroll to zoom · drag to pan · hover for OHLC</div>

      <div className="chart-svg-wrap">
        <svg
          ref={svgRef}
          className="market-chart workstation-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={live ? "Live validated candlestick chart" : "Last validated candlestick chart"}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => { setCrosshair(null); setTooltip(null); }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <rect x={plotLeft} y={plotTop} width={plotWidth} height={priceHeight} className="chart-plot-bg" rx="4" />
          <rect x={plotLeft} y={volumeTop} width={plotWidth} height={volumeBottom - volumeTop} className="chart-volume-bg" rx="4" />

          {priceTicks.map((tick, index) => {
            const tickY = y(tick);
            return (
              <g key={`price-${index}`}>
                <line x1={plotLeft} x2={width - plotRight} y1={tickY} y2={tickY} className="chart-grid" />
                <text x={width - plotRight + 9} y={tickY + 3} className="chart-price-label">{formatPrice(tick)}</text>
              </g>
            );
          })}

          {timeIndices.map((index) => (
            <text key={`time-${index}`} x={x(index)} y={height - 10} textAnchor="middle" className="chart-time-label">{formatTime(visible[index].time)}</text>
          ))}

          {sessionBoundaries}
          {zoneRects(chartist?.fairValueGaps, "chart-zone-fvg")}
          {zoneRects(chartist?.orderBlocks, "chart-zone-ob")}

          {chartist?.liquidityHigh != null && (
            <line x1={plotLeft} x2={width - plotRight} y1={y(chartist.liquidityHigh)} y2={y(chartist.liquidityHigh)} className="liquidity-line high" />
          )}
          {chartist?.liquidityLow != null && (
            <line x1={plotLeft} x2={width - plotRight} y1={y(chartist.liquidityLow)} y2={y(chartist.liquidityLow)} className="liquidity-line low" />
          )}
          {chartist?.sessionHigh != null && (
            <line x1={plotLeft} x2={width - plotRight} y1={y(chartist.sessionHigh)} y2={y(chartist.sessionHigh)} className="session-level high" />
          )}
          {chartist?.sessionLow != null && (
            <line x1={plotLeft} x2={width - plotRight} y1={y(chartist.sessionLow)} y2={y(chartist.sessionLow)} className="session-level low" />
          )}
          {(workstation?.annotations ?? []).filter((annotation: any) => annotation?.price != null).map((annotation: any, index: number) => {
            const price = Number(annotation.price);
            if (!Number.isFinite(price) || price < chartMin || price > chartMax) return null;
            const annotationY = y(price);
            const type = String(annotation.type ?? "LEVEL");
            const toneClass = type === "ENTRY" ? "workstation-entry" : type === "STOP" ? "workstation-stop" : type === "TARGET" ? "workstation-target" : "workstation-equilibrium";
            return (
              <g key={`workstation-${type}-${index}`} className={toneClass}>
                <line x1={plotLeft} x2={width - plotRight} y1={annotationY} y2={annotationY} className="workstation-level-line" />
                <rect x={plotLeft + 6} y={annotationY - 10} width={Math.max(58, String(annotation.label ?? type).length * 7 + 18)} height="20" rx="4" className="workstation-level-tag" />
                <text x={plotLeft + 14} y={annotationY + 3} className="workstation-level-text">{annotation.label ?? type}</text>
                <text x={width - plotRight - 6} y={annotationY - 4} textAnchor="end" className="workstation-level-price">{formatPrice(price)}</text>
              </g>
            );
          })}

          {(decisionEngine?.events ?? []).filter((item: any) => item?.timestamp).map((item: any, index: number) => {
            const eventIndex = visible.findIndex((candle) => candle.time >= Number(item.timestamp));
            if (eventIndex < 0) return null;
            const eventX = x(eventIndex);
            return (
              <g key={`decision-event-${item.id ?? index}`} className={`decision-event decision-event-${String(item.importance ?? "LOW").toLowerCase()}`}>
                <line x1={eventX} x2={eventX} y1={plotTop} y2={volumeBottom} className="decision-event-line" />
                <circle cx={eventX} cy={plotTop + 24 + (index % 3) * 10} r="4" className="decision-event-dot" />
                <title>{`${item.title}: ${item.detail}`}</title>
              </g>
            );
          })}

          {visible.map((candle, index) => {
            const bullish = candle.close >= candle.open;
            const cx = x(index);
            const bodyTop = y(Math.max(candle.open, candle.close));
            const bodyBottom = y(Math.min(candle.open, candle.close));
            const bodyHeight = Math.max(2, bodyBottom - bodyTop);
            const volumeHeight = ((candle.volume ?? 0) / maxVolume) * (volumeBottom - volumeTop - 7);
            return (
              <g key={`${candle.time}-${index}`}>
                <rect x={cx - bodyWidth / 2} y={volumeBottom - volumeHeight} width={Math.max(2, bodyWidth * 0.82)} height={Math.max(1, volumeHeight)} className={bullish ? "volume-bar bullish" : "volume-bar bearish"} rx="1" />
                <line x1={cx} x2={cx} y1={y(candle.high)} y2={y(candle.low)} className={bullish ? "candle-wick bullish" : "candle-wick bearish"} />
                <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} rx="1.5" className={bullish ? "candle-body bullish" : "candle-body bearish"} />
              </g>
            );
          })}

          {latest && chartist?.mssDirection && chartist.mssDirection !== "NONE" && (
            <g>
              <circle cx={x(visible.length - 1)} cy={chartist.mssDirection === "LONG" ? y(latest.low) + 14 : y(latest.high) - 14} r="4" className="mss-marker" />
              <text x={x(visible.length - 1) + 9} y={chartist.mssDirection === "LONG" ? y(latest.low) + 18 : y(latest.high) - 18} className="structure-marker">MSS {chartist.mssDirection}</text>
            </g>
          )}

          <line x1={plotLeft} x2={width - plotRight} y1={priceY} y2={priceY} className="current-price-line" />
          <rect x={width - plotRight + 4} y={priceY - 10} width="76" height="20" rx="4" className="current-price-tag" />
          <text x={width - plotRight + 42} y={priceY + 3} textAnchor="middle" className="current-price-label">{formatPrice(price)}</text>

          {crosshair && (
            <g className="crosshair-layer">
              <line x1={crosshair.x} x2={crosshair.x} y1={plotTop} y2={volumeBottom} className="crosshair-line" />
              <line x1={plotLeft} x2={width - plotRight} y1={crosshair.y} y2={crosshair.y} className="crosshair-line" />
            </g>
          )}

          {tooltip && (
            <g transform={`translate(${tooltip.x},${tooltip.y})`} className="chart-tooltip">
              <rect width="238" height="82" rx="7" />
              <text x="12" y="17" className="tooltip-time">{formatTime(tooltip.candle.time)} · {timeframe}</text>
              <text x="12" y="36">O <tspan>{formatPrice(tooltip.candle.open)}</tspan></text>
              <text x="83" y="36">H <tspan>{formatPrice(tooltip.candle.high)}</tspan></text>
              <text x="154" y="36">L <tspan>{formatPrice(tooltip.candle.low)}</tspan></text>
              <text x="12" y="59">C <tspan>{formatPrice(tooltip.candle.close)}</tspan></text>
              <text x="83" y="59">VOL <tspan>{fmt(tooltip.candle.volume ?? 0, 0)}</tspan></text>
            </g>
          )}
        </svg>
      </div>

      <div className="chart-legend workstation-legend">
        <span><i className="legend-up" /> Bullish</span>
        <span><i className="legend-down" /> Bearish</span>
        <span><i className="legend-fvg" /> FVG</span>
        <span><i className="legend-ob" /> Order block</span>
        <span><i className="legend-liquidity" /> Liquidity</span>
        <span><i className="legend-price" /> Current price</span>
        <span>{live ? "Validated live feed" : "Last validated feed"}</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  icon,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        {icon}
        {label}
      </div>
      <div className={`metric-value ${valueClass ?? ""}`}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function CheckList({ checks }: { checks: Record<string, boolean> }) {
  return (
    <div className="check-list">
      {Object.entries(checks).map(([key, value]) => (
        <div className={`check-row ${value ? "pass" : "fail"}`} key={key}>
          {value ? <CheckCircle2 size={15} /> : <X size={15} />}
          <span>{key.replace(/([A-Z])/g, " $1")}</span>
          <b>{value ? "PASS" : "BLOCK"}</b>
        </div>
      ))}
    </div>
  );
}

function feedDisplayState(
  feed: any,
  streaming: boolean,
): {
  label: string;
  tone: "positive" | "negative" | "neutral";
  description: string;
  chartLive: boolean;
} {
  if (!streaming) {
    return {
      label: "RECONNECTING",
      tone: "negative",
      description: "Live stream connection is reconnecting. Trading remains blocked.",
      chartLive: false,
    };
  }

  if (!feed) {
    return {
      label: "DISCONNECTED",
      tone: "negative",
      description: "No validated market feed is available.",
      chartLive: false,
    };
  }

  if (feed.stale || feed.connection === "DEGRADED") {
    return {
      label: "STALE / DEGRADED",
      tone: "negative",
      description: "Last validated data is retained for context; live execution is blocked.",
      chartLive: false,
    };
  }

  if (feed.connection === "CONNECTED" && feed.tradingAllowed === true) {
    return {
      label: "LIVE VALIDATED",
      tone: "positive",
      description: "Fresh provider data passed feed validation.",
      chartLive: true,
    };
  }

  return {
    label: "CONNECTED / BLOCKED",
    tone: "neutral",
    description: feed.reason ?? "Market feed is connected but execution remains blocked.",
    chartLive: false,
  };
}

export default function Home() {
  const [symbol, setSymbol] = useState<MarketSymbol>("XAUUSD");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [user, setUser] = useState<User>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const [commandText, setCommandText] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState(
    "Waiting for validated market intelligence.",
  );
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestError, setBacktestError] = useState("");
  const [backtestTimeframe, setBacktestTimeframe] = useState("1min");
  const [researchBusy, setResearchBusy] = useState(false);
  const [research, setResearch] = useState<any>(null);
  const [researchError, setResearchError] = useState("");
  const [researchStart, setResearchStart] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [researchEnd, setResearchEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [section, setSection] = useState<
    (typeof NAV)[number][0]
  >("overview");
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const eventSource = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/nine/dashboard?symbol=${symbol}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as Dashboard;
      setDashboard(data);
      setActionMessage(
        data.orchestration?.commandSummary ??
          data.error ??
          "Waiting for validated market intelligence.",
      );
    } catch {
      setActionMessage("Dashboard request failed.");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    let active = true;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active) setUser(data.user ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAuthChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();

    eventSource.current?.close();
    const es = new EventSource(
      `/api/stream/market?symbol=${symbol}`,
    );
    eventSource.current = es;

    es.addEventListener("market", (event) => {
      try {
        const data = JSON.parse(
          (event as MessageEvent).data,
        );
        setDashboard((current) => ({
          ...(current ?? {}),
          ok: true,
          version: data.version,
          symbol: data.symbol,
          market: data.market,
          feed: data.feed,
          runtime: data.runtime,
          orchestration: data.orchestration,
          decisionEngine: data.decisionEngine,
          paperLoop: data.paperLoop,
          account: data.account,
          orders: data.orders,
          chart: data.chart,
          v27: {
            commandCenter: {
              status: data.orchestration?.v26?.brain?.action,
              executionMode: data.orchestration?.executionMode,
              tradingAllowed:
                data.feed?.tradingAllowed === true &&
                data.market?.tradingAllowed === true,
            },
            brain: data.orchestration?.v26?.brain,
            setup: data.orchestration?.v26?.setup,
            marketHealth:
              data.orchestration?.v26?.marketHealth,
            risk:
              data.orchestration?.v26?.riskTelemetry,
            events:
              data.orchestration?.v26?.signalEvents,
          },
        }));
        setStreaming(true);
        setLoading(false);
      } catch {
        setStreaming(false);
        setActionMessage("Received an invalid market frame.");
      }
    });

    es.addEventListener("market_error", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setStreaming(false);
        setDashboard((current) => ({
          ...(current ?? {}),
          ok: false,
          version: data.version ?? current?.version,
          symbol,
          feed: data.feed ?? {
            connection: "DISCONNECTED",
            stale: true,
            tradingAllowed: false,
            reason: data.message ?? "Market stream unavailable.",
          },
          v27: {
            ...(current?.v27 ?? {}),
            commandCenter: {
              ...(current?.v27?.commandCenter ?? {}),
              status: "BLOCKED",
              executionMode: "PAPER",
              tradingAllowed: false,
            },
            brain: {
              ...(current?.v27?.brain ?? {}),
              action: "BLOCKED",
              direction: "NONE",
              confidence: 0,
              blockers: [data.message ?? "Market stream unavailable."],
            },
            marketHealth: {
              state: "BLOCKED",
              tradingAllowed: false,
              feedAgeSeconds: Infinity,
              latencyMs: null,
              reasons: [data.message ?? "Market stream unavailable."],
            },
            events: data.events ?? [{
              type: "MARKET_DEGRADED",
              message: `Signal engine blocked: ${data.message ?? "Market stream unavailable."}`,
              timestamp: Date.now(),
            }],
          },
        }));
        setActionMessage(data.message ?? "Market stream unavailable. Reconnecting…");
      } catch {
        setStreaming(false);
        setActionMessage("Market stream unavailable. Reconnecting…");
      }
    });

    es.addEventListener("error", () => {
      setStreaming(false);
      setActionMessage("Live stream reconnecting…");
    });

    return () => {
      es.close();
    };
  }, [load, symbol]);

  useEffect(() => {
    return () => recognition.current?.stop();
  }, []);

  const market = dashboard?.market;
  const setup = dashboard?.orchestration?.setup;
  const v27 = dashboard?.v27;
  const sentinel = dashboard?.orchestration?.sentinel;
  const atlas = dashboard?.orchestration?.atlas;
  const chartist = setup?.smc?.chartist;
  const agents = dashboard?.agents;
  const workstation = dashboard?.workstation;
  const decisionEngine = dashboard?.decisionEngine;
  const paperLoop = dashboard?.paperLoop;
  const account = dashboard?.account;
  const feed = dashboard?.feed;
  const feedState = feedDisplayState(feed, streaming);
  const risk = v27?.risk ?? sentinel?.risk;
  const events = v27?.events ?? [];
  const openPositions: Position[] = useMemo(
    () =>
      (account?.positions ?? []).filter(
        (position: Position) =>
          position.status === "OPEN",
      ),
    [account],
  );

  const commandSuggestions = [
    "Analyze gold",
    "Analyze current setup",
    "Show market status",
    "Paper trade XAUUSD",
  ];

  const submitCommand = async (text: string) => {
    const value = text.trim();
    if (!value || commandBusy) return;

    if (!user) {
      setLoginError("Login is required for commands.");
      return;
    }

    setCommandBusy(true);
    setActionMessage("NINE is processing the command…");

    try {
      const response = await fetch(
        "/api/nine/command",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: value, symbol }),
        },
      );
      const data = await response.json();

      if (response.status === 401) {
        setUser(null);
      }

      const message =
        data.message ??
        data.orchestration?.commandSummary ??
        data.error ??
        "Command completed.";

      setActionMessage(message);
      setCommands((current) => [
        {
          id: Date.now(),
          text: value,
          message,
          timestamp: Date.now(),
        },
        ...current,
      ].slice(0, 8));
      await load();
    } catch {
      setActionMessage("Command endpoint unavailable.");
    } finally {
      setCommandBusy(false);
    }
  };

  const submitCommandForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCommand(commandText);
    setCommandText("");
  };

  const startVoice = () => {
    if (!user) {
      setLoginError("Login is required for voice commands.");
      return;
    }

    const Constructor =
      window.SpeechRecognition ??
      window.webkitSpeechRecognition;

    if (!Constructor) {
      setActionMessage(
        "Voice recognition is not available in this browser.",
      );
      return;
    }

    recognition.current?.stop();

    const instance = new Constructor();
    instance.lang = "en-US";
    instance.interimResults = true;
    instance.continuous = false;

    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(
          (result: any) =>
            result[0]?.transcript ?? "",
        )
        .join(" ")
        .trim();

      setVoiceText(transcript);

      if (
        event.results[
          event.results.length - 1
        ]?.isFinal
      ) {
        void submitCommand(transcript);
      }
    };

    instance.onend = () => setVoiceOn(false);
    instance.onerror = () => {
      setVoiceOn(false);
      setActionMessage("Voice recognition stopped.");
    };

    recognition.current = instance;
    setVoiceText("");
    setVoiceOn(true);
    instance.start();
  };

  const stopVoice = () => {
    recognition.current?.stop();
    setVoiceOn(false);
  };

  const loginSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setLoginError("");

    try {
      const response = await fetch(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(login),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        setLoginError(
          data.error ?? "Login failed.",
        );
        return;
      }

      setUser(data.user);
      setLogin((current) => ({
        ...current,
        password: "",
      }));
    } catch {
      setLoginError("Authentication endpoint unavailable.");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
    });
    setUser(null);
    setActionMessage(
      "Signed out. Market intelligence remains read-only.",
    );
  };

  const runHistoricalResearch = useCallback(async () => {
    if (!user) return;
    setResearchBusy(true);
    setResearchError("");
    try {
      const response = await fetch("/api/strategy-lab/historical", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe: backtestTimeframe,
          startDate: researchStart,
          endDate: researchEnd,
          folds: 4,
          monteCarloSimulations: 1000,
          targetWinRate: 90,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Historical research failed.");
      setResearch(data.result);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Historical research failed.");
    } finally {
      setResearchBusy(false);
    }
  }, [backtestTimeframe, researchEnd, researchStart, symbol, user]);

  const runBacktest = async () => {
    if (!user) {
      setLoginError("Login is required for backtesting.");
      return;
    }

    setBacktestBusy(true);
    setBacktestError("");
    setActionMessage("Running replay on validated historical candles…");

    try {
      const response = await fetch(
        `/api/backtest/v2?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(backtestTimeframe)}&initialBalance=10000&riskPercent=0.5`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setUser(null);
      }

      if (!response.ok || data.ok !== true || !data.result) {
        const message = data.error ?? `Backtest failed with HTTP ${response.status}.`;
        setBacktest(null);
        setBacktestError(message);
        setActionMessage(message);
        return;
      }

      const result = data.result;
      setBacktest({
        totalTrades: Number(result.totalTrades ?? 0),
        wins: Number(result.wins ?? 0),
        losses: Number(result.losses ?? 0),
        winRate: Number(result.winRate ?? 0),
        netPnl: Number(result.netPnl ?? 0),
        maxDrawdown: Number(result.maxDrawdownPercent ?? result.maxDrawdown ?? 0),
        profitFactor: Number(result.profitFactor ?? 0),
        finalBalance: Number(result.finalBalance ?? (result.initialBalance ?? 10000) + (result.netPnl ?? 0)),
        initialBalance: Number(result.initialBalance ?? 10000),
        averageWin: Number(result.averageWin ?? 0),
        averageLoss: Number(result.averageLoss ?? 0),
        expectancy: Number(result.expectancy ?? 0),
        sessionStats: result.sessionStats ?? {},
        trades: Array.isArray(result.trades) ? result.trades : [],
      });
      setActionMessage(
        `Backtest completed using ${data.candlesUsed ?? "validated"} candles from ${data.source ?? "validated data"}.`,
      );
    } catch {
      const message = "Backtest endpoint unavailable. Check the market-data provider and try again.";
      setBacktest(null);
      setBacktestError(message);
      setActionMessage(message);
    } finally {
      setBacktestBusy(false);
    }
  };

  const status = v27?.brain?.action ?? "WATCH";
  const marketHealth =
    v27?.marketHealth?.state ?? "BLOCKED";
  const gateOpen =
    sentinel?.approved === true &&
    v27?.marketHealth?.tradingAllowed === true &&
    status === "PAPER_READY";

  const latestCandle = dashboard?.chart?.at(-1);
  const previousCandle =
    dashboard?.chart?.at(-2);
  const liveMove =
    latestCandle && previousCandle
      ? ((latestCandle.close -
          previousCandle.close) /
          previousCandle.close) *
        100
      : market?.changePercent;

  const selectSection = (
    value: (typeof NAV)[number][0],
  ) => {
    setSection(value);
    document
      .getElementById(`section-${value}`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  };

  if (!authChecked) {
    return (
      <main className="nine-app loading-app">
        <div className="loading-mark">N</div>
        <div className="eyebrow">
          INITIALIZING NINE V2.10.1
        </div>
        <p>Loading protected command center…</p>
      </main>
    );
  }

  return (
    <main className="nine-app xau-terminal">
      <header className="xau-topbar">
        <div className="xau-brand"><div className="xau-logo">N</div><div><b>NINE</b><span>XAUUSD AUTONOMOUS PAPER DESK · V4.4</span></div></div>
        <div className="xau-instrument"><span className="xau-kicker">PRIMARY INSTRUMENT</span><strong>XAUUSD</strong><span>GOLD / US DOLLAR</span></div>
        <div className="xau-price"><strong>{fmt(market?.price, 2)}</strong><span className={liveMove >= 0 ? "xau-up" : "xau-down"}>{signed(liveMove)} · {feedState.label}</span></div>
        <div className="xau-top-status"><span className={streaming ? "xau-live-dot" : "xau-live-dot off"} />{streaming ? "LIVE DATA" : "DATA DEGRADED"}<button type="button" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={15} /></button>{user && <button type="button" onClick={() => void logout()} className="xau-signout"><LogOut size={13} /> EXIT</button>}</div>
      </header>
      <div className="xau-modebar"><div><span className="xau-mode-dot" /> AUTONOMOUS PAPER LOOP <b>{paperLoop?.state ?? "INITIALIZING"}</b></div><div><span>SESSION</span><b>{decisionEngine?.session ?? "—"}</b></div><div><span>LIFECYCLE</span><b>{decisionEngine?.lifecycle ?? "WATCH"}</b></div><div><span>POSITION</span><b>{paperLoop?.positionId ? String(paperLoop.positionId).slice(0, 16) : "NONE"}</b></div><div><span>LIVE BROKER</span><b className="xau-blocked">LOCKED</b></div></div>
      <div className="xau-shell">
        <aside className="xau-left">
          <section className="xau-panel xau-brain"><div className="xau-panel-head"><span><Brain size={14} /> NINE BRAIN</span><span className="xau-pulse" /></div><div className="brain-state">{status}</div><div className="brain-direction">{v27?.brain?.direction ?? "NONE"}</div><p>{v27?.brain?.rationale ?? "Waiting for validated market intelligence."}</p><div className="xau-confidence"><span>CONFIDENCE</span><b>{fmt(v27?.brain?.confidence, 0)}%</b></div><div className="xau-progress"><i /></div></section>
          <section className="xau-panel"><div className="xau-panel-head"><span>MARKET STATE</span></div><div className="xau-state-row"><span>SESSION</span><b>{chartist?.session ?? "—"}</b></div><div className="xau-state-row"><span>HTF BIAS</span><b>{chartist?.higherTimeframeBias ?? "NONE"}</b></div><div className="xau-state-row"><span>TREND</span><b>{setup?.technical?.trend ?? "—"}</b></div><div className="xau-state-row"><span>REGIME</span><b>{setup?.technical?.volatility ?? setup?.smc?.volatilityState ?? "—"}</b></div><div className="xau-state-row"><span>PRICE ZONE</span><b>{setup?.smc?.premiumDiscount ?? "—"}</b></div></section>
          <section className="xau-panel"><div className="xau-panel-head"><span><Sparkles size={14} /> SMART MONEY</span></div><SignalRow label="Liquidity Sweep" value={setup?.smc?.liquiditySweep ? setup.smc.sweepDirection : "NONE"} /><SignalRow label="MSS / CHoCH" value={setup?.smc?.marketStructureShift ? setup.smc.structureDirection : "NONE"} /><SignalRow label="Fair Value Gap" value={setup?.smc?.fairValueGap ? "DETECTED" : "NONE"} /><SignalRow label="Order Block" value={setup?.smc?.orderBlock ? "DETECTED" : "NONE"} /><SignalRow label="Structure" value={setup?.smc?.structureDirection ?? "NONE"} /></section>
          <section className="xau-panel xau-loop-panel"><div className="xau-panel-head"><span><Zap size={14} /> AUTONOMOUS LOOP</span><b>{paperLoop?.state ?? "WAITING"}</b></div><div className="xau-loop-steps">{["DETECTED","VALIDATED","TRACKING","ENTERED","MANAGING","CLOSED"].map((step:string) => <div key={step} className={"xau-loop-step " + (step === paperLoop?.state || (step === "ENTERED" && paperLoop?.state === "MANAGING") || (step === "MANAGING" && paperLoop?.state === "CLOSED") ? "active" : ["DETECTED","VALIDATED","TRACKING","ENTERED","MANAGING"].indexOf(step) < ["DETECTED","VALIDATED","TRACKING","ENTERED","MANAGING","CLOSED"].indexOf(paperLoop?.state ?? "") ? "done" : "")}><i /> <span>{step}</span></div>)}</div><p>{paperLoop?.entry?.message ?? "NINE is waiting for a validated XAUUSD setup."}</p><small>Continuous paper execution · Sentinel gated · no broker order</small></section>
          <section className="xau-panel xau-command"><div className="xau-panel-head"><span><Command size={14} /> TALK TO NINE</span><Mic size={14} /></div><form onSubmit={submitCommandForm}><input value={commandText} onChange={e => setCommandText(e.target.value)} placeholder="Ask: analyze gold…" maxLength={500} /><button type="submit" disabled={commandBusy}><Zap size={15} /></button></form><div className="xau-command-chips">{["Analyze gold","Analyze current setup","Show market status"].map(item => <button key={item} type="button" onClick={() => void submitCommand(item)}>{item}</button>)}</div><button type="button" className={voiceOn ? "xau-voice active" : "xau-voice"} onClick={voiceOn ? stopVoice : startVoice}>{voiceOn ? <MicOff size={14} /> : <Mic size={14} />} {voiceOn ? "LISTENING…" : "VOICE COMMAND"}</button></section>
        </aside>
        <section className="xau-center">
          <div className="xau-chart-header"><div><span className="xau-kicker">MARKET STRUCTURE ENGINE</span><h1>XAUUSD <em>{fmt(market?.price, 2)}</em></h1><p>{setup?.technical?.structure ?? "Awaiting structure analysis."}</p></div><div className="xau-chart-tags"><span>LIQUIDITY</span><span>FVG</span><span>ORDER BLOCK</span><span>MSS / CHoCH</span></div></div>
          <div className="xau-chart-card"><CandlestickChart candles={dashboard?.chart ?? []} live={streaming && feed?.tradingAllowed === true} chartist={chartist} setup={setup} workstation={workstation} decisionEngine={decisionEngine} height={500} /></div>
          <div className="xau-intel-grid"><section className="xau-panel xau-lifecycle"><div className="xau-panel-head"><span>SETUP LIFECYCLE</span><b className={`xau-life-${String(decisionEngine?.lifecycle ?? "WATCH").toLowerCase()}`}>{decisionEngine?.lifecycle ?? "WATCH"}</b></div><div className="xau-life-track"><span className={["WATCH","FORMING","PAPER_READY","BLOCKED","PAPER_ACTIVE","EXPIRED"].includes(workstation?.lifecycle) ? "on" : ""}>WATCH</span><i /><span className={["FORMING","PAPER_READY","PAPER_ACTIVE"].includes(workstation?.lifecycle) ? "on" : ""}>FORMING</span><i /><span className={["PAPER_READY","PAPER_ACTIVE"].includes(workstation?.lifecycle) ? "on" : ""}>READY</span></div><div className="xau-session-strip"><b>{decisionEngine?.session ?? decisionEngine?.session ?? "OFF_SESSION"}</b><span>{decisionEngine?.sessionPhase ?? "RANGE MAPPING"}</span></div><p>{decisionEngine?.sessionRule ?? workstation?.nextTrigger ?? "Awaiting next validated trigger."}</p><small>{decisionEngine?.invalidation?.reason ?? decisionEngine?.invalidation?.reason ?? "No active invalidation rule."}</small></section><section className="xau-panel xau-evidence-ledger"><div className="xau-panel-head"><span>EVIDENCE LEDGER</span><span>{workstation?.confluenceScore ?? 0}/100</span></div>{(decisionEngine?.evidenceChain ?? workstation?.evidence ?? []).slice(0,7).map((item:any,i:number)=><div className="xau-ledger-row" key={item.id ?? i}><b>{item.source}</b><span className={`ledger-${String(item.strength ?? item.state ?? "").toLowerCase()}`}>{item.strength ?? item.state ?? "—"}</span><p>{item.evidence ?? item.signal}</p></div>)}</section></div>
          <div className="xau-analysis-tabs"><div className="xau-analysis-title"><Brain size={15} /> MULTI-AGENT ANALYSIS <span className="xau-agent-authority">{agents?.decision ?? "WATCHING"} · SENTINEL ONLY</span></div><div className="xau-agent-grid">{(agents?.messages ?? dashboard?.orchestration?.agentReports ?? []).map((agent: any, i: number) => <article className={`xau-agent xau-agent-${String(agent.status ?? "ONLINE").toLowerCase()}`} key={agent.id ?? i}><div className="xau-agent-top"><b>{agent.name ?? agent.agent ?? agent.id}</b><span>{agent.status ?? "—"}</span></div><strong>{agent.confidence != null ? agent.confidence + "% confidence" : "No confidence"}</strong><p>{agent.summary ?? "No validated report."}</p><div className="xau-evidence">{(agent.evidence ?? agent.signals ?? []).slice(0,3).map((s: string, j: number) => <span key={j}>{s}</span>)}</div></article>)}</div></div>
          <div className="xau-debate"><div className="xau-battle-head"><span><Brain size={15} /> AGENT DEBATE</span><small>Independent evidence → challenge → synthesis</small></div><div className="xau-debate-grid">{(decisionEngine?.debate ?? []).map((item:any,i:number)=><article className={`xau-debate-card debate-${String(item.stance ?? "CHALLENGE").toLowerCase()}`} key={item.agent ?? i}><div><b>{item.agent}</b><span>{item.stance}</span></div><p>{item.message}</p><div>{(item.evidence ?? []).slice(0,3).map((e:string,j:number)=><small key={j}>{e}</small>)}</div></article>)}</div></div>
          <div className="xau-event-timeline"><div className="xau-battle-head"><span><Bell size={15} /> SMC EVENT TIMELINE</span><small>{(decisionEngine?.events ?? []).length} validated events</small></div><div className="xau-event-stream">{(decisionEngine?.events ?? []).slice(0,10).map((item:any,i:number)=><article key={item.id ?? i} className={`decision-timeline-${String(item.importance ?? "LOW").toLowerCase()}`}><div className="xau-event-time">{new Date(Number(item.timestamp)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div><div className="xau-event-node" /><div><b>{item.title}</b><p>{item.detail}</p><small>{item.source} · {item.direction}</small></div></article>)}</div></div>
          <div className="xau-battle"><div className="xau-battle-head"><span><Activity size={15} /> BULL vs BEAR ENGINE</span><small>Evidence, not prediction</small></div><div className="xau-battle-grid"><article className="xau-bull"><div><b>BULL CASE</b><span>{setup?.direction === "LONG" ? "ACTIVE" : "NOT CONFIRMED"}</span></div><p>{setup?.direction === "LONG" ? "Current validated evidence supports a bullish setup." : "No validated long confluence at the current snapshot."}</p><ul><li>Trend: {setup?.technical?.trend ?? "—"}</li><li>Structure: {setup?.smc?.structureDirection ?? "—"}</li><li>HTF: {chartist?.higherTimeframeBias ?? "—"}</li></ul></article><article className="xau-bear"><div><b>BEAR CASE</b><span>{setup?.direction === "SHORT" ? "ACTIVE" : "NOT CONFIRMED"}</span></div><p>{setup?.direction === "SHORT" ? "Current validated evidence supports a bearish setup." : "No validated short confluence at the current snapshot."}</p><ul><li>Trend: {setup?.technical?.trend ?? "—"}</li><li>Structure: {setup?.smc?.structureDirection ?? "—"}</li><li>Premium/Discount: {setup?.smc?.premiumDiscount ?? "—"}</li></ul></article></div></div>
        </section>
        <aside className="xau-right">
          <section className="xau-panel xau-decision"><div className="xau-panel-head"><span><Target size={14} /> SETUP ENGINE</span><StatusPill value={setup?.status ?? "WATCHING"} /></div><div className="xau-life-chip">{decisionEngine?.lifecycle ?? "WATCH"} · {decisionEngine?.session ?? "OFF_SESSION"}</div><div className="xau-decision-direction">{setup?.direction ?? "NONE"}</div><div className="xau-decision-grid"><Metric label="ENTRY" value={fmt(setup?.entry,2)} /><Metric label="STOP LOSS" value={fmt(setup?.stopLoss,2)} /><Metric label="TAKE PROFIT" value={fmt(setup?.takeProfit,2)} /><Metric label="R:R" value={fmt(setup?.riskReward,2)} /></div><div className="xau-score"><span>VALIDATION SCORE</span><b>{fmt(setup?.validation?.score,0)}/100</b></div>{(setup?.validation?.blockers ?? []).slice(0,4).map((b: string,i:number)=><div className="xau-blocker" key={i}><AlertTriangle size={12}/>{b}</div>)}</section>
          <section className="xau-panel xau-atlas"><div className="xau-panel-head"><span><Radio size={14}/> ATLAS · MACRO</span><span>{atlas?.sourceStatus ?? "—"}</span></div><div className="xau-macro-bias">{atlas?.bias ?? "NEUTRAL"}</div><p>{atlas?.summary ?? "Macro/news context is unavailable for this snapshot."}</p><div className="xau-headlines">{(atlas?.headlines ?? []).slice(0,4).map((h:any,i:number)=><div key={i}><b>{h.sentiment ?? "—"}</b><span>{h.title ?? "Untitled headline"}</span></div>)}</div></section>
          <section className="xau-panel xau-sentinel"><div className="xau-panel-head"><span><Shield size={14}/> SENTINEL</span><span className={sentinel?.approved ? "xau-approved" : "xau-blocked"}>{sentinel?.approved ? "APPROVED" : "BLOCKED"}</span></div><div className="xau-lock">PAPER ONLY</div><p>{sentinel?.reason ?? "Sentinel authorization unavailable."}</p><div className="xau-safety-list"><div><span>LIVE BROKER</span><b className="xau-blocked">LOCKED</b></div><div><span>EXECUTION</span><b>PAPER</b></div><div><span>RISK</span><b>{fmt(risk?.exposurePercent,2)}%</b></div><div><span>DRAWDOWN</span><b>{fmt(risk?.drawdownPercent,2)}%</b></div></div></section>
          <section className="xau-panel xau-paper-account"><div className="xau-panel-head"><span><CircleDollarSign size={14}/> PAPER ACCOUNT</span><b>LIVE SIMULATION</b></div><div className="xau-account-grid"><Metric label="EQUITY" value={fmt(paperLoop?.account?.equity,2)} /><Metric label="BALANCE" value={fmt(paperLoop?.account?.balance,2)} /><Metric label="REALIZED" value={fmt(paperLoop?.account?.realizedPnl,2)} /><Metric label="UNREALIZED" value={fmt(paperLoop?.account?.unrealizedPnl,2)} /></div><div className="xau-paper-position"><div><span>STATE</span><b>{paperLoop?.state ?? "WATCH"}</b></div><div><span>POSITION</span><b>{paperLoop?.positionId ? String(paperLoop.positionId).slice(0,12) : "—"}</b></div><div><span>TRANSITIONS</span><b>{paperLoop?.history?.length ?? 0}</b></div></div></section>
          <section className="xau-panel xau-tracking"><div className="xau-panel-head"><span><Target size={14}/> PAPER SETUP TRACKER</span><span>{decisionEngine?.tracking?.setupId ? String(decisionEngine.tracking.setupId).slice(0,8) : "—"}</span></div><div className="xau-tracking-state"><b>{decisionEngine?.tracking?.lifecycle ?? "WATCH"}</b><span>{decisionEngine?.tracking?.ageSeconds ?? 0}s tracked</span></div><div className="xau-safety-list"><div><span>DIRECTION</span><b>{decisionEngine?.tracking?.direction ?? "NONE"}</b></div><div><span>PAPER POSITION</span><b>{decisionEngine?.tracking?.matchedPaperPositionId ? "MATCHED" : "NONE"}</b></div><div><span>ENTRY</span><b>{fmt(decisionEngine?.tracking?.entry,2)}</b></div><div><span>STATUS</span><b>{decisionEngine?.tracking?.statusReason ?? "—"}</b></div></div></section>
          <section className="xau-panel xau-events"><div className="xau-panel-head"><span><Bell size={14}/> LIVE EVENTS</span><span>{events.length}</span></div>{events.slice(0,5).map((event:any,i:number)=><div className="xau-event" key={i}><span>{event.type ?? "EVENT"}</span><p>{event.message ?? "Signal event."}</p></div>)}{!events.length && <p className="xau-muted">No new validated events.</p>}</section>
        </aside>
      </div>
      <footer className="xau-footer"><span>NINE XAUUSD AUTONOMOUS PAPER DESK · V4.4</span><span>{feed?.provider ?? "—"} · {feedState.label}</span><span>LIVE BROKER <b className="xau-blocked">HARD LOCKED</b></span></footer>
      {!user && <div className="auth-overlay"><form className="auth-card" onSubmit={loginSubmit}><div className="auth-mark">N</div><div className="eyebrow">NINE SECURE ACCESS</div><h2>Sign in to control NINE</h2><p>Market intelligence remains visible, while commands and paper execution require authentication.</p><input value={login.email} onChange={event => setLogin({...login,email:event.target.value})} placeholder="Admin email" type="email" autoComplete="username" required /><input value={login.password} onChange={event => setLogin({...login,password:event.target.value})} placeholder="Password" type="password" autoComplete="current-password" required />{loginError && <div className="login-error"><AlertTriangle size={14}/>{loginError}</div>}<button className="login-button" type="submit">AUTHENTICATE</button></form></div>}
    </main>
  );


function SignalRow({label,value}:{label:string;value:unknown}){const textValue=String(value??"NONE");const active=!["NONE","FALSE","UNDEFINED","NULL"].includes(textValue.toUpperCase());return <div className="xau-signal-row"><span>{label}</span><b className={active?"active":""}>{textValue}</b></div>}
function Metric({label,value}:{label:string;value:string}){return <div className="xau-metric"><span>{label}</span><b>{value}</b></div>}

}
