import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Asset = "BTCUSD" | "ETHUSD" | "XAGUSD" | "XAUUSD";
type Mode = "scalping" | "intradia";
type Direction = "LONG" | "SHORT";
type ExitReason = "TP" | "SL" | "TRAIL" | "REVERSAL";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type AppTab = "trading" | "backtest" | "configuracion";

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
  maxDrawdown: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number;
  avgLoss: number;
};

type Toast = { id: number; msg: string; type: "success" | "warning" | "error" | "info" };
type AiStatus = "idle" | "testing" | "ok" | "error" | "disabled";

// ─── Constants ────────────────────────────────────────────────────────────────
const assets: Asset[] = ["BTCUSD", "ETHUSD", "XAGUSD", "XAUUSD"];

const assetLabel: Record<Asset, string> = {
  BTCUSD: "BTC/USD (500×)",
  ETHUSD: "ETH/USD (500×)",
  XAGUSD: "Plata XAG (1000×)",
  XAUUSD: "Oro XAU (1000×)",
};

const initialPrices: Record<Asset, number> = {
  BTCUSD: 63500, ETHUSD: 3250, XAGUSD: 29.4, XAUUSD: 2330,
};

const leverageByAsset: Record<Asset, number> = {
  BTCUSD: 500, ETHUSD: 500, XAGUSD: 1000, XAUUSD: 1000,
};

const initialLearning: LearningModel = {
  riskScale: 1, confidenceFloor: 57, scalpingTpAtr: 1.35,
  intradayTpAtr: 2.6, atrTrailMult: 0.9, hourEdge: {},
};

