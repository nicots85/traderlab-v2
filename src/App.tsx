import { useEffect, useMemo, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Asset = "BTCUSD" | "ETHUSD" | "XAGUSD" | "XAUUSD";
type Mode = "scalping" | "intradia";
type Direction = "LONG" | "SHORT";
type ExitReason = "TP" | "SL" | "TRAIL" | "REVERSAL";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type Signal = {
  asset: Asset;
  mode: Mode;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  spreadPct: number;
  atr: number;
  mtf: { htf: number; ltf: number; exec: number };
  rationale: string;
};

type Position = {
  id: number;
  signal: Signal;
  size: number;
  marginUsed: number;
  openedAt: string;
  peak: number;
  trough: number;
};

type ClosedTrade = {
  id: number;
  asset: Asset;
  mode: Mode;
  direction: Direction;
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  result: ExitReason;
  openedAt: string;
  closedAt: string;
};

type LearningModel = {
  riskScale: number;
  confidenceFloor: number;
  scalpingTpAtr: number;
  intradayTpAtr: number;
  atrTrailMult: number;
  hourEdge: Record<number, number>;
};

type BacktestReport = {
  total: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  sharpe: number;
};

type Toast = { id: number; msg: string; type: "success" | "warning" | "error" | "info" };

// ─── Constants ────────────────────────────────────────────────────────────────
const assets: Asset[] = ["BTCUSD", "ETHUSD", "XAGUSD", "XAUUSD"];

const assetLabel: Record<Asset, string> = {
  BTCUSD: "BTCUSD (500x)",
  ETHUSD: "ETHUSD (500x)",
  XAGUSD: "XAGUSD Plata (1000x)",
  XAUUSD: "XAUUSD Oro (1000x)",
};

const initialPrices: Record<Asset, number> = {
  BTCUSD: 63500,
  ETHUSD: 3250,
  XAGUSD: 29.4,
  XAUUSD: 2330,
};

const leverageByAsset: Record<Asset, number> = {
  BTCUSD: 500,
  ETHUSD: 500,
  XAGUSD: 1000,
  XAUUSD: 1000,
};

const initialLearning: LearningModel = {
  riskScale: 1,
  confidenceFloor: 57,
  scalpingTpAtr: 1.35,
  intradayTpAtr: 2.6,
  atrTrailMult: 0.9,
  hourEdge: {},
};

const exitLabel: Record<ExitReason, string> = {
  TP: "TP ✓",
  SL: "SL ✗",
  TRAIL: "Trail ⟳",
  REVERSAL: "Reversión ↩",
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function money(v: number) { return `$${v.toFixed(2)}`; }
function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(v => (v - m) ** 2)));
}
function ema(arr: number[], period: number) {
  if (!arr.length) return 0;
  const alpha = 2 / (period + 1);
  return arr.reduce((acc, v) => alpha * v + (1 - alpha) * acc, arr[0]);
}
function calcAtr(arr: number[], lookback: number) {
  const data = arr.slice(-lookback);
  if (data.length < 2) return 0;
  return avg(data.slice(1).map((v, i) => Math.abs(v - data[i])));
}
function getSpreadPct(asset: Asset, shock: number) {
  const base = asset === "BTCUSD" ? 0.04 : asset === "ETHUSD" ? 0.05 : 0.03;
  return base * (1 + shock * 1.35);
}
function calcDrawdown(trades: ClosedTrade[]) {
  let running = 100; let peak = 100; let maxDd = 0;
  [...trades].reverse().forEach(t => {
    running += t.pnl;
    if (running > peak) peak = running;
    maxDd = Math.max(maxDd, ((peak - running) / peak) * 100);
  });
  return maxDd;
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function parseMetalsSpot(payload: unknown) {
  const result: Partial<Record<"gold" | "silver", number>> = {};
  if (!Array.isArray(payload)) return result;
  payload.forEach(row => {
    if (row && typeof row === "object") {
      Object.entries(row as Record<string, unknown>).forEach(([k, v]) => {
        const low = k.toLowerCase();
        if (typeof v === "number") {
          if (low.includes("gold") || low.includes("xau")) result.gold = v;
          if (low.includes("silver") || low.includes("xag")) result.silver = v;
        }
      });
    }
  });
  return result;
}

type KlineBar = [number, string, string, string, string, string];

// FIX: fetches crypto and metals INDEPENDENTLY so one failure doesn't kill the other
async function fetchRealMarketSnapshot(prevPrices: Record<Asset, number>) {
  // Crypto: required — if this fails, the whole sync fails (intentional)
  const [btcTicker, ethTicker, btcKline, ethKline] = await Promise.all([
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"),
    fetchJson<KlineBar[]>("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120"),
    fetchJson<KlineBar[]>("https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=120"),
  ]);

  // Metals: optional — failures fall back to previous known price silently
  let goldPrice = prevPrices.XAUUSD;
  let silverPrice = prevPrices.XAGUSD;
  let metalsSource = "precio anterior";
  try {
    const metals = await fetchJson<unknown>("https://api.metals.live/v1/spot");
    const parsed = parseMetalsSpot(metals);
    if (parsed.gold && parsed.silver) {
      goldPrice = parsed.gold;
      silverPrice = parsed.silver;
      metalsSource = "metals.live";
    }
  } catch {
    // mantener precios anteriores — sin error visible al usuario
  }

  const btcSeries = btcKline.map(b => Number(b[4]));
  const ethSeries = ethKline.map(b => Number(b[4]));

  const btcCandles: Candle[] = btcKline.map(b => ({
    t: b[0], o: Number(b[1]), h: Number(b[2]), l: Number(b[3]), c: Number(b[4]), v: Number(b[5]),
  }));
  const ethCandles: Candle[] = ethKline.map(b => ({
    t: b[0], o: Number(b[1]), h: Number(b[2]), l: Number(b[3]), c: Number(b[4]), v: Number(b[5]),
  }));

  const btcAbsRet = avg(btcSeries.slice(1).map((v, i) => Math.abs((v - btcSeries[i]) / Math.max(btcSeries[i], 1e-9))));
  const ethAbsRet = avg(ethSeries.slice(1).map((v, i) => Math.abs((v - ethSeries[i]) / Math.max(ethSeries[i], 1e-9))));
  const shock = clamp(((btcAbsRet + ethAbsRet) / 2) * 220, 0.08, 1.25);

  return {
    prices: { BTCUSD: Number(btcTicker.price), ETHUSD: Number(ethTicker.price), XAUUSD: goldPrice, XAGUSD: silverPrice } as Record<Asset, number>,
    series: { BTCUSD: btcSeries, ETHUSD: ethSeries },
    candles: { BTCUSD: btcCandles, ETHUSD: ethCandles },
    shock,
    metalsSource,
  };
}

// ─── Candlestick Chart ────────────────────────────────────────────────────────
function deriveSyntheticCandles(closes: number[]): Candle[] {
  const result: Candle[] = [];
  const step = 3;
  for (let i = 0; i + 4 < closes.length; i += step) {
    const slice = closes.slice(i, i + 5);
    result.push({ t: i, o: slice[0], h: Math.max(...slice), l: Math.min(...slice), c: slice[slice.length - 1], v: 0 });
  }
  return result;
}

function CandlestickChart({ candles }: { candles: Candle[] }) {
  const visible = candles.slice(-60);
  if (visible.length < 3) {
    return (
      <div className="flex items-center justify-center" style={{ height: 240 }}>
        <p className="text-sm" style={{ color: "rgb(31 31 46 / 0.4)" }}>Sin datos de velas disponibles</p>
      </div>
    );
  }

  const W = 600;
  const CHART_H = 185;
  const VOL_H = 40;
  const TOTAL_H = CHART_H + VOL_H + 8;

  const highs = visible.map(c => c.h);
  const lows = visible.map(c => c.l);
  const vols = visible.map(c => c.v);
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  const range = Math.max(maxH - minL, 1e-9);
  const maxVol = Math.max(...vols, 1);

  const slotW = W / visible.length;
  const candleW = Math.max(1.5, slotW * 0.72);
  const scaleY = (v: number) => ((maxH - v) / range) * CHART_H;
  const scaleVol = (v: number) => (v / maxVol) * VOL_H;

  // Price labels
  const priceLabels = [minL, minL + range * 0.5, maxH].map(v => ({
    y: scaleY(v),
    label: v >= 1000 ? v.toFixed(0) : v.toFixed(2),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="w-full overflow-visible" style={{ height: 240 }}>
      {/* Grid */}
      {[0.2, 0.5, 0.8].map(f => (
        <line key={f} x1={0} y1={CHART_H * f} x2={W} y2={CHART_H * f}
          stroke="rgb(31 31 46 / 0.07)" strokeWidth="0.6" />
      ))}
      {/* Price labels */}
      {priceLabels.map(({ y, label }) => (
        <text key={label} x={W - 1} y={y + 3} textAnchor="end"
          fontSize="7" fill="rgb(31 31 46 / 0.35)" fontFamily="IBM Plex Mono, monospace">{label}</text>
      ))}
      {/* Volume separator */}
      <line x1={0} y1={CHART_H + 5} x2={W} y2={CHART_H + 5} stroke="rgb(31 31 46 / 0.07)" strokeWidth="0.5" />

      {visible.map((c, i) => {
        const cx = i * slotW + slotW / 2;
        const bull = c.c >= c.o;
        const color = bull ? "#10b981" : "#ef4444";
        const bodyTop = scaleY(Math.max(c.o, c.c));
        const bodyBot = scaleY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const volH = scaleVol(c.v);
        return (
          <g key={i}>
            <line x1={cx} y1={scaleY(c.h)} x2={cx} y2={scaleY(c.l)} stroke={color} strokeWidth="0.9" />
            <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH}
              fill={color} opacity={0.88} rx={0.4} />
            {c.v > 0 && (
              <rect x={cx - candleW / 2} y={CHART_H + 8 + VOL_H - volH} width={candleW} height={volH}
                fill={color} opacity={0.28} rx={0.3} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  const colors: Record<Toast["type"], string> = {
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  };
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, width: "100%", pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id}
          style={{ background: colors[t.type], color: "#fff", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.22)", display: "flex", alignItems: "flex-start", gap: 8, pointerEvents: "auto", cursor: "pointer" }}
          onClick={() => onRemove(t.id)}
        >
          <span style={{ flex: 1 }}>{t.msg}</span>
          <span style={{ opacity: 0.7, fontSize: 11, marginTop: 1 }}>✕</span>
        </div>
      ))}
    </div>
  );
}

// ─── Equity Curve ─────────────────────────────────────────────────────────────
function EquityCurve({ trades }: { trades: ClosedTrade[] }) {
  const points = useMemo(() => {
    let r = 100;
    const arr = [r];
    [...trades].reverse().forEach(t => { r += t.pnl; arr.push(r); });
    return arr;
  }, [trades]);

  if (points.length < 2) return (
    <p className="text-sm text-center py-3" style={{ color: "rgb(31 31 46 / 0.4)" }}>Sin trades para graficar</p>
  );

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 0.01);
  const scaleY = (v: number) => 100 - ((v - min) / range) * 100;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 100},${scaleY(v)}`).join(" ");
  const isProfit = points[points.length - 1] >= points[0];
  const color = isProfit ? "#10b981" : "#ef4444";

  return (
    <div className="rounded-xl border border-ink/10 bg-white/70 p-2 mb-3">
      <p className="text-xs font-semibold mb-1 px-1" style={{ color: "rgb(31 31 46 / 0.6)" }}>Curva de equity</p>
      <svg viewBox="0 0 100 60" className="w-full overflow-visible" style={{ height: 72 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgb(31 31 46 / 0.08)" strokeWidth="0.3" strokeDasharray="2,2" />
        <polyline fill="url(#eqFill)" stroke="none" points={`0,100 ${pts} 100,100`} />
        <polyline fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" points={pts} />
        <text x="0" y="58" fontSize="5.5" fill="rgb(31 31 46 / 0.4)" fontFamily="IBM Plex Mono, monospace">${points[0].toFixed(0)}</text>
        <text x="100" y="58" fontSize="5.5" textAnchor="end" fill={color} fontFamily="IBM Plex Mono, monospace">${points[points.length - 1].toFixed(2)}</text>
      </svg>
    </div>
  );
}

// ─── Trade History with Filters ───────────────────────────────────────────────
function TradeHistory({ trades }: { trades: ClosedTrade[] }) {
  const [filterAsset, setFilterAsset] = useState<Asset | "todas">("todas");
  const [filterMode, setFilterMode] = useState<Mode | "todos">("todos");
  const [filterResult, setFilterResult] = useState<ExitReason | "todos">("todos");

  const filtered = useMemo(() => trades.filter(t =>
    (filterAsset === "todas" || t.asset === filterAsset) &&
    (filterMode === "todos" || t.mode === filterMode) &&
    (filterResult === "todos" || t.result === filterResult)
  ), [trades, filterAsset, filterMode, filterResult]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <select className="select-field !mt-0 !py-1 !text-xs" style={{ width: "auto" }}
          value={filterAsset} onChange={e => setFilterAsset(e.target.value as Asset | "todas")}>
          <option value="todas">Todos los activos</option>
          {assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select-field !mt-0 !py-1 !text-xs" style={{ width: "auto" }}
          value={filterMode} onChange={e => setFilterMode(e.target.value as Mode | "todos")}>
          <option value="todos">Todos los modos</option>
          <option value="scalping">Scalping</option>
          <option value="intradia">Intradía</option>
        </select>
        <select className="select-field !mt-0 !py-1 !text-xs" style={{ width: "auto" }}
          value={filterResult} onChange={e => setFilterResult(e.target.value as ExitReason | "todos")}>
          <option value="todos">Todos los resultados</option>
          <option value="TP">TP ✓</option>
          <option value="SL">SL ✗</option>
          <option value="TRAIL">Trail ⟳</option>
          <option value="REVERSAL">Reversión</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-ink/10">
        <table className="w-full text-left" style={{ minWidth: 480, fontSize: 11 }}>
          <thead style={{ color: "rgb(31 31 46 / 0.5)", background: "rgba(255,255,255,0.6)" }}>
            <tr>
              <th className="py-2 px-2">Activo</th>
              <th className="py-2 px-2">Modo</th>
              <th className="py-2 px-2">Dir.</th>
              <th className="py-2 px-2">Entrada</th>
              <th className="py-2 px-2">Salida</th>
              <th className="py-2 px-2">P&L</th>
              <th className="py-2 px-2">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map(t => (
              <tr key={t.id} style={{ borderTop: "1px solid rgb(31 31 46 / 0.06)" }}>
                <td className="py-1.5 px-2 font-medium">{t.asset}</td>
                <td className="py-1.5 px-2" style={{ color: "rgb(31 31 46 / 0.6)" }}>{t.mode === "scalping" ? "Scalp" : "MTF"}</td>
                <td className="py-1.5 px-2 font-semibold" style={{ color: t.direction === "LONG" ? "#059669" : "#dc2626" }}>{t.direction}</td>
                <td className="py-1.5 px-2">{t.entry.toFixed(2)}</td>
                <td className="py-1.5 px-2">{t.exit.toFixed(2)}</td>
                <td className="py-1.5 px-2 font-semibold" style={{ color: t.pnl >= 0 ? "#059669" : "#dc2626" }}>{money(t.pnl)}</td>
                <td className="py-1.5 px-2">{exitLabel[t.result]}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center" style={{ color: "rgb(31 31 46 / 0.4)" }}>Sin operaciones con estos filtros</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1" style={{ fontSize: 11, color: "rgb(31 31 46 / 0.4)" }}>{filtered.length} operaciones</p>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export function App() {
  const [tab, setTab] = useState<Mode>("scalping");
  const [asset, setAsset] = useState<Asset>("BTCUSD");
  const [prices, setPrices] = useState(initialPrices);
  const [series, setSeries] = useState<Record<Asset, number[]>>({
    BTCUSD: Array.from({ length: 120 }, () => initialPrices.BTCUSD),
    ETHUSD: Array.from({ length: 120 }, () => initialPrices.ETHUSD),
    XAGUSD: Array.from({ length: 120 }, () => initialPrices.XAGUSD),
    XAUUSD: Array.from({ length: 120 }, () => initialPrices.XAUUSD),
  });
  const [candles, setCandles] = useState<Record<Asset, Candle[]>>({
    BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [],
  });
  const [balance, setBalance] = useState(100);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<Signal | null>(null);
  const [volumeShock, setVolumeShock] = useState(0.28);
  const [learning, setLearning] = useState<LearningModel>(initialLearning);
  const [apiKey, setApiKey] = useState("");
  const [usingGroq, setUsingGroq] = useState(false);
  const [riskPct, setRiskPct] = useState(1.2);
  const [backtestSize, setBacktestSize] = useState(40);
  const [lastBacktest, setLastBacktest] = useState<BacktestReport | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [scanEverySec, setScanEverySec] = useState(20);
  const [feedStatus, setFeedStatus] = useState("Esperando feed en vivo...");
  const [liveReady, setLiveReady] = useState(false);
  const [activePanel, setActivePanel] = useState<"historial" | "backtest">("historial");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const prevPricesRef = useRef(initialPrices);

  useEffect(() => { prevPricesRef.current = prices; }, [prices]);

  useEffect(() => {
    const envKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
    if (envKey && !apiKey) setApiKey(envKey);
  }, [apiKey]);

  // ── Toast helpers ──
  function pushToast(msg: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts(prev => [{ id, msg, type }, ...prev].slice(0, 5));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4800);
  }
  function removeToast(id: number) { setToasts(prev => prev.filter(t => t.id !== id)); }
  // kept for backward compat inside component
  function pushAlert(msg: string) { pushToast(msg, "warning"); }

  // ── Derived state ──
  const spreadByAsset = useMemo(() => {
    const map = {} as Record<Asset, number>;
    assets.forEach(a => { map[a] = (getSpreadPct(a, volumeShock) / 100) * prices[a]; });
    return map;
  }, [prices, volumeShock]);

  const unrealized = useMemo(() => openPositions.reduce((acc, p) => {
    const mark = prices[p.signal.asset];
    const spread = spreadByAsset[p.signal.asset];
    const eff = p.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
    return acc + (p.signal.direction === "LONG" ? (eff - p.signal.entry) : (p.signal.entry - eff)) * p.size;
  }, 0), [openPositions, prices, spreadByAsset]);

  const equity = balance + unrealized;

  const stats = useMemo(() => {
    const total = closedTrades.length;
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl <= 0);
    const pnl = closedTrades.reduce((a, t) => a + t.pnl, 0);
    const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const returns = closedTrades.map(t => t.pnlPct / 100);
    const sharpe = std(returns) === 0 ? 0 : (avg(returns) / std(returns)) * Math.sqrt(Math.max(returns.length, 1));
    return {
      total,
      winRate: total ? (wins.length / total) * 100 : 0,
      pnl,
      expectancy: total ? pnl / total : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      sharpe,
      maxDrawdown: calcDrawdown(closedTrades),
    };
  }, [closedTrades]);

  const bestHours = useMemo(() =>
    Object.entries(learning.hourEdge)
      .map(([h, e]) => ({ hour: Number(h), edge: e }))
      .sort((a, b) => b.edge - a.edge).slice(0, 4),
    [learning.hourEdge]);

  const visibleCandles = useMemo(() => {
    const c = candles[asset];
    return c.length > 0 ? c : deriveSyntheticCandles(series[asset]);
  }, [asset, candles, series]);

  // ── Learning model ──
  function refreshLearning(trades: ClosedTrade[]) {
    if (!trades.length) { setLearning(initialLearning); return; }
    const wr = trades.filter(t => t.pnl > 0).length / trades.length;
    const exp = trades.reduce((a, t) => a + t.pnl, 0) / trades.length;
    const hourMap: Record<number, number[]> = {};
    trades.forEach(t => {
      const h = new Date(t.closedAt).getHours();
      if (!hourMap[h]) hourMap[h] = [];
      hourMap[h].push(t.pnl);
    });
    const hourEdge: Record<number, number> = {};
    Object.entries(hourMap).forEach(([h, vs]) => { hourEdge[Number(h)] = avg(vs); });
    setLearning({
      riskScale: clamp(0.7 + wr * 0.9 + exp * 0.05, 0.6, 1.6),
      confidenceFloor: clamp(60 - exp * 2, 52, 72),
      scalpingTpAtr: clamp(1.2 + wr * 0.4, 1.15, 1.8),
      intradayTpAtr: clamp(2.1 + wr * 1.05, 2, 3.4),
      atrTrailMult: clamp(0.7 + wr * 0.45, 0.65, 1.25),
      hourEdge,
    });
  }

  // ── Signal generation ──
  function getMtfScore(currentAsset: Asset) {
    const vals = series[currentAsset];
    const atr = Math.max(calcAtr(vals, 20), prices[currentAsset] * 0.0005);
    const htfSlice = vals.slice(-70);
    const ltfSlice = vals.slice(-32);
    const execSlice = vals.slice(-8);
    return {
      htf: (ema(htfSlice, 21) - ema(htfSlice, 55)) / atr,
      ltf: (ema(ltfSlice, 8) - ema(ltfSlice, 21)) / atr,
      exec: ((execSlice[execSlice.length - 1] ?? 0) - (execSlice[0] ?? 0)) / atr,
      atr,
    };
  }

  function generateSignal(currentMode: Mode, currentAsset: Asset): Signal {
    const price = prices[currentAsset];
    const spreadPct = getSpreadPct(currentAsset, volumeShock);
    const spread = (spreadPct / 100) * price;
    const mtf = getMtfScore(currentAsset);
    const momentum = mtf.exec;
    const direction: Direction = currentMode === "intradia"
      ? (mtf.htf > 0 && mtf.ltf > 0 && momentum > 0 ? "LONG"
        : mtf.htf < 0 && mtf.ltf < 0 && momentum < 0 ? "SHORT"
        : mtf.ltf + momentum > 0 ? "LONG" : "SHORT")
      : (momentum > 0 ? "LONG" : "SHORT");

    const baseAtr = mtf.atr;
    const entry = direction === "LONG" ? price + spread / 2 : price - spread / 2;
    const stopLoss = direction === "LONG"
      ? entry - baseAtr * (currentMode === "scalping" ? 1.05 : 1.65)
      : entry + baseAtr * (currentMode === "scalping" ? 1.05 : 1.65);
    const takeProfit = direction === "LONG"
      ? entry + baseAtr * (currentMode === "scalping" ? learning.scalpingTpAtr : learning.intradayTpAtr)
      : entry - baseAtr * (currentMode === "scalping" ? learning.scalpingTpAtr : learning.intradayTpAtr);
    const confidence = clamp(50 + Math.abs(mtf.htf) * 12 + Math.abs(mtf.ltf) * 10 + Math.abs(mtf.exec) * 8 - spreadPct * 45, 50, 97);

    return {
      asset: currentAsset, mode: currentMode, direction, entry, stopLoss, takeProfit,
      confidence, spreadPct, atr: baseAtr, mtf,
      rationale: currentMode === "intradia"
        ? "Confluencia MTF HTF + LTF + 1m. TP por ATR y cierre por cruce MA5/MA13."
        : "Scalping rápido con SL corto y trailing ATR para proteger capital.",
    };
  }

  async function aiDecision(signal: Signal) {
    if (!usingGroq || !apiKey.trim()) return signal.confidence >= learning.confidenceFloor ? "OPEN" : "SKIP";
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.15,
          max_tokens: 2,
          messages: [
            { role: "system", content: "You are a trading execution gate for a simulated account. Reply with exactly OPEN or SKIP." },
            { role: "user", content: `asset=${signal.asset}; mode=${signal.mode}; conf=${signal.confidence.toFixed(1)}; spread=${signal.spreadPct.toFixed(3)}; htf=${signal.mtf.htf.toFixed(2)}; ltf=${signal.mtf.ltf.toFixed(2)}; exec=${signal.mtf.exec.toFixed(2)};` },
          ],
        }),
      });
      const data = await r.json() as { choices: Array<{ message: { content: string } }> };
      return String(data?.choices?.[0]?.message?.content ?? "").toUpperCase().includes("OPEN") ? "OPEN" : "SKIP";
    } catch {
      return signal.confidence >= learning.confidenceFloor + 3 ? "OPEN" : "SKIP";
    }
  }

  // ── Position management ──
  function closePosition(position: Position, exit: number, result: ExitReason) {
    const pnl = position.signal.direction === "LONG"
      ? (exit - position.signal.entry) * position.size
      : (position.signal.entry - exit) * position.size;

    const icon = result === "TP" ? "✅" : result === "SL" ? "❌" : "⟳";
    pushToast(`${icon} ${position.signal.asset} ${position.signal.direction} → ${exitLabel[result]}  ${pnl >= 0 ? "+" : ""}${money(pnl)}`, pnl >= 0 ? "success" : "error");

    setBalance(prev => prev + pnl);
    setOpenPositions(prev => prev.filter(p => p.id !== position.id));
    setClosedTrades(prev => {
      const next: ClosedTrade[] = [{
        id: position.id,
        asset: position.signal.asset,
        mode: position.signal.mode,
        direction: position.signal.direction,
        entry: position.signal.entry,
        exit, pnl,
        pnlPct: (pnl / Math.max(position.marginUsed, 0.01)) * 100,
        result,
        openedAt: position.openedAt,
        closedAt: new Date().toISOString(),
      }, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
  }

  function evaluateOpenPositions(nextPrices: Record<Asset, number>, nextShock: number, vals: Record<Asset, number[]>) {
    openPositions.forEach(position => {
      const px = nextPrices[position.signal.asset];
      const spread = (getSpreadPct(position.signal.asset, nextShock) / 100) * px;
      const tradable = position.signal.direction === "LONG" ? px - spread / 2 : px + spread / 2;
      const peak = Math.max(position.peak, tradable);
      const trough = Math.min(position.trough, tradable);
      const trailDist = position.signal.atr * learning.atrTrailMult;
      const trailingStop = position.signal.direction === "LONG" ? peak - trailDist : trough + trailDist;
      const effectiveStop = position.signal.direction === "LONG"
        ? Math.max(position.signal.stopLoss, trailingStop)
        : Math.min(position.signal.stopLoss, trailingStop);
      const ma5 = avg(vals[position.signal.asset].slice(-5));
      const ma13 = avg(vals[position.signal.asset].slice(-13));
      const reversal = position.signal.mode === "intradia" &&
        ((position.signal.direction === "LONG" && ma5 < ma13) || (position.signal.direction === "SHORT" && ma5 > ma13));
      const hitTp = position.signal.direction === "LONG" ? tradable >= position.signal.takeProfit : tradable <= position.signal.takeProfit;
      const hitSl = position.signal.direction === "LONG" ? tradable <= effectiveStop : tradable >= effectiveStop;

      if (hitTp) { closePosition(position, tradable, "TP"); return; }
      if (hitSl) { closePosition(position, tradable, effectiveStop === position.signal.stopLoss ? "SL" : "TRAIL"); return; }
      if (reversal) { closePosition(position, tradable, "REVERSAL"); return; }

      setOpenPositions(prev => prev.map(p => p.id === position.id
        ? { ...p, peak, trough, signal: { ...p.signal, stopLoss: effectiveStop } } : p));
    });
  }

  async function createSignalAndExecute(mode: Mode, targetAsset: Asset, autoLabel = false) {
    if (!liveReady) { pushAlert("El feed en vivo aún no está listo. Sincronice primero."); return; }
    const signal = generateSignal(mode, targetAsset);
    if (!autoLabel) setLastSignal(signal);
    const decision = await aiDecision(signal);
    if (decision !== "OPEN") {
      if (!autoLabel) pushToast(`⏭ ${targetAsset} omitido — confianza ${signal.confidence.toFixed(0)}%`, "warning");
      return;
    }
    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * learning.riskScale);
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), signal.entry * 0.0003);
    const size = riskUsd / stopDistance;
    const marginUsed = (size * signal.entry) / leverageByAsset[signal.asset];
    if (marginUsed > equity * 0.65) { pushToast("⚠️ Margen insuficiente para esta posición", "warning"); return; }
    setOpenPositions(prev => [...prev, { id: Date.now(), signal, size, marginUsed, openedAt: new Date().toISOString(), peak: signal.entry, trough: signal.entry }]);
    if (!autoLabel) pushToast(`🚀 ${signal.asset} ${signal.direction} abierto @ ${signal.entry.toFixed(2)} — conf. ${signal.confidence.toFixed(0)}%`, "success");
  }

  // ── Sync ──
  async function syncRealData() {
    setIsSyncing(true);
    try {
      const payload = await fetchRealMarketSnapshot(prevPricesRef.current);
      setPrices(payload.prices);
      setSeries(prev => {
        const nextSeries = {
          BTCUSD: payload.series.BTCUSD.length ? payload.series.BTCUSD : prev.BTCUSD,
          ETHUSD: payload.series.ETHUSD.length ? payload.series.ETHUSD : prev.ETHUSD,
          XAGUSD: [...prev.XAGUSD.slice(-159), payload.prices.XAGUSD],
          XAUUSD: [...prev.XAUUSD.slice(-159), payload.prices.XAUUSD],
        };
        evaluateOpenPositions(payload.prices, payload.shock, nextSeries);
        return nextSeries;
      });
      setCandles(prev => ({ ...prev, BTCUSD: payload.candles.BTCUSD, ETHUSD: payload.candles.ETHUSD }));
      setVolumeShock(payload.shock);
      const metalInfo = payload.metalsSource !== "metals.live" ? ` (metales: ${payload.metalsSource})` : "";
      setFeedStatus(`✓ Sincronizado${metalInfo}`);
      setLiveReady(true);
    } catch {
      setFeedStatus("❌ Feed no disponible");
      setLiveReady(false);
      pushToast("Error al sincronizar datos de mercado. Reintente.", "error");
    } finally {
      setIsSyncing(false);
    }
  }

  async function runAutoScan() {
    for (const a of assets) await createSignalAndExecute("intradia", a, true);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void syncRealData(); }, []);

  useEffect(() => {
    if (!autoScan) return;
    const ms = Math.max(8, scanEverySec) * 1000;
    const id = window.setInterval(() => { void syncRealData(); void runAutoScan(); }, ms);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, scanEverySec]);

  // ── Backtest ──
  function runBacktest() {
    if (!liveReady) { pushToast("El backtest necesita historial en vivo. Sincronice primero.", "warning"); return; }
    const simulated: ClosedTrade[] = [];
    const returns: number[] = [];
    let equityBt = 100;
    for (let i = 0; i < backtestSize; i++) {
      const sampleAsset = assets[i % assets.length];
      const mode: Mode = i % 2 === 0 ? "scalping" : "intradia";
      const vals = series[sampleAsset];
      const start = Math.max(25, vals.length - (backtestSize + 25));
      const idx = start + i;
      if (idx >= vals.length - 2) break;
      const history = vals.slice(0, idx + 1);
      const entry = vals[idx];
      const maFast = avg(history.slice(-5));
      const maSlow = avg(history.slice(-13));
      const direction: Direction = maFast >= maSlow ? "LONG" : "SHORT";
      const atr = Math.max(calcAtr(history, 20), entry * 0.0004);
      const stopDist = atr * (mode === "scalping" ? 1.05 : 1.65);
      const tpDist = atr * (mode === "scalping" ? learning.scalpingTpAtr : learning.intradayTpAtr);
      const stop = direction === "LONG" ? entry - stopDist : entry + stopDist;
      const tp = direction === "LONG" ? entry + tpDist : entry - tpDist;
      const horizon = mode === "scalping" ? 6 : 22;
      let exit = vals[Math.min(idx + horizon, vals.length - 1)];
      let result: ExitReason = "REVERSAL";
      for (let j = idx + 1; j <= Math.min(idx + horizon, vals.length - 1); j++) {
        const px = vals[j];
        if (direction === "LONG" ? px >= tp : px <= tp) { exit = px; result = "TP"; break; }
        if (direction === "LONG" ? px <= stop : px >= stop) { exit = px; result = "SL"; break; }
      }
      const riskUsd = Math.max(0.5, equityBt * (riskPct / 100));
      const size = riskUsd / Math.max(stopDist, entry * 0.0003);
      const pnl = direction === "LONG" ? (exit - entry) * size : (entry - exit) * size;
      equityBt += pnl;
      simulated.push({
        id: Date.now() + i, asset: sampleAsset, mode, direction, entry, exit, pnl,
        pnlPct: (pnl / Math.max((size * entry) / leverageByAsset[sampleAsset], 0.01)) * 100,
        result,
        openedAt: new Date(Date.now() - 60000 * 30).toISOString(),
        closedAt: new Date().toISOString(),
      });
      returns.push(pnl);
    }
    if (!simulated.length) { pushToast("No hay suficientes velas para el backtest.", "warning"); return; }
    const wins = simulated.filter(t => t.pnl > 0);
    const losses = simulated.filter(t => t.pnl <= 0);
    const gp = wins.reduce((a, t) => a + t.pnl, 0);
    const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    setLastBacktest({
      total: simulated.length,
      winRate: (wins.length / simulated.length) * 100,
      expectancy: avg(returns),
      profitFactor: gl > 0 ? gp / gl : gp,
      sharpe: std(returns) > 0 ? avg(returns) / std(returns) : 0,
    });
    setClosedTrades(prev => { const next = [...simulated, ...prev].slice(0, 400); refreshLearning(next); return next; });
    setBalance(prev => prev + avg(returns) * 0.5);
    pushToast(`✅ Backtest: ${simulated.length} trades | Win rate ${((wins.length / simulated.length) * 100).toFixed(1)}%`, "success");
  }

  // ── Render ──
  return (
    <div className="min-h-screen bg-shell px-4 py-6 text-ink md:px-8">
      <ToastList toasts={toasts} onRemove={removeToast} />
      <div className="ambient-grid" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">

        {/* ── Header ── */}
        <header className="hero-card">
          <p className="kicker">TraderLab v3 — Mesa de paper trading realista</p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            Señales IA para BTC, ETH, Plata y Oro con feed en vivo + motor de simulación
          </h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="metric-card"><span>Balance</span><strong>{money(balance)}</strong></div>
            <div className="metric-card">
              <span>P&L no realizado</span>
              <strong style={{ color: unrealized >= 0 ? "#059669" : "#dc2626" }}>{money(unrealized)}</strong>
            </div>
            <div className="metric-card"><span>Equity cruzado</span><strong>{money(equity)}</strong></div>
            <div className="metric-card"><span>Win rate</span><strong>{stats.winRate.toFixed(1)}%</strong></div>
            <div className="metric-card"><span>Factor de ganancia</span><strong>{stats.profitFactor.toFixed(2)}</strong></div>
            <div className="metric-card"><span>Feed</span><strong style={{ fontSize: "0.78rem" }}>{feedStatus}</strong></div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1.18fr_1.9fr_1.2fr]">

          {/* ── Left: Controls ── */}
          <section className="panel">
            <div className="mb-4 flex gap-2">
              <button className={`tab-btn pressable ${tab === "scalping" ? "tab-btn-active" : ""}`} onClick={() => setTab("scalping")}>Scalping</button>
              <button className={`tab-btn pressable ${tab === "intradia" ? "tab-btn-active" : ""}`} onClick={() => setTab("intradia")}>Intradía MTF</button>
            </div>

            <label className="label">Activo</label>
            <select className="select-field" value={asset} onChange={e => setAsset(e.target.value as Asset)}>
              {assets.map(a => <option key={a} value={a}>{assetLabel[a]}</option>)}
            </select>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div>
                <label className="label">Riesgo base %</label>
                <input className="input-field" type="number" min={0.2} max={3} step={0.1}
                  value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Trades backtest</label>
                <input className="input-field" type="number" min={20} max={180} step={10}
                  value={backtestSize} onChange={e => setBacktestSize(Number(e.target.value))} />
              </div>
            </div>

            <label className="label mt-4">API Key Groq (opcional)</label>
            <input className="input-field" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="gsk_..." />
            <button
              className={`mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold pressable ${usingGroq ? "bg-amber-500 text-white" : "bg-ink text-white"}`}
              onClick={() => setUsingGroq(p => !p)}
            >
              {usingGroq ? "IA de ejecución: Groq" : "IA de ejecución: motor local"}
            </button>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="cta pressable" onClick={() => createSignalAndExecute(tab, asset)}>Generar + ejecutar</button>
              <button className="cta-secondary pressable" onClick={() => void syncRealData()}>
                {isSyncing ? "Sincronizando..." : "Sync datos reales"}
              </button>
              <button className="cta-secondary pressable" onClick={() => void runAutoScan()}>Escanear ahora</button>
              <button className="cta-secondary pressable" onClick={runBacktest}>Backtest adaptativo</button>
            </div>

            {/* Auto-scan */}
            <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Auto-scan intradía</p>
                <button className={`scan-toggle ${autoScan ? "scan-toggle-on" : ""}`} onClick={() => setAutoScan(p => !p)}>
                  <span className="scan-dot" />{autoScan ? "ON" : "OFF"}
                </button>
              </div>
              {autoScan && (
                <div className="mt-2">
                  <label className="label">Intervalo (seg)</label>
                  <input className="input-field" type="number" min={8} max={300} step={5}
                    value={scanEverySec} onChange={e => setScanEverySec(Number(e.target.value))} />
                </div>
              )}
            </div>

            {/* Última señal */}
            {lastSignal && (
              <div className="mt-4 rounded-2xl border border-ink/10 bg-white/80 p-3">
                <p className="text-sm font-semibold mb-2">Última señal generada</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="badge-soft font-bold" style={{ color: lastSignal.direction === "LONG" ? "#059669" : "#dc2626" }}>{lastSignal.direction}</span>
                  <span className="badge-soft">{lastSignal.asset}</span>
                  <span className="badge-soft">Conf. {lastSignal.confidence.toFixed(0)}%</span>
                  <span className="badge-soft">{lastSignal.mode === "scalping" ? "Scalp" : "MTF"}</span>
                </div>
                <p className="mt-2 text-xs" style={{ color: "rgb(31 31 46 / 0.6)" }}>{lastSignal.rationale}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div><span style={{ color: "rgb(31 31 46 / 0.5)" }}>Entrada</span><br />{lastSignal.entry.toFixed(2)}</div>
                  <div><span style={{ color: "rgb(31 31 46 / 0.5)" }}>SL</span><br /><span style={{ color: "#dc2626" }}>{lastSignal.stopLoss.toFixed(2)}</span></div>
                  <div><span style={{ color: "rgb(31 31 46 / 0.5)" }}>TP</span><br /><span style={{ color: "#059669" }}>{lastSignal.takeProfit.toFixed(2)}</span></div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs" style={{ color: "rgb(31 31 46 / 0.55)" }}>
                  <div>HTF: {lastSignal.mtf.htf.toFixed(2)}</div>
                  <div>LTF: {lastSignal.mtf.ltf.toFixed(2)}</div>
                  <div>Exec: {lastSignal.mtf.exec.toFixed(2)}</div>
                </div>
              </div>
            )}

            {/* Precios en vivo */}
            <div className="mt-4 rounded-2xl border border-ink/10 bg-white/80 p-3">
              <p className="text-sm font-semibold mb-2">Precios en vivo</p>
              <div className="grid grid-cols-2 gap-1.5">
                {assets.map(a => (
                  <div key={a} className="metric-card" style={{ cursor: "pointer" }} onClick={() => setAsset(a)}>
                    <span>{a}</span>
                    <strong style={{ fontSize: "0.82rem" }}>{prices[a].toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Mejores horas */}
            {bestHours.length > 0 && (
              <div className="mt-4 rounded-2xl border border-ink/10 bg-white/80 p-3">
                <p className="text-sm font-semibold mb-1">Mejores horas del día</p>
                <div className="flex flex-wrap gap-1">
                  {bestHours.map(({ hour, edge }) => (
                    <span key={hour} className="badge-soft text-xs" style={{ color: edge > 0 ? "#059669" : "#dc2626" }}>
                      {hour}:00 ({edge >= 0 ? "+" : ""}{edge.toFixed(2)})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Center: Chart + Positions ── */}
          <section className="panel">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">{asset}</h2>
                <p className="text-sm" style={{ color: "rgb(31 31 46 / 0.5)" }}>
                  {tab === "intradia" ? "Confluencia multitemporal" : "Ejecución scalping"}
                </p>
              </div>
              <div className="badge-soft text-xs">
                Px {prices[asset].toFixed(2)} | Spread {spreadByAsset[asset].toFixed(3)}
              </div>
            </div>

            {/* Candlestick chart */}
            <div className="rounded-2xl border border-ink/15 bg-white/85 p-3">
              <CandlestickChart candles={visibleCandles} />
            </div>

            {/* Open positions */}
            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white p-3">
              <p className="mb-2 text-sm font-semibold">Posiciones abiertas ({openPositions.length})</p>
              <table className="w-full text-left" style={{ minWidth: 560, fontSize: 11 }}>
                <thead style={{ color: "rgb(31 31 46 / 0.6)" }}>
                  <tr>
                    <th className="py-1">Activo</th>
                    <th className="py-1">Dir.</th>
                    <th className="py-1">Entrada</th>
                    <th className="py-1">SL</th>
                    <th className="py-1">TP</th>
                    <th className="py-1">P&L</th>
                    <th className="py-1">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map(p => {
                    const mark = prices[p.signal.asset];
                    const spread = spreadByAsset[p.signal.asset];
                    const eff = p.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
                    const pnl = (p.signal.direction === "LONG" ? eff - p.signal.entry : p.signal.entry - eff) * p.size;
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid rgb(31 31 46 / 0.06)" }}>
                        <td className="py-1.5">{p.signal.asset}</td>
                        <td className="py-1.5 font-semibold" style={{ color: p.signal.direction === "LONG" ? "#059669" : "#dc2626" }}>{p.signal.direction}</td>
                        <td className="py-1.5">{p.signal.entry.toFixed(2)}</td>
                        <td className="py-1.5" style={{ color: "#dc2626" }}>{p.signal.stopLoss.toFixed(2)}</td>
                        <td className="py-1.5" style={{ color: "#059669" }}>{p.signal.takeProfit.toFixed(2)}</td>
                        <td className="py-1.5 font-semibold" style={{ color: pnl >= 0 ? "#059669" : "#dc2626" }}>{money(pnl)}</td>
                        <td className="py-1.5">{p.signal.confidence.toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                  {openPositions.length === 0 && (
                    <tr><td colSpan={7} className="py-3 text-center" style={{ color: "rgb(31 31 46 / 0.4)" }}>Sin posiciones abiertas</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* CFD info */}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="soft-card text-sm">
                <p className="font-semibold">Condiciones de simulación CFD</p>
                <p>Capital: 100 USD | Margen cruzado | sin comisiones</p>
                <p>Spread bid/ask dinámico según actividad del mercado</p>
                <p>Apalancamiento: {leverageByAsset[asset]}x en {asset}</p>
              </div>
              <div className="soft-card text-sm">
                <p className="font-semibold">Lógica de salida v3</p>
                <p>Trailing stop: {learning.atrTrailMult.toFixed(2)} ATR</p>
                <p>TP scalping: {learning.scalpingTpAtr.toFixed(2)} ATR</p>
                <p>TP intradía: {learning.intradayTpAtr.toFixed(2)} ATR + reversión MA5/MA13</p>
              </div>
            </div>
          </section>

          {/* ── Right: Stats + History/Backtest ── */}
          <section className="panel flex flex-col gap-4">
            {/* Stats grid */}
            <div>
              <p className="text-sm font-semibold mb-2">Estadísticas generales</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["Total trades", stats.total],
                  ["Win rate", `${stats.winRate.toFixed(1)}%`],
                  ["Expectativa", money(stats.expectancy)],
                  ["Factor ganancia", stats.profitFactor.toFixed(2)],
                  ["Sharpe ratio", stats.sharpe.toFixed(2)],
                  ["Max drawdown", `${stats.maxDrawdown.toFixed(1)}%`],
                  ["P&L total", money(stats.pnl)],
                  ["Pos. abiertas", openPositions.length],
                ] as [string, string | number][]).map(([label, value]) => (
                  <div key={label} className="metric-card">
                    <span>{label}</span>
                    <strong style={{ fontSize: "0.85rem" }}>{value}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel tabs */}
            <div className="flex gap-2">
              <button className={`tab-btn pressable flex-1 ${activePanel === "historial" ? "tab-btn-active" : ""}`}
                onClick={() => setActivePanel("historial")}>Historial</button>
              <button className={`tab-btn pressable flex-1 ${activePanel === "backtest" ? "tab-btn-active" : ""}`}
                onClick={() => setActivePanel("backtest")}>Backtest</button>
            </div>

            {activePanel === "historial" && (
              <div>
                <EquityCurve trades={closedTrades} />
                <TradeHistory trades={closedTrades} />
              </div>
            )}

            {activePanel === "backtest" && (
              <div>
                {lastBacktest ? (
                  <>
                    <EquityCurve trades={closedTrades.slice(0, lastBacktest.total)} />
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["Trades", lastBacktest.total],
                        ["Win rate", `${lastBacktest.winRate.toFixed(1)}%`],
                        ["Expectativa", money(lastBacktest.expectancy)],
                        ["Factor ganancia", lastBacktest.profitFactor.toFixed(2)],
                        ["Sharpe", lastBacktest.sharpe.toFixed(2)],
                      ] as [string, string | number][]).map(([label, value]) => (
                        <div key={label} className="metric-card">
                          <span>{label}</span>
                          <strong style={{ fontSize: "0.85rem" }}>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-ink/10 p-6 text-center text-sm" style={{ color: "rgb(31 31 46 / 0.4)" }}>
                    <p className="mb-1">Sincronice datos reales primero</p>
                    <p>luego ejecute el backtest adaptativo</p>
                  </div>
                )}
                <p className="mt-2 text-xs" style={{ color: "rgb(31 31 46 / 0.4)" }}>
                  Usa velas de 1 minuto reales de Binance para BTC/ETH y serie acumulada para metales.
                </p>
              </div>
            )}

            {/* Learning model */}
            <div className="rounded-2xl border border-ink/10 bg-white/80 p-3">
              <p className="text-sm font-semibold mb-2">Modelo de aprendizaje adaptativo</p>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {[
                  ["Escala de riesgo", `${learning.riskScale.toFixed(2)}x`],
                  ["Umbral confianza", `${learning.confidenceFloor.toFixed(0)}%`],
                  ["TP scalping", `${learning.scalpingTpAtr.toFixed(2)} ATR`],
                  ["TP intradía", `${learning.intradayTpAtr.toFixed(2)} ATR`],
                  ["Trail ATR", `${learning.atrTrailMult.toFixed(2)}x`],
                ].map(([label, value]) => (
                  <div key={label} className="metric-card">
                    <span>{label}</span>
                    <strong style={{ fontSize: "0.82rem" }}>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
