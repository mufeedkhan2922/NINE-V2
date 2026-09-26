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
  ["atlas", "Atlas"],
  ["sentinel", "Sentinel"],
  ["backtest", "Backtest"],
  ["signals", "Signals"],
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

function Sparkline({
  candles,
  height = 220,
}: {
  candles: Candle[];
  height?: number;
}) {
  if (!candles.length) {
    return (
      <div className="chart-placeholder">
        <Database size={20} />
        <span>Waiting for validated candles…</span>
      </div>
    );
  }

  const width = 1000;
  const padX = 20;
  const padY = 18;
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const span = Math.max(max - min, 0.000001);
  const x = (index: number) =>
    padX +
    (index / Math.max(candles.length - 1, 1)) *
      (width - padX * 2);
  const y = (price: number) =>
    height -
    padY -
    ((price - min) / span) * (height - padY * 2);

  const line = candles
    .map((c, index) => `${x(index)},${y(c.close)}`)
    .join(" ");

  return (
    <svg
      className="market-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Validated live market chart"
    >
      <defs>
        <linearGradient id="nineChartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".20" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
        <line
          key={ratio}
          x1={padX}
          x2={width - padX}
          y1={height * ratio}
          y2={height * ratio}
          className="chart-grid"
        />
      ))}
      <polygon
        points={`${padX},${height - padY} ${line} ${
          width - padX
        },${height - padY}`}
        fill="url(#nineChartFill)"
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(candles.length - 1)}
        cy={y(candles.at(-1)?.close ?? min)}
        r="4"
        fill="currentColor"
      />
    </svg>
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
          body: JSON.stringify({ text: value }),
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
      setLoginError(
        "Login is required for backtesting.",
      );
      return;
    }

    setBacktestBusy(true);
    setActionMessage(
      "Running V2.7 replay on validated candles…",
    );

    try {
      const response = await fetch(
        `/api/backtest/v2?symbol=${symbol}&initialBalance=10000&riskPercent=0.5`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (response.status === 401) {
        setUser(null);
      }

      setBacktest(data.result ?? null);
      setActionMessage(
        data.error ??
          "Backtest completed from validated candle data.",
      );
    } catch {
      setActionMessage(
        "Backtest endpoint unavailable.",
      );
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
          INITIALIZING NINE V2.7
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
              AI TRADING DESK · V2.7
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
          <div className="stream-status">
            <span
              className={`live-dot ${
                streaming ? "" : "offline"
              }`}
            />
            {streaming ? "STREAMING" : "RECONNECTING"}
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
                NINE COMMAND CENTER ·{" "}
                {dashboard?.version ?? "2.7.0"}
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

          <section
            id="section-chartist"
            className="panel chart-panel"
          >
            <SectionHeader
              eyebrow="01 · CHARTIST"
              title={`${symbol} market structure`}
              description="Validated 1-minute candles with higher-timeframe context and SMC state."
              action={
                <div className="chart-actions">
                  <span className="chart-source">
                    {feed?.priceSource ?? "NONE"} PRICE
                  </span>
                  <span className="chart-source">
                    {feed?.ageSeconds != null
                      ? `${fmt(
                          feed.ageSeconds,
                          1,
                        )}s old`
                      : "—"}
                  </span>
                </div>
              }
            />

            <div className="chart-wrap">
              <Sparkline
                candles={dashboard?.chart ?? []}
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
                    No validated Atlas headlines
                    available.
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
              <div>
                <span>TIMEFRAME</span>
                <b>1 MIN</b>
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

            {backtest ? (
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
                    No current signal events.
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
              NINE V2.7 · PAPER EXECUTION
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