const exitLabel: Record<ExitReason, string> = {
  TP: "TP ✓", SL: "SL ✗", TRAIL: "Trail ⟳", REVERSAL: "Reversión ↩",
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
function formatDuration(openedAt: string) {
  const ms = Date.now() - new Date(openedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

async function fetchRealMarketSnapshot(prevPrices: Record<Asset, number>) {
  const [btcTicker, ethTicker, btcKline, ethKline] = await Promise.all([
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"),
    fetchJson<KlineBar[]>("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=160"),
    fetchJson<KlineBar[]>("https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=160"),
  ]);

  const btcPrice = parseFloat(btcTicker.price);
  const ethPrice = parseFloat(ethTicker.price);

  const toCandles = (bars: KlineBar[]): Candle[] => bars.map(b => ({
    t: b[0], o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));

  const btcCandles = toCandles(btcKline);
  const ethCandles = toCandles(ethKline);
  const btcSeries = btcCandles.map(c => c.c);
  const ethSeries = ethCandles.map(c => c.c);

  const shock = clamp(btcCandles.slice(-10).reduce((acc, c) => {
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    return acc + (range > 0 ? body / range : 0);
  }, 0) / 10, 0.1, 1.0);

  let silverPrice = prevPrices.XAGUSD;
  let goldPrice = prevPrices.XAUUSD;
  let metalsSource = "prev";

  try {
    const metals = await fetchJson<unknown>("https://api.metals.live/v1/spot");
    const parsed = parseMetalsSpot(metals);
    if (parsed.silver && parsed.silver > 5) silverPrice = parsed.silver;
    if (parsed.gold && parsed.gold > 500) goldPrice = parsed.gold;
    metalsSource = "metals.live";
  } catch {
    try {
      const fallback = await fetchJson<Record<string, number>>(
        "https://api.frankfurter.app/latest?from=USD&to=XAU,XAG"
      );
      if (fallback?.XAG && fallback.XAG > 0) silverPrice = 1 / fallback.XAG;
      if (fallback?.XAU && fallback.XAU > 0) goldPrice = 1 / fallback.XAU;
      metalsSource = "frankfurter";
    } catch { /* use prev */ }
  }

  return {
    prices: { BTCUSD: btcPrice, ETHUSD: ethPrice, XAGUSD: silverPrice, XAUUSD: goldPrice } as Record<Asset, number>,
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
      <div className="flex items-center justify-center" style={{ height: 220 }}>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos de velas disponibles</p>
      </div>
    );
  }

  const W = 600; const CHART_H = 175; const VOL_H = 36; const TOTAL_H = CHART_H + VOL_H + 8;
  const highs = visible.map(c => c.h); const lows = visible.map(c => c.l);
  const vols = visible.map(c => c.v);
  const maxH = Math.max(...highs); const minL = Math.min(...lows);
  const range = Math.max(maxH - minL, 1e-9); const maxVol = Math.max(...vols, 1);
  const slotW = W / visible.length; const candleW = Math.max(1.5, slotW * 0.72);
  const scaleY = (v: number) => ((maxH - v) / range) * CHART_H;
  const scaleVol = (v: number) => (v / maxVol) * VOL_H;
  const priceLabels = [minL, minL + range * 0.5, maxH].map(v => ({
    y: scaleY(v), label: v >= 1000 ? v.toFixed(0) : v.toFixed(2),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="w-full overflow-visible" style={{ height: 220 }}>
      {[0.2, 0.5, 0.8].map(f => (
        <line key={f} x1={0} y1={CHART_H * f} x2={W} y2={CHART_H * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
      ))}
      {priceLabels.map(({ y, label }) => (
        <text key={label} x={W - 1} y={y + 3} textAnchor="end" fontSize="7" fill="rgba(255,255,255,0.3)" fontFamily="'JetBrains Mono', monospace">{label}</text>
      ))}
      <line x1={0} y1={CHART_H + 5} x2={W} y2={CHART_H + 5} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      {visible.map((c, i) => {
        const cx = i * slotW + slotW / 2; const bull = c.c >= c.o;
        const color = bull ? "#10b981" : "#ef4444";
        const bodyTop = scaleY(Math.max(c.o, c.c)); const bodyBot = scaleY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop); const volH = scaleVol(c.v);
        return (
          <g key={i}>
            <line x1={cx} y1={scaleY(c.h)} x2={cx} y2={scaleY(c.l)} stroke={color} strokeWidth="0.9" />
            <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} opacity={0.88} rx={0.4} />
            {c.v > 0 && (
              <rect x={cx - candleW / 2} y={CHART_H + 8 + VOL_H - volH} width={candleW} height={volH} fill={color} opacity={0.28} rx={0.3} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  const colors: Record<Toast["type"], string> = {
    success: "#10b981", warning: "#f59e0b", error: "#ef4444", info: "#3b82f6",
  };
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, width: "100%", pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id}
          style={{ background: colors[t.type], color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", gap: 8, pointerEvents: "auto", cursor: "pointer", animation: "slideIn 0.2s ease" }}
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
function EquityCurve({ trades, height = 80 }: { trades: ClosedTrade[]; height?: number }) {
  const points = useMemo(() => {
    let r = 100; const arr = [r];
    [...trades].reverse().forEach(t => { r += t.pnl; arr.push(r); });
    return arr;
  }, [trades]);

  if (points.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Sin datos de trades</p>
    </div>
  );

  const min = Math.min(...points); const max = Math.max(...points);
  const range = Math.max(max - min, 0.01);
  const scaleY = (v: number) => 100 - ((v - min) / range) * 100;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 100},${scaleY(v)}`).join(" ");
  const isProfit = points[points.length - 1] >= points[0];
  const color = isProfit ? "#10b981" : "#ef4444";

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.03)", padding: "8px 4px 4px" }}>
      <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4, paddingLeft: 4 }}>Curva de equity</p>
      <svg viewBox="0 0 100 60" className="w-full overflow-visible" style={{ height }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" strokeDasharray="2,2" />
        <polyline fill="url(#eqFill)" stroke="none" points={`0,100 ${pts} 100,100`} />
        <polyline fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" points={pts} />
        <text x="0" y="58" fontSize="5" fill="rgba(255,255,255,0.3)" fontFamily="'JetBrains Mono',monospace">${points[0].toFixed(0)}</text>
        <text x="100" y="58" fontSize="5" textAnchor="end" fill={color} fontFamily="'JetBrains Mono',monospace">${points[points.length - 1].toFixed(2)}</text>
      </svg>
    </div>
  );
}

// ─── Live Position Card ───────────────────────────────────────────────────────
function LivePositionCard({
  position, prices, spreadByAsset, now,
  onClose,
}: {
  position: Position;
  prices: Record<Asset, number>;
  spreadByAsset: Record<Asset, number>;
  now: number;
  onClose: (pos: Position) => void;
}) {
  const mark = prices[position.signal.asset];
  const spread = spreadByAsset[position.signal.asset];
  const eff = position.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
  const pnl = (position.signal.direction === "LONG" ? eff - position.signal.entry : position.signal.entry - eff) * position.size;
  const isLong = position.signal.direction === "LONG";

  // Progress toward TP and distance from SL
  const totalRange = Math.abs(position.signal.takeProfit - position.signal.entry);
  const progress = clamp(
    (isLong ? eff - position.signal.entry : position.signal.entry - eff) / totalRange * 100,
    0, 100
  );
  const distToSl = Math.abs(eff - position.signal.stopLoss);
  const distToTp = Math.abs(eff - position.signal.takeProfit);
  const durationMs = now - new Date(position.openedAt).getTime();
  const durationStr = formatDuration(position.openedAt);
  const isOld = durationMs > 30 * 60 * 1000; // >30 min

  return (
    <div className="live-card" style={{ borderLeft: `3px solid ${isLong ? "#10b981" : "#ef4444"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="live-dot" style={{ background: isLong ? "#10b981" : "#ef4444" }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>{position.signal.asset}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
            background: isLong ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: isLong ? "#10b981" : "#ef4444"
          }}>{position.signal.direction}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 5 }}>
            {position.signal.mode === "scalping" ? "Scalp" : "Intradía"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: isOld ? "#f59e0b" : "var(--muted)" }}>⏱ {durationStr}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: pnl >= 0 ? "#10b981" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{money(pnl)}</span>
          <button
            onClick={() => onClose(position)}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(239,68,68,0.12)", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}
          >Cerrar</button>
        </div>
      </div>

      {/* Barra de progreso TP */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>SL {position.signal.stopLoss.toFixed(2)}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>Entrada {position.signal.entry.toFixed(2)}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>TP {position.signal.takeProfit.toFixed(2)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${Math.max(0, progress)}%`, borderRadius: 4,
            background: progress > 70 ? "#10b981" : progress > 30 ? "#f59e0b" : "#ef4444",
            transition: "width 0.5s ease"
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
          <span style={{ fontSize: 9, color: "#ef4444" }}>↓ SL −{distToSl.toFixed(2)}</span>
          <span style={{ fontSize: 9, color: "var(--muted)" }}>Px actual: {eff.toFixed(2)}</span>
          <span style={{ fontSize: 9, color: "#10b981" }}>TP +{distToTp.toFixed(2)} ↑</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--muted)" }}>
        <span>Tamaño: {position.size.toFixed(4)}</span>
        <span>Margen: {money(position.marginUsed)}</span>
        <span>Conf: {position.signal.confidence.toFixed(0)}%</span>
        <span>Trailing SL activo</span>
      </div>
    </div>
  );
}

// ─── Trade History ────────────────────────────────────────────────────────────
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {[
          { val: filterAsset, set: setFilterAsset as (v: string) => void, opts: [["todas", "Todos los activos"], ...assets.map(a => [a, a])] },
          { val: filterMode, set: setFilterMode as (v: string) => void, opts: [["todos", "Todos los modos"], ["scalping", "Scalping"], ["intradia", "Intradía"]] },
          { val: filterResult, set: setFilterResult as (v: string) => void, opts: [["todos", "Todos"], ["TP", "TP ✓"], ["SL", "SL ✗"], ["TRAIL", "Trail ⟳"], ["REVERSAL", "Reversión"]] },
        ].map((f, fi) => (
          <select key={fi} className="sel" value={f.val} onChange={e => f.set(e.target.value)}>
            {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
      </div>
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 480 }}>
          <thead style={{ background: "rgba(255,255,255,0.03)" }}>
            <tr>
              {["Activo", "Modo", "Dir.", "Entrada", "Salida", "P&L", "Resultado"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map(t => (
              <tr key={t.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{t.asset}</td>
                <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{t.mode === "scalping" ? "Scalp" : "MTF"}</td>
                <td style={{ padding: "7px 10px", fontWeight: 700, color: t.direction === "LONG" ? "#10b981" : "#ef4444" }}>{t.direction}</td>
                <td style={{ padding: "7px 10px" }}>{t.entry.toFixed(2)}</td>
                <td style={{ padding: "7px 10px" }}>{t.exit.toFixed(2)}</td>
                <td style={{ padding: "7px 10px", fontWeight: 700, color: t.pnl >= 0 ? "#10b981" : "#ef4444" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</td>
                <td style={{ padding: "7px 10px" }}>{exitLabel[t.result]}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: "20px", textAlign: "center", color: "var(--muted)" }}>Sin operaciones</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>{filtered.length} operaciones</p>
    </div>
  );
}

// ─── AI Status Badge ──────────────────────────────────────────────────────────
function AiBadge({ status, onTest, latency }: { status: AiStatus; onTest: () => void; latency: number | null }) {
  const cfg: Record<AiStatus, { label: string; color: string; bg: string }> = {
    idle:     { label: "IA: sin configurar", color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    testing:  { label: "Probando conexión…",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    ok:       { label: `IA: Groq conectada${latency ? ` ${latency}ms` : ""}`, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
    error:    { label: "IA: error de conexión", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    disabled: { label: "IA: motor local", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
  };
  const c = cfg[status];
  return (
    <button onClick={onTest} style={{
      display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8,
      border: `1px solid ${c.color}30`, background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 600, cursor: "pointer"
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: c.color,
        animation: status === "ok" ? "pulse 2s infinite" : status === "testing" ? "pulse 0.5s infinite" : "none"
      }} />
      {c.label}
    </button>
  );
}

// ─── Backtest Tab ─────────────────────────────────────────────────────────────
function BacktestTab({
  liveReady, backtestSize, setBacktestSize, riskPct, setRiskPct,
  runBacktest, lastBacktest, closedTrades,
}: {
  liveReady: boolean;
  backtestSize: number;
  setBacktestSize: (n: number) => void;
  riskPct: number;
  setRiskPct: (n: number) => void;
  runBacktest: () => void;
  lastBacktest: BacktestReport | null;
  closedTrades: ClosedTrade[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Config */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <div>
          <p className="label">Número de trades simulados</p>
          <input className="inp" type="number" min={20} max={180} step={10} value={backtestSize}
            onChange={e => setBacktestSize(Number(e.target.value))} style={{ width: 120 }} />
        </div>
        <div>
          <p className="label">Riesgo por trade (%)</p>
          <input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct}
            onChange={e => setRiskPct(Number(e.target.value))} style={{ width: 100 }} />
        </div>
        <button className="btn-primary" onClick={runBacktest} disabled={!liveReady}
          style={{ opacity: liveReady ? 1 : 0.45 }}>
          {liveReady ? "▶ Ejecutar backtest" : "Sincronice primero"}
        </button>
      </div>

      {lastBacktest ? (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {[
              { label: "Total trades", value: lastBacktest.total, accent: false },
              { label: "Win rate", value: `${lastBacktest.winRate.toFixed(1)}%`, accent: lastBacktest.winRate >= 50 },
              { label: "Factor de ganancia", value: lastBacktest.profitFactor.toFixed(2), accent: lastBacktest.profitFactor >= 1.5 },
              { label: "Sharpe ratio", value: lastBacktest.sharpe.toFixed(2), accent: lastBacktest.sharpe >= 1 },
              { label: "Expectativa / trade", value: money(lastBacktest.expectancy), accent: lastBacktest.expectancy > 0 },
              { label: "Max drawdown", value: `${lastBacktest.maxDrawdown.toFixed(1)}%`, accent: false },
              { label: "Ganancia bruta", value: money(lastBacktest.grossProfit), accent: true },
              { label: "Pérdida bruta", value: money(lastBacktest.grossLoss), accent: false },
              { label: "Win promedio", value: money(lastBacktest.avgWin), accent: true },
              { label: "Loss promedio", value: money(lastBacktest.avgLoss), accent: false },
            ].map(({ label, value, accent }) => (
              <div key={label} className="metric">
                <span className="label">{label}</span>
                <strong style={{ color: accent ? "#10b981" : "var(--text)" }}>{value}</strong>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          <div className="card">
            <EquityCurve trades={closedTrades.slice(0, lastBacktest.total)} height={120} />
          </div>

          {/* Interpretation */}
          <div className="card" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
            <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>📊 Interpretación estadística</p>
            <p>
              {lastBacktest.profitFactor >= 1.5 ? "✅ Factor de ganancia sólido (≥1.5). " : "⚠️ Factor de ganancia bajo (<1.5). "}
              {lastBacktest.sharpe >= 1 ? "✅ Sharpe aceptable para trading intradiario. " : "⚠️ Sharpe bajo — alta volatilidad de retornos. "}
              {lastBacktest.winRate >= 50 ? "✅ Win rate positivo. " : "⚠️ Win rate <50% — verificar RR ratio. "}
              {lastBacktest.maxDrawdown <= 20 ? "✅ Drawdown controlado. " : "❌ Drawdown elevado — revisar sizing. "}
            </p>
            <p style={{ marginTop: 6, fontSize: 11 }}>
              Usa velas de 1m reales de Binance para BTC/ETH y serie acumulada para metales. Resultados pasados no garantizan rendimiento futuro.
            </p>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 28, marginBottom: 12 }}>🔬</p>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>Sin datos de backtest</p>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Sincronice datos reales y ejecute el backtest para ver las estadísticas.</p>
        </div>
      )}

      {/* Historial completo */}
      {closedTrades.length > 0 && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 12 }}>Historial de operaciones</p>
          <TradeHistory trades={closedTrades} />
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export function App() {
  const [appTab, setAppTab] = useState<AppTab>("trading");
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
  const [feedStatus, setFeedStatus] = useState("Esperando feed...");
  const [liveReady, setLiveReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiLatency, setAiLatency] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const toastIdRef = useRef(0);
  const prevPricesRef = useRef(initialPrices);
  const openPositionsRef = useRef(openPositions);

  useEffect(() => { openPositionsRef.current = openPositions; }, [openPositions]);
  useEffect(() => { prevPricesRef.current = prices; }, [prices]);

  // Tick cada segundo para actualizar PnL y duración
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const envKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
    if (envKey && !apiKey) { setApiKey(envKey); setUsingGroq(true); }
  }, [apiKey]);

  useEffect(() => {
    if (usingGroq && apiKey.trim()) setAiStatus("idle");
    else if (!usingGroq) setAiStatus("disabled");
  }, [usingGroq, apiKey]);

  // ── Toast helpers ──
  function pushToast(msg: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts(prev => [{ id, msg, type }, ...prev].slice(0, 5));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4800);
  }
  function removeToast(id: number) { setToasts(prev => prev.filter(t => t.id !== id)); }

  // ── Test conexión IA ──
  async function testAiConnection() {
    if (!apiKey.trim() || !usingGroq) { pushToast("Ingrese API Key Groq y active el modo Groq primero.", "warning"); return; }
    setAiStatus("testing");
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant", temperature: 0, max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lat = Date.now() - t0;
      setAiLatency(lat);
      setAiStatus("ok");
      pushToast(`✅ Groq conectada — ${lat}ms de latencia`, "success");
    } catch (e) {
      setAiStatus("error");
      pushToast(`❌ Groq: ${e instanceof Error ? e.message : "error de conexión"}`, "error");
    }
  }

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
      total, winRate: total ? (wins.length / total) * 100 : 0, pnl,
      expectancy: total ? pnl / total : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      sharpe, maxDrawdown: calcDrawdown(closedTrades),
    };
  }, [closedTrades]);

  const bestHours = useMemo(() =>
    Object.entries(learning.hourEdge).map(([h, e]) => ({ hour: Number(h), edge: e }))
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
    const htfSlice = vals.slice(-70); const ltfSlice = vals.slice(-32); const execSlice = vals.slice(-8);
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
          model: "llama-3.1-8b-instant", temperature: 0.15, max_tokens: 2,
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
  const closePosition = useCallback((position: Position, exit: number, result: ExitReason) => {
    const pnl = position.signal.direction === "LONG"
      ? (exit - position.signal.entry) * position.size
      : (position.signal.entry - exit) * position.size;
    const icon = result === "TP" ? "✅" : result === "SL" ? "❌" : "⟳";
    pushToast(`${icon} ${position.signal.asset} ${position.signal.direction} → ${exitLabel[result]}  ${pnl >= 0 ? "+" : ""}${money(pnl)}`, pnl >= 0 ? "success" : "error");
    setBalance(prev => prev + pnl);
    setOpenPositions(prev => prev.filter(p => p.id !== position.id));
    setClosedTrades(prev => {
      const next: ClosedTrade[] = [{
        id: position.id, asset: position.signal.asset, mode: position.signal.mode,
        direction: position.signal.direction, entry: position.signal.entry, exit, pnl,
        pnlPct: (pnl / Math.max(position.marginUsed, 0.01)) * 100,
        result, openedAt: position.openedAt, closedAt: new Date().toISOString(),
      }, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function evaluateOpenPositions(nextPrices: Record<Asset, number>, nextShock: number, vals: Record<Asset, number[]>) {
    openPositionsRef.current.forEach(position => {
      const px = nextPrices[position.signal.asset];
      const spread = (getSpreadPct(position.signal.asset, nextShock) / 100) * px;
      const tradable = position.signal.direction === "LONG" ? px - spread / 2 : px + spread / 2;
      const peak = Math.max(position.peak, tradable); const trough = Math.min(position.trough, tradable);
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
    if (!liveReady) { pushToast("El feed en vivo aún no está listo. Sincronice primero.", "warning"); return; }
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
      setFeedStatus(`✓ ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${metalInfo}`);
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
      const maFast = avg(history.slice(-5)); const maSlow = avg(history.slice(-13));
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
        result, openedAt: new Date(Date.now() - 60000 * 30).toISOString(), closedAt: new Date().toISOString(),
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
      maxDrawdown: calcDrawdown(simulated),
      grossProfit: gp,
      grossLoss: gl,
      avgWin: wins.length ? gp / wins.length : 0,
      avgLoss: losses.length ? gl / losses.length : 0,
    });
    setClosedTrades(prev => { const next = [...simulated, ...prev].slice(0, 400); refreshLearning(next); return next; });
    setBalance(prev => prev + avg(returns) * 0.5);
    pushToast(`✅ Backtest: ${simulated.length} trades | Win rate ${((wins.length / simulated.length) * 100).toFixed(1)}%`, "success");
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const NAV_TABS: { id: AppTab; label: string; icon: string }[] = [
    { id: "trading", label: "Trading", icon: "📈" },
    { id: "backtest", label: "Backtest", icon: "🔬" },
    { id: "configuracion", label: "Configuración", icon: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <ToastList toasts={toasts} onRemove={removeToast} />

      {/* ── Top nav ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(10,11,18,0.92)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", padding: "0 24px", height: 56,
        gap: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 24 }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em" }}>TraderLab</span>
          <span style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 5, fontWeight: 600 }}>v4</span>
        </div>

        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {NAV_TABS.map(t => (
            <button key={t.id} onClick={() => setAppTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8,
              border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
              background: appTab === t.id ? "rgba(255,255,255,0.1)" : "transparent",
              color: appTab === t.id ? "var(--text)" : "var(--muted)",
              transition: "all 0.15s"
            }}>
              <span>{t.icon}</span>{t.label}
              {t.id === "trading" && openPositions.length > 0 && (
                <span style={{ background: "#10b981", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {openPositions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} />
          <div style={{ fontSize: 11, color: liveReady ? "#10b981" : "#6b7280", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: liveReady ? "#10b981" : "#6b7280", animation: liveReady ? "pulse 2s infinite" : "none", display: "inline-block" }} />
            {feedStatus}
          </div>
        </div>
      </nav>

      {/* ── Header metrics (siempre visibles) ── */}
      <div style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "12px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          {[
            { label: "Balance", value: money(balance), color: "var(--text)" },
            { label: "P&L no realizado", value: money(unrealized), color: unrealized >= 0 ? "#10b981" : "#ef4444" },
            { label: "Equity", value: money(equity), color: "var(--text)" },
            { label: "Win rate", value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? "#10b981" : "#ef4444" },
            { label: "Factor de ganancia", value: stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1.5 ? "#10b981" : "var(--text)" },
            { label: "Posiciones abiertas", value: openPositions.length, color: openPositions.length > 0 ? "#f59e0b" : "var(--muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="metric" style={{ flex: "0 0 auto", minWidth: 110 }}>
              <span className="label">{label}</span>
              <strong style={{ color, fontSize: 16 }}>{value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>

        {/* ━━━━━━━━━ PESTAÑA TRADING ━━━━━━━━━ */}
        {appTab === "trading" && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 340px", gap: 16 }}>

            {/* Columna izq: controles */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Modo */}
              <div className="card">
                <p className="label" style={{ marginBottom: 8 }}>Modo de trading</p>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["scalping", "intradia"] as Mode[]).map(m => (
                    <button key={m} className={tab === m ? "tab-active" : "tab"} onClick={() => setTab(m)} style={{ flex: 1 }}>
                      {m === "scalping" ? "Scalping" : "Intradía MTF"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Activo */}
              <div className="card">
                <p className="label" style={{ marginBottom: 6 }}>Activo</p>
                <select className="sel" value={asset} onChange={e => setAsset(e.target.value as Asset)} style={{ width: "100%" }}>
                  {assets.map(a => <option key={a} value={a}>{assetLabel[a]}</option>)}
                </select>
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", fontSize: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Precio</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{prices[asset].toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ color: "var(--muted)" }}>Spread</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{spreadByAsset[asset].toFixed(3)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ color: "var(--muted)" }}>Apalancamiento</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{leverageByAsset[asset]}×</span>
                  </div>
                </div>
              </div>

              {/* Riesgo */}
              <div className="card">
                <p className="label" style={{ marginBottom: 6 }}>Riesgo base (%)</p>
                <input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct}
                  onChange={e => setRiskPct(Number(e.target.value))} />
              </div>

              {/* Acciones */}
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn-primary" onClick={() => createSignalAndExecute(tab, asset)}>
                  ⚡ Generar + ejecutar señal
                </button>
                <button className="btn-secondary" onClick={() => void syncRealData()} disabled={isSyncing}>
                  {isSyncing ? "⟳ Sincronizando..." : "↻ Sync datos reales"}
                </button>
                <button className="btn-secondary" onClick={() => void runAutoScan()}>
                  🔍 Escanear todos los activos
                </button>
              </div>

              {/* Auto-scan */}
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <p style={{ fontWeight: 600, fontSize: 13 }}>Auto-scan</p>
                  <button
                    onClick={() => setAutoScan(p => !p)}
                    style={{
                      padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                      fontWeight: 700, fontSize: 11,
                      background: autoScan ? "#10b981" : "rgba(255,255,255,0.08)",
                      color: autoScan ? "#fff" : "var(--muted)"
                    }}
                  >{autoScan ? "● ACTIVO" : "○ INACTIVO"}</button>
                </div>
                {autoScan && (
                  <div>
                    <p className="label" style={{ marginBottom: 4 }}>Intervalo (seg)</p>
                    <input className="inp" type="number" min={8} max={120} step={1} value={scanEverySec}
                      onChange={e => setScanEverySec(Number(e.target.value))} />
                  </div>
                )}
              </div>

              {/* Horas de mayor edge */}
              {bestHours.length > 0 && (
                <div className="card">
                  <p className="label" style={{ marginBottom: 6 }}>Horas de mayor edge</p>
                  {bestHours.map(({ hour, edge }) => (
                    <div key={hour} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "var(--muted)" }}>{hour}:00</span>
                      <span style={{ color: edge >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>{edge >= 0 ? "+" : ""}{edge.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Parámetros del modelo */}
              <div className="card" style={{ fontSize: 11 }}>
                <p className="label" style={{ marginBottom: 6 }}>Modelo adaptativo</p>
                {[
                  ["Trailing ATR", learning.atrTrailMult.toFixed(2)],
                  ["TP scalp", `${learning.scalpingTpAtr.toFixed(2)} ATR`],
                  ["TP intradía", `${learning.intradayTpAtr.toFixed(2)} ATR`],
                  ["Piso confianza", `${learning.confidenceFloor.toFixed(0)}%`],
                  ["Escala riesgo", `${learning.riskScale.toFixed(2)}×`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ color: "var(--muted)" }}>{k}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Columna centro: gráfico + posiciones abiertas */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Chart */}
              <div className="card" style={{ padding: "14px 14px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <h2 style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>{asset}</h2>
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>{tab === "intradia" ? "Confluencia multitemporal" : "Ejecución scalping"}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                    {lastSignal && lastSignal.asset === asset && (
                      <>
                        <span>HTF: <strong style={{ color: lastSignal.mtf.htf >= 0 ? "#10b981" : "#ef4444" }}>{lastSignal.mtf.htf.toFixed(2)}</strong></span>
                        <span>LTF: <strong style={{ color: lastSignal.mtf.ltf >= 0 ? "#10b981" : "#ef4444" }}>{lastSignal.mtf.ltf.toFixed(2)}</strong></span>
                        <span>Exec: <strong style={{ color: lastSignal.mtf.exec >= 0 ? "#10b981" : "#ef4444" }}>{lastSignal.mtf.exec.toFixed(2)}</strong></span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ borderRadius: 10, overflow: "hidden", background: "rgba(0,0,0,0.3)", padding: "8px 4px 4px" }}>
                  <CandlestickChart candles={visibleCandles} />
                </div>
              </div>

              {/* Última señal */}
              {lastSignal && (
                <div className="card" style={{ borderLeft: `3px solid ${lastSignal.direction === "LONG" ? "#10b981" : "#ef4444"}` }}>
                  <p className="label" style={{ marginBottom: 6 }}>Última señal generada</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
                    {[
                      ["Activo", lastSignal.asset],
                      ["Dirección", lastSignal.direction],
                      ["Entrada", lastSignal.entry.toFixed(2)],
                      ["Stop Loss", lastSignal.stopLoss.toFixed(2)],
                      ["Take Profit", lastSignal.takeProfit.toFixed(2)],
                      ["Confianza", `${lastSignal.confidence.toFixed(0)}%`],
                      ["ATR", lastSignal.atr.toFixed(3)],
                      ["Spread %", lastSignal.spreadPct.toFixed(3)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 8px" }}>
                        <p style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{k}</p>
                        <p style={{ fontWeight: 700, color: k === "Dirección" ? (v === "LONG" ? "#10b981" : "#ef4444") : "var(--text)" }}>{v}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>{lastSignal.rationale}</p>
                </div>
              )}

              {/* Posiciones abiertas con seguimiento en vivo */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 14 }}>Posiciones abiertas</h3>
                  {openPositions.length > 0 && (
                    <span style={{ background: "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>
                      {openPositions.length} activa{openPositions.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {openPositions.length === 0 ? (
                  <div className="card" style={{ textAlign: "center", padding: "28px 16px", color: "var(--muted)", fontSize: 13 }}>
                    Sin posiciones abiertas
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {openPositions.map(p => (
                      <LivePositionCard
                        key={p.id} position={p} prices={prices}
                        spreadByAsset={spreadByAsset} now={now}
                        onClose={pos => closePosition(pos, prices[pos.signal.asset], "REVERSAL")}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Equity curve compacta */}
              {closedTrades.length >= 2 && (
                <div className="card">
                  <EquityCurve trades={closedTrades} height={70} />
                </div>
              )}
            </div>

            {/* Columna der: estadísticas + historial */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 10 }}>Estadísticas generales</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Total trades", value: stats.total },
                    { label: "Win rate", value: `${stats.winRate.toFixed(1)}%` },
                    { label: "Expectativa", value: money(stats.expectancy) },
                    { label: "Factor ganancia", value: stats.profitFactor.toFixed(2) },
                    { label: "Sharpe", value: stats.sharpe.toFixed(2) },
                    { label: "Max drawdown", value: `${stats.maxDrawdown.toFixed(1)}%` },
                    { label: "P&L total", value: money(stats.pnl) },
                    { label: "Pos. abiertas", value: openPositions.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="metric">
                      <span className="label">{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, marginBottom: 10 }}>Historial reciente</p>
                <TradeHistory trades={closedTrades} />
              </div>

              {/* CFD info */}
              <div className="card" style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
                <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Condiciones CFD simuladas</p>
                <p>Capital: $100 | Margen cruzado | Sin comisiones</p>
                <p>Spread dinámico según actividad de mercado</p>
                <p>Trailing stop: {learning.atrTrailMult.toFixed(2)} ATR</p>
              </div>
            </div>
          </div>
        )}

        {/* ━━━━━━━━━ PESTAÑA BACKTEST ━━━━━━━━━ */}
        {appTab === "backtest" && (
          <BacktestTab
            liveReady={liveReady} backtestSize={backtestSize} setBacktestSize={setBacktestSize}
            riskPct={riskPct} setRiskPct={setRiskPct}
            runBacktest={runBacktest} lastBacktest={lastBacktest} closedTrades={closedTrades}
          />
        )}

        {/* ━━━━━━━━━ PESTAÑA CONFIGURACIÓN ━━━━━━━━━ */}
        {appTab === "configuracion" && (
          <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Groq IA */}
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🤖 Configuración IA (Groq)</p>

              <p className="label" style={{ marginBottom: 6 }}>API Key Groq</p>
              <input className="inp" type="password" value={apiKey}
                onChange={e => setApiKey(e.target.value)} placeholder="gsk_..." />

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  className={usingGroq ? "btn-primary" : "btn-secondary"}
                  onClick={() => setUsingGroq(p => !p)}
                  style={{ flex: 1 }}
                >{usingGroq ? "✅ Motor: Groq IA" : "○ Motor: lógica local"}</button>
                <button className="btn-secondary" onClick={testAiConnection} disabled={!apiKey.trim() || !usingGroq}>
                  Probar conexión
                </button>
              </div>

              {/* Estado detallado */}
              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} />
                </div>
                {aiStatus === "ok" && <p style={{ color: "var(--muted)" }}>✅ Groq responde correctamente. La IA filtra señales antes de abrir posiciones.</p>}
                {aiStatus === "error" && <p style={{ color: "#ef4444" }}>❌ No se pudo conectar. Verifique la API Key y que tenga créditos disponibles.</p>}
                {aiStatus === "disabled" && <p style={{ color: "var(--muted)" }}>El motor local usa la confianza de señal ({learning.confidenceFloor.toFixed(0)}%) como filtro.</p>}
                {aiStatus === "idle" && apiKey && <p style={{ color: "var(--muted)" }}>API Key ingresada. Haga clic en "Probar conexión" para verificar.</p>}
                {aiLatency && aiStatus === "ok" && <p style={{ color: "#10b981", marginTop: 4 }}>Latencia: {aiLatency}ms — modelo: llama-3.1-8b-instant</p>}
              </div>
            </div>

            {/* Feed de datos */}
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>📡 Feed de datos de mercado</p>
              <div style={{ fontSize: 12, lineHeight: 2 }}>
                <p><strong>Crypto:</strong> Binance API — velas de 1 minuto en tiempo real</p>
                <p><strong>Metales:</strong> metals.live → frankfurter.app (fallback)</p>
                <p><strong>Estado:</strong> <span style={{ color: liveReady ? "#10b981" : "#ef4444" }}>{feedStatus}</span></p>
              </div>
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => void syncRealData()} disabled={isSyncing}>
                {isSyncing ? "⟳ Sincronizando..." : "↻ Sincronizar ahora"}
              </button>
            </div>

            {/* Auto-scan */}
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🔄 Auto-scan intradía</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <button
                  onClick={() => setAutoScan(p => !p)}
                  style={{
                    padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 12,
                    background: autoScan ? "#10b981" : "rgba(255,255,255,0.08)",
                    color: autoScan ? "#fff" : "var(--muted)"
                  }}
                >{autoScan ? "● ACTIVO" : "○ INACTIVO"}</button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{autoScan ? `Escanea cada ${scanEverySec}s` : "Escaneo automático desactivado"}</span>
              </div>
              <p className="label" style={{ marginBottom: 6 }}>Intervalo en segundos</p>
              <input className="inp" type="number" min={8} max={300} step={1} value={scanEverySec}
                onChange={e => setScanEverySec(Number(e.target.value))} style={{ width: 120 }} />
            </div>

            {/* Reset */}
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🔁 Reiniciar simulación</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Restablece el balance a $100, borra todas las operaciones y reinicia el modelo adaptativo.</p>
              <button
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                onClick={() => {
                  setBalance(100); setOpenPositions([]); setClosedTrades([]);
                  setLearning(initialLearning); setLastBacktest(null); setLastSignal(null);
                  pushToast("Simulación reiniciada a $100", "info");
                }}
              >Reiniciar todo</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
