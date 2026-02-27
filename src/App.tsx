import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Asset = "BTCUSD" | "ETHUSD" | "XAGUSD" | "XAUUSD";
type Mode = "scalping" | "intradia";
type Direction = "LONG" | "SHORT";
type ExitReason = "TP" | "SL" | "TRAIL" | "REVERSAL";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type AppTab = "trading" | "backtest" | "configuracion";

type Signal = {
  asset: Asset; mode: Mode; direction: Direction;
  entry: number; stopLoss: number; takeProfit: number;
  confidence: number; spreadPct: number; atr: number;
  mtf: { htf: number; ltf: number; exec: number };
  rationale: string;
};

type Position = {
  id: number; signal: Signal; size: number; marginUsed: number;
  openedAt: string; peak: number; trough: number;
};

type ClosedTrade = {
  id: number; asset: Asset; mode: Mode; direction: Direction;
  entry: number; exit: number; pnl: number; pnlPct: number;
  result: ExitReason; openedAt: string; closedAt: string;
  // flag para saber si es trade real o backtest simulado
  source: "real" | "backtest";
};

type LearningModel = {
  riskScale: number; confidenceFloor: number;
  scalpingTpAtr: number; intradayTpAtr: number;
  atrTrailMult: number; hourEdge: Record<number, number>;
};

type BacktestReport = {
  total: number; winRate: number; expectancy: number;
  profitFactor: number; sharpe: number; maxDrawdown: number;
  grossProfit: number; grossLoss: number; avgWin: number; avgLoss: number;
};

type Toast = { id: number; msg: string; type: "success" | "warning" | "error" | "info" };
type AiStatus = "idle" | "testing" | "ok" | "error" | "disabled";

// ─── Constants ────────────────────────────────────────────────────────────────
const assets: Asset[] = ["BTCUSD", "ETHUSD", "XAGUSD", "XAUUSD"];

// Símbolos en Bybit para cada activo
const bybitSymbol: Record<Asset, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XAGUSD: "XAGUSDT",  // Bybit usa XAGUSDT para plata
  XAUUSD: "XAUUSDT",  // Bybit usa XAUUSDT para oro
};

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
  const s = Math.floor((Date.now() - new Date(openedAt).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ─── API: Todo desde Bybit ────────────────────────────────────────────────────
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// Bybit V5 kline response
type BybitKlineResp = {
  retCode: number;
  result: { list: string[][] }; // [startTime, open, high, low, close, volume, turnover]
};

type BybitTickerResp = {
  retCode: number;
  result: { list: Array<{ symbol: string; lastPrice: string }> };
};

// ── Bybit helpers ──
async function fetchBybitKlines(symbol: string, limit = 160): Promise<Candle[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=${limit}`;
  const data = await fetchJson<BybitKlineResp>(url);
  if (data.retCode !== 0) throw new Error(`Bybit kline error ${data.retCode}`);
  return data.result.list.reverse().map(b => ({
    t: Number(b[0]), o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));
}

async function fetchBybitTicker(symbol: string): Promise<number> {
  const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`;
  const data = await fetchJson<BybitTickerResp>(url);
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}`);
  const price = parseFloat(data.result.list[0]?.lastPrice ?? "0");
  if (!price) throw new Error(`Precio 0 para ${symbol}`);
  return price;
}

// ── Binance helpers (fallback para metales) ──
type BinanceKline = [number, string, string, string, string, string];

async function fetchBinanceKlines(symbol: string, limit = 160): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`;
  const data = await fetchJson<BinanceKline[]>(url);
  return data.map(b => ({
    t: b[0], o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));
}

async function fetchBinanceTicker(symbol: string): Promise<number> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const data = await fetchJson<{ price: string }>(url);
  const price = parseFloat(data.price);
  if (!price) throw new Error(`Binance precio 0 para ${symbol}`);
  return price;
}

// Simbolo equivalente en Binance para fallback
const binanceSymbol: Record<Asset, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XAUUSD: "XAUUSDT",
  XAGUSD: "XAGUSDT",
};

async function fetchRealMarketSnapshot(prevPrices: Record<Asset, number>) {
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      const bySym = bybitSymbol[asset];
      const binSym = binanceSymbol[asset];
      let price: number;
      let candles: Candle[];
      let source = "Bybit";
      try {
        [price, candles] = await Promise.all([
          fetchBybitTicker(bySym),
          fetchBybitKlines(bySym, 160),
        ]);
      } catch {
        source = "Binance";
        [price, candles] = await Promise.all([
          fetchBinanceTicker(binSym),
          fetchBinanceKlines(binSym, 160),
        ]);
      }
      return { asset, price, candles, source };
    })
  );

  const prices = { ...prevPrices };
  const candleMap: Record<Asset, Candle[]> = { BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] };
  const seriesMap: Partial<Record<Asset, number[]>> = {};
  const failedAssets: string[] = [];
  const sourceMap: Partial<Record<Asset, string>> = {};

  results.forEach((r, i) => {
    const asset = assets[i];
    if (r.status === "fulfilled") {
      prices[asset] = r.value.price;
      candleMap[asset] = r.value.candles;
      seriesMap[asset] = r.value.candles.map(c => c.c);
      sourceMap[asset] = r.value.source;
    } else {
      failedAssets.push(asset);
    }
  });

  const btcSeries = seriesMap.BTCUSD ?? [];
  let shock = 0.28;
  if (btcSeries.length > 10) {
    const absRet = avg(btcSeries.slice(1).map((v, i) => Math.abs((v - btcSeries[i]) / Math.max(btcSeries[i], 1e-9))));
    shock = clamp(absRet * 220, 0.08, 1.25);
  }

  const metalSources = (["XAUUSD", "XAGUSD"] as Asset[]).map(a => sourceMap[a] ?? "?");
  const sourceNote = failedAssets.length > 0
    ? `⚠ fallo: ${failedAssets.join(", ")}`
    : metalSources.some(s => s === "Binance")
      ? "Bybit + Binance (metales)"
      : "Bybit";

  return { prices, candleMap, seriesMap, btcCandles: candleMap.BTCUSD, shock, sourceNote };
}

