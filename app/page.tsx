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
  height = 440,
}: {
  candles: Candle[];
  live: boolean;
  chartist?: any;
  setup?: any;
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
    <main className="nine-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="brand-name">NINE</div>
            <div className="brand-version">
              AI TRADING DESK · MAX 3.0
            </div>
          </div>
        </div>

        <nav className="main-nav" aria-label="NINE sections">
          {NAV.map(([id, label]) => (
            <button
              key={id}
              className={
                section === id
                  ? "nav-button active"
                  : "nav-button"
              }
              onClick={() => selectSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <div className={`stream-status ${feedState.tone}`}>
            <span className={`live-dot ${feedState.tone !== "positive" ? "offline" : ""}`} />
            {feedState.label}
          </div>
          <button
            className="icon-button"
            onClick={() => void load()}
            title="Refresh dashboard"
          >
            <RefreshCw size={15} />
          </button>
          {user && (
            <button
              className="signout"
              onClick={() => void logout()}
            >
              <LogOut size={13} />
              SIGN OUT
            </button>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-block">
            <div className="eyebrow">MARKET UNIVERSE</div>
            <div className="symbol-list">
              {SYMBOLS.map((item) => (
                <button
                  key={item.value}
                  className={
                    symbol === item.value
                      ? "symbol-button active"
                      : "symbol-button"
                  }
                  onClick={() =>
                    setSymbol(item.value)
                  }
                >
                  <span>
                    <b>{item.label}</b>
                    <small>{item.description}</small>
                  </span>
                  {symbol === item.value && (
                    <span className="selected-dot" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-block command-block">
            <div className="eyebrow">
              <Command size={12} /> NINE COMMAND
            </div>

            <form
              className="command-form"
              onSubmit={submitCommandForm}
            >
              <input
                value={commandText}
                onChange={(event) =>
                  setCommandText(event.target.value)
                }
                placeholder="Ask NINE…"
                maxLength={500}
              />
              <button
                type="submit"
                disabled={commandBusy || !commandText.trim()}
              >
                <Zap size={14} />
              </button>
            </form>

            <div className="suggestion-list">
              {commandSuggestions.map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() =>
                      void submitCommand(
                        suggestion,
                      )
                    }
                  >
                    {suggestion}
                  </button>
                ),
              )}
            </div>

            <div className="voice-controls">
              <button
                className={
                  voiceOn
                    ? "voice-button active"
                    : "voice-button"
                }
                onClick={
                  voiceOn
                    ? stopVoice
                    : startVoice
                }
              >
                {voiceOn ? (
                  <MicOff size={14} />
                ) : (
                  <Mic size={14} />
                )}
                {voiceOn
                  ? "STOP VOICE"
                  : "VOICE COMMAND"}
              </button>
            </div>

            {voiceText && (
              <div className="voice-transcript">
                “{voiceText}”
              </div>
            )}
          </div>

          <div className="sidebar-block safety-card">
            <div className="eyebrow">
              <Shield size={12} /> SAFETY
            </div>
            <div className="safety-row">
              <span>Execution mode</span>
              <b>PAPER</b>
            </div>
            <div className="safety-row">
              <span>Live broker</span>
              <b className="locked">
                {dashboard?.runtime
                  ?.liveTradingEnabled
                  ? "CONFIGURED"
                  : "LOCKED"}
              </b>
            </div>
            <div className="safety-row">
              <span>Sentinel gate</span>
              <b
                className={
                  sentinel?.approved
                    ? "approved"
                    : "locked"
                }
              >
                {sentinel?.approved
                  ? "READY"
                  : "BLOCKED"}
              </b>
            </div>
          </div>
        </aside>

        <div className="content">
          <section
            id="section-overview"
            className="hero-section"
          >
            <div className="hero-copy">
              <div className="eyebrow">
                NINE MAX COMMAND CENTER ·{" "}
                {dashboard?.version ?? "3.0.0"}
              </div>
              <h1>
                One desk.
                <br />
                <span>Six layers of intelligence.</span>
              </h1>
              <p>
                Validated market data flows through
                Chartist, Atlas, the setup engine,
                NINE Brain and Sentinel before paper
                execution can be considered.
              </p>
            </div>

            <div className="hero-state">
              <div className="state-top">
                <StatusPill value={marketHealth} />
                <span className="state-time">
                  {loading
                    ? "SYNCING…"
                    : new Date().toLocaleTimeString()}
                </span>
              </div>
              <div className="hero-price">
                {fmt(market?.price, 2)}
              </div>
              <div className="hero-symbol">
                {symbol} ·{" "}
                {feed?.provider ?? "—"} ·{" "}
                <span
                  className={
                    liveMove >= 0
                      ? "positive-text"
                      : "negative-text"
                  }
                >
                  {signed(liveMove)}
                </span>
              </div>
              <div className={`hero-feed-state ${feedState.tone}`}>
                <span className="status-pill-dot" />
                {feedState.label} · {feedState.description}
              </div>
            </div>
          </section>

          <section className="max-cockpit">
            <div className="max-cockpit-head">
              <div>
                <div className="eyebrow"><Sparkles size={12} /> NINE MAX OPERATING SYSTEM</div>
                <h2>Research. Decide. Protect. Learn.</h2>
                <p>One unified surface for market intelligence, strategy research, paper execution and safety telemetry.</p>
              </div>
              <div className="max-mode">
                <span>EXECUTION</span>
                <b>PAPER ONLY</b>
                <small>LIVE BROKER HARD LOCKED</small>
              </div>
            </div>
            <div className="max-layer-grid">
              <div className="max-layer"><span>01</span><b>MARKET</b><StatusPill value={feed?.connection ?? "UNKNOWN"} /><small>{feed?.priceSource ?? "—"} · {feed?.ageSeconds != null ? fmt(feed.ageSeconds, 0) + "s" : "no age"}</small></div>
              <div className="max-layer"><span>02</span><b>CHARTIST</b><StatusPill value={setup?.lifecycle ?? "WATCHING"} /><small>{v27?.setup?.confluenceScore ?? setup?.confidence ?? 0}% confluence</small></div>
              <div className="max-layer"><span>03</span><b>LEARNING</b><StatusPill value={dashboard?.strategyLab?.regime ?? "MIXED"} /><small>{dashboard?.strategyLab?.conceptCoverage ?? 0}% concept window</small></div>
              <div className="max-layer"><span>04</span><b>MEMORY</b><StatusPill value={(dashboard?.strategyMemory?.length ?? 0) ? "ACTIVE" : "EMPTY"} /><small>{dashboard?.strategyMemory?.length ?? 0} evidence records</small></div>
              <div className="max-layer"><span>05</span><b>SENTINEL</b><StatusPill value={sentinel?.approved ? "APPROVED" : "BLOCKED"} /><small>{risk?.openPositions ?? 0} open · {fmt(risk?.drawdownPercent, 2)}% DD</small></div>
              <div className="max-layer"><span>06</span><b>RECON</b><StatusPill value={dashboard?.paperReconciliation?.healthy ? "HEALTHY" : dashboard?.paperReconciliation ? "CHECK" : "UNKNOWN"} /><small>score {dashboard?.paperReconciliation?.score ?? "—"}/100</small></div>
            </div>
          </section>

          <section className="metric-grid">
            <Metric
              label="NINE DECISION"
              value={
                <StatusPill value={status} />
              }
              sub={
                v27?.brain?.rationale ??
                "Waiting for validated setup."
              }
              icon={<Brain size={14} />}
            />
            <Metric
              label="SENTINEL"
              value={
                <StatusPill
                  value={
                    sentinel?.approved
                      ? "APPROVED"
                      : "BLOCKED"
                  }
                />
              }
              sub={
                sentinel?.reason ??
                "Risk gate unavailable."
              }
              icon={<Shield size={14} />}
            />
            <Metric
              label="SETUP"
              value={
                setup?.lifecycle ?? "WATCHING"
              }
              sub={`Confluence ${
                v27?.setup?.confluenceScore ??
                setup?.confidence ??
                0
              }%`}
              icon={<Target size={14} />}
            />
            <Metric
              label="DATA"
              value={
                <StatusPill
                  value={
                    feed?.connection ??
                    "DISCONNECTED"
                  }
                />
              }
              sub={
                feed?.reason ??
                "Waiting for market feed."
              }
              icon={<Radio size={14} />}
            />
          </section>

          <section className="provider-diagnostics-panel">
            <div className="provider-diagnostics-header">
              <div>
                <div className="eyebrow">PROVIDER CONTROL</div>
                <h3>Twelve Data request health</h3>
              </div>
              <StatusPill
                value={
                  dashboard?.diagnostics?.provider?.rateLimited
                    ? "RATE LIMITED"
                    : dashboard?.diagnostics?.provider?.configured
                      ? "READY"
                      : "NOT CONFIGURED"
                }
              />
            </div>
            <div className="provider-diagnostics-grid">
              <div><span>REQUESTS / MIN</span><b>{dashboard?.diagnostics?.provider?.requestsLastMinute ?? 0} / {dashboard?.diagnostics?.provider?.requestBudgetPerMinute ?? "—"}</b></div>
              <div><span>CREDITS LEFT</span><b>{dashboard?.diagnostics?.provider?.apiCreditsLeft ?? "—"} / {dashboard?.diagnostics?.provider?.apiCreditsLimit ?? "—"}</b></div>
              <div><span>COOLDOWN</span><b>{dashboard?.diagnostics?.provider?.cooldownRemainingSeconds ? `${dashboard.diagnostics.provider.cooldownRemainingSeconds}s` : "READY"}</b></div>
              <div><span>QUOTE CACHE</span><b>{dashboard?.diagnostics?.provider?.quoteCacheAgeSeconds != null ? `${fmt(dashboard.diagnostics.provider.quoteCacheAgeSeconds, 0)}s` : "CANDLE MODE"}</b></div>
              <div><span>QUOTE MODE</span><b>{dashboard?.diagnostics?.provider?.quoteEndpointEnabled ? "ENDPOINT" : "CANDLE-FIRST"}</b></div>
              <div><span>LAST ERROR</span><b>{dashboard?.diagnostics?.provider?.lastError ?? "NONE"}</b></div>
            </div>
            <small>Validated cache is reused during provider cooldowns. NINE will not fabricate market data or bypass Sentinel.</small>
          </section>

          <section
            id="section-chartist"
            className="panel chart-panel"
          >
            <SectionHeader
              eyebrow="01 · CHARTIST"
              title={`${symbol} market structure`}
              description="Candlesticks use only validated provider data. When the feed is stale or disconnected, NINE labels the chart as last validated data and blocks execution."
              action={
                <div className="chart-actions">
                  <span className={`chart-source ${feedState.tone}`}>
                    {feedState.label}
                  </span>
                  <span className="chart-source">
                    {feed?.priceSource ?? "NONE"} PRICE
                  </span>
                  <span className="chart-source">
                    {feed?.ageSeconds != null
                      ? `${fmt(feed.ageSeconds, 1)}s old`
                      : "NO TIMESTAMP"}
                  </span>
                </div>
              }
            />

            <div className="chart-wrap">
              <CandlestickChart
                candles={dashboard?.chart ?? []}
                live={feedState.chartLive}
                chartist={chartist}
                setup={setup}
              />
              <div className="chart-axis">
                <span>LOW {fmt(
                  Math.min(
                    ...(dashboard?.chart?.map(
                      (c) => c.low,
                    ) ?? [0]),
                  ),
                  2,
                )}</span>
                <span>
                  HIGH{" "}
                  {fmt(
                    Math.max(
                      ...(dashboard?.chart?.map(
                        (c) => c.high,
                      ) ?? [0]),
                      2,
                    ),
                  )}
                </span>
              </div>
            </div>

            <div className="structure-grid">
              <Metric
                label="SESSION"
                value={
                  chartist?.session ?? "—"
                }
                sub={`High ${fmt(
                  chartist?.sessionHigh,
                )}`}
              />
              <Metric
                label="HTF BIAS"
                value={
                  <StatusPill
                    value={
                      chartist?.higherTimeframeBias
                    }
                  />
                }
                sub={`Low ${fmt(
                  chartist?.sessionLow,
                )}`}
              />
              <Metric
                label="MSS"
                value={
                  chartist?.mssDirection ?? "NONE"
                }
                sub={
                  chartist?.chochDirection
                    ? `CHoCH ${chartist.chochDirection}`
                    : "No CHoCH detected"
                }
              />
              <Metric
                label="CONFLUENCE"
                value={`${chartist?.confluenceScore ?? 0}%`}
                sub={
                  chartist?.confluenceReasons
                    ?.slice(0, 2)
                    .join(" · ") ??
                  "Waiting for structure."
                }
              />
            </div>

            <div className="zones-grid">
              <div className="subpanel">
                <div className="eyebrow">
                  LIQUIDITY
                </div>
                <div className="zone-row">
                  <span>HIGH</span>
                  <b>
                    {fmt(
                      chartist?.liquidityHigh,
                    )}
                  </b>
                </div>
                <div className="zone-row">
                  <span>LOW</span>
                  <b>
                    {fmt(
                      chartist?.liquidityLow,
                    )}
                  </b>
                </div>
              </div>
              <div className="subpanel">
                <div className="eyebrow">
                  STRUCTURE
                </div>
                <div className="zone-row">
                  <span>SWEEP</span>
                  <StatusPill
                    value={
                      setup?.smc?.sweepDirection ??
                      "NONE"
                    }
                  />
                </div>
                <div className="zone-row">
                  <span>FVG</span>
                  <b>
                    {setup?.smc?.fairValueGap
                      ? "DETECTED"
                      : "NONE"}
                  </b>
                </div>
                <div className="zone-row">
                  <span>ORDER BLOCK</span>
                  <b>
                    {setup?.smc?.orderBlock
                      ? "DETECTED"
                      : "NONE"}
                  </b>
                </div>
              </div>
            </div>
          </section>

          <section id="section-strategy-intelligence" className="panel">
            <SectionHeader
              eyebrow="02 · STRATEGY INTELLIGENCE"
              title="NINE strategy brain"
              description="Multiple independent playbooks are evaluated against the same validated XAUUSD context. Scores are evidence strength, not guaranteed win rates."
              action={
                <StatusPill
                  value={
                    v27?.brain?.strategyConsensus?.regime ??
                    "MIXED"
                  }
                />
              }
            />

            <div className="metric-grid">
              <Metric
                label="BOOK SCORE"
                value={v27?.brain?.strategyConsensus?.score ?? 0}
                sub="Top-five evidence average / 100"
              />
              <Metric
                label="CONFIDENCE"
                value={v27?.brain?.strategyConsensus?.confidence ?? 0}
                sub="Bounded intelligence score"
              />
              <Metric
                label="ACTIVE"
                value={v27?.brain?.strategyConsensus?.activeStrategies ?? 0}
                sub="Strategies above activation threshold"
              />
              <Metric
                label="ALIGNED"
                value={v27?.brain?.strategyConsensus?.alignedStrategies ?? 0}
                sub="Strategies sharing the leading direction"
              />
            </div>

            <div className="signal-grid">
              <div className="signal-list">
                <div className="eyebrow">TOP PLAYBOOKS</div>
                {(v27?.brain?.strategyConsensus?.candidates ?? []).map(
                  (candidate: any) => (
                    <div className="signal-row" key={candidate.strategyId}>
                      <div className="signal-icon">
                        <Brain size={15} />
                      </div>
                      <div>
                        <b>{candidate.strategyName}</b>
                        <span>
                          {candidate.direction} · {candidate.score}/100 ·{" "}
                          {candidate.family}
                        </span>
                      </div>
                      <small>{candidate.confidence}</small>
                    </div>
                  ),
                )}
                {!v27?.brain?.strategyConsensus?.candidates?.length && (
                  <div className="empty-state">
                    Strategy book is waiting for enough validated candles.
                  </div>
                )}
              </div>

              <div className="command-history">
                <div className="eyebrow">KNOWLEDGE COVERAGE</div>
                <div className="command-history-row">
                  <span>CONCEPTS</span>
                  <b>29</b>
                  <small>Structure · liquidity · momentum · risk · execution</small>
                </div>
                <div className="command-history-row">
                  <span>PLAYBOOKS</span>
                  <b>12</b>
                  <small>Trend · SMC · breakout · reversal · session · momentum</small>
                </div>
                <div className="command-history-row">
                  <span>REGIME</span>
                  <b>{v27?.brain?.strategyConsensus?.regime ?? "MIXED"}</b>
                  <small>Strategy selection adapts to the observed market regime.</small>
                </div>
              </div>
            </div>
          </section>

          <section id="section-learning-lab" className="panel">
            <SectionHeader
              eyebrow="02 · NINE LEARNING LAB"
              title="Adaptive research & concept laboratory"
              description="NINE learns from measured outcomes, current market structure and explicit concept rules. Learning never overrides Sentinel or fabricates missing data."
              action={<StatusPill value={dashboard?.strategyLab?.regime ?? "MIXED"} />}
            />

            <div className="metric-grid">
              <Metric
                label="LAB REGIME"
                value={dashboard?.strategyLab?.regime ?? "MIXED"}
                sub={`${dashboard?.strategyLab?.session ?? "OFF_SESSION"} session`}
              />
              <Metric
                label="VOLATILITY"
                value={fmt(dashboard?.strategyLab?.volatility, 3)}
                sub="Recent / baseline range"
              />
              <Metric
                label="CONCEPT COVERAGE"
                value={`${dashboard?.strategyLab?.conceptCoverage ?? 0}%`}
                sub="Observed concepts in current window"
              />
              <Metric
                label="LEARNING WIN RATE"
                value={
                  v27?.brain?.learning?.bestWinRate != null
                    ? `${fmt(v27.brain.learning.bestWinRate, 1)}%`
                    : "—"
                }
                sub={
                  v27?.brain?.learning?.totalEvaluatedSignals
                    ? `${v27.brain.learning.totalEvaluatedSignals} evaluated signals`
                    : "Waiting for sufficient history"
                }
              />
            </div>

            <div className="signal-grid">
              <div className="signal-list">
                <div className="eyebrow">LIVE CONCEPT EVENTS</div>
                {(dashboard?.strategyLab?.events ?? []).map((event: any) => (
                  <div className="signal-row" key={event.id}>
                    <div className="signal-icon"><Sparkles size={15} /></div>
                    <div>
                      <b>{event.concept}</b>
                      <span>{event.evidence}</span>
                    </div>
                    <small>{event.strength}/100</small>
                  </div>
                ))}
                {!dashboard?.strategyLab?.events?.length && (
                  <div className="empty-state">No validated concept events in the current window.</div>
                )}
              </div>

              <div className="signal-list">
                <div className="eyebrow">SETUP LAB</div>
                {(dashboard?.strategyLab?.setups ?? []).slice(0, 6).map((setup: any) => (
                  <div className="signal-row" key={setup.id}>
                    <div className="signal-icon"><Target size={15} /></div>
                    <div>
                      <b>{setup.name}</b>
                      <span>{setup.status} · {setup.direction} · {setup.matchedConcepts.length}/{setup.requiredConcepts.length} concepts</span>
                    </div>
                    <small>{setup.score}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="command-history">
              <div className="eyebrow">NINE CURRICULUM</div>
              {(dashboard?.strategyLab?.lessons ?? []).slice(0, 8).map((lesson: any) => (
                <div className="command-history-row" key={lesson.id}>
                  <span>{lesson.level}</span>
                  <b>{lesson.title}</b>
                  <small>{lesson.objective}</small>
                </div>
              ))}
            </div>
          </section>

          <section id="section-strategy-memory" className="panel">
            <SectionHeader
              eyebrow="03 · STRATEGY MEMORY"
              title="Historical edge memory"
              description="Persistent strategy × session × regime evidence from completed historical research. Memory adjusts research scoring; it never bypasses Sentinel."
              action={<StatusPill value={(dashboard?.strategyMemory?.length ?? 0) > 0 ? "LEARNING" : "EMPTY"} />}
            />
            <div className="signal-list">
              {(dashboard?.strategyMemory ?? []).slice(0, 12).map((memory: any, index: number) => (
                <div className="signal-row" key={memory.strategyId + memory.session + memory.regime + index}>
                  <div className="signal-icon"><Brain size={15} /></div>
                  <div>
                    <b>{memory.strategyName}</b>
                    <span>{memory.session} · {memory.regime} · {memory.trades} trades</span>
                  </div>
                  <small>{fmt(memory.winRate, 1)}% · {fmt(memory.expectancyR, 3)}R</small>
                </div>
              ))}
              {!dashboard?.strategyMemory?.length && (
                <div className="empty-state">Run historical intelligence to populate persistent strategy memory.</div>
              )}
            </div>
          </section>

          <section
            id="section-atlas"
            className="panel"
          >
            <SectionHeader
              eyebrow="02 · ATLAS"
              title="Macro & market intelligence"
              description="News and event context is displayed with source availability and freshness state."
              action={
                <StatusPill
                  value={
                    atlas?.sourceStatus ??
                    "UNAVAILABLE"
                  }
                />
              }
            />

            <div className="atlas-grid">
              <div className="atlas-summary">
                <div className="atlas-bias">
                  <span>MACRO BIAS</span>
                  <StatusPill
                    value={atlas?.macroBias}
                  />
                </div>
                <p>
                  {atlas?.summary ??
                    "Atlas source is unavailable. NINE will not fabricate macro information."}
                </p>
                <div className="source-line">
                  <Database size={13} />
                  {atlas?.headlineCount ?? 0} headlines
                  {" · "}
                  {atlas?.freshnessSeconds !=
                  null
                    ? `${fmt(
                        atlas.freshnessSeconds,
                        0,
                      )}s freshness`
                    : "freshness unknown"}
                </div>
              </div>

              <div className="headline-list">
                {!atlas?.headlines?.length && (
                  <div className="atlas-unavailable">
                    <div className="atlas-unavailable-title">
                      <AlertTriangle size={15} />
                      ATLAS DATA UNAVAILABLE
                    </div>
                    <div className="atlas-unavailable-grid">
                      <span>News provider <b>{atlas?.sourceStatus === "UNAVAILABLE" ? "NOT CONFIGURED" : "NO VALIDATED DATA"}</b></span>
                      <span>Macro events <b>{atlas?.macroEvents?.length ? "AVAILABLE" : "NOT VALIDATED"}</b></span>
                    </div>
                    {(atlas?.errors ?? []).length > 0 && (
                      <div className="atlas-error-list">
                        {(atlas?.errors ?? []).slice(0, 2).map((error: string, index: number) => (
                          <span key={`${error}-${index}`}>{error}</span>
                        ))}
                      </div>
                    )}
                    <small>NINE will not infer or fabricate headlines, calendar events, or macro conditions.</small>
                  </div>
                )}
                {(atlas?.headlines ?? [])
                  .slice(0, 5)
                  .map(
                    (
                      headline: any,
                      index: number,
                    ) => (
                      <div
                        className="headline-row"
                        key={`${headline.title}-${index}`}
                      >
                        <span
                          className={`headline-dot ${tone(
                            headline.sentiment,
                          )}`}
                        />
                        <div>
                          <b>
                            {headline.title}
                          </b>
                          <small>
                            {headline.source} ·{" "}
                            {headline.publishedAt ??
                              "time unavailable"}
                          </small>
                        </div>
                        <StatusPill
                          value={
                            headline.sentiment
                          }
                        />
                      </div>
                    ),
                  )}
                {!atlas?.headlines?.length && (
                  <div className="empty-state">
                    <AlertTriangle size={17} />
                    No validated Atlas headlines in the current feed.
                  </div>
                )}
              </div>
            </div>

            <div className="events-table">
              <div className="eyebrow">
                ECONOMIC CALENDAR
              </div>
              {(atlas?.macroEvents ?? [])
                .slice(0, 6)
                .map(
                  (
                    event: any,
                    index: number,
                  ) => (
                    <div
                      className="event-row"
                      key={`${event.title}-${index}`}
                    >
                      <span>
                        {event.time ?? "—"}
                      </span>
                      <b>{event.title}</b>
                      <span>
                        {event.country ??
                          "GLOBAL"}
                      </span>
                      <StatusPill
                        value={
                          event.impact ??
                          "UNKNOWN"
                        }
                      />
                    </div>
                  ),
                )}
              {!atlas?.macroEvents?.length && (
                <div className="empty-state">
                  No validated macro events available.
                </div>
              )}
            </div>
          </section>

          <section
            id="section-sentinel"
            className="panel"
          >
            <SectionHeader
              eyebrow="03 · SENTINEL"
              title="Risk control center"
              description="Sentinel remains an independent hard gate. NINE Brain cannot override it."
              action={
                <StatusPill
                  value={
                    sentinel?.approved
                      ? "APPROVED"
                      : "BLOCKED"
                  }
                />
              }
            />

            <div className="risk-grid">
              <Metric
                label="EQUITY"
                value={`$${fmt(
                  risk?.equity ??
                    account?.equity,
                )}`}
                sub="Paper account"
              />
              <Metric
                label="DAILY LOSS"
                value={`${fmt(
                  risk?.dailyLossPercent,
                )}%`}
                sub="Limit enforced"
                valueClass={
                  (risk?.dailyLossPercent ??
                    0) > 0
                    ? "warning-text"
                    : ""
                }
              />
              <Metric
                label="DRAWDOWN"
                value={`${fmt(
                  risk?.drawdownPercent,
                )}%`}
                sub="Peak-to-equity"
              />
              <Metric
                label="EXPOSURE"
                value={`${fmt(
                  risk?.exposurePercent,
                )}%`}
                sub={`${risk?.openPositions ?? 0} open`}
              />
              <Metric
                label="PROJECTED LOSS"
                value={`$${fmt(
                  risk?.projectedLoss,
                )}`}
                sub="Current setup"
              />
              <Metric
                label="LOSS STREAK"
                value={
                  risk?.consecutiveLosses ??
                  0
                }
                sub="Trailing closed losses"
              />
            </div>

            <div className="sentinel-layout">
              <div className="gate-card">
                <div className="gate-icon">
                  {sentinel?.approved ? (
                    <CheckCircle2 size={25} />
                  ) : (
                    <PauseCircle size={25} />
                  )}
                </div>
                <div>
                  <div className="eyebrow">
                    EXECUTION GATE
                  </div>
                  <h3>
                    {sentinel?.approved
                      ? "Sentinel approved"
                      : "Execution blocked"}
                  </h3>
                  <p>
                    {sentinel?.reason ??
                      "Waiting for a validated setup."}
                  </p>
                </div>
              </div>

              <CheckList
                checks={
                  setup?.validation
                    ?.checks ?? {}
                }
              />
            </div>
          </section>

          <section
            id="section-backtest"
            className="panel"
          >
            <SectionHeader
              eyebrow="04 · BACKTEST"
              title="Replay workstation"
              description="Runs against validated live-candle data. Results are not invented when the provider is unavailable."
              action={
                <button
                  className="primary-button"
                  onClick={() =>
                    void runBacktest()
                  }
                  disabled={backtestBusy || !user}
                >
                  {backtestBusy ? (
                    <>
                      <RefreshCw
                        size={14}
                        className="spin"
                      />
                      RUNNING
                    </>
                  ) : (
                    <>
                      <PlayCircle size={14} />
                      RUN REPLAY
                    </>
                  )}
                </button>
              }
            />

            <div className="backtest-controls">
              <div>
                <span>SYMBOL</span>
                <b>{symbol}</b>
              </div>
              <div className="backtest-timeframe-control">
                <span>TIMEFRAME</span>
                <select value={backtestTimeframe} onChange={(event) => setBacktestTimeframe(event.target.value)} disabled={backtestBusy}>
                  <option value="1min">1 MIN</option>
                  <option value="5min">5 MIN</option>
                  <option value="15min">15 MIN</option>
                  <option value="1h">1 HOUR</option>
                </select>
              </div>
              <div>
                <span>INITIAL BALANCE</span>
                <b>$10,000</b>
              </div>
              <div>
                <span>RISK / TRADE</span>
                <b>0.50%</b>
              </div>
            </div>

            {backtestError ? (
              <div className="empty-large backtest-error">
                <AlertTriangle size={24} />
                <b>Replay unavailable</b>
                <span>{backtestError}</span>
                <button className="secondary-button" type="button" onClick={() => void runBacktest()} disabled={backtestBusy || !user}>
                  <RefreshCw size={14} /> RETRY REPLAY
                </button>
              </div>
            ) : backtest ? (
              <>
              <div className="backtest-results">
                <Metric
                  label="TRADES"
                  value={backtest.totalTrades}
                  sub={`${backtest.wins} wins · ${backtest.losses} losses`}
                />
                <Metric
                  label="WIN RATE"
                  value={`${fmt(
                    backtest.winRate,
                    1,
                  )}%`}
                />
                <Metric
                  label="NET P&L"
                  value={`$${fmt(
                    backtest.netPnl,
                  )}`}
                  valueClass={
                    backtest.netPnl >= 0
                      ? "positive-text"
                      : "negative-text"
                  }
                />
                <Metric
                  label="MAX DRAWDOWN"
                  value={`${fmt(
                    backtest.maxDrawdown,
                    1,
                  )}%`}
                />
                <Metric
                  label="PROFIT FACTOR"
                  value={fmt(
                    backtest.profitFactor,
                    2,
                  )}
                />
                <Metric
                  label="FINAL BALANCE"
                  value={`$${fmt(
                    backtest.finalBalance,
                  )}`}
                />
              </div>
              {backtest.trades?.length ? (
                <div className="backtest-trades">
                  <div className="eyebrow">RECENT REPLAY TRADES</div>
                  <div className="backtest-trade-list">
                    {backtest.trades.slice(-12).reverse().map((trade) => (
                      <div className="backtest-trade-row" key={trade.id}>
                        <b className={trade.side === "LONG" ? "positive-text" : "negative-text"}>{trade.side}</b>
                        <span>{fmt(trade.entryPrice)} → {fmt(trade.exitPrice)}</span>
                        <span>SL {fmt(trade.stopLoss)}</span>
                        <span>TP {fmt(trade.takeProfit)}</span>
                        <span className={trade.pnl >= 0 ? "positive-text" : "negative-text"}>${fmt(trade.pnl)}</span>
                        <small>{trade.reason}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="backtest-note">No strategy trades were generated from the validated historical window. This is a valid zero-trade result, not fabricated output.</div>
              )}
              </>
            ) : (
              <div className="empty-large">
                <BarChart3 size={24} />
                <b>No replay result loaded</b>
                <span>
                  Authenticate and run a replay to
                  populate this workstation.
                </span>
              </div>
            )}
          </section>

          <section
            id="section-signals"
            className="panel"
          >
            <SectionHeader
              eyebrow="05 · SIGNALS"
              title="Signal & audit stream"
              description="Setup lifecycle events and recent command activity."
              action={
                <div className="signal-count">
                  <Bell size={14} />
                  {events.length} engine events
                  <StatusPill value={
                    events.some((event: any) => event.type === "SETUP_CONFIRMED")
                      ? "CONFIRMED"
                      : events.some((event: any) => event.type === "SETUP_FORMING")
                        ? "FORMING"
                        : events.some((event: any) => event.type === "MARKET_DEGRADED")
                          ? "BLOCKED"
                          : "WATCHING"
                  } />
                </div>
              }
            />

            <div className="signal-grid">
              <div className="signal-list">
                {events.slice(0, 10).map(
                  (
                    event: any,
                    index: number,
                  ) => (
                    <div
                      className="signal-row"
                      key={`${event.type}-${event.timestamp}-${index}`}
                    >
                      <div
                        className={`signal-icon ${tone(
                          event.type,
                        )}`}
                      >
                        {event.type ===
                        "EXECUTION_READY" ? (
                          <CheckCircle2
                            size={15}
                          />
                        ) : (
                          <Zap size={15} />
                        )}
                      </div>
                      <div>
                        <b>{event.type}</b>
                        <span>
                          {event.message ??
                            event.reason ??
                            "Signal event"}
                        </span>
                      </div>
                      <small>
                        {event.timestamp
                          ? new Date(
                              event.timestamp,
                            ).toLocaleTimeString()
                          : "—"}
                      </small>
                    </div>
                  ),
                )}
                {!events.length && (
                  <div className="empty-state">
                    <Bell size={16} />
                    <div>
                      <b>{v27?.setup?.lifecycle ?? "WATCHING"}</b>
                      <span>{v27?.setup?.reasons?.[0] ?? "Signal engine is waiting for validated market structure."}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="command-history">
                <div className="eyebrow">
                  COMMAND HISTORY
                </div>
                {commands.map((item) => (
                  <div
                    className="command-history-row"
                    key={item.id}
                  >
                    <span>
                      {new Date(
                        item.timestamp,
                      ).toLocaleTimeString()}
                    </span>
                    <b>{item.text}</b>
                    <small>{item.message}</small>
                  </div>
                ))}
                {!commands.length && (
                  <div className="empty-state">
                    <Command size={16} />
                    No commands in this session.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section id="section-overview-bottom" className="panel">
            <SectionHeader
              eyebrow="06 · PAPER DESK"
              title="Open positions & account"
              description="Paper execution only. Every position remains subject to the same orchestration and Sentinel controls."
              action={
                <StatusPill
                  value={
                    gateOpen
                      ? "PAPER_READY"
                      : "BLOCKED"
                  }
                />
              }
            />

            <div className="account-grid">
              <Metric
                label="EQUITY"
                value={`$${fmt(
                  account?.equity,
                )}`}
                icon={
                  <CircleDollarSign size={14} />
                }
              />
              <Metric
                label="REALIZED P&L"
                value={`$${fmt(
                  account?.realizedPnl,
                )}`}
                valueClass={
                  (account?.realizedPnl ??
                    0) >= 0
                    ? "positive-text"
                    : "negative-text"
                }
              />
              <Metric
                label="UNREALIZED P&L"
                value={`$${fmt(
                  account?.unrealizedPnl,
                )}`}
              />
              <Metric
                label="OPEN POSITIONS"
                value={openPositions.length}
                sub="Paper only"
              />
            </div>

            <div className="positions-list">
              {openPositions.map(
                (position) => (
                  <div
                    className="position-card"
                    key={position.id}
                  >
                    <div
                      className={`position-side ${
                        position.side === "BUY"
                          ? "buy"
                          : "sell"
                      }`}
                    >
                      {position.side ===
                      "BUY" ? (
                        <ArrowUpRight
                          size={16}
                        />
                      ) : (
                        <ArrowDownRight
                          size={16}
                        />
                      )}
                      {position.side}
                    </div>
                    <div>
                      <span>QUANTITY</span>
                      <b>{position.quantity}</b>
                    </div>
                    <div>
                      <span>ENTRY</span>
                      <b>
                        {fmt(
                          position.entryPrice,
                        )}
                      </b>
                    </div>
                    <div>
                      <span>STOP</span>
                      <b>
                        {fmt(
                          position.stopLoss,
                        )}
                      </b>
                    </div>
                    <div>
                      <span>TARGET</span>
                      <b>
                        {fmt(
                          position.takeProfit,
                        )}
                      </b>
                    </div>
                  </div>
                ),
              )}
              {!openPositions.length && (
                <div className="empty-large compact">
                  <PauseCircle size={20} />
                  <b>No open paper positions</b>
                  <span>
                    NINE will only create a paper position
                    after its execution gate is satisfied.
                  </span>
                </div>
              )}
            </div>
          </section>

          <footer className="footer">
            <span>
              NINE MAX · V2.17+ · PAPER EXECUTION
            </span>
            <span>
              {feed?.provider ?? "—"} ·{" "}
              {feed?.tradingAllowed
                ? "validated feed"
                : "trading blocked"}
            </span>
            <span>
              Live broker:{" "}
              {dashboard?.runtime
                ?.liveTradingEnabled
                ? "configured"
                : "hard locked"}
            </span>
          </footer>
        </div>
      </div>

      {!user && (
        <div className="auth-overlay">
          <form
            className="auth-card"
            onSubmit={loginSubmit}
          >
            <div className="auth-mark">N</div>
            <div className="eyebrow">
              NINE SECURE ACCESS
            </div>
            <h2>Sign in to control NINE</h2>
            <p>
              Market intelligence remains visible,
              while commands, backtests and paper
              execution require an authenticated
              session.
            </p>
            <input
              value={login.email}
              onChange={(event) =>
                setLogin({
                  ...login,
                  email: event.target.value,
                })
              }
              placeholder="Admin email"
              type="email"
              autoComplete="username"
              required
            />
            <input
              value={login.password}
              onChange={(event) =>
                setLogin({
                  ...login,
                  password: event.target.value,
                })
              }
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              required
            />
            {loginError && (
              <div className="login-error">
                <AlertTriangle size={14} />
                {loginError}
              </div>
            )}
            <button
              className="login-button"
              type="submit"
            >
              AUTHENTICATE
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