// ─── Candlestick Chart ────────────────────────────────────────────────────────
function deriveSyntheticCandles(closes: number[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 4 < closes.length; i += 3) {
    const slice = closes.slice(i, i + 5);
    result.push({ t: i, o: slice[0], h: Math.max(...slice), l: Math.min(...slice), c: slice[slice.length - 1], v: 0 });
  }
  return result;
}

function CandlestickChart({ candles }: { candles: Candle[] }) {
  const visible = candles.slice(-60);
  if (visible.length < 3) return (
    <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos de velas</p>
    </div>
  );

  const W = 600; const CH = 175; const VH = 36; const TH = CH + VH + 8;
  const maxH = Math.max(...visible.map(c => c.h));
  const minL = Math.min(...visible.map(c => c.l));
  const range = Math.max(maxH - minL, 1e-9);
  const maxVol = Math.max(...visible.map(c => c.v), 1);
  const slotW = W / visible.length;
  const candleW = Math.max(1.5, slotW * 0.72);
  const sy = (v: number) => ((maxH - v) / range) * CH;
  const sv = (v: number) => (v / maxVol) * VH;
  const labels = [minL, minL + range * 0.5, maxH].map(v => ({
    y: sy(v), label: v >= 1000 ? v.toFixed(0) : v.toFixed(2),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${TH}`} className="w-full overflow-visible" style={{ height: 220 }}>
      {[0.2, 0.5, 0.8].map(f => (
        <line key={f} x1={0} y1={CH * f} x2={W} y2={CH * f} stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
      ))}
      {labels.map(({ y, label }) => (
        <text key={label} x={W - 1} y={y + 3} textAnchor="end" fontSize="7"
          fill="rgba(255,255,255,0.28)" fontFamily="'JetBrains Mono',monospace">{label}</text>
      ))}
      <line x1={0} y1={CH + 5} x2={W} y2={CH + 5} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      {visible.map((c, i) => {
        const cx = i * slotW + slotW / 2;
        const bull = c.c >= c.o;
        const color = bull ? "#10b981" : "#ef4444";
        const bt = sy(Math.max(c.o, c.c));
        const bb = sy(Math.min(c.o, c.c));
        const bh = Math.max(1, bb - bt);
        return (
          <g key={i}>
            <line x1={cx} y1={sy(c.h)} x2={cx} y2={sy(c.l)} stroke={color} strokeWidth="0.9" />
            <rect x={cx - candleW / 2} y={bt} width={candleW} height={bh} fill={color} opacity={0.88} rx={0.4} />
            {c.v > 0 && <rect x={cx - candleW / 2} y={CH + 8 + VH - sv(c.v)} width={candleW} height={sv(c.v)} fill={color} opacity={0.28} rx={0.3} />}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  const colors: Record<Toast["type"], string> = { success: "#10b981", warning: "#f59e0b", error: "#ef4444", info: "#3b82f6" };
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, width: "100%", pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onRemove(t.id)}
          style={{ background: colors[t.type], color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", gap: 8, pointerEvents: "auto", cursor: "pointer", animation: "slideIn 0.2s ease" }}>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <span style={{ opacity: 0.7, fontSize: 11 }}>✕</span>
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
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Sin datos</p>
    </div>
  );

  const min = Math.min(...points); const max = Math.max(...points);
  const range = Math.max(max - min, 0.01);
  const sy = (v: number) => 100 - ((v - min) / range) * 100;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 100},${sy(v)}`).join(" ");
  const color = points[points.length - 1] >= points[0] ? "#10b981" : "#ef4444";

  return (
    <div style={{ borderRadius: 10, background: "rgba(255,255,255,0.03)", padding: "8px 4px 4px" }}>
      <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4, paddingLeft: 4 }}>Curva de equity</p>
      <svg viewBox="0 0 100 60" className="w-full overflow-visible" style={{ height }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline fill="url(#eqFill)" stroke="none" points={`0,100 ${pts} 100,100`} />
        <polyline fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" points={pts} />
        <text x="0" y="58" fontSize="5" fill="rgba(255,255,255,0.3)" fontFamily="'JetBrains Mono',monospace">${points[0].toFixed(0)}</text>
        <text x="100" y="58" fontSize="5" textAnchor="end" fill={color} fontFamily="'JetBrains Mono',monospace">${points[points.length - 1].toFixed(2)}</text>
      </svg>
    </div>
  );
}

// ─── Live Position Card ───────────────────────────────────────────────────────
function LivePositionCard({ position, prices, spreadByAsset, now, onClose }: {
  position: Position; prices: Record<Asset, number>;
  spreadByAsset: Record<Asset, number>; now: number;
  onClose: (pos: Position) => void;
}) {
  const mark = prices[position.signal.asset];
  const spread = spreadByAsset[position.signal.asset];
  const isLong = position.signal.direction === "LONG";
  const eff = isLong ? mark - spread / 2 : mark + spread / 2;
  const pnl = (isLong ? eff - position.signal.entry : position.signal.entry - eff) * position.size;
  const totalRange = Math.abs(position.signal.takeProfit - position.signal.entry);
  const progress = clamp((isLong ? eff - position.signal.entry : position.signal.entry - eff) / totalRange * 100, 0, 100);
  const distToSl = Math.abs(eff - position.signal.stopLoss);
  const distToTp = Math.abs(eff - position.signal.takeProfit);
  const isOld = (now - new Date(position.openedAt).getTime()) > 30 * 60 * 1000;

  return (
    <div className="live-card" style={{ borderLeft: `3px solid ${isLong ? "#10b981" : "#ef4444"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="live-dot" style={{ background: isLong ? "#10b981" : "#ef4444", animation: "pulse 1.5s infinite" }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>{position.signal.asset}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: isLong ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: isLong ? "#10b981" : "#ef4444" }}>{position.signal.direction}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 5 }}>{position.signal.mode === "scalping" ? "Scalp" : "Intradía"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: isOld ? "#f59e0b" : "var(--muted)" }}>⏱ {formatDuration(position.openedAt)}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: pnl >= 0 ? "#10b981" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{money(pnl)}</span>
          <button onClick={() => onClose(position)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>Cerrar</button>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10, color: "var(--muted)" }}>
          <span>SL {position.signal.stopLoss.toFixed(2)}</span>
          <span>Entrada {position.signal.entry.toFixed(2)}</span>
          <span>TP {position.signal.takeProfit.toFixed(2)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, progress)}%`, borderRadius: 4, background: progress > 70 ? "#10b981" : progress > 30 ? "#f59e0b" : "#ef4444", transition: "width 0.5s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9 }}>
          <span style={{ color: "#ef4444" }}>↓ SL −{distToSl.toFixed(2)}</span>
          <span style={{ color: "var(--muted)" }}>Px actual: {eff.toFixed(2)}</span>
          <span style={{ color: "#10b981" }}>TP +{distToTp.toFixed(2)} ↑</span>
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
function TradeHistory({ trades, showSource = false }: { trades: ClosedTrade[]; showSource?: boolean }) {
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
        <select className="sel" style={{ width: "auto" }} value={filterAsset} onChange={e => setFilterAsset(e.target.value as Asset | "todas")}>
          <option value="todas">Todos los activos</option>
          {assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="sel" style={{ width: "auto" }} value={filterMode} onChange={e => setFilterMode(e.target.value as Mode | "todos")}>
          <option value="todos">Todos los modos</option>
          <option value="scalping">Scalping</option>
          <option value="intradia">Intradía</option>
        </select>
        <select className="sel" style={{ width: "auto" }} value={filterResult} onChange={e => setFilterResult(e.target.value as ExitReason | "todos")}>
          <option value="todos">Todos los resultados</option>
          <option value="TP">TP ✓</option>
          <option value="SL">SL ✗</option>
          <option value="TRAIL">Trail ⟳</option>
          <option value="REVERSAL">Reversión</option>
        </select>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 480 }}>
          <thead style={{ background: "rgba(255,255,255,0.03)" }}>
            <tr>
              {["Activo", "Modo", "Dir.", "Entrada", "Salida", "P&L", "Resultado", ...(showSource ? ["Fuente"] : [])].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 80).map(t => (
              <tr key={t.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{t.asset}</td>
                <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{t.mode === "scalping" ? "Scalp" : "MTF"}</td>
                <td style={{ padding: "7px 10px", fontWeight: 700, color: t.direction === "LONG" ? "#10b981" : "#ef4444" }}>{t.direction}</td>
                <td style={{ padding: "7px 10px" }}>{t.entry.toFixed(2)}</td>
                <td style={{ padding: "7px 10px" }}>{t.exit.toFixed(2)}</td>
                <td style={{ padding: "7px 10px", fontWeight: 700, color: t.pnl >= 0 ? "#10b981" : "#ef4444" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</td>
                <td style={{ padding: "7px 10px" }}>{exitLabel[t.result]}</td>
                {showSource && <td style={{ padding: "7px 10px" }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: t.source === "real" ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.12)", color: t.source === "real" ? "#10b981" : "#a5b4fc" }}>{t.source === "real" ? "Real" : "Backtest"}</span>
                </td>}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: "20px", textAlign: "center", color: "var(--muted)" }}>Sin operaciones</td></tr>
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
    idle:     { label: "IA: sin configurar",  color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    testing:  { label: "Probando…",            color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    ok:       { label: `Groq OK${latency ? ` ${latency}ms` : ""}`, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
    error:    { label: "IA: error",            color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    disabled: { label: "IA: motor local",      color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
  };
  const c = cfg[status];
  return (
    <button onClick={onTest} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, border: `1px solid ${c.color}30`, background: c.bg, color: c.color, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, animation: status === "ok" || status === "testing" ? "pulse 2s infinite" : "none", display: "inline-block" }} />
      {c.label}
    </button>
  );
}

// ─── Backtest Tab — SEPARADO del modelo real ──────────────────────────────────
function BacktestTab({ liveReady, backtestSize, setBacktestSize, riskPct, setRiskPct, runBacktest, lastBacktest, backtestTrades }: {
  liveReady: boolean; backtestSize: number; setBacktestSize: (n: number) => void;
  riskPct: number; setRiskPct: (n: number) => void;
  runBacktest: () => void; lastBacktest: BacktestReport | null;
  backtestTrades: ClosedTrade[];  // solo trades simulados, NO afectan el modelo real
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Aviso separación */}
      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", fontSize: 12, color: "#a5b4fc" }}>
        <strong>ℹ️ Backtest aislado:</strong> los resultados aquí son puramente simulados y <strong>no modifican el modelo adaptativo</strong>. El modelo aprende exclusivamente de trades reales ejecutados en la pestaña Trading.
      </div>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <div>
          <p className="label" style={{ marginBottom: 6 }}>Trades simulados</p>
          <input className="inp" type="number" min={20} max={180} step={10} value={backtestSize} onChange={e => setBacktestSize(Number(e.target.value))} style={{ width: 120 }} />
        </div>
        <div>
          <p className="label" style={{ marginBottom: 6 }}>Riesgo por trade (%)</p>
          <input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} style={{ width: 100 }} />
        </div>
        <button className="btn-primary" onClick={runBacktest} disabled={!liveReady} style={{ opacity: liveReady ? 1 : 0.45 }}>
          {liveReady ? "▶ Ejecutar backtest" : "Sincronice primero"}
        </button>
      </div>

      {lastBacktest ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 12 }}>
            {[
              { label: "Total trades",       value: lastBacktest.total,                              accent: false },
              { label: "Win rate",           value: `${lastBacktest.winRate.toFixed(1)}%`,           accent: lastBacktest.winRate >= 50 },
              { label: "Factor de ganancia", value: lastBacktest.profitFactor.toFixed(2),            accent: lastBacktest.profitFactor >= 1.5 },
              { label: "Sharpe ratio",       value: lastBacktest.sharpe.toFixed(2),                  accent: lastBacktest.sharpe >= 1 },
              { label: "Expectativa/trade",  value: money(lastBacktest.expectancy),                  accent: lastBacktest.expectancy > 0 },
              { label: "Max drawdown",       value: `${lastBacktest.maxDrawdown.toFixed(1)}%`,       accent: false },
              { label: "Ganancia bruta",     value: money(lastBacktest.grossProfit),                 accent: true },
              { label: "Pérdida bruta",      value: money(lastBacktest.grossLoss),                   accent: false },
              { label: "Win promedio",       value: money(lastBacktest.avgWin),                      accent: true },
              { label: "Loss promedio",      value: money(lastBacktest.avgLoss),                     accent: false },
            ].map(({ label, value, accent }) => (
              <div key={label} className="metric">
                <span className="label">{label}</span>
                <strong style={{ color: accent ? "#10b981" : "var(--text)" }}>{value}</strong>
              </div>
            ))}
          </div>

          <div className="card">
            <EquityCurve trades={backtestTrades} height={120} />
          </div>

          <div className="card" style={{ fontSize: 12, lineHeight: 1.8, color: "var(--muted)" }}>
            <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>📊 Interpretación estadística</p>
            <p>
              {lastBacktest.profitFactor >= 1.5 ? "✅ Factor de ganancia sólido (≥1.5). " : "⚠️ Factor de ganancia bajo (<1.5). "}
              {lastBacktest.sharpe >= 1 ? "✅ Sharpe aceptable. " : "⚠️ Sharpe bajo — alta volatilidad de retornos. "}
              {lastBacktest.winRate >= 50 ? "✅ Win rate positivo. " : "⚠️ Win rate <50% — verificar RR ratio. "}
              {lastBacktest.maxDrawdown <= 20 ? "✅ Drawdown controlado. " : "❌ Drawdown elevado — revisar sizing. "}
            </p>
            <p style={{ marginTop: 6, fontSize: 11 }}>Datos de velas 1m reales de Bybit. Resultados pasados no garantizan rendimiento futuro.</p>
          </div>

          <div className="card">
            <p style={{ fontWeight: 700, marginBottom: 12 }}>Trades simulados (solo backtest)</p>
            <TradeHistory trades={backtestTrades} showSource={false} />
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 28, marginBottom: 12 }}>🔬</p>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>Sin datos de backtest</p>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Sincronice datos reales y ejecute el backtest.</p>
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
  const [candles, setCandles] = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [balance, setBalance] = useState(100);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);

  // ── Trades separados: reales vs backtest ──
  const [realTrades, setRealTrades] = useState<ClosedTrade[]>([]);       // alimenta el modelo
  const [backtestTrades, setBacktestTrades] = useState<ClosedTrade[]>([]); // solo para análisis

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
  const learningRef = useRef(learning);
  const volumeShockRef = useRef(volumeShock);
  const seriesRef = useRef(series);

  useEffect(() => { openPositionsRef.current = openPositions; }, [openPositions]);
  useEffect(() => { prevPricesRef.current = prices; }, [prices]);
  useEffect(() => { learningRef.current = learning; }, [learning]);
  useEffect(() => { volumeShockRef.current = volumeShock; }, [volumeShock]);
  useEffect(() => { seriesRef.current = series; }, [series]);

  // Tick cada segundo — actualiza PnL visual y evaluación continua de posiciones
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      // Evaluación continua: usa precios y series actuales desde refs
      if (openPositionsRef.current.length > 0) {
        evaluatePositionsWithCurrentPrices();
      }
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!apiKey.trim() || !usingGroq) { pushToast("Ingrese API Key Groq y active el modo Groq.", "warning"); return; }
    setAiStatus("testing");
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "llama-3.1-8b-instant", temperature: 0, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lat = Date.now() - t0;
      setAiLatency(lat); setAiStatus("ok");
      pushToast(`✅ Groq conectada — ${lat}ms`, "success");
    } catch (e) {
      setAiStatus("error");
      pushToast(`❌ Groq: ${e instanceof Error ? e.message : "error"}`, "error");
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

  // Stats solo de trades reales
  const stats = useMemo(() => {
    const trades = realTrades;
    const total = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const pnl = trades.reduce((a, t) => a + t.pnl, 0);
    const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const returns = trades.map(t => t.pnlPct / 100);
    const sharpe = std(returns) === 0 ? 0 : (avg(returns) / std(returns)) * Math.sqrt(Math.max(returns.length, 1));
    return {
      total, winRate: total ? (wins.length / total) * 100 : 0, pnl,
      expectancy: total ? pnl / total : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      sharpe, maxDrawdown: calcDrawdown(trades),
    };
  }, [realTrades]);

  const bestHours = useMemo(() =>
    Object.entries(learning.hourEdge).map(([h, e]) => ({ hour: Number(h), edge: e }))
      .sort((a, b) => b.edge - a.edge).slice(0, 4),
    [learning.hourEdge]);

  const visibleCandles = useMemo(() => {
    const c = candles[asset];
    return c.length > 0 ? c : deriveSyntheticCandles(series[asset]);
  }, [asset, candles, series]);

  // ── Learning: SOLO con trades reales ──
  function refreshLearning(trades: ClosedTrade[]) {
    const real = trades.filter(t => t.source === "real");
    if (!real.length) return; // sin trades reales, no tocamos el modelo
    const wr = real.filter(t => t.pnl > 0).length / real.length;
    const exp = real.reduce((a, t) => a + t.pnl, 0) / real.length;
    const hourMap: Record<number, number[]> = {};
    real.forEach(t => {
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
    const lrn = learningRef.current;
    const stopLoss = direction === "LONG"
      ? entry - baseAtr * (currentMode === "scalping" ? 1.05 : 1.65)
      : entry + baseAtr * (currentMode === "scalping" ? 1.05 : 1.65);
    const takeProfit = direction === "LONG"
      ? entry + baseAtr * (currentMode === "scalping" ? lrn.scalpingTpAtr : lrn.intradayTpAtr)
      : entry - baseAtr * (currentMode === "scalping" ? lrn.scalpingTpAtr : lrn.intradayTpAtr);
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
    const lrn = learningRef.current;
    if (!usingGroq || !apiKey.trim()) return signal.confidence >= lrn.confidenceFloor ? "OPEN" : "SKIP";
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
      return signal.confidence >= learningRef.current.confidenceFloor + 3 ? "OPEN" : "SKIP";
    }
  }

  // ── Close position — marca como "real" ──
  const closePosition = useCallback((position: Position, exit: number, result: ExitReason) => {
    const pnl = position.signal.direction === "LONG"
      ? (exit - position.signal.entry) * position.size
      : (position.signal.entry - exit) * position.size;
    const icon = result === "TP" ? "✅" : result === "SL" ? "❌" : "⟳";
    pushToast(`${icon} ${position.signal.asset} ${position.signal.direction} → ${exitLabel[result]}  ${pnl >= 0 ? "+" : ""}${money(pnl)}`, pnl >= 0 ? "success" : "error");
    setBalance(prev => prev + pnl);
    setOpenPositions(prev => prev.filter(p => p.id !== position.id));
    setRealTrades(prev => {
      const next: ClosedTrade[] = [{
        id: position.id, asset: position.signal.asset, mode: position.signal.mode,
        direction: position.signal.direction, entry: position.signal.entry, exit, pnl,
        pnlPct: (pnl / Math.max(position.marginUsed, 0.01)) * 100,
        result, openedAt: position.openedAt, closedAt: new Date().toISOString(),
        source: "real",  // ← solo los reales alimentan el modelo
      }, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Evaluación continua: se llama cada segundo desde el ticker ──
  function evaluatePositionsWithCurrentPrices() {
    const currentPrices = prevPricesRef.current;
    const currentShock = volumeShockRef.current;
    const currentSeries = seriesRef.current;
    const currentLearning = learningRef.current;

    openPositionsRef.current.forEach(position => {
      const px = currentPrices[position.signal.asset];
      const spread = (getSpreadPct(position.signal.asset, currentShock) / 100) * px;
      const tradable = position.signal.direction === "LONG" ? px - spread / 2 : px + spread / 2;
      const peak = Math.max(position.peak, tradable);
      const trough = Math.min(position.trough, tradable);
      const trailDist = position.signal.atr * currentLearning.atrTrailMult;
      const trailingStop = position.signal.direction === "LONG" ? peak - trailDist : trough + trailDist;
      const effectiveStop = position.signal.direction === "LONG"
        ? Math.max(position.signal.stopLoss, trailingStop)
        : Math.min(position.signal.stopLoss, trailingStop);
      const vals = currentSeries[position.signal.asset];
      const ma5 = avg(vals.slice(-5));
      const ma13 = avg(vals.slice(-13));
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
    const lrn = learningRef.current;
    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * lrn.riskScale);
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), signal.entry * 0.0003);
    const size = riskUsd / stopDistance;
    const marginUsed = (size * signal.entry) / leverageByAsset[signal.asset];
    if (marginUsed > equity * 0.65) { pushToast("⚠️ Margen insuficiente para esta posición", "warning"); return; }
    setOpenPositions(prev => [...prev, { id: Date.now(), signal, size, marginUsed, openedAt: new Date().toISOString(), peak: signal.entry, trough: signal.entry }]);
    if (!autoLabel) pushToast(`🚀 ${signal.asset} ${signal.direction} abierto @ ${signal.entry.toFixed(2)} — conf. ${signal.confidence.toFixed(0)}%`, "success");
  }

  // ── Sync — Bybit para todo ──
  async function syncRealData() {
    setIsSyncing(true);
    try {
      const payload = await fetchRealMarketSnapshot(prevPricesRef.current);
      setPrices(payload.prices);
      setSeries(prev => {
        const next = { ...prev };
        assets.forEach(a => {
          const s = payload.seriesMap[a];
          if (s && s.length > 0) next[a] = s;
          else next[a] = [...prev[a].slice(-159), payload.prices[a]];
        });
        return next;
      });
      setCandles(prev => {
        const next = { ...prev };
        assets.forEach(a => {
          if (payload.candleMap[a].length > 0) next[a] = payload.candleMap[a];
        });
        return next;
      });
      setVolumeShock(payload.shock);
      setFeedStatus(`✓ ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} — ${payload.sourceNote}`);
      setLiveReady(true);
    } catch (e) {
      setFeedStatus("❌ Bybit no disponible");
      setLiveReady(false);
      pushToast(`Error al sincronizar: ${e instanceof Error ? e.message : "fallo de red"}`, "error");
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

  // ── Backtest — NO toca realTrades ni el modelo ──
  function runBacktest() {
    if (!liveReady) { pushToast("Sincronice datos reales primero.", "warning"); return; }
    const simulated: ClosedTrade[] = [];
    const returns: number[] = [];
    let equityBt = 100;
    const lrn = learningRef.current;

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
      const tpDist = atr * (mode === "scalping" ? lrn.scalpingTpAtr : lrn.intradayTpAtr);
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
        result, openedAt: new Date(Date.now() - 60000 * 30).toISOString(),
        closedAt: new Date().toISOString(),
        source: "backtest",  // ← marcados como backtest, NO afectan el modelo
      });
      returns.push(pnl);
    }
    if (!simulated.length) { pushToast("No hay suficientes velas.", "warning"); return; }
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
      grossProfit: gp, grossLoss: gl,
      avgWin: wins.length ? gp / wins.length : 0,
      avgLoss: losses.length ? gl / losses.length : 0,
    });

    // Guarda los trades simulados por separado — NO en realTrades
    setBacktestTrades(simulated);
    // NO llama a refreshLearning — el modelo no se toca
    pushToast(`✅ Backtest: ${simulated.length} trades | WR ${((wins.length / simulated.length) * 100).toFixed(1)}%`, "success");
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const NAV: { id: AppTab; label: string; icon: string }[] = [
    { id: "trading", label: "Trading", icon: "📈" },
    { id: "backtest", label: "Backtest", icon: "🔬" },
    { id: "configuracion", label: "Configuración", icon: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <ToastList toasts={toasts} onRemove={removeToast} />

      {/* ── Nav ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,9,16,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 24px", height: 56, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 24 }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em" }}>TraderLab</span>
          <span style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 5, fontWeight: 600 }}>v4</span>
        </div>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {NAV.map(t => (
            <button key={t.id} onClick={() => setAppTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: appTab === t.id ? "rgba(255,255,255,0.1)" : "transparent", color: appTab === t.id ? "var(--text)" : "var(--muted)", transition: "all 0.15s" }}>
              <span>{t.icon}</span>{t.label}
              {t.id === "trading" && openPositions.length > 0 && (
                <span style={{ background: "#10b981", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>{openPositions.length}</span>
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

      {/* ── Header metrics ── */}
      <div style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "12px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 12 }}>
          {[
            { label: "Balance", value: money(balance), color: "var(--text)" },
            { label: "P&L no realizado", value: money(unrealized), color: unrealized >= 0 ? "#10b981" : "#ef4444" },
            { label: "Equity", value: money(equity), color: "var(--text)" },
            { label: "Win rate (real)", value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? "#10b981" : "#ef4444" },
            { label: "Factor ganancia", value: stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1.5 ? "#10b981" : "var(--text)" },
            { label: "Trades reales", value: realTrades.length, color: "var(--muted)" },
            { label: "Posiciones abiertas", value: openPositions.length, color: openPositions.length > 0 ? "#f59e0b" : "var(--muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="metric" style={{ flex: "0 0 auto", minWidth: 110 }}>
              <span className="label">{label}</span>
              <strong style={{ color, fontSize: 16 }}>{value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>

        {/* ━━━━━━━━━ TRADING ━━━━━━━━━ */}
        {appTab === "trading" && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 340px", gap: 16 }}>

            {/* Izq: controles */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

              <div className="card">
                <p className="label" style={{ marginBottom: 6 }}>Activo</p>
                <select className="sel" value={asset} onChange={e => setAsset(e.target.value as Asset)} style={{ width: "100%" }}>
                  {assets.map(a => <option key={a} value={a}>{assetLabel[a]}</option>)}
                </select>
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", fontSize: 11 }}>
                  {[["Precio", prices[asset].toFixed(2)], ["Spread", spreadByAsset[asset].toFixed(3)], ["Apalancamiento", `${leverageByAsset[asset]}×`]].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ color: "var(--muted)" }}>{k}</span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <p className="label" style={{ marginBottom: 6 }}>Riesgo base (%)</p>
                <input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} />
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn-primary" onClick={() => createSignalAndExecute(tab, asset)}>⚡ Generar + ejecutar señal</button>
                <button className="btn-secondary" onClick={() => void syncRealData()} disabled={isSyncing}>{isSyncing ? "⟳ Sincronizando..." : "↻ Sync datos (Bybit)"}</button>
                <button className="btn-secondary" onClick={() => void runAutoScan()}>🔍 Escanear todos los activos</button>
              </div>

              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <p style={{ fontWeight: 600, fontSize: 13 }}>Auto-scan</p>
                  <button onClick={() => setAutoScan(p => !p)} style={{ padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 11, background: autoScan ? "#10b981" : "rgba(255,255,255,0.08)", color: autoScan ? "#fff" : "var(--muted)" }}>
                    {autoScan ? "● ACTIVO" : "○ INACTIVO"}
                  </button>
                </div>
                {autoScan && (
                  <div>
                    <p className="label" style={{ marginBottom: 4 }}>Intervalo (seg)</p>
                    <input className="inp" type="number" min={8} max={120} step={1} value={scanEverySec} onChange={e => setScanEverySec(Number(e.target.value))} />
                  </div>
                )}
              </div>

              {bestHours.length > 0 && (
                <div className="card">
                  <p className="label" style={{ marginBottom: 6 }}>Horas de mayor edge (real)</p>
                  {bestHours.map(({ hour, edge }) => (
                    <div key={hour} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "var(--muted)" }}>{hour}:00</span>
                      <span style={{ color: edge >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>{edge >= 0 ? "+" : ""}{edge.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="card" style={{ fontSize: 11 }}>
                <p className="label" style={{ marginBottom: 6 }}>Modelo adaptativo (aprendizaje real)</p>
                {[["Trailing ATR", learning.atrTrailMult.toFixed(2)], ["TP scalp", `${learning.scalpingTpAtr.toFixed(2)} ATR`], ["TP intradía", `${learning.intradayTpAtr.toFixed(2)} ATR`], ["Piso confianza", `${learning.confidenceFloor.toFixed(0)}%`], ["Escala riesgo", `${learning.riskScale.toFixed(2)}×`]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ color: "var(--muted)" }}>{k}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{v}</span>
                  </div>
                ))}
                <p style={{ marginTop: 8, fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>Solo aprende de {realTrades.length} trades reales ejecutados.</p>
              </div>
            </div>

            {/* Centro: gráfico + posiciones */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="card" style={{ padding: "14px 14px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <h2 style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>{asset}</h2>
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>{tab === "intradia" ? "Confluencia multitemporal" : "Ejecución scalping"} — Bybit</p>
                  </div>
                  {lastSignal && lastSignal.asset === asset && (
                    <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                      {[["HTF", lastSignal.mtf.htf], ["LTF", lastSignal.mtf.ltf], ["Exec", lastSignal.mtf.exec]].map(([k, v]) => (
                        <span key={k as string}>{k}: <strong style={{ color: (v as number) >= 0 ? "#10b981" : "#ef4444" }}>{(v as number).toFixed(2)}</strong></span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ borderRadius: 10, overflow: "hidden", background: "rgba(0,0,0,0.3)", padding: "8px 4px 4px" }}>
                  <CandlestickChart candles={visibleCandles} />
                </div>
              </div>

              {lastSignal && (
                <div className="card" style={{ borderLeft: `3px solid ${lastSignal.direction === "LONG" ? "#10b981" : "#ef4444"}` }}>
                  <p className="label" style={{ marginBottom: 6 }}>Última señal generada</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                    {[["Activo", lastSignal.asset], ["Dirección", lastSignal.direction], ["Entrada", lastSignal.entry.toFixed(2)], ["Stop Loss", lastSignal.stopLoss.toFixed(2)], ["Take Profit", lastSignal.takeProfit.toFixed(2)], ["Confianza", `${lastSignal.confidence.toFixed(0)}%`]].map(([k, v]) => (
                      <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 8px" }}>
                        <p style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{k}</p>
                        <p style={{ fontWeight: 700, color: k === "Dirección" ? (v === "LONG" ? "#10b981" : "#ef4444") : "var(--text)" }}>{v}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>{lastSignal.rationale}</p>
                </div>
              )}

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 14 }}>Posiciones abiertas</h3>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>— evaluación continua cada 1s</span>
                  {openPositions.length > 0 && (
                    <span style={{ background: "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>{openPositions.length} activa{openPositions.length > 1 ? "s" : ""}</span>
                  )}
                </div>
                {openPositions.length === 0 ? (
                  <div className="card" style={{ textAlign: "center", padding: "28px 16px", color: "var(--muted)", fontSize: 13 }}>Sin posiciones abiertas</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {openPositions.map(p => (
                      <LivePositionCard key={p.id} position={p} prices={prices} spreadByAsset={spreadByAsset} now={now}
                        onClose={pos => closePosition(pos, prices[pos.signal.asset], "REVERSAL")} />
                    ))}
                  </div>
                )}
              </div>

              {realTrades.length >= 2 && (
                <div className="card">
                  <EquityCurve trades={realTrades} height={70} />
                </div>
              )}
            </div>

            {/* Der: stats + historial real */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 10 }}>Estadísticas — trades reales</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["Total trades", stats.total], ["Win rate", `${stats.winRate.toFixed(1)}%`], ["Expectativa", money(stats.expectancy)], ["Factor ganancia", stats.profitFactor.toFixed(2)], ["Sharpe", stats.sharpe.toFixed(2)], ["Max drawdown", `${stats.maxDrawdown.toFixed(1)}%`], ["P&L total", money(stats.pnl)], ["Pos. abiertas", openPositions.length]].map(([label, value]) => (
                    <div key={label} className="metric">
                      <span className="label">{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card" style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, marginBottom: 10 }}>Historial real</p>
                <TradeHistory trades={realTrades} />
              </div>
              <div className="card" style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
                <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Fuente de datos</p>
                <p>Todos los activos: Bybit API v5</p>
                <p>Velas 1m en tiempo real</p>
                <p>Trailing stop: {learning.atrTrailMult.toFixed(2)} ATR</p>
              </div>
            </div>
          </div>
        )}

        {/* ━━━━━━━━━ BACKTEST ━━━━━━━━━ */}
        {appTab === "backtest" && (
          <BacktestTab
            liveReady={liveReady} backtestSize={backtestSize} setBacktestSize={setBacktestSize}
            riskPct={riskPct} setRiskPct={setRiskPct}
            runBacktest={runBacktest} lastBacktest={lastBacktest} backtestTrades={backtestTrades}
          />
        )}

        {/* ━━━━━━━━━ CONFIGURACIÓN ━━━━━━━━━ */}
        {appTab === "configuracion" && (
          <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🤖 IA de ejecución (Groq)</p>
              <p className="label" style={{ marginBottom: 6 }}>API Key Groq</p>
              <input className="inp" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="gsk_..." />
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className={usingGroq ? "btn-primary" : "btn-secondary"} onClick={() => setUsingGroq(p => !p)} style={{ flex: 1 }}>
                  {usingGroq ? "✅ Motor: Groq IA" : "○ Motor: lógica local"}
                </button>
                <button className="btn-secondary" onClick={testAiConnection} disabled={!apiKey.trim() || !usingGroq}>Probar conexión</button>
              </div>
              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: 12 }}>
                <AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} />
                <p style={{ color: "var(--muted)", marginTop: 8 }}>
                  {aiStatus === "ok" && "✅ Groq filtra señales antes de abrir posiciones."}
                  {aiStatus === "error" && "❌ Verificar API Key y créditos disponibles."}
                  {aiStatus === "disabled" && `Motor local: usa confianza ≥${learning.confidenceFloor.toFixed(0)}% como filtro.`}
                  {aiStatus === "idle" && apiKey && "API Key ingresada. Probá la conexión."}
                </p>
              </div>
            </div>

            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>📡 Feed de datos — Bybit</p>
              <div style={{ fontSize: 12, lineHeight: 2 }}>
                <p><strong>Fuente:</strong> Bybit API v5 (todos los activos)</p>
                <p><strong>BTC, ETH:</strong> BTCUSDT, ETHUSDT (perpetuos)</p>
                <p><strong>Oro, Plata:</strong> XAUUSD, XAGUSD (perpetuos)</p>
                <p><strong>Estado:</strong> <span style={{ color: liveReady ? "#10b981" : "#ef4444" }}>{feedStatus}</span></p>
              </div>
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => void syncRealData()} disabled={isSyncing}>
                {isSyncing ? "⟳ Sincronizando..." : "↻ Sincronizar ahora"}
              </button>
            </div>

            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🧠 Modelo adaptativo</p>
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", fontSize: 12, color: "#6ee7b7", marginBottom: 12 }}>
                El modelo <strong>solo aprende de trades reales</strong> ejecutados en la pestaña Trading. El backtest corre en un entorno completamente aislado y no modifica ningún parámetro del modelo.
              </div>
              <div style={{ fontSize: 12 }}>
                <p style={{ color: "var(--muted)" }}>Trades reales acumulados: <strong style={{ color: "var(--text)" }}>{realTrades.length}</strong></p>
                <p style={{ color: "var(--muted)", marginTop: 4 }}>Trades de backtest (aislados): <strong style={{ color: "#a5b4fc" }}>{backtestTrades.length}</strong></p>
              </div>
            </div>

            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🔄 Auto-scan</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <button onClick={() => setAutoScan(p => !p)} style={{ padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, background: autoScan ? "#10b981" : "rgba(255,255,255,0.08)", color: autoScan ? "#fff" : "var(--muted)" }}>
                  {autoScan ? "● ACTIVO" : "○ INACTIVO"}
                </button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{autoScan ? `Escanea cada ${scanEverySec}s` : "Desactivado"}</span>
              </div>
              <p className="label" style={{ marginBottom: 6 }}>Intervalo (segundos)</p>
              <input className="inp" type="number" min={8} max={300} step={1} value={scanEverySec} onChange={e => setScanEverySec(Number(e.target.value))} style={{ width: 120 }} />
            </div>

            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>🔁 Reiniciar simulación</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Restablece balance a $100, borra trades reales y reinicia el modelo. Los datos de backtest se borran por separado.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  onClick={() => { setBalance(100); setOpenPositions([]); setRealTrades([]); setLearning(initialLearning); setLastSignal(null); pushToast("Simulación real reiniciada.", "info"); }}>
                  Reiniciar trading real
                </button>
                <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  onClick={() => { setBacktestTrades([]); setLastBacktest(null); pushToast("Datos de backtest borrados.", "info"); }}>
                  Limpiar backtest
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
