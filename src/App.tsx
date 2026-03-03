import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Asset = "BTCUSD" | "ETHUSD" | "XAGUSD" | "XAUUSD";
type Mode = "scalping" | "intradia";
type Direction = "LONG" | "SHORT";
type ExitReason = "TP" | "SL" | "TRAIL" | "REVERSAL";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

// ─── Tipos de Order Flow / Market Control ─────────────────────────────────
type FootprintCandle = {
  t: number; o: number; h: number; l: number; c: number; v: number;
  buyVol: number;    // volumen estimado de agresores compradores
  sellVol: number;   // volumen estimado de agresores vendedores
  delta: number;     // buyVol - sellVol
  deltaPct: number;  // delta / v * 100
  absorption: "buy" | "sell" | "none"; // absorción detectada
  initiative: "buy" | "sell" | "neutral"; // quién tomó iniciativa
};

type VolumeProfileFull = {
  poc: number;       // Point of Control — precio con más volumen negociado
  vah: number;       // Value Area High (70% del volumen)
  val: number;       // Value Area Low
  hvn: number[];     // High Volume Nodes — zonas de aceptación de precio
  lvn: number[];     // Low Volume Nodes — zonas de rechazo (vacíos)
  profile: Array<{ price: number; vol: number; buyVol: number; sellVol: number }>;
  valueAreaPct: number; // qué % del rango es el Value Area
};

type CVDAnalysis = {
  cvd50: number;      // CVD últimas 50 velas (tendencia)
  cvd20: number;      // CVD últimas 20 velas (estructura)
  cvd10: number;      // CVD últimas 10 velas (momentum)
  cvd5:  number;      // CVD últimas 5 velas (ejecución)
  slope50: number;    // pendiente CVD50
  slope10: number;    // pendiente CVD10
  divergence: boolean; // precio sube pero CVD baja (o viceversa) → divergencia
  trend: "bullish" | "bearish" | "neutral";
};

type OrderFlowScore = {
  // Control de mercado: quién domina bid/ask
  control: "bulls" | "bears" | "contested"; // control neto
  controlScore: number;    // -100 (osos totales) a +100 (toros totales)
  // Componentes individuales
  cvdScore: number;        // contribución CVD
  footprintScore: number;  // contribución footprint
  profileScore: number;    // contribución volume profile
  absorptionScore: number; // contribución absorción
  // Detalles
  cvd: CVDAnalysis;
  profile: VolumeProfileFull;
  footprint: FootprintCandle[];
  // Señales de trading
  longSetup: boolean;      // condiciones para LONG confirmadas
  shortSetup: boolean;     // condiciones para SHORT confirmadas
  setupStrength: number;   // 0-1, fuerza del setup
  narrative: string;       // descripción en español
};
// ─── MarketControl (legacy, mantenido para compatibilidad con analyzeMarketControl) ───
type MarketControl = {
  score: number;         // -100 a +100
  bias: "bull" | "bear" | "neutral";
  cvd: number;
  cvdSlope: number;
  poc: number;
  vah: number;
  val: number;
  vwapDev: number;
  bidAskImbalance: number;
  dominantSide: "buyers" | "sellers" | "balanced";
};

// ─── ScalpingRisk (gestión de riesgo diario y ruina) ─────────────────────────
type ScalpingRisk = {
  dailyPnl: number;
  dailyTrades: number;
  ruinRisk: number;
  ruinProb: number;
  mathExpectancy: number;
  kellyFraction: number;
  kellyWR: number;
  kellyRR: number;
  blocked: boolean;
  blockReason: string;
  sizeMultiplier: number;
  streak: number;
};

type AppTab = "trading" | "backtest" | "configuracion";

// ── Wyckoff ──
type WyckoffPhase = "A" | "B" | "C" | "D" | "E" | "unknown";
type WyckoffBias = "accumulation" | "distribution" | "neutral";
type WyckoffEvent = {
  label: string;          // SC, AR, ST, Spring, UTAD, SOS, SOW, LPS, LPSY
  candleIndex: number;    // índice dentro del array visible
  price: number;
  color: string;
};
type WyckoffAnalysis = {
  phase: WyckoffPhase;
  bias: WyckoffBias;
  events: WyckoffEvent[];
  supportZone: [number, number] | null;   // [low, high]
  resistanceZone: [number, number] | null;
  volumeClimaxIdx: number[];
  narrative: string;
};

// ── Indicators ──
type Indicators = {
  rsi: number;
  rsiDivergence: "bullish" | "bearish" | "none";
  stochK: number; stochD: number;
  ma5: number; ma10: number; ma20: number; ma50: number;
  vwap: number;
  vwapUpperBand1: number; vwapLowerBand1: number;
  vwapUpperBand2: number; vwapLowerBand2: number;
  bbUpper: number; bbMiddle: number; bbLower: number;
  bbSqueeze: boolean;
  volumeDelta: number;       // positivo = presión compradora
  volumeDeltaPct: number;    // % respecto al volumen total
  imbalances: Array<{ idx: number; type: "bullish" | "bearish"; price: number }>;
  atr: number;
  keltnerUpper: number; keltnerLower: number;
};

type Signal = {
  asset: Asset; mode: Mode; direction: Direction;
  entry: number; stopLoss: number; takeProfit: number;
  confidence: number; spreadPct: number; atr: number;
  mtf: { htf: number; ltf: number; exec: number };
  indicators: Indicators;
  wyckoff: WyckoffAnalysis;
  rationale: string;
  aiRationale?: string;
  aiRiskNotes?: string;
};

type Position = {
  id: number; signal: Signal; size: number; marginUsed: number;
  openedAt: string; peak: number; trough: number;
};

type ClosedTrade = {
  id: number; asset: Asset; mode: Mode; direction: Direction;
  entry: number; exit: number; pnl: number; pnlPct: number;
  result: ExitReason; openedAt: string; closedAt: string;
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

// ── Fuentes de datos por activo ─────────────────────────────────────────────
// BTC/ETH/Oro → Bybit V5 linear (API pública, category=linear, sin auth)
// Plata → Binance spot XAGUSDT (precio real ~32 usd; Bybit no tiene XAG perpetuo)
const bybitLinearSymbol: Partial<Record<Asset, string>> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XAUUSD: "XAUTUSDT",  // XAU tokenizado perpetuo linear — precio real del oro
};
// Binance Futures perpetuo para XAG (mismo formato que Bybit klines)
// fapi.binance.com — precios del contrato perpetuo XAGUSDT, 50x leverage
const binanceFuturesSymbol: Partial<Record<Asset, string>> = {
  XAGUSD: "XAGUSDT",   // Plata — Binance Futures perpetuo (Bybit no tiene XAG linear)
};

const assetLabel: Record<Asset, string> = {
  BTCUSD: "BTC/USD (100×)", ETHUSD: "ETH/USD (100×)",
  XAGUSD: "Plata XAG (50×)", XAUUSD: "Oro XAU (100×)",
};

const initialPrices: Record<Asset, number> = {
  BTCUSD: 63500, ETHUSD: 3250, XAGUSD: 29.4, XAUUSD: 2330,
};

const leverageByAsset: Record<Asset, number> = {
  BTCUSD: 100, ETHUSD: 100, XAGUSD: 50, XAUUSD: 100,
};
// ATR mínimo por activo — evita sizing explosivo en mercados de bajo precio
// XAGUSD ~32 usd: ATR 1m mínimo realista = 0.05 usd (0.15%)
// XAUUSD ~3300 usd: ATR 1m mínimo = 1.5 usd
// BTC ~95000 usd: ATR 1m mínimo = 50 usd
const minAtrByAsset: Record<Asset, number> = {
  BTCUSD: 50, ETHUSD: 5, XAGUSD: 0.08, XAUUSD: 2.0,
};

const initialLearning: LearningModel = {
  riskScale: 1, confidenceFloor: 52, scalpingTpAtr: 1.35,
  intradayTpAtr: 3.5, atrTrailMult: 0.35, hourEdge: {},
};

const exitLabel: Record<ExitReason, string> = {
  TP: "TP ✓", SL: "SL ✗", TRAIL: "Trail ⟳", REVERSAL: "Reversión ↩",
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
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
function emaFull(arr: number[], period: number): number[] {
  if (!arr.length) return [];
  const alpha = 2 / (period + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(alpha * arr[i] + (1 - alpha) * out[i - 1]);
  return out;
}
function calcAtr(candles: Candle[], lookback: number): number {
  const data = candles.slice(-lookback);
  if (data.length < 2) return 0;
  const trs = data.slice(1).map((c, i) =>
    Math.max(c.h - c.l, Math.abs(c.h - data[i].c), Math.abs(c.l - data[i].c))
  );
  return avg(trs);
}
function calcAtrFromSeries(arr: number[], lookback: number): number {
  const data = arr.slice(-lookback);
  if (data.length < 2) return 0;
  return avg(data.slice(1).map((v, i) => Math.abs(v - data[i])));
}
// ─── Modelo de spread CFD realista ───────────────────────────────────────────
type SpreadSnapshot = {
  spread: number; spreadPct: number; bid: number; ask: number;
  component: { base: number; volume: number; session: number };
  sessionLabel: string; isHighVolume: boolean;
};
const CFD_BASE_SPREAD_PCT: Record<Asset, number> = {
  BTCUSD: 0.016, ETHUSD: 0.025, XAUUSD: 0.008, XAGUSD: 0.045,
};
function calcCFDSpread(asset: Asset, price: number, shock: number): SpreadSnapshot {
  const hourUTC = new Date().getUTCHours();
  const dayUTC  = new Date().getUTCDay();
  const basePct = CFD_BASE_SPREAD_PCT[asset];
  // Componente volumen: curva no lineal — spread triplica en picos de volatilidad
  const shockMult  = 1 + Math.pow(Math.max(shock - 0.08, 0) / 0.4, 1.6) * 1.8;
  const volumePct  = basePct * (shockMult - 1);
  // Componente sesión UTC
  let sessionMult = 1.0; let sessionLabel = "NY";
  const isWeekend = dayUTC === 0 || dayUTC === 6;
  if      (isWeekend)                        { sessionMult = 1.6;  sessionLabel = "OFF"; }
  else if (hourUTC >= 13 && hourUTC < 21)    { sessionMult = 1.0;  sessionLabel = "NY"; }
  else if (hourUTC >= 7  && hourUTC < 16)    { sessionMult = 1.05; sessionLabel = "LONDON"; }
  else if (hourUTC >= 0  && hourUTC < 7)     { sessionMult = 1.35; sessionLabel = "ASIA"; }
  else                                        { sessionMult = 1.20; sessionLabel = "OVERLAP"; }
  // Metales: sesión importa menos (market makers globales)
  if (asset === "XAUUSD" || asset === "XAGUSD") sessionMult = 1 + (sessionMult - 1) * 0.4;
  const sessionPct = basePct * (sessionMult - 1);
  const totalPct   = (basePct + volumePct + sessionPct) * sessionMult;
  const spread     = totalPct / 100 * price;
  return {
    spread, spreadPct: totalPct,
    bid: price - spread / 2, ask: price + spread / 2,
    component: { base: basePct/100*price, volume: volumePct/100*price, session: sessionPct/100*price },
    sessionLabel, isHighVolume: shock > 0.5 || isWeekend,
  };
}
function getSpreadPct(asset: Asset, shock: number, price?: number) {
  const p = price ?? (asset==="BTCUSD"?95000:asset==="ETHUSD"?3000:asset==="XAUUSD"?3300:32);
  return calcCFDSpread(asset, p, shock).spreadPct;
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

// ─── Indicators Engine ────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return closes.map(() => 50);
  const gains: number[] = []; const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const rsiArr: number[] = new Array(period).fill(50);
  let avgG = avg(gains.slice(0, period));
  let avgL = avg(losses.slice(0, period));
  rsiArr.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  for (let i = period; i < gains.length; i++) {
    avgG = (avgG * (period - 1) + gains[i]) / period;
    avgL = (avgL * (period - 1) + losses[i]) / period;
    rsiArr.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  }
  return rsiArr;
}

function calcStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number; d: number } {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const kArr: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map(c => c.h));
    const low  = Math.min(...slice.map(c => c.l));
    const range = Math.max(high - low, 1e-9);
    kArr.push(((candles[i].c - low) / range) * 100);
  }
  const dArr: number[] = [];
  for (let i = dPeriod - 1; i < kArr.length; i++) dArr.push(avg(kArr.slice(i - dPeriod + 1, i + 1)));
  return { k: kArr[kArr.length - 1], d: dArr.length > 0 ? dArr[dArr.length - 1] : kArr[kArr.length - 1] };
}
function calcMAs(closes: number[]): { ma10: number; ma20: number; ma50: number } {
  return {
    ma10: closes.length >= 10 ? avg(closes.slice(-10)) : closes[closes.length - 1],
    ma20: closes.length >= 20 ? avg(closes.slice(-20)) : closes[closes.length - 1],
    ma50: closes.length >= 50 ? avg(closes.slice(-50)) : avg(closes),
  };
}
function detectRsiDivergence(closes: number[], rsi: number[], lookback = 20): "bullish" | "bearish" | "none" {
  if (closes.length < lookback) return "none";
  const priceSlice = closes.slice(-lookback);
  const rsiSlice = rsi.slice(-lookback);
  const priceMin = Math.min(...priceSlice); const rsiAtPriceMin = rsiSlice[priceSlice.indexOf(priceMin)];
  const priceMax = Math.max(...priceSlice); const rsiAtPriceMax = rsiSlice[priceSlice.indexOf(priceMax)];
  const prevMin = Math.min(...priceSlice.slice(0, -5));
  const prevRsiMin = rsiSlice[priceSlice.slice(0, -5).indexOf(prevMin)];
  const prevMax = Math.max(...priceSlice.slice(0, -5));
  const prevRsiMax = rsiSlice[priceSlice.slice(0, -5).indexOf(prevMax)];
  // Bullish div: precio hace LL pero RSI hace HL
  if (priceMin < prevMin && rsiAtPriceMin > prevRsiMin + 2) return "bullish";
  // Bearish div: precio hace HH pero RSI hace LH
  if (priceMax > prevMax && rsiAtPriceMax < prevRsiMax - 2) return "bearish";
  return "none";
}

function calcVWAP(candles: Candle[]): { vwap: number; upper1: number; lower1: number; upper2: number; lower2: number } {
  if (!candles.length) return { vwap: 0, upper1: 0, lower1: 0, upper2: 0, lower2: 0 };
  // VWAP diario: reset en cada sesión (usamos todas las velas disponibles como proxy)
  let cumTP = 0; let cumVol = 0; const tpVwap: number[] = [];
  candles.forEach(c => {
    const tp = (c.h + c.l + c.c) / 3;
    cumTP += tp * c.v;
    cumVol += c.v;
    tpVwap.push(cumVol > 0 ? cumTP / cumVol : tp);
  });
  const vwap = tpVwap[tpVwap.length - 1];
  // Bandas: desviación estándar del precio respecto al VWAP
  const devs = candles.map((c, i) => ((c.h + c.l + c.c) / 3 - tpVwap[i]) ** 2 * c.v);
  const variance = avg(devs) / Math.max(avg(candles.map(c => c.v)), 1e-9);
  const sigma = Math.sqrt(Math.max(variance, 0));
  return { vwap, upper1: vwap + sigma, lower1: vwap - sigma, upper2: vwap + 2 * sigma, lower2: vwap - 2 * sigma };
}

function calcBollinger(closes: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number } {
  const slice = closes.slice(-period);
  if (slice.length < period) return { upper: closes[closes.length - 1], middle: closes[closes.length - 1], lower: closes[closes.length - 1] };
  const middle = avg(slice);
  const sigma = std(slice);
  return { upper: middle + mult * sigma, middle, lower: middle - mult * sigma };
}

function calcKeltner(candles: Candle[], period = 20, mult = 1.5): { upper: number; lower: number } {
  const closes = candles.map(c => c.c);
  const m = ema(closes.slice(-period), period);
  const atr = calcAtr(candles, period);
  return { upper: m + mult * atr, lower: m - mult * atr };
}

function calcVolumeDelta(candles: Candle[], lookback = 20): { delta: number; pct: number } {
  const slice = candles.slice(-lookback);
  let buyVol = 0; let sellVol = 0;
  slice.forEach(c => {
    // Aproximación: vela alcista = presión compradora proporcional al cuerpo
    const body = Math.abs(c.c - c.o);
    const range = Math.max(c.h - c.l, 1e-9);
    const buyFrac = c.c >= c.o ? 0.5 + 0.5 * (body / range) : 0.5 - 0.5 * (body / range);
    buyVol += c.v * buyFrac;
    sellVol += c.v * (1 - buyFrac);
  });
  const total = buyVol + sellVol;
  return { delta: buyVol - sellVol, pct: total > 0 ? ((buyVol - sellVol) / total) * 100 : 0 };
}

function detectImbalances(candles: Candle[], lookback = 60): Array<{ idx: number; type: "bullish" | "bearish"; price: number }> {
  const slice = candles.slice(-lookback);
  const avgVol = avg(slice.map(c => c.v));
  const result: Array<{ idx: number; type: "bullish" | "bearish"; price: number }> = [];
  slice.forEach((c, i) => {
    const body = Math.abs(c.c - c.o);
    const range = Math.max(c.h - c.l, 1e-9);
    const bodyRatio = body / range;
    const volSpike = c.v > avgVol * 1.5;
    if (bodyRatio > 0.68 && volSpike) {
      result.push({
        idx: candles.length - lookback + i,
        type: c.c >= c.o ? "bullish" : "bearish",
        price: (c.h + c.l) / 2,
      });
    }
  });
  return result.slice(-6); // máximo 6 imbalances visibles
}

function computeIndicators(candles: Candle[]): Indicators {
  if (candles.length < 25) {
    const p = candles[candles.length - 1]?.c ?? 0;
    return {
      rsi: 50, rsiDivergence: "none", stochK: 50, stochD: 50, ma5: p, ma10: p, ma20: p, ma50: p, vwap: p,
      vwapUpperBand1: p, vwapLowerBand1: p, vwapUpperBand2: p, vwapLowerBand2: p,
      bbUpper: p, bbMiddle: p, bbLower: p, bbSqueeze: false,
      volumeDelta: 0, volumeDeltaPct: 0, imbalances: [],
      atr: 0, keltnerUpper: p, keltnerLower: p,
    };
  }
  const closes = candles.map(c => c.c);
  const lastClose = closes[closes.length - 1] ?? 0;
  const rsiArr = calcRSI(closes);
  const rsi = rsiArr[rsiArr.length - 1];
  const rsiDivergence = detectRsiDivergence(closes, rsiArr);
  const { k: stochK, d: stochD } = calcStochastic(candles, 14, 3);
  const mas = calcMAs(closes);
  const ma5 = closes.length >= 5 ? avg(closes.slice(-5)) : lastClose;
  const vwapData = calcVWAP(candles);
  const bb = calcBollinger(closes);
  const keltner = calcKeltner(candles);
  const bbSqueeze = bb.upper < keltner.upper && bb.lower > keltner.lower;
  const { delta, pct } = calcVolumeDelta(candles);
  const imbalances = detectImbalances(candles);
  const atr = calcAtr(candles, 14);
  return {
    rsi, rsiDivergence, stochK, stochD,
    ma5, ma10: mas.ma10, ma20: mas.ma20, ma50: mas.ma50,
    vwap: vwapData.vwap, vwapUpperBand1: vwapData.upper1, vwapLowerBand1: vwapData.lower1,
    vwapUpperBand2: vwapData.upper2, vwapLowerBand2: vwapData.lower2,
    bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower, bbSqueeze,
    volumeDelta: delta, volumeDeltaPct: pct,
    imbalances, atr, keltnerUpper: keltner.upper, keltnerLower: keltner.lower,
  };
}

// ─── Wyckoff Engine ───────────────────────────────────────────────────────────

// Construye velas sintéticas agregando N velas de 1m → 1 vela de N minutos
function buildSyntheticTF(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map(c => c.h)),
      l: Math.min(...slice.map(c => c.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((a, c) => a + c.v, 0),
    });
  }
  return out;
}

// Wyckoff en un solo TF (lógica extraída para reusar en MTF)
function analyzeWyckoffSingle(candles: Candle[]): WyckoffAnalysis {
  const empty: WyckoffAnalysis = {
    phase: "unknown", bias: "neutral", events: [],
    supportZone: null, resistanceZone: null,
    volumeClimaxIdx: [], narrative: "Datos insuficientes para análisis Wyckoff.",
  };
  if (candles.length < 40) return empty;

  const window = candles.slice(-120); // últimas 120 velas
  const closes = window.map(c => c.c);
  const highs = window.map(c => c.h);
  const lows = window.map(c => c.l);
  const vols = window.map(c => c.v);
  const avgVol = avg(vols);
  const avgRange = avg(window.map(c => c.h - c.l));

  // 1. Detectar climax de volumen (volumen >2x promedio + rango amplio)
  const climaxIdx: number[] = [];
  window.forEach((c, i) => {
    if (c.v > avgVol * 2 && (c.h - c.l) > avgRange * 1.4) climaxIdx.push(i);
  });

  const events: WyckoffEvent[] = [];

  // 2. Selling Climax (SC): vela bajista de alto volumen en mínimos recientes
  const priceMin = Math.min(...lows);
  const scIdx = lows.indexOf(priceMin);
  if (scIdx >= 0 && window[scIdx].v > avgVol * 1.6 && window[scIdx].c < window[scIdx].o) {
    events.push({ label: "SC", candleIndex: scIdx, price: lows[scIdx], color: "#10b981" });
  }

  // 3. Automatic Rally (AR): rally fuerte tras SC
  if (scIdx >= 0 && scIdx < window.length - 5) {
    const arSlice = highs.slice(scIdx, scIdx + 15);
    const arHigh = Math.max(...arSlice);
    const arIdx = scIdx + arSlice.indexOf(arHigh);
    if (arHigh > closes[scIdx] * 1.005) {
      events.push({ label: "AR", candleIndex: arIdx, price: arHigh, color: "#6366f1" });
    }
  }

  // 4. Secondary Test (ST): regresa a zona SC con menor volumen
  const stCandidates = window.slice(scIdx + 5).map((c, i) => ({ c, i: scIdx + 5 + i }))
    .filter(({ c, i }) => lows[i] < priceMin * 1.006 && c.v < avgVol * 1.2 && i > scIdx + 3);
  if (stCandidates.length > 0) {
    const st = stCandidates[0];
    events.push({ label: "ST", candleIndex: st.i, price: lows[st.i], color: "#f59e0b" });
  }

  // 5. Spring: falso quiebre por debajo del soporte (fase C acumulación)
  const supportLevel = priceMin;
  const springCandidates = window.slice(-30).map((c, i) => ({ c, i: window.length - 30 + i }))
    .filter(({ c, i }) => lows[i] < supportLevel * 0.998 && closes[i] > supportLevel && c.v > avgVol * 0.8);
  if (springCandidates.length > 0) {
    const sp = springCandidates[0];
    events.push({ label: "Spring", candleIndex: sp.i, price: lows[sp.i], color: "#10b981" });
  }

  // 6. Buying Climax (BC): vela alcista de alto volumen en máximos (distribución)
  const priceMax = Math.max(...highs);
  const bcIdx = highs.indexOf(priceMax);
  if (bcIdx >= 0 && window[bcIdx].v > avgVol * 1.6 && window[bcIdx].c > window[bcIdx].o && bcIdx > scIdx + 10) {
    events.push({ label: "BC", candleIndex: bcIdx, price: highs[bcIdx], color: "#ef4444" });
  }

  // 7. UTAD: falso quiebre por encima de la resistencia (distribución fase C)
  const resistanceLevel = priceMax;
  const utadCandidates = window.slice(-30).map((c, i) => ({ c, i: window.length - 30 + i }))
    .filter(({ c, i }) => highs[i] > resistanceLevel * 1.002 && closes[i] < resistanceLevel && c.v > avgVol * 1.2);
  if (utadCandidates.length > 0) {
    const ut = utadCandidates[0];
    events.push({ label: "UTAD", candleIndex: ut.i, price: highs[ut.i], color: "#ef4444" });
  }

  // 8. SOS / SOW (Sign of Strength / Weakness): expansión de rango con volumen
  const sosWCandidates = window.slice(-20).map((c, i) => ({ c, i: window.length - 20 + i }))
    .filter(({ c }) => c.v > avgVol * 1.5 && (c.h - c.l) > avgRange * 1.3);
  sosWCandidates.forEach(({ c, i }) => {
    if (c.c > c.o && c.c > closes[Math.max(0, i - 3)]) {
      events.push({ label: "SOS", candleIndex: i, price: c.h, color: "#10b981" });
    } else if (c.c < c.o) {
      events.push({ label: "SOW", candleIndex: i, price: c.l, color: "#ef4444" });
    }
  });

  // 9. LPS / LPSY
  const lastSosIdx = events.filter(e => e.label === "SOS").at(-1)?.candleIndex ?? -1;
  if (lastSosIdx > 0 && lastSosIdx < window.length - 3) {
    const lpsSlice = window.slice(lastSosIdx).map((c, i) => ({ c, i: lastSosIdx + i }))
      .filter(({ c, i }) => lows[i] > supportLevel && c.v < avgVol * 0.9);
    if (lpsSlice.length > 0) {
      events.push({ label: "LPS", candleIndex: lpsSlice[0].i, price: lows[lpsSlice[0].i], color: "#6366f1" });
    }
  }

  // 10. Determinar fase y bias
  const hasSpring = events.some(e => e.label === "Spring");
  const hasSOS = events.some(e => e.label === "SOS");
  const hasUTAD = events.some(e => e.label === "UTAD");
  const hasSOW = events.some(e => e.label === "SOW");
  const hasBC = events.some(e => e.label === "BC");
  const hasSC = events.some(e => e.label === "SC");
  const hasAR = events.some(e => e.label === "AR");

  let phase: WyckoffPhase = "unknown";
  let bias: WyckoffBias = "neutral";
  let narrative = "";

  if (hasSOS && !hasSOW) { phase = "E"; bias = "accumulation"; }
  else if (hasSpring && hasSOS) { phase = "D"; bias = "accumulation"; }
  else if (hasSpring) { phase = "C"; bias = "accumulation"; }
  else if (hasSC && hasAR) { phase = "B"; bias = "neutral"; }
  else if (hasSC) { phase = "A"; bias = "accumulation"; }
  else if (hasUTAD && hasSOW) { phase = "D"; bias = "distribution"; }
  else if (hasUTAD) { phase = "C"; bias = "distribution"; }
  else if (hasBC && hasAR) { phase = "B"; bias = "distribution"; }
  else if (hasBC) { phase = "A"; bias = "distribution"; }

  const phaseLabel = phase === "unknown" ? "sin patrón claro" : `Fase ${phase}`;
  const biasLabel = bias === "accumulation" ? "Acumulación" : bias === "distribution" ? "Distribución" : "Lateral/neutral";

  narrative = `${biasLabel} — ${phaseLabel}. `;
  if (bias === "accumulation" && phase === "C") narrative += "Spring detectado: posible punto de inflexión alcista.";
  else if (bias === "accumulation" && phase === "D") narrative += "SOS confirma inicio de tendencia alcista. Buscar LPS para entrada.";
  else if (bias === "accumulation" && phase === "E") narrative += "Tendencia alcista activa. Operar en retrocesos a VWAP o soportes previos.";
  else if (bias === "distribution" && phase === "C") narrative += "UTAD detectado: posible trampa alcista antes de caída.";
  else if (bias === "distribution" && phase === "D") narrative += "SOW confirma debilidad. Buscar LPSY para entrada SHORT.";
  else if (phase === "B") narrative += "Rango de construcción activo. Esperar resolución de fase C.";
  else narrative += "Monitorear volumen y estructura de precio.";

  // Zonas de soporte/resistencia
  const supportZone: [number, number] = [priceMin * 0.998, priceMin * 1.003];
  const resistanceZone: [number, number] = [priceMax * 0.997, priceMax * 1.002];

  return {
    phase, bias, events,
    supportZone: hasSC ? supportZone : null,
    resistanceZone: hasBC ? resistanceZone : null,
    volumeClimaxIdx: climaxIdx,
    narrative,
  };
}

// Wyckoff multi-timeframe: analiza 1m, 5m sintético y 15m sintético
// Devuelve el análisis del TF más alto con señal definida, más un wyckoffMultiplier
function analyzeWyckoff(candles: Candle[]): WyckoffAnalysis & { wyckoffLotMult: number } {
  // Construir TFs sintéticos
  const tf5  = buildSyntheticTF(candles, 5);   // ~5m
  const tf15 = buildSyntheticTF(candles, 15);  // ~15m

  const w1  = analyzeWyckoffSingle(candles.slice(-80));
  const w5  = tf5.length  >= 20 ? analyzeWyckoffSingle(tf5.slice(-60))  : null;
  const w15 = tf15.length >= 10 ? analyzeWyckoffSingle(tf15.slice(-40)) : null;

  // Calcular confluencia: cuántos TFs coinciden en bias
  const biases = [w1.bias, w5?.bias, w15?.bias].filter(Boolean);
  const bullBiases = biases.filter(b => b === "accumulation").length;
  const bearBiases = biases.filter(b => b === "distribution").length;
  const totalTFs = biases.length;

  // TF dominante: usar el más alto con señal definida
  const dominant = (w15?.phase !== "unknown" ? w15 : w5?.phase !== "unknown" ? w5 : w1) ?? w1;

  // Multiplicador de lote basado en confluencia Wyckoff MTF
  // Solo activo en intradía cuando 2+ TFs coinciden en fase avanzada (C, D, E)
  const advancedPhases = new Set<WyckoffPhase>(["C", "D", "E"]);
  const confluenceScore = bullBiases >= 2 ? bullBiases : bearBiases >= 2 ? bearBiases : 0;
  const isAdvanced = advancedPhases.has(dominant.phase);
  const hasSpringOrUtad = dominant.events.some(e => ["Spring", "UTAD", "SOS", "SOW"].includes(e.label));

  let wyckoffLotMult = 1.0;
  if (confluenceScore >= 2 && isAdvanced && hasSpringOrUtad) {
    // Confluencia fuerte en fase avanzada con evento clave: hasta 1.5×
    wyckoffLotMult = confluenceScore === 3 ? 1.5 : 1.3;
  } else if (confluenceScore >= 2) {
    wyckoffLotMult = 1.15;
  }

  // Construir narrative enriquecida con info MTF
  const tfLabel = (w: WyckoffAnalysis | null, name: string) =>
    w ? `${name}: ${w.bias === "neutral" ? "neutral" : w.bias === "accumulation" ? "acum" : "dist"} F${w.phase}` : "";
  const mtfNarrative = [tfLabel(w15, "15m"), tfLabel(w5, "5m"), tfLabel(w1, "1m")].filter(Boolean).join(" | ");

  return {
    ...dominant,
    narrative: `${dominant.narrative} [${mtfNarrative}] Mult lote: ${wyckoffLotMult.toFixed(2)}×`,
    wyckoffLotMult,
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

type BybitKlineResp = { retCode: number; result: { list: string[][] } };
type BybitTickerResp = { retCode: number; result: { list: Array<{ lastPrice: string }> } };
type BinanceKline = [number, string, string, string, string, string];

async function fetchBybitKlines(symbol: string, limit = 160): Promise<Candle[]> {
  const data = await fetchJson<BybitKlineResp>(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=${limit}`
  );
  if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}`);
  return data.result.list.reverse().map(b => ({
    t: Number(b[0]), o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));
}

async function fetchBybitTicker(symbol: string): Promise<number> {
  const data = await fetchJson<BybitTickerResp>(
    `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`
  );
  if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}`);
  const p = parseFloat(data.result.list[0]?.lastPrice ?? "0");
  if (!p) throw new Error(`Precio 0`);
  return p;
}

async function fetchBinanceKlines(symbol: string, limit = 160): Promise<Candle[]> {
  const data = await fetchJson<BinanceKline[]>(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`
  );
  return data.map(b => ({
    t: b[0], o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));
}

async function fetchBinanceTicker(symbol: string): Promise<number> {
  const data = await fetchJson<{ price: string }>(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  );
  const p = parseFloat(data.price);
  if (!p) throw new Error(`Precio 0`);
  return p;
}

// ── Bybit V5 linear: ticker en tiempo real ──────────────────────────────────
// Usamos /v5/market/tickers (category=linear) — público, sin auth
// Devuelve bid/ask + lastPrice en tiempo real
async function fetchBybitTickerV5(symbol: string): Promise<number> {
  const data = await fetchJson<BybitTickerResp>(
    `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`
  );
  if (data.retCode !== 0) throw new Error(`Bybit ticker ${data.retCode}`);
  const item = data.result.list[0];
  if (!item) throw new Error(`Sin datos para ${symbol}`);
  // Usamos mid = (bid + ask) / 2 si disponible, sino lastPrice
  const last = parseFloat(item.lastPrice);
  if (!last) throw new Error(`Precio 0 para ${symbol}`);
  return last;
}

// ── Bybit V5 linear: klines con concurrencia y reverse correcto ─────────────
async function fetchBybitKlinesV5(symbol: string, limit = 200): Promise<Candle[]> {
  const data = await fetchJson<BybitKlineResp>(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=${limit}`
  );
  if (data.retCode !== 0) throw new Error(`Bybit kline ${data.retCode}`);
  // Bybit devuelve [reciente → antigua] — reverse() para tener [antigua → reciente]
  return data.result.list.reverse().map(b => ({
    t: Number(b[0]),
    o: parseFloat(b[1]),
    h: parseFloat(b[2]),
    l: parseFloat(b[3]),
    c: parseFloat(b[4]),
    v: parseFloat(b[5]),
  }));
}

// ── Binance Futures (fapi) para XAG perpetuo ─────────────────────────────────
async function fetchBinanceFuturesTicker(symbol: string): Promise<number> {
  const data = await fetchJson<{ symbol: string; lastPrice: string; bidPrice: string; askPrice: string }>(
    `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`
  );
  const p = parseFloat(data.lastPrice ?? (data as unknown as { price: string }).price ?? "0");
  if (!p) throw new Error(`Binance Futures precio 0 para ${symbol}`);
  return p;
}

async function fetchBinanceFuturesKlines(symbol: string, limit = 200): Promise<Candle[]> {
  // fapi klines ya vienen en orden cronológico [antigua → reciente] — no necesita reverse()
  const data = await fetchJson<Array<[number, string, string, string, string, string]>>(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`
  );
  return data.map(b => ({
    t: b[0], o: parseFloat(b[1]), h: parseFloat(b[2]),
    l: parseFloat(b[3]), c: parseFloat(b[4]), v: parseFloat(b[5]),
  }));
}

// ── Fuente de datos: MT5 Bridge (PrimeXBT) con fallback a Bybit/Binance ──────
// Cuando el bridge está activo, UNA sola llamada /snapshot reemplaza todo.
// Si el bridge no está disponible, cae al sistema anterior (Bybit/Binance).

async function fetchFromMT5Bridge(bridgeUrl: string, prevPrices: Record<Asset, number>) {
  const r = await fetch(`${bridgeUrl}/snapshot`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
  const data = await r.json() as {
    assets: Record<string, {
      price: number; bid: number; ask: number;
      spread: number; spread_pct: number; digits: number;
      candles: Candle[]; source: string; error?: string;
    }>;
    ts: string;
  };

  const prices    = { ...prevPrices };
  const candleMap: Record<Asset, Candle[]> = { BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] };
  const seriesMap: Partial<Record<Asset, number[]>> = {};
  const spreadMap: Partial<Record<Asset, { spread: number; spread_pct: number; bid: number; ask: number }>> = {};
  const failedAssets: string[] = [];

  for (const asset of assets) {
    const d = data.assets[asset];
    if (!d || d.error) { failedAssets.push(asset); continue; }
    prices[asset]    = d.price;
    candleMap[asset] = d.candles;
    seriesMap[asset] = d.candles.map(c => c.c);
    spreadMap[asset] = { spread: d.spread, spread_pct: d.spread_pct, bid: d.bid, ask: d.ask };
  }

  // Shock de volatilidad por activo (no solo BTC)
  let shock = 0.28;
  const shockByAsset: Partial<Record<Asset, number>> = {};
  for (const asset of assets) {
    const s = seriesMap[asset] ?? [];
    if (s.length > 10) {
      const absRet = avg(s.slice(1).map((v, i) => Math.abs((v - s[i]) / Math.max(s[i], 1e-9))));
      shockByAsset[asset] = clamp(absRet * 220, 0.08, 1.25);
    }
  }
  shock = shockByAsset.BTCUSD ?? 0.28;

  const sourceNote = failedAssets.length > 0
    ? `⚠ fallo: ${failedAssets.join(", ")}`
    : `MT5/PrimeXBT (${data.ts.slice(11, 19)} UTC)`;

  return { prices, candleMap, seriesMap, shock, shockByAsset, spreadMap, sourceNote, fromBridge: true };
}

async function fetchRealMarketSnapshot(
  prevPrices: Record<Asset, number>,
  bridgeUrl?: string,
  useBridge?: boolean,
) {
  // Si el bridge está habilitado y conectado → datos de MT5/PrimeXBT
  if (useBridge && bridgeUrl) {
    try {
      return await fetchFromMT5Bridge(bridgeUrl, prevPrices);
    } catch (e) {
      console.warn("[TraderLab] Bridge falló, usando Bybit/Binance como fallback:", e);
    }
  }

  // Fallback: Bybit + Binance (comportamiento original)
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      const bybitSym   = bybitLinearSymbol[asset];
      const binanceSym = binanceFuturesSymbol[asset];
      if (bybitSym) {
        const [price, candles] = await Promise.all([
          fetchBybitTickerV5(bybitSym),
          fetchBybitKlinesV5(bybitSym, 200),
        ]);
        return { asset, price, candles, source: "Bybit" };
      } else if (binanceSym) {
        const [price, candles] = await Promise.all([
          fetchBinanceFuturesTicker(binanceSym),
          fetchBinanceFuturesKlines(binanceSym, 200),
        ]);
        return { asset, price, candles, source: "Binance Futures" };
      } else {
        throw new Error(`Sin fuente para ${asset}`);
      }
    })
  );

  const prices    = { ...prevPrices };
  const candleMap: Record<Asset, Candle[]> = { BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] };
  const seriesMap: Partial<Record<Asset, number[]>> = {};
  const failedAssets: string[] = [];

  results.forEach((r, i) => {
    const asset = assets[i];
    if (r.status === "fulfilled") {
      prices[asset]    = r.value.price;
      candleMap[asset] = r.value.candles;
      seriesMap[asset] = r.value.candles.map(c => c.c);
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

  return {
    prices, candleMap, seriesMap, shock,
    shockByAsset: {} as Partial<Record<Asset, number>>,
    spreadMap: {} as Partial<Record<Asset, { spread: number; spread_pct: number; bid: number; ask: number }>>,
    sourceNote: failedAssets.length > 0 ? `⚠ fallo: ${failedAssets.join(", ")}` : `Bybit V5 · Binance Futures`,
    fromBridge: false,
  };
}

// ─── Candlestick Chart with Indicators & Wyckoff ─────────────────────────────
function deriveSyntheticCandles(closes: number[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 4 < closes.length; i += 3) {
    const s = closes.slice(i, i + 5);
    result.push({ t: i, o: s[0], h: Math.max(...s), l: Math.min(...s), c: s[s.length - 1], v: 0 });
  }
  return result;
}

function CandlestickChart({ candles, indicators, wyckoff, showIndicators }: {
  candles: Candle[];
  indicators: Indicators | null;
  wyckoff: WyckoffAnalysis | null;
  showIndicators: boolean;
}) {
  const { useState: useS, useRef: useR, useCallback: useCB } = { useState, useRef, useCallback };
  // ── Zoom + Pan state ─────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useS(60);   // velas visibles
  const [offset, setOffset] = useS(0);                 // desplazamiento desde el final
  const svgRef = useR<SVGSVGElement>(null);
  const dragRef = useR<{ startX: number; startOffset: number } | null>(null);

  const totalCandles = candles.length;
  const maxOffset = Math.max(0, totalCandles - visibleCount);
  const startIdx = Math.max(0, totalCandles - visibleCount - offset);
  const visible = candles.slice(startIdx, startIdx + visibleCount);

  // Scroll = zoom (más velas = más zoom out)
  const handleWheel = useCB((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 5 : -5;
    setVisibleCount(v => clamp(v + delta, 10, Math.min(200, totalCandles)));
  }, [totalCandles]);

  // Drag = pan
  const handleMouseDown = useCB((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startOffset: offset };
  }, [offset]);

  const handleMouseMove = useCB((e: React.MouseEvent) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pxPerCandle = rect.width / visibleCount;
    const deltaPx = e.clientX - dragRef.current.startX;
    const deltaCandles = Math.round(deltaPx / pxPerCandle);
    setOffset(clamp(dragRef.current.startOffset - deltaCandles, 0, maxOffset));
  }, [visibleCount, maxOffset]);

  const handleMouseUp = useCB(() => { dragRef.current = null; }, []);

  // Touch support
  const touchRef = useR<{ startX: number; startOffset: number } | null>(null);
  const handleTouchStart = useCB((e: React.TouchEvent) => {
    touchRef.current = { startX: e.touches[0].clientX, startOffset: offset };
  }, [offset]);
  const handleTouchMove = useCB((e: React.TouchEvent) => {
    if (!touchRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pxPerCandle = rect.width / visibleCount;
    const deltaPx = e.touches[0].clientX - touchRef.current.startX;
    const deltaCandles = Math.round(deltaPx / pxPerCandle);
    setOffset(clamp(touchRef.current.startOffset - deltaCandles, 0, maxOffset));
  }, [visibleCount, maxOffset]);

  if (visible.length < 3) return (
    <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos — sincronizá primero</p>
    </div>
  );

  const W = 600; const CH = 200; const VH = 44; const TH = CH + VH + 12;
  const allHigh = Math.max(...visible.map(c => c.h));
  const allLow  = Math.min(...visible.map(c => c.l));
  const indPrices: number[] = [];
  if (indicators && showIndicators) {
    indPrices.push(indicators.vwap, indicators.vwapUpperBand2, indicators.vwapLowerBand2, indicators.bbUpper, indicators.bbLower);
  }
  const maxH  = Math.max(allHigh, ...indPrices.filter(Boolean));
  const minL  = Math.min(allLow,  ...indPrices.filter(Boolean));
  const range  = Math.max(maxH - minL, 1e-9);
  const maxVol = Math.max(...visible.map(c => c.v), 1);
  const slotW  = W / visible.length;
  const candleW = Math.max(1.2, slotW * 0.65);
  const sy = (v: number) => ((maxH - v) / range) * CH;
  const sv = (v: number) => (v / maxVol) * VH;

  const labels = [minL, minL + range * 0.25, minL + range * 0.5, minL + range * 0.75, maxH].map(v => ({
    y: sy(v), label: v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(3),
  }));

  // Map events to visible window
  const wyckoffVisible = wyckoff?.events.filter(e => e.candleIndex >= startIdx && e.candleIndex < startIdx + visibleCount)
    .map(e => ({ ...e, visibleIdx: e.candleIndex - startIdx })) ?? [];
  const climaxVisible = (wyckoff?.volumeClimaxIdx ?? [])
    .filter(i => i >= startIdx && i < startIdx + visibleCount)
    .map(i => i - startIdx);

  // ── Wyckoff accumulation/distribution range shading ──────────────────────
  // Solo pintamos el rango completo de acumulación o distribución
  // detectando el span entre primer y último evento del ciclo activo
  const wyckoffBias  = wyckoff?.bias ?? "neutral";
  const isAccum      = wyckoffBias === "accumulation";
  const isDist       = wyckoffBias === "distribution";
  let rangeShadeX1   = -1; let rangeShadeX2 = -1;
  if ((isAccum || isDist) && wyckoff && wyckoff.events.length >= 2) {
    const eventsInView = wyckoff.events.filter(e =>
      e.candleIndex >= startIdx && e.candleIndex < startIdx + visibleCount
    );
    if (eventsInView.length >= 1) {
      const firstIdx = eventsInView[0].candleIndex - startIdx;
      const lastIdx  = eventsInView[eventsInView.length - 1].candleIndex - startIdx;
      rangeShadeX1   = firstIdx * slotW;
      rangeShadeX2   = Math.min((lastIdx + 1) * slotW, W);
    }
  }
  const rangeShadeColor = isAccum
    ? "rgba(16,185,129,0.07)"   // verde — acumulación
    : isDist
    ? "rgba(239,68,68,0.07)"    // rojo — distribución
    : "transparent";
  const rangeShadeStroke = isAccum ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)";

  // Soporte/resistencia Wyckoff
  const supportY = wyckoff?.supportZone ? [sy(wyckoff.supportZone[1]), sy(wyckoff.supportZone[0])] : null;
  const resistY  = wyckoff?.resistanceZone ? [sy(wyckoff.resistanceZone[1]), sy(wyckoff.resistanceZone[0])] : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Controles zoom/pan */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Scroll: zoom · Drag: pan · {visible.length} velas
        </span>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {[20, 40, 60, 100].map(n => (
            <button key={n} onClick={() => { setVisibleCount(n); setOffset(0); }}
              style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, cursor: "pointer",
                border: `1px solid ${visibleCount === n ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`,
                background: visibleCount === n ? "rgba(99,102,241,0.15)" : "transparent",
                color: visibleCount === n ? "#a5b4fc" : "var(--muted)" }}>
              {n}
            </button>
          ))}
          <button onClick={() => { setVisibleCount(60); setOffset(0); }}
            style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "var(--muted)" }}>
            Reset
          </button>
        </div>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${TH}`} className="w-full overflow-visible"
        style={{ height: 310, cursor: dragRef.current ? "grabbing" : "grab", userSelect: "none" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => { touchRef.current = null; }}>

        {/* Grid */}
        {[0.2, 0.4, 0.6, 0.8].map(f => (
          <line key={f} x1={0} y1={CH * f} x2={W} y2={CH * f} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        ))}
        {labels.map(({ y, label }) => (
          <text key={label} x={W - 2} y={y + 3} textAnchor="end" fontSize="7.5"
            fill="rgba(255,255,255,0.3)" fontFamily="'JetBrains Mono',monospace">{label}</text>
        ))}

        {/* ── Rango Wyckoff: solo acumulación (verde) o distribución (rojo) ── */}
        {rangeShadeX1 >= 0 && (
          <rect x={rangeShadeX1} y={0} width={Math.max(0, rangeShadeX2 - rangeShadeX1)} height={CH}
            fill={rangeShadeColor} stroke={rangeShadeStroke} strokeWidth="0.6" strokeDasharray="4,3" />
        )}
        {/* Etiqueta del rango */}
        {rangeShadeX1 >= 0 && (
          <text x={rangeShadeX1 + 4} y={12} fontSize="8" fontWeight="700"
            fill={isAccum ? "#10b981" : "#ef4444"} fontFamily="'DM Sans',sans-serif" opacity="0.9">
            {isAccum ? "ACUMULACIÓN" : "DISTRIBUCIÓN"} F{wyckoff?.phase}
          </text>
        )}

        {/* Soporte/resistencia Wyckoff (líneas de zona, sutiles) */}
        {supportY && (
          <rect x={0} y={supportY[0]} width={W} height={Math.max(1, supportY[1] - supportY[0])}
            fill="rgba(16,185,129,0.05)" stroke="rgba(16,185,129,0.25)" strokeWidth="0.4" strokeDasharray="3,2" />
        )}
        {resistY && (
          <rect x={0} y={resistY[0]} width={W} height={Math.max(1, resistY[1] - resistY[0])}
            fill="rgba(239,68,68,0.05)" stroke="rgba(239,68,68,0.25)" strokeWidth="0.4" strokeDasharray="3,2" />
        )}

        {/* Indicator lines */}
        {indicators && showIndicators && (() => {
          const lineData = [
            { val: indicators.vwap,           color: "#f59e0b",               width: 1.3 },
            { val: indicators.vwapUpperBand1,  color: "rgba(245,158,11,0.45)", dash: "3,2" },
            { val: indicators.vwapLowerBand1,  color: "rgba(245,158,11,0.45)", dash: "3,2" },
            { val: indicators.vwapUpperBand2,  color: "rgba(245,158,11,0.22)", dash: "2,3" },
            { val: indicators.vwapLowerBand2,  color: "rgba(245,158,11,0.22)", dash: "2,3" },
            { val: indicators.bbUpper,         color: "rgba(99,102,241,0.55)", dash: "2,2" },
            { val: indicators.bbMiddle,        color: "rgba(99,102,241,0.35)", dash: "3,2" },
            { val: indicators.bbLower,         color: "rgba(99,102,241,0.55)", dash: "2,2" },
          ];
          return lineData.map(({ val, color, dash, width = 0.9 }) => val > 0 ? (
            <line key={`${color}-${val}`} x1={0} y1={sy(val)} x2={W} y2={sy(val)}
              stroke={color} strokeWidth={width} strokeDasharray={dash ?? ""} />
          ) : null);
        })()}

        {/* Imbalance zones */}
        {indicators?.imbalances.map((imb, i) => {
          const vIdx = imb.idx - startIdx;
          if (vIdx < 0 || vIdx >= visible.length) return null;
          const cx = vIdx * slotW;
          return (
            <rect key={i} x={cx} y={0} width={slotW * 3} height={CH}
              fill={imb.type === "bullish" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)"}
              stroke={imb.type === "bullish" ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)"}
              strokeWidth="0.3" />
          );
        })}

        {/* Volume separator */}
        <line x1={0} y1={CH + 5} x2={W} y2={CH + 5} stroke="rgba(255,255,255,0.05)" strokeWidth="0.4" />

        {/* Candles */}
        {visible.map((c, i) => {
          const cx = i * slotW + slotW / 2;
          const bull = c.c >= c.o;
          const col = bull ? "#10b981" : "#ef4444";
          const bt = sy(Math.max(c.o, c.c));
          const bh = Math.max(1, sy(Math.min(c.o, c.c)) - bt);
          const isClimax = climaxVisible.includes(i);
          return (
            <g key={i}>
              {isClimax && <rect x={cx - slotW / 2} y={0} width={slotW} height={CH} fill="rgba(245,158,11,0.07)" />}
              <line x1={cx} y1={sy(c.h)} x2={cx} y2={sy(c.l)} stroke={col} strokeWidth="0.9" />
              <rect x={cx - candleW / 2} y={bt} width={candleW} height={bh} fill={col} opacity={0.88} rx={0.3} />
              {c.v > 0 && <rect x={cx - candleW / 2} y={CH + 8 + VH - sv(c.v)} width={candleW} height={sv(c.v)} fill={col} opacity={0.28} rx={0.2} />}
            </g>
          );
        })}

        {/* Wyckoff event labels */}
        {wyckoffVisible.map((ev, i) => {
          const cx = ev.visibleIdx * slotW + slotW / 2;
          const isTop = ["BC", "AR", "UTAD", "SOW", "LPSY"].includes(ev.label);
          const y = isTop
            ? sy(visible[ev.visibleIdx]?.h ?? ev.price) - 7
            : sy(visible[ev.visibleIdx]?.l ?? ev.price) + 11;
          return (
            <g key={i}>
              <rect x={cx - 11} y={y - 9} width={22} height={11} rx={2.5}
                fill={ev.color} opacity={0.92} />
              <text x={cx} y={y} textAnchor="middle" fontSize="6.5" fontWeight="700"
                fill="#fff" fontFamily="'DM Sans',sans-serif">{ev.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


// ─── Tooltip técnico ─────────────────────────────────────────────────────────
const GLOSSARY: Record<string, string> = {
  "MTF":          "Multi-Timeframe: analiza la tendencia en 3 temporalidades (corto, medio, largo plazo) para confirmar la dirección antes de entrar.",
  "HTF":          "Higher Time Frame: la temporalidad mayor (EMA20/50). Define la tendencia principal. Si no está alineada, no se opera.",
  "LTF":          "Lower Time Frame: temporalidad media (EMA10/20). Confirma que la estructura va en la misma dirección que el HTF.",
  "Exec":         "Execution TF: momentum de las últimas 8 velas de 1m. Confirma que el precio se está moviendo ahora en la dirección correcta.",
  "RSI":          "Relative Strength Index: oscilador de momentum 0-100. En crypto: sobreventa <20, sobrecompra >80. Mide la velocidad del movimiento.",
  "Estocástico":  "Oscilador %K/%D que mide dónde está el precio dentro de su rango reciente. En crypto: sobreventa <20, sobrecompra >80. Ideal para scalping.",
  "VWAP":         "Volume Weighted Average Price: precio promedio ponderado por volumen. Las instituciones lo usan como referencia. Por encima = sesgo alcista.",
  "Wyckoff":      "Método de análisis de Richard Wyckoff: identifica ciclos de acumulación (manos fuertes comprando) y distribución (vendiendo) antes de grandes movimientos.",
  "Spring":       "Evento Wyckoff: caída falsa por debajo del soporte con recuperación rápida. Señal de que las manos fuertes absorbieron la venta. Alta probabilidad alcista.",
  "UTAD":         "Upthrust After Distribution: falso quiebre sobre resistencia en distribución. Las manos fuertes venden a los compradores tardíos. Señal bajista.",
  "SOS":          "Sign of Strength: expansión de rango alcista con alto volumen. Confirma que la acumulación terminó y el precio está listo para subir.",
  "SOW":          "Sign of Weakness: expansión bajista con volumen. Confirma que la distribución terminó y el precio está listo para caer.",
  "LPS":          "Last Point of Support: último pullback tras el SOS con bajo volumen. Punto de entrada de alta calidad en tendencia alcista.",
  "SC":           "Selling Climax: venta masiva de pánico con volumen extremo. Marca el fondo potencial de una corrección.",
  "BC":           "Buying Climax: compra masiva con volumen extremo en máximos. Marca el techo potencial antes de distribución.",
  "AR":           "Automatic Rally: rebote automático tras el SC. Define el techo del rango de acumulación.",
  "BB Squeeze":   "Bollinger Bands Squeeze: las bandas se comprimen dentro del canal Keltner. Indica baja volatilidad antes de una expansión fuerte.",
  "Vol Delta":    "Volume Delta: diferencia entre volumen comprador y vendedor estimado. Positivo = presión de compra dominante.",
  "ATR":          "Average True Range: medida de volatilidad promedio. Se usa para calcular stops y take profits proporcionales al movimiento real del mercado.",
  "Confianza":    "Score interno 0-100% que refleja cuántos factores técnicos confluyen en la misma dirección. Por encima del umbral configurado, la IA evalúa si abrir.",
  "Win Rate":     "Porcentaje de trades ganadores sobre el total. Por sí solo no indica rentabilidad — importa también el ratio ganancia/pérdida.",
  "Sharpe":       "Ratio de Sharpe: retorno ajustado por riesgo. >1 es aceptable, >2 es excelente. Mide si el rendimiento justifica la volatilidad asumida.",
  "Profit Factor":"Ratio entre ganancias brutas y pérdidas brutas. >1.5 es saludable. >2 es muy bueno.",
  "Drawdown":     "Caída máxima desde un pico de equity. Mide el peor momento histórico de la curva de capital.",
  "Expectancy":   "Ganancia promedio esperada por trade considerando win rate y ratio de ganancias/pérdidas.",
  "Imbalance":    "Zona donde el precio se movió con impulso y poco retroceso. Las instituciones suelen regresar a estos niveles para completar órdenes.",
  "Fase A":       "Wyckoff Fase A: parada de la tendencia bajista previa. Se confirma con SC + AR.",
  "Fase B":       "Wyckoff Fase B: construcción del rango. Precio oscila entre soporte y resistencia mientras las manos fuertes acumulan.",
  "Fase C":       "Wyckoff Fase C: test final (Spring en acumulación, UTAD en distribución). El momento más engañoso — parece que el precio cae/sube más.",
  "Fase D":       "Wyckoff Fase D: inicio del movimiento tendencial. SOS/SOW confirman que el rango terminó.",
  "Fase E":       "Wyckoff Fase E: tendencia establecida fuera del rango. LPS en acumulación son puntos de entrada.",
  "Acumulación":  "Proceso donde manos fuertes (instituciones) compran gradualmente sin que el precio suba demasiado. Precede a movimientos alcistas tendenciales.",
  "Distribución": "Proceso donde manos fuertes venden gradualmente en un rango. Precede a caídas tendenciales.",
  "Scalping":     "Estrategia de trading de muy corto plazo (segundos a minutos). Busca pequeños movimientos frecuentes con stops ajustados.",
  "Intradía":     "Estrategia que abre y cierra posiciones dentro del mismo día. Usa timeframes más amplios que scalping.",
  "RR":           "Risk/Reward ratio: relación entre la ganancia potencial y el riesgo asumido. 2:1 significa que se gana el doble de lo que se arriesga.",
  "Trailing Stop":"Stop loss que sigue al precio cuando va a favor, fijando ganancias. Se mueve solo en dirección favorable, nunca en contra.",
  "Leverage":     "Apalancamiento: multiplicador de exposición. 500× significa que con $1 se controla $500 de activo. Amplifica ganancias Y pérdidas.",
};

function TechTip({ term, children }: { term: string; children?: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const def = GLOSSARY[term];
  if (!def) return <>{children ?? term}</>;

  const handleEnter = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + window.scrollY + 4 });
    setShow(true);
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
      {children ?? term}
      <span
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 13, height: 13, borderRadius: "50%",
          background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.5)",
          color: "#a5b4fc", fontSize: 8, fontWeight: 700, cursor: "help",
          flexShrink: 0, lineHeight: 1,
        }}>?</span>
      {show && (
        <span style={{
          position: "fixed", left: Math.min(pos.x, window.innerWidth - 260), top: pos.y,
          width: 240, background: "rgba(12,13,22,0.97)", border: "1px solid rgba(99,102,241,0.35)",
          borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: "#e2e8f0",
          lineHeight: 1.5, zIndex: 9999, pointerEvents: "none",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          <strong style={{ color: "#a5b4fc", display: "block", marginBottom: 3 }}>{term}</strong>
          {def}
        </span>
      )}
    </span>
  );
}

// ─── Indicator Panel ──────────────────────────────────────────────────────────

// ─── Order Flow Panel (solo scalping) ────────────────────────────────────────
function OrderFlowPanel({ of: ofData, price }: { of: OrderFlowScore; price: number }) {
  const ctrlColor = ofData.control === "bulls" ? "#10b981" : ofData.control === "bears" ? "#ef4444" : "#f59e0b";
  const cvd = ofData.cvd;
  const prof = ofData.profile;
  const dp = (v: number) => v > 1000 ? 1 : v > 10 ? 2 : 4;

  // Mini barra horizontal para el score de control
  const barW = Math.abs(ofData.controlScore);
  const barDir = ofData.controlScore >= 0 ? "right" : "left";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ── Control de mercado — gauge principal ── */}
      <div className="card" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>Control de mercado</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{ofData.setupStrength > 0.6 ? "🔥 Setup fuerte" : ofData.setupStrength > 0.3 ? "⚡ Setup moderado" : "😐 Indeciso"}</span>
        </div>
        {/* Gauge -100 → 0 → +100 */}
        <div style={{ position: "relative", height: 24, borderRadius: 12, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 6 }}>
          {/* Fondo dividido */}
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.12)" }} />
          {/* Barra de control */}
          <div style={{
            position: "absolute",
            top: 4, bottom: 4, borderRadius: 8,
            left:  barDir === "right" ? "50%" : `${50 - barW/2}%`,
            width: `${barW / 2}%`,
            background: ofData.controlScore >= 0
              ? "linear-gradient(90deg, rgba(16,185,129,0.3), #10b981)"
              : "linear-gradient(90deg, #ef4444, rgba(239,68,68,0.3))",
            transition: "width 0.6s ease, left 0.6s ease",
          }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: ctrlColor, textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
              {ofData.control === "bulls" ? "🐂 TOROS" : ofData.control === "bears" ? "🐻 OSOS" : "⚔ DISPUTADO"} {ofData.controlScore > 0 ? "+" : ""}{ofData.controlScore.toFixed(0)}
            </span>
          </div>
        </div>
        {/* Sub-scores */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
          {[
            { label: "CVD", val: ofData.cvdScore },
            { label: "Footprint", val: ofData.footprintScore },
            { label: "Perfil Vol", val: ofData.profileScore },
            { label: "Absorción", val: ofData.absorptionScore },
          ].map(({ label, val }) => {
            const pct = clamp(Math.abs(val), 0, 100);
            const col = val > 0 ? "#10b981" : val < 0 ? "#ef4444" : "var(--muted)";
            return (
              <div key={label} style={{ textAlign: "center", background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 4px" }}>
                <div style={{ fontSize: 9.5, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
                <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", marginBottom: 3 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: col }}>{val > 0 ? "+" : ""}{val.toFixed(0)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CVD multi-ventana ── */}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 8 }}>CVD Acumulado</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[
            { label: "CVD 50v", val: cvd.cvd50, trend: cvd.slope50 },
            { label: "CVD 20v", val: cvd.cvd20, trend: null },
            { label: "CVD 10v", val: cvd.cvd10, trend: cvd.slope10 },
            { label: "CVD 5v",  val: cvd.cvd5,  trend: null },
          ].map(({ label, val, trend }) => {
            const col = val > 0 ? "#10b981" : val < 0 ? "#ef4444" : "var(--muted)";
            const arrow = trend !== null ? (trend > 0 ? " ↑" : " ↓") : "";
            return (
              <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 8px", border: `1px solid ${col}22` }}>
                <div style={{ fontSize: 9.5, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: col, fontFamily: "'JetBrains Mono',monospace" }}>
                  {val > 0 ? "+" : ""}{val.toFixed(1)}{arrow}
                </div>
              </div>
            );
          })}
        </div>
        {cvd.divergence && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.1)", borderRadius: 6, padding: "5px 8px" }}>
            ⚠ Divergencia CVD-precio — el precio se mueve sin respaldo de flujo real
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
          Tendencia: <span style={{ color: cvd.trend === "bullish" ? "#10b981" : cvd.trend === "bearish" ? "#ef4444" : "var(--muted)", fontWeight: 600 }}>
            {cvd.trend === "bullish" ? "Acumulando ↑" : cvd.trend === "bearish" ? "Distribuyendo ↓" : "Lateral"}
          </span>
        </div>
      </div>

      {/* ── Volume Profile ── */}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 8 }}>Perfil de Volumen</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
          {[
            { label: "VAH", val: prof.vah, color: "#10b981", note: price > prof.vah ? "← precio aquí" : "" },
            { label: "POC", val: prof.poc, color: "#f59e0b", note: Math.abs(price - prof.poc) < (prof.vah - prof.val) * 0.15 ? "← precio aquí" : "" },
            { label: "VAL", val: prof.val, color: "#ef4444", note: price < prof.val ? "← precio aquí" : "" },
          ].map(({ label, val, color, note }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 8px", border: `1px solid ${color}22` }}>
              <div style={{ fontSize: 9.5, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace" }}>{val.toFixed(dp(val))}</div>
              {note && <div style={{ fontSize: 9, color }}>{note}</div>}
            </div>
          ))}
        </div>
        {/* Posición del precio en el value area */}
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Precio: <span style={{ fontWeight: 700, color:
            price > prof.vah ? "#10b981" :
            price < prof.val ? "#ef4444" :
            price > prof.poc ? "#10b981" : "#f59e0b" }}>
            {price > prof.vah ? "Sobre VAH — aceptación alcista" :
             price < prof.val ? "Bajo VAL — aceptación bajista" :
             price > prof.poc ? "Entre POC y VAH — toros" :
             "Entre VAL y POC — osos"}
          </span>
        </div>
        {(prof.hvn.length > 0 || prof.lvn.length > 0) && (
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
            {prof.hvn.length > 0 && <>HVN (soporte/resist.): {prof.hvn.slice(0,3).map(p => p.toFixed(dp(p))).join(", ")} </>}
            {prof.lvn.length > 0 && <>| LVN (vacíos): {prof.lvn.slice(0,3).map(p => p.toFixed(dp(p))).join(", ")}</>}
          </div>
        )}
      </div>

      {/* ── Footprint últimas 6 velas ── */}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 8 }}>Footprint (últimas 6 velas)</div>
        <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
          {ofData.footprint.slice(-6).map((c, i) => {
            const isUp  = c.c >= c.o;
            const dCol  = c.delta > 0 ? "#10b981" : "#ef4444";
            const hPct  = Math.min(Math.abs(c.deltaPct) * 1.2, 100);
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                {/* Vela */}
                <div style={{ width: "100%", height: 22, borderRadius: 3, background: isUp ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)", border: `1px solid ${isUp ? "#10b981" : "#ef4444"}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 9, color: isUp ? "#10b981" : "#ef4444", fontWeight: 700 }}>{isUp ? "▲" : "▼"}</span>
                </div>
                {/* Delta bar */}
                <div style={{ width: "100%", height: 20, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${hPct}%`, background: dCol, opacity: 0.7, borderRadius: 2 }} />
                </div>
                {/* Delta valor */}
                <div style={{ fontSize: 9, color: dCol, fontFamily: "'JetBrains Mono',monospace" }}>
                  {c.delta > 0 ? "+" : ""}{c.deltaPct.toFixed(0)}%
                </div>
                {/* Absorción */}
                {c.absorption !== "none" && (
                  <div style={{ fontSize: 8, color: "#f59e0b" }}>
                    {c.absorption === "buy" ? "🧲B" : "🧲S"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
          Iniciativa: {ofData.footprint.slice(-6).map(c => c.initiative === "buy" ? "🟢" : c.initiative === "sell" ? "🔴" : "⚪").join(" ")}
        </div>
      </div>
    </div>
  );
}

function IndicatorPanel({ ind, mode }: { ind: Indicators; mode: Mode }) {
  const d = (v: number) => v > 100 ? 1 : v > 1 ? 3 : 4;
  const rsiColor = ind.rsi > 70 ? "#ef4444" : ind.rsi < 30 ? "#10b981" : "#f59e0b";
  const stochColor = ind.stochK > 80 ? "#ef4444" : ind.stochK < 20 ? "#10b981" : "var(--text)";
  const divColor = ind.rsiDivergence === "bullish" ? "#10b981" : ind.rsiDivergence === "bearish" ? "#ef4444" : "var(--muted)";
  const deltaColor = ind.volumeDeltaPct > 10 ? "#10b981" : ind.volumeDeltaPct < -10 ? "#ef4444" : "var(--muted)";
  const maAligned = ind.ma10 > ind.ma20 && ind.ma20 > ind.ma50;
  const maAlignedShort = ind.ma10 < ind.ma20 && ind.ma20 < ind.ma50;
  const maAlignColor = maAligned ? "#10b981" : maAlignedShort ? "#ef4444" : "var(--muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {mode === "scalping" ? (
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="Estocástico">Estocástico %K/%D</TechTip></span>
            <strong style={{ color: stochColor }}>{ind.stochK.toFixed(1)} / {ind.stochD.toFixed(1)}</strong>
            <span style={{ fontSize: 12, color: stochColor, marginTop: 3, display: "block" }}>
              {ind.stochK < 20 ? "⬇ Sobreventa (<20)" : ind.stochK > 80 ? "⬆ Sobrecompra (>80)" : ind.stochK > ind.stochD ? "K>D alcista" : "K<D bajista"}
            </span>
          </div>
        ) : (
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="RSI">RSI 14</TechTip> <span style={{fontSize:10,color:"var(--muted)"}}>(OS&lt;20/OB&gt;80)</span></span>
            <strong style={{ color: rsiColor }}>{ind.rsi.toFixed(1)}</strong>
            <span style={{ fontSize: 12, color: divColor, marginTop: 3, display: "block" }}>
              {ind.rsi < 20 ? "Sobreventa extrema" : ind.rsi > 80 ? "Sobrecompra extrema" : ind.rsiDivergence !== "none" ? (ind.rsiDivergence === "bullish" ? "↗ Div. alcista" : "↘ Div. bajista") : "Neutral"}
            </span>
          </div>
        )}
        {mode === "scalping" ? (
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}>MA5/MA10 scalp</span>
            <strong style={{ color: ind.ma5 > ind.ma10 ? "#10b981" : "#ef4444", fontSize: 12 }}>
              {ind.ma5 > ind.ma10 ? "MA5 > MA10 ↑" : "MA5 < MA10 ↓"}
            </strong>
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>
              {ind.ma5.toFixed(d(ind.ma5))} / {ind.ma10.toFixed(d(ind.ma10))}
            </span>
          </div>
        ) : (
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}>MAs Tendencia <TechTip term="HTF">?</TechTip></span>
            <strong style={{ color: maAlignColor, fontSize: 11 }}>
              {maAligned ? "Alcista ↑" : maAlignedShort ? "Bajista ↓" : "Sin alineación"}
            </strong>
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>
              {ind.ma10.toFixed(d(ind.ma10))} / {ind.ma20.toFixed(d(ind.ma20))} / {ind.ma50.toFixed(d(ind.ma50))}
            </span>
          </div>
        )}
        <div className="metric">
          <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="VWAP">VWAP</TechTip></span>
          <strong style={{ fontSize: 12 }}>{ind.vwap.toFixed(d(ind.vwap))}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>
            ±1σ {ind.vwapUpperBand1.toFixed(d(ind.vwap))} / {ind.vwapLowerBand1.toFixed(d(ind.vwap))}
          </span>
        </div>
        <div className="metric">
          <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="BB Squeeze">BB Squeeze</TechTip> {ind.bbSqueeze ? "🔴" : ""}</span>
          <strong style={{ color: ind.bbSqueeze ? "#f59e0b" : "var(--text)", fontSize: 12 }}>
            {ind.bbSqueeze ? "Expansión próxima" : `W ${(ind.bbUpper - ind.bbLower).toFixed(d(ind.bbUpper))}`}
          </strong>
          <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>
            {ind.bbUpper.toFixed(d(ind.bbUpper))} / {ind.bbLower.toFixed(d(ind.bbLower))}
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: mode === "scalping" ? "1fr 1fr" : "1fr 1fr 1fr", gap: 8 }}>
        <div className="metric">
          <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="Vol Delta">Vol. Delta</TechTip></span>
          <strong style={{ color: deltaColor }}>{ind.volumeDeltaPct > 0 ? "+" : ""}{ind.volumeDeltaPct.toFixed(1)}%</strong>
          <span style={{ fontSize: 12, color: deltaColor, marginTop: 3, display: "block" }}>
            {ind.volumeDeltaPct > 15 ? "Compradores fuertes" : ind.volumeDeltaPct < -15 ? "Vendedores fuertes" : ind.volumeDeltaPct > 5 ? "Sesgo comprador" : ind.volumeDeltaPct < -5 ? "Sesgo vendedor" : "Equilibrado"}
          </span>
        </div>
        {mode === "scalping" ? (
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}>RSI (referencia)</span>
            <strong style={{ color: rsiColor }}>{ind.rsi.toFixed(1)}</strong>
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>OS &lt;20 / OB &gt;80</span>
          </div>
        ) : (<>
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="Estocástico">Estocástico</TechTip></span>
            <strong style={{ color: stochColor }}>{ind.stochK.toFixed(1)} / {ind.stochD.toFixed(1)}</strong>
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "block" }}>K / D</span>
          </div>
          <div className="metric">
            <span className="label" style={{ fontSize: 11, fontWeight: 600 }}><TechTip term="RSI">RSI</TechTip> div.</span>
            <strong style={{ fontSize: 12, color: divColor }}>{ind.rsiDivergence === "bullish" ? "↗ Alcista" : ind.rsiDivergence === "bearish" ? "↘ Bajista" : "Ninguna"}</strong>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── Wyckoff Summary Panel ────────────────────────────────────────────────────
function WyckoffPanel({ wyckoff }: { wyckoff: WyckoffAnalysis }) {
  const biasColor = wyckoff.bias === "accumulation" ? "#10b981" : wyckoff.bias === "distribution" ? "#ef4444" : "#6b7280";
  const phaseBg = wyckoff.phase === "unknown" ? "rgba(107,114,128,0.08)" : wyckoff.bias === "accumulation" ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)";

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${biasColor}25`, background: phaseBg, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: biasColor }}>
          {wyckoff.bias === "accumulation" ? "🟢 ACUMULACIÓN" : wyckoff.bias === "distribution" ? "🔴 DISTRIBUCIÓN" : "⚪ NEUTRAL"}
        </span>
        {wyckoff.phase !== "unknown" && (
          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 12, background: `${biasColor}20`, color: biasColor, fontWeight: 700 }}>
            Fase {wyckoff.phase}
          </span>
        )}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
          {wyckoff.events.slice(-5).map((ev, i) => (
            <span key={i} style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, background: `${ev.color}20`, color: ev.color, fontWeight: 700, border: `1px solid ${ev.color}30` }}>{ev.label}</span>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{wyckoff.narrative}</p>
      {wyckoff.supportZone && (
        <p style={{ fontSize: 10, color: "#10b981", marginTop: 4 }}>
          Soporte Wyckoff: {wyckoff.supportZone[0].toFixed(2)} – {wyckoff.supportZone[1].toFixed(2)}
        </p>
      )}
      {wyckoff.resistanceZone && (
        <p style={{ fontSize: 10, color: "#ef4444", marginTop: 2 }}>
          Resistencia Wyckoff: {wyckoff.resistanceZone[0].toFixed(2)} – {wyckoff.resistanceZone[1].toFixed(2)}
        </p>
      )}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  const colors: Record<Toast["type"], string> = { success: "#10b981", warning: "#f59e0b", error: "#ef4444", info: "#3b82f6" };
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onRemove(t.id)}
          style={{ background: colors[t.type], color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", gap: 8, pointerEvents: "auto", cursor: "pointer", animation: "slideIn 0.2s ease" }}>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <span style={{ opacity: 0.7 }}>✕</span>
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
  if (points.length < 2) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--muted)", fontSize: 12 }}>Sin datos</p></div>;
  const min = Math.min(...points); const max = Math.max(...points);
  const range = Math.max(max - min, 0.01);
  const sy = (v: number) => 100 - ((v - min) / range) * 100;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 100},${sy(v)}`).join(" ");
  const color = points[points.length - 1] >= 100 ? "#10b981" : "#ef4444";
  return (
    <div style={{ borderRadius: 10, background: "rgba(255,255,255,0.03)", padding: "8px 4px 4px" }}>
      <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4, paddingLeft: 4 }}>Curva de equity</p>
      <svg viewBox="0 0 100 60" className="w-full overflow-visible" style={{ height }}>
        <defs><linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
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
  position: Position; prices: Record<Asset, number>; spreadByAsset: Record<Asset, number>;
  now: number; onClose: (pos: Position) => void;
}) {
  const mark = prices[position.signal.asset];
  const spread = spreadByAsset[position.signal.asset];
  const isLong = position.signal.direction === "LONG";
  const eff = isLong ? mark - spread / 2 : mark + spread / 2;
  const pnl = (isLong ? eff - position.signal.entry : position.signal.entry - eff) * position.size;
  const totalRange = Math.abs(position.signal.takeProfit - position.signal.entry);
  const progress = clamp((isLong ? eff - position.signal.entry : position.signal.entry - eff) / totalRange * 100, 0, 100);
  const isOld = (now - new Date(position.openedAt).getTime()) > 30 * 60 * 1000;
  return (
    <div className="live-card" style={{ borderLeft: `3px solid ${isLong ? "#10b981" : "#ef4444"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isLong ? "#10b981" : "#ef4444", animation: "pulse 1.5s infinite", display: "inline-block" }} />
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
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10, color: "var(--muted)" }}>
          <span>SL {position.signal.stopLoss.toFixed(2)}</span>
          <span>Entrada {position.signal.entry.toFixed(2)}</span>
          <span>TP {position.signal.takeProfit.toFixed(2)}</span>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, progress)}%`, background: progress > 70 ? "#10b981" : progress > 30 ? "#f59e0b" : "#ef4444", transition: "width 0.5s ease" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
        <span>Tam: {position.size.toFixed(4)}</span>
        <span>Margen: {money(position.marginUsed)}</span>
        <span>Conf: {position.signal.confidence.toFixed(0)}%</span>
        <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
          background: position.signal.mode === "scalping" ? "rgba(99,102,241,0.2)" : "rgba(245,158,11,0.2)",
          color: position.signal.mode === "scalping" ? "#a5b4fc" : "#f59e0b" }}>
          {position.signal.mode === "scalping" ? "SCALP" : "INTRADÍA"}
        </span>
        {position.signal.mode === "intradia" && position.signal.wyckoff.bias !== "neutral" && (
          <span style={{ color: position.signal.wyckoff.bias === "accumulation" ? "#10b981" : "#ef4444" }}>
            Wyckoff: {position.signal.wyckoff.bias === "accumulation" ? "Acum" : "Dist"} F{position.signal.wyckoff.phase}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Trade History ────────────────────────────────────────────────────────────
function TradeHistory({ trades, showSource = false }: { trades: ClosedTrade[]; showSource?: boolean }) {
  const [fa, setFa] = useState<Asset | "todas">("todas");
  const [fm, setFm] = useState<Mode | "todos">("todos");
  const [fr, setFr] = useState<ExitReason | "todos">("todos");
  const filtered = useMemo(() => trades.filter(t =>
    (fa === "todas" || t.asset === fa) && (fm === "todos" || t.mode === fm) && (fr === "todos" || t.result === fr)
  ), [trades, fa, fm, fr]);
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <select className="sel" style={{ width: "auto" }} value={fa} onChange={e => setFa(e.target.value as Asset | "todas")}>
          <option value="todas">Todos</option>{assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="sel" style={{ width: "auto" }} value={fm} onChange={e => setFm(e.target.value as Mode | "todos")}>
          <option value="todos">Todos</option><option value="scalping">Scalp</option><option value="intradia">MTF</option>
        </select>
        <select className="sel" style={{ width: "auto" }} value={fr} onChange={e => setFr(e.target.value as ExitReason | "todos")}>
          <option value="todos">Todos</option><option value="TP">TP</option><option value="SL">SL</option><option value="TRAIL">Trail</option><option value="REVERSAL">Rev.</option>
        </select>
      </div>
      <div className="table-wrap" style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
          <thead style={{ background: "rgba(255,255,255,0.04)" }}>
            <tr>{["Activo", "Modo", "Dir.", "Entrada", "Salida", "P&L", "Resultado", ...(showSource ? ["Fuente"] : [])].map(h => (
              <th key={h} style={{ padding: "9px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.slice(0, 80).map(t => {
              const dpT = (v: number) => v > 1000 ? 2 : v > 10 ? 3 : 4;
              return (
                <tr key={t.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "9px 10px", fontWeight: 700, fontSize: 13 }}>{t.asset}</td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, fontWeight: 700,
                      background: t.mode === "scalping" ? "rgba(99,102,241,0.15)" : "rgba(245,158,11,0.15)",
                      color: t.mode === "scalping" ? "#a5b4fc" : "#f59e0b" }}>
                      {t.mode === "scalping" ? "SCALP" : "INTRA"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 10px", fontWeight: 700, color: t.direction === "LONG" ? "#10b981" : "#ef4444", fontSize: 13 }}>{t.direction}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{t.entry.toFixed(dpT(t.entry))}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{t.exit.toFixed(dpT(t.exit))}</td>
                  <td style={{ padding: "9px 10px", fontWeight: 800, fontSize: 14, color: t.pnl >= 0 ? "#10b981" : "#ef4444", fontFamily: "'JetBrains Mono',monospace" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</td>
                  <td style={{ padding: "9px 10px", fontSize: 12 }}>{exitLabel[t.result]}</td>
                  {showSource && <td style={{ padding: "9px 10px" }}><span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: t.source === "real" ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.12)", color: t.source === "real" ? "#10b981" : "#a5b4fc" }}>{t.source}</span></td>}
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Sin operaciones</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 5, fontSize: 10, color: "var(--muted)" }}>{filtered.length} operaciones</p>
    </div>
  );
}

// ─── AI Badge ─────────────────────────────────────────────────────────────────
function AiBadge({ status, onTest, latency }: { status: AiStatus; onTest: () => void; latency: number | null }) {
  const cfg: Record<AiStatus, { label: string; color: string; bg: string }> = {
    idle: { label: "IA: sin conf.", color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    testing: { label: "Probando…", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    ok: { label: `Groq ${latency ? latency + "ms" : "OK"}`, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
    error: { label: "IA: error", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    disabled: { label: "Motor local", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
  };
  const c = cfg[status];
  return (
    <button onClick={onTest} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, border: `1px solid ${c.color}30`, background: c.bg, color: c.color, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, animation: status === "ok" || status === "testing" ? "pulse 2s infinite" : "none", display: "inline-block" }} />
      {c.label}
    </button>
  );
}

// ─── Backtest Tab ──────────────────────────────────────────────────────────────
function BacktestTab({ liveReady, backtestSize, setBacktestSize, riskPct, setRiskPct, runBacktest, lastBacktest, backtestTrades }: {
  liveReady: boolean; backtestSize: number; setBacktestSize: (n: number) => void;
  riskPct: number; setRiskPct: (n: number) => void;
  runBacktest: () => void; lastBacktest: BacktestReport | null; backtestTrades: ClosedTrade[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", fontSize: 12, color: "#a5b4fc" }}>
        <strong>ℹ️ Backtest aislado</strong> — los resultados son puramente simulados y <strong>no modifican el modelo adaptativo</strong>. El modelo aprende exclusivamente de trades reales.
      </div>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <div><p className="label" style={{ marginBottom: 5 }}>Trades simulados</p><input className="inp" type="number" min={20} max={200} step={10} value={backtestSize} onChange={e => setBacktestSize(Number(e.target.value))} style={{ width: 110 }} /></div>
        <div><p className="label" style={{ marginBottom: 5 }}>Riesgo por trade (%)</p><input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} style={{ width: 100 }} /></div>
        <button className="btn-primary" onClick={runBacktest} disabled={!liveReady} style={{ opacity: liveReady ? 1 : 0.45 }}>▶ Ejecutar backtest</button>
      </div>
      {lastBacktest ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {[["Total trades", lastBacktest.total, false], ["Win rate", `${lastBacktest.winRate.toFixed(1)}%`, lastBacktest.winRate >= 50], ["Factor ganancia", lastBacktest.profitFactor.toFixed(2), lastBacktest.profitFactor >= 1.5], ["Sharpe", lastBacktest.sharpe.toFixed(2), lastBacktest.sharpe >= 1], ["Expectativa", money(lastBacktest.expectancy), lastBacktest.expectancy > 0], ["Max DD", `${lastBacktest.maxDrawdown.toFixed(1)}%`, false], ["Gan. bruta", money(lastBacktest.grossProfit), true], ["Pérd. bruta", money(lastBacktest.grossLoss), false], ["Win prom.", money(lastBacktest.avgWin), true], ["Loss prom.", money(lastBacktest.avgLoss), false]].map(([l, v, ac]) => (
              <div key={l as string} className="metric"><span className="label" style={{ fontSize: 11, fontWeight: 600 }}>{l}</span><strong style={{ color: ac ? "#10b981" : "var(--text)" }}>{v}</strong></div>
            ))}
          </div>
          <div className="card"><EquityCurve trades={backtestTrades} height={120} /></div>
          <div className="card" style={{ fontSize: 12, lineHeight: 1.9, color: "var(--muted)" }}>
            <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>📊 Interpretación estadística</p>
            <p>
              {lastBacktest.profitFactor >= 1.5 ? "✅ Factor ganancia sólido. " : "⚠️ Factor bajo (<1.5). "}
              {lastBacktest.sharpe >= 1 ? "✅ Sharpe aceptable. " : "⚠️ Sharpe bajo. "}
              {lastBacktest.winRate >= 50 ? "✅ Win rate positivo. " : "⚠️ WR <50% — revisar R:R. "}
              {lastBacktest.maxDrawdown <= 20 ? "✅ Drawdown controlado." : "❌ DD elevado — revisar sizing."}
            </p>
          </div>
          <div className="card"><p style={{ fontWeight: 700, marginBottom: 10 }}>Trades simulados</p><TradeHistory trades={backtestTrades} /></div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 28, marginBottom: 10 }}>🔬</p>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>Sin datos de backtest</p>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Sincronice datos y ejecute el backtest.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// SCALPING ENGINE — Control de mercado, liquidez, perfil de volumen
// ═══════════════════════════════════════════════════════════════════════════

// ─── ORDER FLOW ENGINE ───────────────────────────────────────────────────────

// 1. FOOTPRINT: reconstruye delta por vela con estimación de agresores
function buildFootprint(candles: Candle[]): FootprintCandle[] {
  return candles.map(c => {
    const range  = Math.max(c.h - c.l, 1e-9);
    const body   = Math.abs(c.c - c.o);
    const isUp   = c.c >= c.o;
    // Estimación de volumen comprador/vendedor basada en posición del cierre
    // Método: fracción del cierre dentro del rango (buy fraction)
    const buyFrac  = (c.c - c.l) / range;
    const sellFrac = 1 - buyFrac;
    const buyVol   = c.v * buyFrac;
    const sellVol  = c.v * sellFrac;
    const delta    = buyVol - sellVol;
    const deltaPct = c.v > 0 ? (delta / c.v) * 100 : 0;
    // Absorción: vela con mucho volumen pero cierre débil → absorción de esa dirección
    // Ej: vela alcista con gran volumen y mecha superior larga → vendedores absorbiendo compradores
    const upperWick = c.h - Math.max(c.o, c.c);
    const lowerWick = Math.min(c.o, c.c) - c.l;
    let absorption: FootprintCandle["absorption"] = "none";
    if (isUp && upperWick > body * 1.5 && c.v > 0)  absorption = "sell"; // compradores absorbidos
    if (!isUp && lowerWick > body * 1.5 && c.v > 0) absorption = "buy";  // vendedores absorbidos
    // Iniciativa: quién tomó el control (la agresión neta en la vela)
    const initiative: FootprintCandle["initiative"] =
      deltaPct >  15 ? "buy" :
      deltaPct < -15 ? "sell" : "neutral";
    return { ...c, buyVol, sellVol, delta, deltaPct, absorption, initiative };
  });
}

// 2. CVD MULTI-VENTANA: acumulación/distribución institucional
function calcCVDFull(fp: FootprintCandle[]): CVDAnalysis {
  if (!fp.length) return {
    cvd50: 0, cvd20: 0, cvd10: 0, cvd5: 0,
    slope50: 0, slope10: 0, divergence: false, trend: "neutral"
  };
  const accumulate = (slice: FootprintCandle[]) => {
    let cum = 0;
    return slice.map(c => { cum += c.delta; return cum; });
  };
  const tail50 = fp.slice(-50);
  const tail20 = fp.slice(-20);
  const tail10 = fp.slice(-10);
  const tail5  = fp.slice(-5);
  const ser50 = accumulate(tail50);
  const ser10 = accumulate(tail10);
  const cvd50 = ser50[ser50.length - 1] ?? 0;
  const cvd20 = accumulate(tail20).slice(-1)[0] ?? 0;
  const cvd10 = ser10[ser10.length - 1] ?? 0;
  const cvd5  = accumulate(tail5).slice(-1)[0] ?? 0;
  // Pendiente: regresión lineal simplificada sobre últimas N velas
  const slope = (ser: number[]) => {
    const n = ser.length;
    if (n < 2) return 0;
    return (ser[n-1] - ser[0]) / n;
  };
  const slope50 = slope(ser50);
  const slope10 = slope(ser10);
  // Divergencia: precio sube (+) pero CVD baja (−) o viceversa
  const priceChange = fp.length >= 20
    ? fp[fp.length-1].c - fp[fp.length-20].c : 0;
  const divergence = (priceChange > 0 && cvd20 < 0) || (priceChange < 0 && cvd20 > 0);
  const trend: CVDAnalysis["trend"] =
    cvd50 > 0 && slope50 > 0 ? "bullish" :
    cvd50 < 0 && slope50 < 0 ? "bearish" : "neutral";
  return { cvd50, cvd20, cvd10, cvd5, slope50, slope10, divergence, trend };
}

// Legacy wrapper para compatibilidad
function calcCVD(candles: Candle[]): { series: number[]; last: number; slope: number } {
  const fp = buildFootprint(candles);
  let cum = 0;
  const series = fp.map(c => { cum += c.delta; return cum; });
  const last = series[series.length - 1] ?? 0;
  const tail = series.slice(-6);
  const slope = tail.length >= 2 ? (tail[tail.length-1] - tail[0]) / tail.length : 0;
  return { series, last, slope };
}

// 3. VOLUME PROFILE COMPLETO con HVN/LVN y delta por nivel
function calcVolumeProfileFull(fp: FootprintCandle[]): VolumeProfileFull {
  if (fp.length < 5) {
    const mid = fp[fp.length-1]?.c ?? 0;
    return { poc: mid, vah: mid, val: mid, hvn: [], lvn: [], profile: [], valueAreaPct: 0 };
  }
  const hi      = Math.max(...fp.map(c => c.h));
  const lo      = Math.min(...fp.map(c => c.l));
  const range   = Math.max(hi - lo, 1e-9);
  const buckets = 32; // más resolución que antes (era 24)
  const bSize   = range / buckets;
  const vol     = new Array(buckets).fill(0) as number[];
  const buyVols = new Array(buckets).fill(0) as number[];
  const selVols = new Array(buckets).fill(0) as number[];

  fp.forEach(c => {
    const loIdx = Math.max(0,         Math.floor((c.l - lo) / bSize));
    const hiIdx = Math.min(buckets-1, Math.floor((c.h - lo) / bSize));
    const span  = Math.max(hiIdx - loIdx + 1, 1);
    for (let i = loIdx; i <= hiIdx; i++) {
      vol[i]     += c.v       / span;
      buyVols[i] += c.buyVol  / span;
      selVols[i] += c.sellVol / span;
    }
  });

  const pocIdx    = vol.indexOf(Math.max(...vol));
  const poc       = lo + (pocIdx + 0.5) * bSize;
  const totalVol  = vol.reduce((a,b) => a+b, 0);
  const target70  = totalVol * 0.70;
  let accum = 0, loB = pocIdx, hiB = pocIdx;
  while (accum < target70 && (loB > 0 || hiB < buckets-1)) {
    const down = loB > 0       ? vol[loB-1] : -1;
    const up   = hiB < buckets-1 ? vol[hiB+1] : -1;
    if (down >= up) { accum += down; loB--; } else { accum += up; hiB++; }
  }
  const vah = lo + (hiB + 1) * bSize;
  const val = lo + loB * bSize;

  // HVN: buckets con volumen > 130% del promedio → zonas de aceptación (soporte/resistencia)
  // LVN: buckets con volumen < 40% del promedio → vacíos de precio (el precio los cruza rápido)
  const avgVol  = totalVol / buckets;
  const hvn: number[] = [];
  const lvn: number[] = [];
  vol.forEach((v, i) => {
    const price = lo + (i + 0.5) * bSize;
    if (v > avgVol * 1.3) hvn.push(price);
    if (v < avgVol * 0.4 && i > 2 && i < buckets-2) lvn.push(price); // excluir extremos
  });

  const profile = vol.map((v, i) => ({
    price:   lo + (i + 0.5) * bSize,
    vol:     v,
    buyVol:  buyVols[i],
    sellVol: selVols[i],
  }));

  return { poc, vah, val, hvn, lvn, profile, valueAreaPct: ((hiB - loB) / buckets) * 100 };
}

// Legacy wrapper
function calcVolumeProfile(candles: Candle[]): { poc: number; vah: number; val: number; profile: Array<{price: number; vol: number}> } {
  const fp = buildFootprint(candles);
  const full = calcVolumeProfileFull(fp);
  return { poc: full.poc, vah: full.vah, val: full.val, profile: full.profile };
}

// 4. ORDER FLOW SCORE: motor principal de control de mercado
function analyzeOrderFlow(candles: Candle[], price: number, vwap: number, atr: number): OrderFlowScore {
  if (candles.length < 10) {
    return {
      control: "contested", controlScore: 0, cvdScore: 0, footprintScore: 0,
      profileScore: 0, absorptionScore: 0, longSetup: false, shortSetup: false,
      setupStrength: 0, narrative: "Datos insuficientes",
      cvd: { cvd50: 0, cvd20: 0, cvd10: 0, cvd5: 0, slope50: 0, slope10: 0, divergence: false, trend: "neutral" },
      profile: { poc: price, vah: price, val: price, hvn: [], lvn: [], profile: [], valueAreaPct: 0 },
      footprint: [],
    };
  }

  const fp      = buildFootprint(candles.slice(-60));
  const cvd     = calcCVDFull(fp);
  const profile = calcVolumeProfileFull(fp);

  // ── Score CVD: dónde fluye el dinero ──────────────────────────────────────
  // Normalizamos por el volumen total para independizarnos del tamaño del mercado
  const totalVol  = fp.reduce((s,c) => s + c.v, 1e-9);
  const cvdNorm50 = clamp(cvd.cvd50 / (totalVol * 0.12), -1, 1);
  const cvdNorm10 = clamp(cvd.cvd10 / (totalVol * 0.06), -1, 1);
  const slopeNorm = clamp(cvd.slope50 / (totalVol * 0.003), -1, 1);
  const cvdScore  = clamp(cvdNorm50 * 40 + cvdNorm10 * 35 + slopeNorm * 25, -100, 100);

  // ── Score Footprint: iniciativa y absorción en velas recientes ────────────
  const recent15 = fp.slice(-15);
  let fpBuyScore = 0, fpSellScore = 0;
  recent15.forEach((c, idx) => {
    const weight = 0.6 + idx * 0.03; // velas recientes pesan más
    if (c.initiative === "buy")  fpBuyScore  += weight;
    if (c.initiative === "sell") fpSellScore += weight;
    // Absorción: si hay absorción de vendedores (compradores se imponen), bullish
    if (c.absorption === "buy")  fpBuyScore  += weight * 0.5;
    if (c.absorption === "sell") fpSellScore += weight * 0.5;
  });
  const fpTotal        = fpBuyScore + fpSellScore || 1;
  const footprintScore = clamp(((fpBuyScore - fpSellScore) / fpTotal) * 100, -100, 100);

  // ── Score Volume Profile: posición del precio respecto al value area ──────
  // Precio sobre VAH → toros en control, compradores aceptan precios altos
  // Precio bajo VAL → osos en control
  // Precio entre VAL y POC → osos leves
  // Precio entre POC y VAH → toros leves
  let profileScore = 0;
  if      (price > profile.vah) profileScore =  80;
  else if (price > profile.poc) profileScore =  35;
  else if (price < profile.val) profileScore = -80;
  else                          profileScore = -35;
  // Bonus/malus: precio en LVN (movimiento rápido esperado) vs HVN (resistencia)
  const nearHVN = profile.hvn.some(h => Math.abs(price - h) < atr * 0.5);
  const nearLVN = profile.lvn.some(l => Math.abs(price - l) < atr * 0.5);
  if (nearLVN) profileScore *= 1.3; // LVN: precio se moverá más rápido
  if (nearHVN) profileScore *= 0.7; // HVN: resistencia a seguir

  // ── Score Absorción: órdenes que frenan el movimiento ────────────────────
  // Absorción de vendedores (compradores absorben sells) → bullish
  // Absorción de compradores (vendedores absorben buys) → bearish
  const last20  = fp.slice(-20);
  const buyAbsorptions  = last20.filter(c => c.absorption === "buy").length;
  const sellAbsorptions = last20.filter(c => c.absorption === "sell").length;
  const absorptionScore = clamp(
    (buyAbsorptions - sellAbsorptions) / Math.max(last20.length * 0.2, 1) * 100,
    -100, 100
  );

  // ── Score VWAP: posición respecto al VWAP ────────────────────────────────
  const vwapDev   = (price - vwap) / Math.max(atr, 1e-9);
  const vwapScore = clamp(vwapDev * 25, -50, 50); // menor peso

  // ── Score compuesto: ponderado por confiabilidad de cada señal ───────────
  const controlScore = clamp(
    cvdScore        * 0.35  // CVD: más confiable, institucional
    + footprintScore * 0.25  // Footprint: iniciativa real
    + profileScore   * 0.20  // Perfil: contexto estructural
    + absorptionScore * 0.12 // Absorción: señal de reversión/continuación
    + vwapScore      * 0.08, // VWAP: contexto menor
    -100, 100
  );

  const control: OrderFlowScore["control"] =
    controlScore >  20 ? "bulls" :
    controlScore < -20 ? "bears" : "contested";

  // ── Setup de trading ──────────────────────────────────────────────────────
  // LONG: toros en control + CVD alcista + precio sobre POC/VAH + sin divergencia bajista
  const longSetup =
    controlScore > 18
    && cvd.trend !== "bearish"
    && price >= profile.val   // al menos dentro del value area
    && !cvd.divergence;

  // SHORT: osos en control + CVD bajista + precio bajo POC/VAL + sin divergencia alcista
  const shortSetup =
    controlScore < -18
    && cvd.trend !== "bullish"
    && price <= profile.vah
    && !cvd.divergence;

  const setupStrength = clamp(Math.abs(controlScore) / 100, 0, 1);

  // ── Narrativa en español ──────────────────────────────────────────────────
  const ctrlStr = control === "bulls" ? "TOROS" : control === "bears" ? "OSOS" : "DISPUTADO";
  const cvdStr  = cvd.trend === "bullish" ? "CVD↑ acumulando" : cvd.trend === "bearish" ? "CVD↓ distribuyendo" : "CVD lateral";
  const posStr  =
    price > profile.vah ? `precio sobre VAH (${profile.vah.toFixed(2)}) — aceptación alcista` :
    price > profile.poc ? `precio sobre POC (${profile.poc.toFixed(2)}) — toros lideran` :
    price < profile.val ? `precio bajo VAL (${profile.val.toFixed(2)}) — aceptación bajista` :
    `precio bajo POC (${profile.poc.toFixed(2)}) — osos lideran`;
  const absorStr = buyAbsorptions > sellAbsorptions
    ? `absorción alcista (${buyAbsorptions})`
    : sellAbsorptions > buyAbsorptions
    ? `absorción bajista (${sellAbsorptions})`
    : "sin absorción dominante";
  const divStr = cvd.divergence ? " ⚠ DIVERGENCIA CVD-precio" : "";

  const narrative =
    `Control: ${ctrlStr} (${controlScore.toFixed(0)}pts) | ${cvdStr} | ${posStr} | ${absorStr}${divStr}`;

  return {
    control, controlScore, cvdScore, footprintScore, profileScore, absorptionScore,
    cvd, profile, footprint: fp, longSetup, shortSetup, setupStrength, narrative,
  };
}

// Legacy analyzeMarketControl — mantiene compatibilidad con el resto del código
function calcSyntheticLiquidity(candles: Candle[], atr: number): { levels: Array<{price: number; side: "bid"|"ask"; strength: number}>; bidAskRatio: number } {
  const fp = buildFootprint(candles.slice(-30));
  const levels: Array<{price: number; side: "bid"|"ask"; strength: number}> = [];
  fp.forEach(c => {
    const upperWick = c.h - Math.max(c.o, c.c);
    const lowerWick = Math.min(c.o, c.c) - c.l;
    if (upperWick > atr * 0.3) levels.push({ price: c.h, side: "ask", strength: Math.min(upperWick / atr, 2) });
    if (lowerWick > atr * 0.3) levels.push({ price: c.l, side: "bid", strength: Math.min(lowerWick / atr, 2) });
  });
  const bids = levels.filter(l => l.side === "bid").reduce((s,l) => s+l.strength, 0);
  const asks = levels.filter(l => l.side === "ask").reduce((s,l) => s+l.strength, 0);
  return { levels, bidAskRatio: (bids / Math.max(bids+asks, 1e-9)) * 100 };
}

function analyzeMarketControl(candles: Candle[], ind: Indicators, atr: number): MarketControl {
  if (candles.length < 10) {
    return { score: 0, bias: "neutral", cvd: 0, cvdSlope: 0,
      poc: ind.vwap, vah: ind.vwap, val: ind.vwap,
      vwapDev: 0, bidAskImbalance: 50, dominantSide: "balanced" };
  }
  const price = candles[candles.length-1].c;
  const of    = analyzeOrderFlow(candles, price, ind.vwap, atr);
  const { last: cvd, slope: cvdSlope } = calcCVD(candles.slice(-50));
  const bidAskRatio = calcSyntheticLiquidity(candles.slice(-50), atr).bidAskRatio;
  const score = of.controlScore;
  const bias: MarketControl["bias"]   = score > 15 ? "bull" : score < -15 ? "bear" : "neutral";
  const dominantSide: MarketControl["dominantSide"] =
    score > 20 ? "buyers" : score < -20 ? "sellers" : "balanced";
  return {
    score, bias, cvd, cvdSlope,
    poc: of.profile.poc, vah: of.profile.vah, val: of.profile.val,
    vwapDev: of.cvdScore / 100, bidAskImbalance: bidAskRatio, dominantSide
  };
}

// calcRiskMetrics — métricas completas de riesgo (panel + IA + aiDecision)
function calcRiskMetrics(trades: ClosedTrade[], balance: number, maxDdPct: number) {
  const real = trades.filter(t => t.source === "real");
  const wins   = real.filter(t => t.pnl > 0);
  const losses = real.filter(t => t.pnl <= 0);
  const total  = real.length;
  const winRate = total > 0 ? wins.length / total : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pnl         = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  const avgWin   = wins.length   ? grossProfit / wins.length   : 0;
  const avgLoss  = losses.length ? grossLoss   / losses.length : 0;
  const expectancy = total > 0 ? pnl / total : 0;
  const rets = real.map(t => t.pnlPct ?? (t.pnl / Math.max(balance, 1) * 100));
  const sharpe = rets.length > 1 ? avg(rets) / (std(rets) || 1) * Math.sqrt(252) : 0;
  const maxDrawdown  = calcDrawdown(real);
  const maxDdPctVal  = balance > 0 ? (maxDrawdown / balance) * 100 : 0;
  const blocked      = maxDdPctVal >= maxDdPct;
  // Kelly criterion: WR - (1-WR)/RR
  const kellyWR  = total >= 5 ? winRate : 0.5;
  const kellyRR  = avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : 1.5;
  const kellyFraction = clamp(kellyWR - (1 - kellyWR) / Math.max(kellyRR, 0.1), 0, 0.25);
  // Riesgo de ruina (Vince)
  const edge = kellyWR - (1 - kellyWR) / Math.max(kellyRR, 0.5);
  const ruinProb = total >= 10 && edge > 0
    ? Math.pow(Math.max((1 - edge) / (1 + edge), 0), 30) * 100
    : (total < 5 ? 50 : 75);
  return { total, winRate, pnl, grossProfit, grossLoss, profitFactor,
           avgWin, avgLoss, expectancy, sharpe, maxDrawdown, maxDdPctVal,
           kellyFraction, kellyWR, kellyRR, ruinProb, blocked };
}


function calcScalpingRisk(trades: ClosedTrade[], balance: number, maxDailyLoss: number, maxDailyGain: number): ScalpingRisk {
  const today = new Date().toDateString();
  const todayTrades = trades.filter(t => new Date(t.closedAt).toDateString() === today);
  const dailyPnl    = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const dailyPnlPct = (dailyPnl / Math.max(balance, 1)) * 100;
  const recent = trades.filter(t => t.source === "real").slice(0, 20);
  let mathExpectancy = 0;
  if (recent.length >= 5) {
    const wins   = recent.filter(t => t.pnl > 0);
    const losses = recent.filter(t => t.pnl <= 0);
    const wr     = wins.length / recent.length;
    const avgW   = wins.length   ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length   : 0;
    const avgL   = losses.length ? Math.abs(losses.reduce((s,t)=>s+t.pnl,0))/losses.length : 1;
    mathExpectancy = wr * avgW - (1 - wr) * avgL;
  }
  let streak = 0;
  for (const t of trades.slice(0, 10)) { if (t.pnl <= 0) streak++; else break; }
  // ── Kelly criterion: fracción óptima del capital a arriesgar ────────────────
  // Kelly = WR - (1-WR)/RR  donde RR = avgWin/avgLoss
  const recent20 = trades.filter(t => t.source === "real").slice(0, 20);
  const recentWins   = recent20.filter(t => t.pnl > 0);
  const recentLosses = recent20.filter(t => t.pnl <= 0);
  const kellyWR  = recent20.length >= 5 ? recentWins.length / recent20.length : 0.5;
  const kellyRR  = recentWins.length && recentLosses.length
    ? (recentWins.reduce((s,t)=>s+t.pnl,0)/recentWins.length) /
      (Math.abs(recentLosses.reduce((s,t)=>s+t.pnl,0)/recentLosses.length) || 1)
    : 1.5;
  const kellyFraction = clamp(kellyWR - (1 - kellyWR) / kellyRR, 0, 0.25);

  // ── Riesgo de ruina (fórmula de Vince) ───────────────────────────────────
  const edge = kellyWR - (1 - kellyWR) / Math.max(kellyRR, 0.5);
  const ruinProb = recent20.length >= 10 && edge > 0
    ? Math.pow(Math.max((1 - edge) / (1 + edge), 0), 30) * 100
    : (recent20.length < 5 ? 50 : 75); // conservador si no hay datos

  // ── Sizing multiplier basado en riesgo compuesto ──────────────────────────
  const ruinRisk = clamp(ruinProb / 100, 0, 1);
  const ddPct = dailyPnlPct;
  const sizeMultiplier =
    ruinRisk > 0.6 || ddPct < -maxDailyLoss * 0.8 ? 0.25 :
    ruinRisk > 0.4 || ddPct < -maxDailyLoss * 0.5 ? 0.50 :
    ruinRisk > 0.2 || ddPct < -maxDailyLoss * 0.3 ? 0.75 : 1.0;

  let blocked = false, blockReason = "";
  if (dailyPnlPct <= -maxDailyLoss) { blocked = true; blockReason = `Límite pérdida diaria (-${maxDailyLoss}%) alcanzado`; }
  if (streak >= 6) { blocked = true; blockReason = `6 pérdidas consecutivas — pausa obligatoria`; }
  return { dailyPnl, dailyTrades: todayTrades.length, ruinRisk, ruinProb,
           mathExpectancy, kellyFraction, kellyWR, kellyRR,
           blocked, blockReason, sizeMultiplier, streak };
}

// ─── Persistencia ────────────────────────────────────────────────────────────

// ─── AI Chat Panel ────────────────────────────────────────────────────────────
type ChatMessage = { role: "user" | "ai"; text: string; ts: string };

function AiChatPanel({
  apiKey, usingGroq, openPositions, realTrades, lastSignal, prices, stats,
}: {
  apiKey: string; usingGroq: boolean;
  openPositions: Position[]; realTrades: ClosedTrade[];
  lastSignal: Signal | null; prices: Record<Asset, number>;
  stats: { total: number; winRate: number; pnl: number; profitFactor: number; sharpe: number; maxDrawdown?: number };
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "ai", text: "Hola. Soy tu trader IA. Podés preguntarme sobre los trades activos, la estrategia, el rendimiento, o cualquier duda sobre las operaciones.", ts: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    const q = input.trim();
    if (!q || loading) return;
    const ts = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { role: "user", text: q, ts }]);
    setInput("");
    setLoading(true);

    // Contexto del sistema para el chat
    // Calcular métricas de riesgo para el chat
    const chatWins   = realTrades.filter(t=>t.pnl>0);
    const chatLosses = realTrades.filter(t=>t.pnl<=0);
    const chatWR     = stats.total > 0 ? chatWins.length / stats.total : 0;
    const chatAvgW   = chatWins.length   ? chatWins.reduce((s,t)=>s+t.pnl,0)/chatWins.length   : 0;
    const chatAvgL   = chatLosses.length ? Math.abs(chatLosses.reduce((s,t)=>s+t.pnl,0)/chatLosses.length) : 0;
    const chatEV     = (chatWR * chatAvgW - (1-chatWR) * chatAvgL).toFixed(3);
    const chatKelly  = chatAvgL > 0 ? clamp(chatWR - (1-chatWR)/(chatAvgW/chatAvgL), 0, 0.25) : 0;
    const chatStreak = realTrades.slice(0,10).reduce((s,t)=>t.pnl<=0 ? s+1 : 0, 0);

    const systemCtx = `You are an algorithmic trading system managing a REAL funded account of $100 USDT.
You speak to your operator in Spanish. Be direct, quantitative, and honest — neither alarmist nor dismissive.

ACCOUNT STATE:
- Equity: $${stats.total > 0 ? (100 + stats.pnl).toFixed(2) : "100.00"} USDT (initial: $100)
- P&L total: $${stats.pnl.toFixed(2)} | Trades: ${stats.total} | Win rate: ${stats.winRate.toFixed(1)}%
- Profit factor: ${stats.profitFactor.toFixed(2)} | Sharpe: ${stats.sharpe.toFixed(2)} | Max DD: ${stats.maxDrawdown?.toFixed(1) ?? "N/A"}%
- Avg win: $${chatAvgW.toFixed(3)} | Avg loss: $${chatAvgL.toFixed(3)}
- Expected value/trade: $${chatEV}
- Kelly fraction: ${(chatKelly*100).toFixed(1)}% of capital
- Consecutive losses now: ${chatStreak}
- Open positions: ${openPositions.length}/3
- Current prices: BTC $${prices.BTCUSD?.toFixed(2)} | ETH $${prices.ETHUSD?.toFixed(2)} | XAU $${prices.XAUUSD?.toFixed(2)} | XAG $${prices.XAGUSD?.toFixed(3)}

OPEN POSITIONS:
${openPositions.length === 0 ? "None" : openPositions.map(p => {
  const pnlEst = (p.signal.direction === "LONG"
    ? prices[p.signal.asset] - p.signal.entry
    : p.signal.entry - prices[p.signal.asset]) * p.size;
  return `  ${p.signal.asset} ${p.signal.direction} ${p.signal.mode.toUpperCase()} | Entry ${p.signal.entry.toFixed(3)} → now ${prices[p.signal.asset]?.toFixed(3)} | PnL est: $${pnlEst.toFixed(3)} | SL: ${p.signal.stopLoss.toFixed(3)} | TP: ${p.signal.takeProfit.toFixed(3)} | Margin: $${p.marginUsed.toFixed(3)}`;
}).join("\n")}

LAST 5 TRADES:
${realTrades.slice(0,5).map(t =>
  `  ${t.asset} ${t.direction} ${t.mode.toUpperCase()} | ${t.result} | PnL: $${t.pnl.toFixed(3)}`
).join("\n") || "None yet"}

LAST SIGNAL: ${lastSignal ? `${lastSignal.asset} ${lastSignal.direction} ${lastSignal.mode} conf:${lastSignal.confidence.toFixed(0)}% | ${lastSignal.rationale}` : "None"}

BEHAVIOR RULES FOR CHAT:
- When asked about risk, always cite actual numbers (EV, Kelly, ruina, DD)
- When asked why a trade opened/closed, reference the actual signal data
- When asked if should open/close, apply the decision framework: EV positive + RR ≥ 1.5 + DD < 5% = lean OPEN
- Never say "it's just paper trading" — treat everything as real capital
- Max 220 words per response. Be precise and actionable.`;

    if (!usingGroq || !apiKey.trim()) {
      setMessages(prev => [...prev, {
        role: "ai",
        text: "Necesitás activar Groq y configurar una API key en Configuración para usar el chat con IA.",
        ts: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
      }]);
      setLoading(false);
      return;
    }

    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0.4, max_tokens: 350,
          messages: [
            { role: "system", content: systemCtx },
            ...messages.filter(m => m.role !== "ai" || messages.indexOf(m) > 0).slice(-6).map(m => ({
              role: m.role === "user" ? "user" : "assistant", content: m.text
            })),
            { role: "user", content: q }
          ],
        }),
      });
      const data = await r.json() as { choices: Array<{ message: { content: string } }> };
      const reply = data?.choices?.[0]?.message?.content ?? "Sin respuesta.";
      setMessages(prev => [...prev, { role: "ai", text: reply, ts: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Error al conectar con Groq. Verificá la API key.", ts: "" }]);
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    "¿Por qué abriste el último trade?",
    "¿Qué opinas del rendimiento actual?",
    "¿Cuál es el mayor riesgo ahora?",
    "¿Deberías cerrar alguna posición?",
  ];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: 420, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Chat con la IA</div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>
            {usingGroq && apiKey ? "Llama 4 Scout · contexto en vivo" : "Configurá Groq para activar"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "88%", padding: "8px 11px", borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              background: m.role === "user" ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${m.role === "user" ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`,
              fontSize: 12.5, lineHeight: 1.5, color: "var(--text)",
            }}>
              {m.text}
            </div>
            {m.ts && <span style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2, paddingInline: 4 }}>{m.ts}</span>}
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ padding: "8px 12px", borderRadius: "12px 12px 12px 4px", background: "rgba(255,255,255,0.05)", fontSize: 12 }}>
              <span style={{ opacity: 0.6 }}>Analizando</span>
              <span style={{ animation: "pulse 1s infinite" }}> ···</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div style={{ padding: "4px 10px", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => setInput(s)}
              style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 12, cursor: "pointer",
                border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)",
                color: "#a5b4fc" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 6 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void sendMessage())}
          placeholder="Preguntá sobre los trades..."
          style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)", color: "var(--text)", fontSize: 12.5, outline: "none" }}
        />
        <button onClick={() => void sendMessage()} disabled={loading || !input.trim()}
          style={{ padding: "7px 12px", borderRadius: 8, border: "none", cursor: loading ? "wait" : "pointer",
            background: loading || !input.trim() ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.7)",
            color: "#fff", fontSize: 13, fontWeight: 700 }}>
          ↑
        </button>
      </div>
    </div>
  );
}

function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  }, [key, val]);
  return [val, setVal];
}

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
  const [candles,    setCandles]    = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [candles5m,  setCandles5m]  = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [candles15m, setCandles15m] = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [mt5SpreadMap, setMt5SpreadMap] = useState<Partial<Record<Asset, {spread: number; spread_pct: number; bid: number; ask: number}>>>({});
  const [balance, setBalance] = useLocalStorage("tl_balance", 100);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [realTrades, setRealTrades] = useLocalStorage<ClosedTrade[]>("tl_trades", []);
  const [backtestTrades, setBacktestTrades] = useState<ClosedTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<Signal | null>(null);
  const [lastOF, setLastOF] = useState<OrderFlowScore | null>(null);
  const [volumeShock, setVolumeShock] = useState(0.28);
  const [learning, setLearning] = useLocalStorage<LearningModel>("tl_learning", initialLearning);
  const [apiKey, setApiKey] = useLocalStorage("tl_apiKey", "");
  const [usingGroq, setUsingGroq] = useState(false);
  const [riskPct, setRiskPct] = useLocalStorage("tl_riskPct", 1.2);
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
  const [showIndicators, setShowIndicators] = useState(true);
  const [maxDailyLoss, setMaxDailyLoss] = useLocalStorage("tl_maxDailyLoss", 3);   // % del balance
  const [maxDailyGain, setMaxDailyGain] = useLocalStorage("tl_maxDailyGain", 6);   // % del balance
  // ── MT5 Bridge ────────────────────────────────────────────────────────────
  const [mt5Enabled,  setMt5Enabled]  = useState(false);
  const [mt5Url,      setMt5Url]      = useState("http://localhost:8000");
  const [mt5Status,   setMt5Status]   = useState<"disconnected"|"connected"|"error"|"testing">("disconnected");
  const [mt5Account,  setMt5Account]  = useState<string|null>(null);
  const [mt5Balance,  setMt5Balance]  = useState<number|null>(null);

  // Indicadores, Wyckoff y control de mercado calculados por activo
  const [indicatorsMap, setIndicatorsMap] = useState<Partial<Record<Asset, Indicators>>>({});
  const [wyckoffMap, setWyckoffMap] = useState<Partial<Record<Asset, WyckoffAnalysis>>>({});
  const [marketControlMap, setMarketControlMap] = useState<Partial<Record<Asset, MarketControl>>>({});

  const toastIdRef = useRef(0);
  const prevPricesRef = useRef(initialPrices);
  const openPositionsRef = useRef(openPositions);
  const learningRef = useRef(learning);
  const volumeShockRef = useRef(volumeShock);
  const seriesRef = useRef(series);
  const candlesRef = useRef(candles);  // ref para usar en setInterval sin stale closure

  useEffect(() => { openPositionsRef.current = openPositions; }, [openPositions]);
  useEffect(() => { prevPricesRef.current = prices; }, [prices]);
  useEffect(() => { learningRef.current = learning; }, [learning]);
  useEffect(() => { volumeShockRef.current = volumeShock; }, [volumeShock]);
  useEffect(() => { seriesRef.current = series; }, [series]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  // Tick cada segundo
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (openPositionsRef.current.length > 0) evaluatePositionsWithCurrentPrices();
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

  // Recalcular indicadores y Wyckoff al cambiar velas
  useEffect(() => {
    assets.forEach(a => {
      const c = candles[a];
      if (c.length > 25) {
        setIndicatorsMap(prev => ({ ...prev, [a]: computeIndicators(c) }));
        setWyckoffMap(prev => ({ ...prev, [a]: analyzeWyckoff(c) }));
        const indForControl = computeIndicators(c);
        const atrForControl = Math.max(calcAtrFromSeries(c.map(x=>x.c), 20), minAtrByAsset[a] ?? 1);
        setMarketControlMap(prev => ({ ...prev, [a]: analyzeMarketControl(c, indForControl, atrForControl) }));
      }
    });
  }, [candles]);

  function pushToast(msg: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts(prev => [{ id, msg, type }, ...prev].slice(0, 5));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4800);
  }
  function removeToast(id: number) { setToasts(prev => prev.filter(t => t.id !== id)); }

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
      setAiLatency(Date.now() - t0); setAiStatus("ok");
      pushToast(`✅ Groq conectada — ${Date.now() - t0}ms`, "success");
    } catch (e) {
      setAiStatus("error");
      pushToast(`❌ Groq: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  const spreadByAsset = useMemo(() => {
    const m = {} as Record<Asset, number>;
    assets.forEach(a => { m[a] = (getSpreadPct(a, volumeShock) / 100) * prices[a]; });
    return m;
  }, [prices, volumeShock]);

  // spreadSnapshot: snapshot completo bid/ask/spread por activo para mostrar en UI
  const spreadSnapshot = useMemo(() => {
    const m = {} as Record<Asset, SpreadSnapshot>;
    assets.forEach(a => { m[a] = calcCFDSpread(a, prices[a], volumeShock); });
    return m;
  }, [prices, volumeShock]);

  const unrealized = useMemo(() => openPositions.reduce((acc, p) => {
    const mark = prices[p.signal.asset];
    const spread = spreadByAsset[p.signal.asset];
    const eff = p.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
    return acc + (p.signal.direction === "LONG" ? eff - p.signal.entry : p.signal.entry - eff) * p.size;
  }, 0), [openPositions, prices, spreadByAsset]);

  const equity = balance + unrealized;
  const riskMetrics = useMemo(() => calcRiskMetrics(realTrades, balance, 5), [realTrades, balance]);

  const currentIndicators = indicatorsMap[asset] ?? null;
  const currentWyckoff = wyckoffMap[asset] ?? null;

  // Order Flow en tiempo real para el activo/modo seleccionado
  const currentOF = useMemo(() => {
    if (tab !== "scalping") return null;
    const c = candles[asset];
    const ind = currentIndicators;
    if (!c?.length || !ind) return null;
    return analyzeOrderFlow(c, prices[asset], ind.vwap, calcAtrFromSeries(series[asset], 20));
  }, [tab, asset, candles, prices, currentIndicators, series]);

  const stats = useMemo(() => {
    const t = realTrades; const total = t.length;
    const wins = t.filter(x => x.pnl > 0); const losses = t.filter(x => x.pnl <= 0);
    const pnl = t.reduce((a, x) => a + x.pnl, 0);
    const gp = wins.reduce((a, x) => a + x.pnl, 0);
    const gl = Math.abs(losses.reduce((a, x) => a + x.pnl, 0));
    const returns = t.map(x => x.pnlPct / 100);
    const sharpe = std(returns) === 0 ? 0 : (avg(returns) / std(returns)) * Math.sqrt(Math.max(returns.length, 1));
    return { total, winRate: total ? (wins.length / total) * 100 : 0, pnl, expectancy: total ? pnl / total : 0, profitFactor: gl > 0 ? gp / gl : gp > 0 ? 99 : 0, sharpe, maxDrawdown: calcDrawdown(t) };
  }, [realTrades]);

  const bestHours = useMemo(() =>
    Object.entries(learning.hourEdge).map(([h, e]) => ({ hour: Number(h), edge: e }))
      .sort((a, b) => b.edge - a.edge).slice(0, 4), [learning.hourEdge]);

  const visibleCandles = useMemo(() => {
    const c = candles[asset];
    return c.length > 0 ? c : deriveSyntheticCandles(series[asset]);
  }, [asset, candles, series]);

  function refreshLearning(trades: ClosedTrade[]) {
    const real = trades.filter(t => t.source === "real");
    if (!real.length) return;
    const wr = real.filter(t => t.pnl > 0).length / real.length;
    const exp = real.reduce((a, t) => a + t.pnl, 0) / real.length;
    const hourMap: Record<number, number[]> = {};
    real.forEach(t => { const h = new Date(t.closedAt).getHours(); if (!hourMap[h]) hourMap[h] = []; hourMap[h].push(t.pnl); });
    const hourEdge: Record<number, number> = {};
    Object.entries(hourMap).forEach(([h, vs]) => { hourEdge[Number(h)] = avg(vs); });
    // Con pocos trades (<10) el modelo no ajusta el piso para no bloquearse
    const minTrades = real.length;
    const floorAdjust = minTrades >= 10 ? clamp(52 + (0.5 - wr) * 16, 48, 62) : 52;
    setLearning({
      riskScale: clamp(0.8 + wr * 0.6 + Math.max(exp, 0) * 0.03, 0.7, 1.5),
      confidenceFloor: floorAdjust,
      scalpingTpAtr: clamp(1.2 + wr * 0.4, 1.15, 1.8),
      intradayTpAtr: clamp(3.0 + wr * 1.5, 2.8, 5.0),
      // atrTrailMult ya no se usa para trailing (es estructural), lo mantenemos
      // como parámetro de buffer del swing stop
      atrTrailMult: clamp(0.25 + wr * 0.3, 0.2, 0.6),
      hourEdge,
    });
  }

  function getMtfScore(a: Asset, mode: Mode = "intradia") {
    const vals = series[a];
    const atr = Math.max(calcAtrFromSeries(vals, 20), minAtrByAsset[a] ?? prices[a] * 0.001);

    if (mode === "scalping") {
      // ── MTF REAL: usa velas 5m y 15m si vienen del bridge ──────────────────
      // Con bridge: HTF = EMA8/21 sobre velas 15m reales, LTF = EMA5/13 sobre 5m reales
      // Sin bridge: sintético (velas 1m agrupadas) — menos preciso
      const real15m = candles15m[a];
      const real5m  = candles5m[a];
      const hasReal = real15m?.length >= 21 && real5m?.length >= 13;

      let htf: number, ltf: number;

      if (hasReal) {
        // HTF 15m REAL — EMA8/21 sobre closes de velas 15m
        const closes15 = real15m.map(c => c.c);
        const atr15    = Math.max(calcAtr(real15m, 14), atr);
        const e8_15    = ema(closes15, 8);
        const e21_15   = ema(closes15, 21);
        htf = (e8_15 - e21_15) / atr15;
        // LTF 5m REAL — EMA5/13 sobre closes de velas 5m
        const closes5 = real5m.map(c => c.c);
        const atr5    = Math.max(calcAtr(real5m, 14), atr);
        const e5_5    = ema(closes5, 5);
        const e13_5   = ema(closes5, 13);
        ltf = (e5_5 - e13_5) / atr5;
      } else {
        // Sintético desde velas 1m (fallback sin bridge)
        const n = vals.length;
        const slice45 = vals.slice(-Math.min(45, n));
        htf = (ema(slice45, Math.min(8, slice45.length)) - ema(slice45, Math.min(21, slice45.length))) / atr;
        const slice20 = vals.slice(-Math.min(20, n));
        ltf = (ema(slice20, Math.min(5, slice20.length)) - ema(slice20, Math.min(13, slice20.length))) / atr;
      }

      // Exec 1m: últimas 3 velas (igual en ambos casos — siempre 1m)
      const n    = vals.length;
      const exec = n >= 3 ? (vals[n-1] - vals[n-3]) / atr : 0;
      return { htf, ltf, exec, atr, hasRealTF: hasReal };
    }

    // Intradía: MAs tendenciales
    const ma10 = avg(vals.slice(-10));
    const ma20 = avg(vals.slice(-20));
    const ma50 = vals.length >= 50 ? avg(vals.slice(-50)) : avg(vals);
    const execSlice = vals.slice(-8);
    return {
      htf:  (ma20 - ma50) / atr,
      ltf:  (ma10 - ma20) / atr,
      exec: ((execSlice[execSlice.length - 1] ?? 0) - (execSlice[0] ?? 0)) / atr,
      atr,
    };
  }

  function generateSignal(currentMode: Mode, currentAsset: Asset): Signal {
    const price = prices[currentAsset];
    const spreadPct = getSpreadPct(currentAsset, volumeShock);
    const spread = (spreadPct / 100) * price;
    const mtf = getMtfScore(currentAsset, currentMode);
    const ind = indicatorsMap[currentAsset] ?? computeIndicators(candles[currentAsset]);
    const wyckoff = currentMode === "intradia"
      ? (wyckoffMap[currentAsset] ?? analyzeWyckoff(candles[currentAsset]))
      : { bias: "neutral" as const, phase: "unknown" as const, events: [],
          supportZone: null, resistanceZone: null, volumeClimaxIdx: [],
          narrative: "", wyckoffLotMult: 1.0 };
    const lrn = learningRef.current;

    // ── Scalping: dirección determinada por control de mercado ────────────────
    // En scalping: Order Flow es la autoridad. MTF confirma, no dicta.
    const price0 = series[currentAsset]?.[series[currentAsset].length-1] ?? 0;
    const of = currentMode === "scalping"
      ? analyzeOrderFlow(candles[currentAsset], price0, ind.vwap, mtf.atr)
      : null;
    const mc = currentMode === "scalping"
      ? (marketControlMap[currentAsset] ?? analyzeMarketControl(candles[currentAsset], ind, mtf.atr))
      : null;

    // ── Dirección primaria: jerarquía OF > MC > MTF ───────────────────────
    let mtfDir: Direction;
    if (currentMode === "scalping" && of) {
      if      (of.control === "bulls" && of.longSetup)  mtfDir = "LONG";
      else if (of.control === "bears" && of.shortSetup) mtfDir = "SHORT";
      else if (mc && mc.bias !== "neutral")              mtfDir = mc.bias === "bull" ? "LONG" : "SHORT";
      else mtfDir = (mtf.htf + mtf.ltf + mtf.exec) >= 0 ? "LONG" : "SHORT";
    } else {
      mtfDir = (mtf.htf + mtf.ltf + mtf.exec) >= 0 ? "LONG" : "SHORT";
    }
    const mtfStrength = Math.abs(mtf.htf + mtf.ltf + mtf.exec);

    // ── Paso 2: Indicador de confirmación (el más fuerte disponible) ──────────
    // Elige el indicador con mayor convicción en la dirección MTF
    type ConfirmIndicator = { name: string; confirms: boolean; strength: number };

    const confirmCandidates: ConfirmIndicator[] = currentMode === "scalping"
      ? [
          // SCALPING — Confirmadores con Order Flow integrado
          { name: "CVD-Flow",
            confirms: of
              ? (mtfDir === "LONG"
                  ? of.cvd.trend !== "bearish" && of.cvd.cvd10 >= 0 && !of.cvd.divergence
                  : of.cvd.trend !== "bullish" && of.cvd.cvd10 <= 0 && !of.cvd.divergence)
              : true,
            strength: of ? clamp(Math.abs(of.cvdScore) / 80, 0, 1) : 0.5 },
          { name: "Vol-Profile",
            confirms: of
              ? (mtfDir === "LONG" ? price >= of.profile.val : price <= of.profile.vah)
              : true,
            strength: of ? clamp(Math.abs(of.profileScore) / 80, 0, 1) : 0.4 },
          { name: "Footprint",
            confirms: of ? (mtfDir === "LONG" ? of.footprintScore > 0 : of.footprintScore < 0) : true,
            strength: of ? clamp(Math.abs(of.footprintScore) / 60, 0, 1) : 0.4 },
          { name: "Stoch",
            confirms: mtfDir === "LONG" ? ind.stochK > ind.stochD : ind.stochK < ind.stochD,
            strength: clamp(Math.abs(ind.stochK - ind.stochD)/20 + (mtfDir==="LONG" && ind.stochK<50 ? 0.3 : mtfDir==="SHORT" && ind.stochK>50 ? 0.3 : 0), 0, 1) },
          { name: "VolDelta",
            confirms: mtfDir === "LONG" ? ind.volumeDeltaPct > 5 : ind.volumeDeltaPct < -5,
            strength: Math.min(Math.abs(ind.volumeDeltaPct) / 35, 1) },
          { name: "Absorcion",
            confirms: of ? (mtfDir === "LONG" ? of.absorptionScore > 0 : of.absorptionScore < 0) : false,
            strength: of ? clamp(Math.abs(of.absorptionScore) / 60, 0, 1) : 0 },
          { name: "BB-Squeeze", confirms: ind.bbSqueeze, strength: ind.bbSqueeze ? 0.72 : 0 },
          { name: "Stoch-Extreme",
            confirms: mtfDir === "LONG" ? ind.stochK < 25 : ind.stochK > 75,
            strength: mtfDir === "LONG" ? clamp((25-ind.stochK)/25+0.4,0.4,1) : clamp((ind.stochK-75)/25+0.4,0.4,1) },
        ]
      : [
          // INTRADÍA — RSI primario (umbrales crypto OS<20/OB>80), MAs tendenciales
          {
            name: "RSI",
            confirms: mtfDir === "LONG" ? (ind.rsi > 30 && ind.rsi < 65) : (ind.rsi > 35 && ind.rsi < 70),
            strength: mtfDir === "LONG"
              ? clamp((ind.rsi - 30) / 35, 0, 1)
              : clamp((70 - ind.rsi) / 35, 0, 1),
          },
          {
            name: "RSI-Extreme",
            confirms: mtfDir === "LONG" ? ind.rsi < 30 : ind.rsi > 70,
            strength: mtfDir === "LONG"
              ? clamp((30 - ind.rsi) / 30 + 0.6, 0.6, 1)
              : clamp((ind.rsi - 70) / 30 + 0.6, 0.6, 1),
          },
          {
            name: "RSI-Div",
            confirms: (mtfDir === "LONG" && ind.rsiDivergence === "bullish") ||
                      (mtfDir === "SHORT" && ind.rsiDivergence === "bearish"),
            strength: ind.rsiDivergence !== "none" ? 0.92 : 0,
          },
          {
            name: "MA10/20/50",
            confirms: mtfDir === "LONG"
              ? (ind.ma10 > ind.ma20 && ind.ma20 > ind.ma50)
              : (ind.ma10 < ind.ma20 && ind.ma20 < ind.ma50),
            strength: clamp((Math.abs(ind.ma10 - ind.ma20) / (price * 0.003) + Math.abs(ind.ma20 - ind.ma50) / (price * 0.005)) / 2, 0, 1),
          },
          {
            name: "MA10/20",
            confirms: mtfDir === "LONG" ? ind.ma10 > ind.ma20 : ind.ma10 < ind.ma20,
            strength: Math.min(Math.abs(ind.ma10 - ind.ma20) / (price * 0.002), 1),
          },
          {
            name: "VWAP",
            confirms: mtfDir === "LONG" ? price > ind.vwap : price < ind.vwap,
            strength: Math.min(Math.abs(price - ind.vwap) / (ind.vwap * 0.005), 1),
          },
          {
            name: "VolDelta",
            confirms: mtfDir === "LONG" ? ind.volumeDeltaPct > 8 : ind.volumeDeltaPct < -8,
            strength: Math.min(Math.abs(ind.volumeDeltaPct) / 40, 1),
          },
          { name: "BB-Squeeze", confirms: ind.bbSqueeze, strength: ind.bbSqueeze ? 0.75 : 0 },
        ];

        // Selecciona el confirmador con mayor strength que confirma
    const bestConfirm = confirmCandidates
      .filter(c => c.confirms && c.strength > 0)
      .sort((a, b) => b.strength - a.strength)[0] ?? null;

    const confirmed = bestConfirm !== null;
    const confirmStrength = bestConfirm?.strength ?? 0;

    // ── Paso 3: Dirección final ───────────────────────────────────────────────
    // MTF dicta la dirección. Si hay confirmación, refuerza. Sin confirmación, sigue igual.
    const direction = mtfDir;

    // ── Paso 4: Calcular confianza ────────────────────────────────────────────
    // Score de control de mercado para scalping (0-20 puntos adicionales)
    const mcScore    = (of && currentMode === "scalping")
      ? Math.abs(of.controlScore) * 0.22
      : (mc ? Math.abs(mc.score) * 0.2 : 0);
    const ofSetupBonus      = (of && currentMode === "scalping")
      ? ((mtfDir === "LONG" && of.longSetup) || (mtfDir === "SHORT" && of.shortSetup) ? 8 : 0) : 0;
    const divergencePenalty = (of?.cvd.divergence && currentMode === "scalping") ? 10 : 0;
    const mcConflict = (of && currentMode === "scalping")
      ? (of.control === "bulls" && mtfDir === "SHORT") || (of.control === "bears" && mtfDir === "LONG")
      : (mc ? (mc.bias === "bull" && mtfDir === "SHORT") || (mc.bias === "bear" && mtfDir === "LONG") : false);
    // spreadCostRatio: fracción que el spread representa respecto al take profit esperado
    // Si spread > 35% del TP → setup caro (penaliza confianza)
    const estTpDist = Math.max(mtf.atr * (currentMode === "scalping" ? lrn.scalpingTpAtr : lrn.intradayTpAtr), spread * 2);
    const spreadCostRatio = spread / Math.max(estTpDist, 1e-9);
    const confidence = clamp(
      50
      + mtfStrength * 7
      + (confirmed ? confirmStrength * 16 : -5)
      + (ind.rsiDivergence !== "none" ? 4 : 0)
      + mcScore
      + ofSetupBonus
      - divergencePenalty
      - (mcConflict ? 15 : 0)
      + (currentMode === "intradia" && wyckoff.bias !== "neutral" ? 4 : 0)
      - (currentMode === "scalping" ? spreadPct * 55 : spreadPct * 20)
      - (spreadCostRatio > 0.4 ? 8 : spreadCostRatio > 0.25 ? 4 : 0),
      50, 96
    );

    // ── Paso 5: Sizing — Wyckoff como multiplicador solo en intradía ──────────
    const wyckoffMult = currentMode === "intradia" ? (wyckoff as WyckoffAnalysis & { wyckoffLotMult?: number }).wyckoffLotMult ?? 1.0 : 1.0;

    const entry = direction === "LONG" ? price + spread / 2 : price - spread / 2;
    const baseAtr = mtf.atr;
    // ── SL: bajo/sobre el swing más reciente + buffer ATR ───────────────────
    const slMult = currentMode === "scalping" ? 1.2 : 3.0;
    // Para scalping: buscar swing low/high reciente en las últimas 8 velas
    const recentC = candles[currentAsset]?.slice(-8) ?? [];
    let structuralSl: number;
    if (currentMode === "scalping" && recentC.length >= 3) {
      const swingLow  = Math.min(...recentC.map(c => c.l));
      const swingHigh = Math.max(...recentC.map(c => c.h));
      structuralSl = direction === "LONG"
        ? swingLow  - baseAtr * 0.2
        : swingHigh + baseAtr * 0.2;
      // Si el swing queda más cerca que 0.8×ATR, usar ATR como fallback
      const slDist = Math.abs(entry - structuralSl);
      if (slDist < baseAtr * 0.8) structuralSl = direction === "LONG"
        ? entry - baseAtr * slMult : entry + baseAtr * slMult;
    } else {
      structuralSl = direction === "LONG"
        ? entry - baseAtr * slMult : entry + baseAtr * slMult;
    }
    const stopLoss = structuralSl;

    // ── TP1: VAH/VAL del perfil de volumen (scalping) o múltiplo ATR (intradía)
    // ── TP2: nivel de liquidez siguiente (trailing en scalping)
    let takeProfit: number;
    if (currentMode === "scalping" && mc) {
      // TP hacia el nivel de liquidez opuesto en el perfil de volumen
      takeProfit = direction === "LONG"
        ? Math.max(mc.vah, entry + baseAtr * lrn.scalpingTpAtr)
        : Math.min(mc.val, entry - baseAtr * lrn.scalpingTpAtr);
    } else {
      const tpMult = Math.max(lrn.intradayTpAtr * 1.8, 4.0);
      takeProfit = direction === "LONG"
        ? entry + baseAtr * tpMult
        : entry - baseAtr * tpMult;
    }

    // ── Paso 6: Rationale ─────────────────────────────────────────────────────
    const mtfCtx = `HTF ${mtf.htf.toFixed(2)} / LTF ${mtf.ltf.toFixed(2)} / Exec ${mtf.exec.toFixed(2)}`;
    const confirmCtx = bestConfirm ? `Confirmación: ${bestConfirm.name} (${(bestConfirm.strength * 100).toFixed(0)}%)` : "Sin confirmación adicional";
    const wyckoffCtx = currentMode === "intradia" && wyckoff.bias !== "neutral"
      ? ` | Wyckoff ${wyckoff.bias === "accumulation" ? "Acum" : "Dist"} F${wyckoff.phase} mult×${wyckoffMult.toFixed(2)}` : "";
    // En scalping: el rationale comienza con el control de mercado (quién manda)
    const controlLabel = (of && currentMode === "scalping")
      ? (of.control === "bulls" ? "🟢 TOROS" : of.control === "bears" ? "🔴 OSOS" : "⚪ DISPUTADO")
      : "";
    const cvdArrow = of ? (of.cvd.trend === "bullish" ? "↑" : of.cvd.trend === "bearish" ? "↓" : "→") : "";
    const mcCtx = (of && currentMode === "scalping")
      ? ` | OF: ${controlLabel} score=${of.controlScore.toFixed(0)} CVD${cvdArrow} FP=${of.footprintScore.toFixed(0)} Vol=${price>of.profile.poc?"▲POC":"▼POC"}`
      : (mc ? ` | Control: ${mc.dominantSide} (${mc.score.toFixed(0)}) CVD${mc.cvdSlope>=0?"↑":"↓"} POC:${mc.poc.toFixed(2)}` : "");
    const rationale = currentMode === "scalping"
      ? `${controlLabel} ${direction} | CVD${cvdArrow} FP:${of?.footprintScore.toFixed(0)??"?"} | ${confirmCtx}${mcCtx}`
      : `${direction} | ${mtfCtx} | ${confirmCtx}${wyckoffCtx}${mcCtx}`;

    return {
      asset: currentAsset, mode: currentMode, direction, entry, stopLoss, takeProfit,
      confidence, spreadPct, atr: baseAtr, mtf, indicators: ind, wyckoff, rationale,
      // Adjuntar mult para usarlo en createSignalAndExecute
      ...(currentMode === "intradia" ? { _wyckoffMult: wyckoffMult } : {}),
    } as Signal & { _wyckoffMult?: number };
  }

  // ── IA: trader experto con master en estadística ──
  async function aiDecision(signal: Signal): Promise<"OPEN" | "SKIP" | "WAIT"> {
    const lrn = learningRef.current;
    if (!usingGroq || !apiKey.trim()) {
      // Scalping necesita piso más bajo para abrir con mayor frecuencia
      const floor = signal.mode === "scalping"
        ? Math.max(48, lrn.confidenceFloor - 4)
        : lrn.confidenceFloor;
      return signal.confidence >= floor ? "OPEN" : "SKIP";
    }
    try {
      // ── Métricas de gestión de riesgo para el prompt ────────────────────────
      const lrnSnap     = learningRef.current;
      const equitySnap  = balance + unrealized;
      const initialCap  = 100; // capital inicial fijo
      const riskPerTrade = riskPct / 100;
      const openCount   = openPositionsRef.current.length;
      const rrRatio     = Math.abs(signal.takeProfit - signal.entry) /
                          Math.max(Math.abs(signal.stopLoss - signal.entry), 1e-9);
      // Riesgo de ruina simplificado (fórmula de Ralph Vince): R = ((1-edge)/(1+edge))^n
      // donde edge = (wr/100 - (1-wr/100)/rrRatio) y n = trades restantes estimados
      const wr01   = Math.max(stats.winRate / 100, 0.01);
      const edge   = wr01 - (1 - wr01) / Math.max(rrRatio, 0.5);
      const ruinRisk = stats.total >= 10
        ? (edge > 0 ? Math.pow(Math.max((1 - edge) / (1 + edge), 0), 20) * 100 : 99).toFixed(1)
        : "N/A (<10 trades)";
      // Esperanza matemática por trade
      const avgWin  = stats.total > 0 ? realTrades.filter(t=>t.pnl>0).reduce((a,t)=>a+t.pnl,0) / Math.max(realTrades.filter(t=>t.pnl>0).length,1) : 0;
      const avgLoss = stats.total > 0 ? Math.abs(realTrades.filter(t=>t.pnl<=0).reduce((a,t)=>a+t.pnl,0) / Math.max(realTrades.filter(t=>t.pnl<=0).length,1)) : 0;
      const expectedValue = (wr01 * avgWin - (1-wr01) * avgLoss).toFixed(3);
      // Drawdown actual desde pico de equity
      const peakEquity = Math.max(initialCap, equitySnap, ...realTrades.map((_,i) =>
        initialCap + realTrades.slice(0,i+1).reduce((a,t)=>a+t.pnl,0)));
      const currentDD  = ((peakEquity - equitySnap) / peakEquity * 100).toFixed(1);
      // Exposición actual
      const totalMargin = openPositionsRef.current.reduce((a,p)=>a+p.marginUsed,0);
      const exposurePct = (totalMargin / equitySnap * 100).toFixed(1);

      // ── Métricas adicionales para el prompt ──────────────────────────────────
      const riskSnap   = calcRiskMetrics(realTrades, balance, maxDailyLoss);
      const kellyStr   = riskSnap.kellyFraction > 0
        ? `${(riskSnap.kellyFraction * 100).toFixed(1)}% (WR ${(riskSnap.kellyWR*100).toFixed(0)}% / RR ${riskSnap.kellyRR.toFixed(2)})`
        : "insuficiente data";
      const consecLoss = calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain).streak;
      const ruinPct    = riskSnap.ruinProb.toFixed(1);
      const evSign     = parseFloat(expectedValue) >= 0 ? "POSITIVE ✓" : "NEGATIVE ✗";

      const systemPrompt = `You are an algorithmic trading system managing a REAL funded account.

IDENTITY AND MANDATE:
- You manage $${initialCap} USDT of real capital. Every dollar lost is permanent until earned back.
- The initial capital ($${initialCap}) is the absolute floor — if equity approaches it, you stop trading.
- Your mandate: GROW capital with controlled risk. Not preserve it at all costs, not gamble it.
- You are NOT risk-averse — you are RISK-CALIBRATED. Edge × frequency = profit.

ACCOUNT STATE RIGHT NOW:
- Equity: $${equitySnap.toFixed(2)} USDT | Initial capital: $${initialCap} USDT
- Drawdown from peak: ${currentDD}% (hard limit: 5% daily, 15% overall)
- Ruin probability next 30 trades: ${ruinPct}% (below 20% = healthy, above 50% = reduce size)
- Consecutive losses: ${consecLoss} (above 5 = mandatory pause)
- Expected value per trade: $${expectedValue} [${evSign}]
- Kelly optimal fraction: ${kellyStr}
- Win rate: ${stats.winRate.toFixed(1)}% | Profit factor: ${stats.profitFactor.toFixed(2)} | Sharpe: ${stats.sharpe.toFixed(2)}
- Open positions: ${openCount} | Margin deployed: ${exposurePct}% of equity

RISK RULES (non-negotiable):
1. Max risk per trade: ${(riskPerTrade * 100).toFixed(1)}% equity = $${(equitySnap * riskPerTrade).toFixed(3)} USDT
2. Max simultaneous positions: 3 (currently ${openCount})
3. Daily DD limit: 5% — current: ${currentDD}%
4. Ruin floor: $${(initialCap * 0.70).toFixed(2)} (−30% from initial) → full stop
5. If ${consecLoss} consecutive losses → WAIT on next signal regardless of quality

CALIBRATED DECISION FRAMEWORK:
You must avoid TWO opposite mistakes with equal discipline:

MISTAKE A — OVER-TRADING (reckless):
Opening when: RR < 1.5 | DD > 4% | EV negative | structure against direction | 5+ consecutive losses
Consequence: destroys capital, hits ruin threshold, loses the funded account.

MISTAKE B — UNDER-TRADING (fearful):
Skipping when: signal has positive EV | RR ≥ 1.5 | DD within limits | momentum confirmed
Consequence: starves the system of data, Kelly fraction never compounds, account stagnates.

CORRECT DECISION LOGIC:
OPEN  → EV positive + RR ≥ 1.5 + DD within limits + mode-specific confirmation + fewer than 3 positions
WAIT  → DD > 4% OR consecutive losses = 5 OR EV marginally positive but structure unclear
SKIP  → EV negative OR RR < 1.2 OR specific structural contradiction (e.g. Phase D distribution LONG)

MODE RULES:
- SCALPING: MTF momentum + Stoch aligned = OPEN if DD < 3%, EV positive, AND spread < 35% of TP. Frequency is the edge.
- INTRADAY: require MTF + 1 indicator + Wyckoff not contradicting. Phase D distribution = hard SKIP.
- NEVER skip a scalp setup purely due to macro uncertainty unless a hard rule is triggered.

CFD SPREAD RULES (broker cobra spread bid-ask en cada operación, sin comisión separada):
- El spread es una pérdida GARANTIZADA al entrar. El precio debe recuperarlo antes de generar ganancia.
- En términos reales: TP neto = TP - spread; SL neto = SL + spread.
- SCALPING: si spread > 35% del TP → requiere confianza ≥ 65% para abrir.
- SCALPING: si spread > 50% del TP → SKIP, setup matemáticamente inviable.
- Alta volatilidad/shock: spread se amplía 2-3×. Reducir frecuencia de scalp automáticamente.
- Sesión ASIA/OFF/WEEKEND: spread +35-60%. Solo intradía con TP amplio es viable.
- INTRADAY: spread típicamente <10% del TP — menos crítico pero sí afecta el EV.
- EV neto = (WR × TP_neto) - (1-WR × SL_neto) — siempre calcular con spread incluido.

Respond ONLY with valid JSON:
{"decision":"OPEN"|"SKIP"|"WAIT","confidence_adjustment":number,"rationale":"string","risk_notes":"string"}
- confidence_adjustment: integer −20 to +20. Use +10 to +20 only when multiple factors strongly confirm. Use −10 to −20 only when risk rules are near breach.
- rationale: ≤ 130 chars Spanish — name the key edge or the specific reason to skip
- risk_notes: ≤ 90 chars Spanish — EV, Kelly, RR, or DD status`;

      const rrQuality = rrRatio >= 2.5 ? "EXCELLENT" : rrRatio >= 1.8 ? "GOOD" : rrRatio >= 1.3 ? "ACCEPTABLE" : "POOR";
      const sigSpread   = calcCFDSpread(signal.asset, signal.entry, volumeShockRef.current);
      const spreadCostA = sigSpread.spread;
      const tpDist      = Math.abs(signal.takeProfit - signal.entry);
      const slDistA     = Math.abs(signal.stopLoss - signal.entry);
      const spreadRatioTP  = (spreadCostA / Math.max(tpDist,  1e-9) * 100).toFixed(1);
      const spreadRatioSL  = (spreadCostA / Math.max(slDistA, 1e-9) * 100).toFixed(1);

      const userMsg = `SIGNAL TO EVALUATE:
Asset: ${signal.asset} | Mode: ${signal.mode.toUpperCase()} | Direction: ${signal.direction}
Entry: ${signal.entry.toFixed(4)} | SL: ${signal.stopLoss.toFixed(4)} | TP: ${signal.takeProfit.toFixed(4)}
RR: ${rrRatio.toFixed(2)}:1 [${rrQuality}] | Risk USDT: $${(equitySnap * riskPerTrade).toFixed(3)}
Expected value if opened: $${expectedValue} [${evSign}]
Confidence: ${signal.confidence.toFixed(1)}% | Kelly suggests: ${riskSnap.kellyFraction > 0.01 ? "OPEN" : "SKIP (no edge)"}

CFD SPREAD (broker cobra spread, no comisión):
- Spread: $${spreadCostA.toFixed(4)} (${sigSpread.spreadPct.toFixed(3)}%) | Sesión: ${sigSpread.sessionLabel} | Vol alta: ${sigSpread.isHighVolume ? "SÍ ⚠" : "no"}
- Spread vs TP: ${spreadRatioTP}% del objetivo (>35% = setup degradado, >50% = SKIP)
- Spread vs SL: ${spreadRatioSL}% del stop (clave en scalping)
- Desglose: base=$${sigSpread.component.base.toFixed(4)} + volumen=$${sigSpread.component.volume.toFixed(4)} + sesión=$${sigSpread.component.session.toFixed(4)}

TECHNICAL CONTEXT:
MTF → HTF: ${signal.mtf.htf.toFixed(2)} | LTF: ${signal.mtf.ltf.toFixed(2)} | Exec: ${signal.mtf.exec.toFixed(2)}
${signal.mode === "scalping"
  ? `Stoch %K: ${signal.indicators.stochK.toFixed(1)} / %D: ${signal.indicators.stochD.toFixed(1)} | ${signal.indicators.stochK > signal.indicators.stochD ? "K>D alcista" : "K<D bajista"}`
  : `RSI: ${signal.indicators.rsi.toFixed(1)} | Divergencia: ${signal.indicators.rsiDivergence}`}
VWAP: ${signal.entry > signal.indicators.vwap ? "SOBRE" : "BAJO"} (${((signal.entry - signal.indicators.vwap) / signal.indicators.vwap * 100).toFixed(2)}%)
BB Squeeze: ${signal.indicators.bbSqueeze ? "SÍ — expansión de volatilidad inminente" : "NO"}
Vol Delta: ${signal.indicators.volumeDeltaPct.toFixed(1)}% (${signal.indicators.volumeDeltaPct > 0 ? "presión compradora" : "presión vendedora"})
${signal.mode === "intradia"
  ? `Wyckoff: ${signal.wyckoff.bias} | Fase: ${signal.wyckoff.phase} | ${signal.wyckoff.narrative}`
  : "Wyckoff: N/A (scalping)"}
${signal.mode === "scalping" ? `
ORDER FLOW (scalping — señal más importante):
${signal.rationale.includes("Control:") || signal.rationale.includes("TOROS") || signal.rationale.includes("OSOS") ? signal.rationale : "Ver rationale"}` : ""}

RISK CHECK FOR THIS TRADE:
- Drawdown now: ${currentDD}% (limit 5%) → ${parseFloat(currentDD) > 4 ? "⚠ NEAR LIMIT" : "✓ OK"}
- Consecutive losses: ${consecLoss} (limit 5) → ${consecLoss >= 4 ? "⚠ CAUTION" : "✓ OK"}
- Open positions: ${openCount}/3 → ${openCount >= 3 ? "⚠ AT LIMIT — must SKIP" : "✓ OK"}
- EV signal: ${evSign}
Rationale from system: ${signal.rationale}`;

      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct", temperature: 0.15, max_tokens: 220,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        }),
      });
      const data = await r.json() as { choices: Array<{ message: { content: string } }> };
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as { decision: string; confidence_adjustment?: number; rationale?: string; risk_notes?: string };

      // Guardar razonamiento de la IA en el signal (mutamos para pasarlo luego)
      signal.aiRationale = parsed.rationale ?? "";
      signal.aiRiskNotes = parsed.risk_notes ?? "";

      const dec = String(parsed.decision ?? "").toUpperCase();
      return dec === "OPEN" ? "OPEN" : dec === "WAIT" ? "WAIT" : "SKIP";
    } catch {
      const floorCatch = signal.mode === "scalping"
        ? Math.max(48, learningRef.current.confidenceFloor - 4)
        : learningRef.current.confidenceFloor;
      return signal.confidence >= floorCatch ? "OPEN" : "SKIP";
    }
  }

  const closePosition = useCallback((position: Position, exit: number, result: ExitReason) => {
    const pnl = position.signal.direction === "LONG"
      ? (exit - position.signal.entry) * position.size
      : (position.signal.entry - exit) * position.size;
    const icon = result === "TP" ? "✅" : result === "SL" ? "❌" : "⟳";
    pushToast(`${icon} ${position.signal.asset} ${position.signal.direction} → ${exitLabel[result]}  ${pnl >= 0 ? "+" : ""}${money(pnl)}`, pnl >= 0 ? "success" : "error");
        if (mt5Enabled) closeInMT5(position.signal.asset, position.signal.direction);
    setBalance(prev => prev + pnl);
    setOpenPositions(prev => prev.filter(p => p.id !== position.id));
    setRealTrades(prev => {
      const next: ClosedTrade[] = [{
        id: position.id, asset: position.signal.asset, mode: position.signal.mode,
        direction: position.signal.direction, entry: position.signal.entry, exit, pnl,
        pnlPct: (pnl / Math.max(position.marginUsed, 0.01)) * 100,
        result, openedAt: position.openedAt, closedAt: new Date().toISOString(), source: "real",
      }, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function evaluatePositionsWithCurrentPrices() {
    const pp    = prevPricesRef.current;
    const shock = volumeShockRef.current;
    const sv    = seriesRef.current;
    const cc    = candlesRef.current;
    const lrn   = learningRef.current;

    openPositionsRef.current.forEach(pos => {
      const px = pp[pos.signal.asset];
      if (!px) return;

      const spread   = (getSpreadPct(pos.signal.asset, shock) / 100) * px;
      const isLong   = pos.signal.direction === "LONG";
      const tradable = isLong ? px - spread / 2 : px + spread / 2;
      const peak     = Math.max(pos.peak,   tradable);
      const trough   = Math.min(pos.trough, tradable);

      // ── Trailing estructural: mover SL solo a niveles de swing ────────────
      const swingLookback = pos.signal.mode === "scalping" ? 8 : 20;
      const recentCandles = (cc[pos.signal.asset] ?? []).slice(-swingLookback);
      const currentSl     = pos.signal.stopLoss;
      let   newSl         = currentSl;

      if (recentCandles.length >= 4) {
        const lookSlice = recentCandles.slice(0, -2);
        if (isLong) {
          const swingLow  = Math.min(...lookSlice.map(c => c.l));
          const candidate = swingLow - pos.signal.atr * lrn.atrTrailMult;
          if (candidate > currentSl && candidate < tradable - pos.signal.atr * 0.3) {
            newSl = candidate;
          }
        } else {
          const swingHigh = Math.max(...lookSlice.map(c => c.h));
          const candidate = swingHigh + pos.signal.atr * lrn.atrTrailMult;
          if (candidate < currentSl && candidate > tradable + pos.signal.atr * 0.3) {
            newSl = candidate;
          }
        }
      }

      const trailMoved  = isLong ? newSl > currentSl : newSl < currentSl;
      const effectiveSl = newSl;

      // ── Reversión: solo intradía con ganancia minima 1×ATR ────────────────
      const vals         = sv[pos.signal.asset] ?? [];
      const maFast       = avg(vals.slice(-(pos.signal.mode === "scalping" ? 5 : 10)));
      const maSlow       = avg(vals.slice(-(pos.signal.mode === "scalping" ? 10 : 20)));
      const profitDist   = isLong ? tradable - pos.signal.entry : pos.signal.entry - tradable;
      const hasMinProfit = profitDist >= pos.signal.atr * 1.0;
      const maCross      = isLong ? maFast < maSlow : maFast > maSlow;
      const reversal     = pos.signal.mode === "intradia" && hasMinProfit && maCross;

      // ── Cierre ───────────────────────────────────────────────────────────
      const hitTp = isLong ? tradable >= pos.signal.takeProfit : tradable <= pos.signal.takeProfit;
      const hitSl = isLong ? tradable <= effectiveSl           : tradable >= effectiveSl;

      if (hitTp)    { closePosition(pos, tradable, "TP");                        return; }
      if (hitSl)    { closePosition(pos, tradable, trailMoved ? "TRAIL" : "SL"); return; }
      if (reversal) { closePosition(pos, tradable, "REVERSAL");                  return; }

      if (trailMoved || peak !== pos.peak || trough !== pos.trough) {
        setOpenPositions(prev => prev.map(p =>
          p.id === pos.id
            ? { ...p, peak, trough, signal: { ...p.signal, stopLoss: effectiveSl } }
            : p
        ));
      }
    });
  }

  async function createSignalAndExecute(mode: Mode, targetAsset: Asset, autoLabel = false) {
    if (!liveReady) { pushToast("El feed aún no está listo. Sincronice primero.", "warning"); return; }

    // ── Verificar límites diarios antes de generar señal ─────────────────────
    if (mode === "scalping") {
      const risk = calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain);
      if (risk.blocked) {
        if (!autoLabel) pushToast(`🛑 ${risk.blockReason}`, "warning");
        return;
      }
      // Modo defensivo si expectancy negativa con suficientes trades
      if (risk.mathExpectancy < -0.5 && risk.dailyTrades > 5) {
        if (!autoLabel) pushToast(`⚠️ Expectativa negativa ($${risk.mathExpectancy.toFixed(2)}). Modo defensivo.`, "warning");
      }
    }

    const signal = generateSignal(mode, targetAsset);
    if (!autoLabel) setLastSignal(signal);
    const decision = await aiDecision(signal);
    if (decision !== "OPEN") {
      if (!autoLabel) pushToast(`⏭ ${targetAsset} omitido (${decision}) — conf ${signal.confidence.toFixed(0)}% | ${signal.aiRationale ?? "confianza insuficiente"}`, "warning");
      return;
    }
    const lrn = learningRef.current;
    const wyckoffMult = (signal as Signal & { _wyckoffMult?: number })._wyckoffMult ?? 1.0;
    // Ajustar sizing por riesgo de ruina en scalping
    const riskMult = signal.mode === "scalping"
      ? calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain).sizeMultiplier
      : 1.0;
    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * lrn.riskScale * wyckoffMult * riskMult);
    // stopDistance mínimo: el mayor entre el SL calculado y 0.3% del precio
    // Evita que ATR pequeño en plata/gold genere sizes irreales
    const minStop = signal.entry * 0.003;
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), minStop);
    const size = riskUsd / stopDistance;
    const marginUsed = (size * signal.entry) / leverageByAsset[signal.asset];
    if (marginUsed > equity * 0.65) { pushToast("⚠️ Margen insuficiente", "warning"); return; }
    const multTag = wyckoffMult > 1 ? ` | Wyckoff ×${wyckoffMult.toFixed(2)}` : "";
    setOpenPositions(prev => [...prev, { id: Date.now(), signal, size, marginUsed, openedAt: new Date().toISOString(), peak: signal.entry, trough: signal.entry }]);
    if (!autoLabel) pushToast(`🚀 ${signal.asset} ${signal.direction} @ ${signal.entry.toFixed(2)} | conf ${signal.confidence.toFixed(0)}%${multTag}${signal.aiRationale ? " | " + signal.aiRationale : ""}`, "success");
    if (mt5Enabled) sendToMT5(signal, size, marginUsed);
  }

  // ── MT5: test de conexión ────────────────────────────────────────────────
  async function testMT5Bridge() {
    setMt5Status("testing");
    try {
      const r = await fetch(`${mt5Url}/status`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { connected: boolean; account?: string; balance?: number; demo?: boolean };
      if (d.connected) {
        setMt5Status("connected");
        setMt5Account(d.account ?? null);
        setMt5Balance(d.balance ?? null);
        pushToast(`✅ MT5 — Cuenta ${d.account} | ${d.demo ? "DEMO ✓" : "⚠ REAL"}`, "success");
      } else {
        setMt5Status("error");
        pushToast("MT5: bridge activo pero MT5 no conectado a PrimeXBT", "warning");
      }
    } catch {
      setMt5Status("error");
      pushToast("MT5: bridge no disponible en " + mt5Url, "error");
    }
  }

  // ── MT5: enviar señal de apertura ─────────────────────────────────────────
  async function sendToMT5(signal: Signal, size: number, marginUsed: number) {
    if (!mt5Enabled || mt5Status !== "connected") return;
    try {
      const r = await fetch(`${mt5Url}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: signal.asset, direction: signal.direction, mode: signal.mode,
          entry: signal.entry, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
          size, confidence: signal.confidence, rationale: signal.rationale, marginUsed,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json() as { ok: boolean; ticket?: number; price?: number; error?: string };
      if (d.ok && d.ticket) pushToast(`📡 MT5 #${d.ticket} ejecutado @ ${d.price?.toFixed(2)}`, "success");
      else pushToast(`⚠ MT5 rechazó: ${d.error ?? "error"}`, "error");
    } catch { pushToast("MT5: timeout al enviar señal", "error"); }
  }

  // ── MT5: cerrar posición ──────────────────────────────────────────────────
  async function closeInMT5(asset: Asset, direction: string) {
    if (!mt5Enabled || mt5Status !== "connected") return;
    try {
      await fetch(`${mt5Url}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, direction }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { /* silencioso */ }
  }

  async function syncRealData() {
    setIsSyncing(true);
    try {
      const usingBridge = mt5Enabled && mt5Status === "connected";
      const payload = await fetchRealMarketSnapshot(prevPricesRef.current, mt5Url, usingBridge);

      setPrices(payload.prices);
      setSeries(prev => {
        const next = { ...prev };
        assets.forEach(a => { const s = payload.seriesMap[a]; if (s?.length) next[a] = s; else next[a] = [...prev[a].slice(-159), payload.prices[a]]; });
        return next;
      });
      setCandles(prev => {
        const next = { ...prev };
        assets.forEach(a => { if (payload.candleMap[a].length) next[a] = payload.candleMap[a]; });
        return next;
      });

      // Spread real del broker (solo disponible desde bridge)
      if (payload.spreadMap && Object.keys(payload.spreadMap).length > 0)
        setMt5SpreadMap(payload.spreadMap);

      setVolumeShock(payload.shock);

      // Si el bridge está activo → fetch adicional de velas 5m y 15m reales
      // para getMtfScore con timeframes reales (no sintéticos)
      if (usingBridge) {
        try {
          const mtfFetches = await Promise.allSettled(
            assets.map(async (a) => {
              const r = await fetch(
                `${mt5Url}/candles_mtf/${a}?limit_1m=5&limit_5m=70&limit_15m=55`,
                { signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const d = await r.json() as { candles_5m: Candle[]; candles_15m: Candle[] };
              return { a, c5m: d.candles_5m ?? [], c15m: d.candles_15m ?? [] };
            })
          );
          const new5m:  Record<Asset, Candle[]> = { BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] };
          const new15m: Record<Asset, Candle[]> = { BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] };
          mtfFetches.forEach(r => {
            if (r.status === "fulfilled") {
              new5m[r.value.a]  = r.value.c5m;
              new15m[r.value.a] = r.value.c15m;
            }
          });
          setCandles5m(new5m);
          setCandles15m(new15m);
        } catch { /* fallback silencioso → getMtfScore usa sintético */ }
      }

      const timeStr = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const srcIcon = payload.fromBridge ? "📡" : "🌐";
      setFeedStatus(`${srcIcon} ${timeStr} — ${payload.sourceNote}`);
      setLiveReady(true);
    } catch (e) {
      setFeedStatus("❌ Feed no disponible");
      setLiveReady(false);
      pushToast(`Error sync: ${e instanceof Error ? e.message : "red"}`, "error");
    } finally { setIsSyncing(false); }
  }

  async function runAutoScan() {
    // Auto scan: prueba ambos modos para todos los activos
    // Scalping primero (más frecuente), luego intradía
    for (const a of assets) await createSignalAndExecute("scalping",  a, true);
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

  function runBacktest() {
    if (!liveReady) { pushToast("Sincronice primero.", "warning"); return; }
    const simulated: ClosedTrade[] = [];
    const returns: number[] = [];
    let equityBt = 100;
    const lrn = learningRef.current;
    for (let i = 0; i < backtestSize; i++) {
      const sa = assets[i % assets.length];
      const mode: Mode = i % 2 === 0 ? "scalping" : "intradia";
      const vals = series[sa];
      const idx = Math.max(25, vals.length - (backtestSize + 25)) + i;
      if (idx >= vals.length - 2) break;
      const hist = vals.slice(0, idx + 1);
      const entry = vals[idx];
      const maFast = avg(hist.slice(-5)); const maSlow = avg(hist.slice(-13));
      const dir: Direction = maFast >= maSlow ? "LONG" : "SHORT";
      const atr = Math.max(calcAtrFromSeries(hist, 20), entry * 0.0004);
      const sd = atr * (mode === "scalping" ? 1.05 : 1.65);
      const td = atr * (mode === "scalping" ? lrn.scalpingTpAtr : lrn.intradayTpAtr);
      const stop = dir === "LONG" ? entry - sd : entry + sd;
      const tp = dir === "LONG" ? entry + td : entry - td;
      const horizon = mode === "scalping" ? 6 : 22;
      let exit = vals[Math.min(idx + horizon, vals.length - 1)];
      let result: ExitReason = "REVERSAL";
      for (let j = idx + 1; j <= Math.min(idx + horizon, vals.length - 1); j++) {
        const px = vals[j];
        if (dir === "LONG" ? px >= tp : px <= tp) { exit = px; result = "TP"; break; }
        if (dir === "LONG" ? px <= stop : px >= stop) { exit = px; result = "SL"; break; }
      }
      const riskUsd = Math.max(0.5, equityBt * (riskPct / 100));
      const size = riskUsd / Math.max(sd, entry * 0.0003);
      const pnl = dir === "LONG" ? (exit - entry) * size : (entry - exit) * size;
      equityBt += pnl;
      simulated.push({ id: Date.now() + i, asset: sa, mode, direction: dir, entry, exit, pnl, pnlPct: (pnl / Math.max((size * entry) / leverageByAsset[sa], 0.01)) * 100, result, openedAt: new Date(Date.now() - 60000 * 30).toISOString(), closedAt: new Date().toISOString(), source: "backtest" });
      returns.push(pnl);
    }
    if (!simulated.length) { pushToast("Sin velas suficientes.", "warning"); return; }
    const wins = simulated.filter(t => t.pnl > 0); const losses = simulated.filter(t => t.pnl <= 0);
    const gp = wins.reduce((a, t) => a + t.pnl, 0); const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    setLastBacktest({ total: simulated.length, winRate: (wins.length / simulated.length) * 100, expectancy: avg(returns), profitFactor: gl > 0 ? gp / gl : gp, sharpe: std(returns) > 0 ? avg(returns) / std(returns) : 0, maxDrawdown: calcDrawdown(simulated), grossProfit: gp, grossLoss: gl, avgWin: wins.length ? gp / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0 });
    setBacktestTrades(simulated);
    pushToast(`✅ Backtest: ${simulated.length} trades | WR ${((wins.length / simulated.length) * 100).toFixed(1)}%`, "success");
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  const NAV = [
    { id: "trading" as AppTab, label: "Trading", icon: "📈" },
    { id: "backtest" as AppTab, label: "Backtest", icon: "🔬" },
    { id: "configuracion" as AppTab, label: "Config", icon: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <ToastList toasts={toasts} onRemove={removeToast} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,9,16,0.93)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 20px", height: 54, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
          <span style={{ fontSize: 17 }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>TraderLab</span>
          <span style={{ fontSize: 11, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "2px 5px", borderRadius: 4, fontWeight: 600 }}>v5</span>
        </div>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {NAV.map(t => (
            <button key={t.id} onClick={() => setAppTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 12, background: appTab === t.id ? "rgba(255,255,255,0.1)" : "transparent", color: appTab === t.id ? "var(--text)" : "var(--muted)", transition: "all 0.13s" }}>
              {t.icon} {t.label}
              {t.id === "trading" && openPositions.length > 0 && <span style={{ background: "#10b981", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: "50%", width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>{openPositions.length}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} />
          <div style={{ fontSize: 10, color: liveReady ? "#10b981" : "#6b7280", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: liveReady ? "#10b981" : "#6b7280", animation: liveReady ? "pulse 2s infinite" : "none", display: "inline-block" }} />
            {feedStatus}
          </div>
        </div>
      </nav>

      {/* Header metrics + Equity Curve */}
      <div style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "12px 20px" }}>
        <div className="header-metrics" style={{ maxWidth: 1440, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          {[
            { label: "Balance", value: money(balance), color: "var(--text)" },
            { label: "P&L no realizado", value: money(unrealized), color: unrealized >= 0 ? "#10b981" : "#ef4444" },
            { label: "Equity", value: money(equity), color: equity >= 100 ? "#10b981" : "#ef4444" },
            { label: "Win rate", value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? "#10b981" : "#ef4444" },
            { label: "Factor ganancia", value: stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1.5 ? "#10b981" : "var(--text)" },
            { label: "Sharpe", value: stats.sharpe.toFixed(2), color: stats.sharpe >= 1 ? "#10b981" : "var(--text)" },
            { label: "Trades reales", value: realTrades.length, color: "var(--muted)" },
            { label: "Posiciones abiertas", value: openPositions.length, color: openPositions.length > 0 ? "#f59e0b" : "var(--muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="metric" style={{ flex: "0 0 auto", minWidth: 105 }}>
              <span className="label" style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</span>
              <strong style={{ color, fontSize: 16 }}>{value}</strong>
            </div>
          ))}
          {/* Curva de equity — visible siempre en el header */}
          {realTrades.length >= 2 && (
            <div style={{ flex: "1 1 200px", minWidth: 200, maxWidth: 340, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 3, display: "block" }}>Curva de equity</span>
              <EquityCurve trades={realTrades} height={50} />
            </div>
          )}
        </div>
      </div>

      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "18px 20px" }}>

        {/* ━━━━━━━━━ TRADING ━━━━━━━━━ */}
        {appTab === "trading" && (
          <div className="trading-grid">

            {/* Izq */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="card">
                <p className="label" style={{ marginBottom: 7 }}>Modo</p>
                <div style={{ display: "flex", gap: 5 }}>
                  {(["scalping", "intradia"] as Mode[]).map(m => (
                    <button key={m} className={tab === m ? "tab-active" : "tab"} onClick={() => setTab(m)} style={{ flex: 1 }}>
                      {m === "scalping" ? "Scalping" : "Intradía MTF"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card">
                <p className="label" style={{ marginBottom: 5 }}>Activo</p>
                <select className="sel" value={asset} onChange={e => setAsset(e.target.value as Asset)} style={{ width: "100%" }}>
                  {assets.map(a => <option key={a} value={a}>{assetLabel[a]}</option>)}
                </select>
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  {(()=>{
                    const ss = spreadSnapshot[asset];
                    const dp = asset === "BTCUSD" || asset === "ETHUSD" ? 2 : asset === "XAUUSD" ? 2 : 4;
                    return [[
                      ["Precio", prices[asset].toFixed(dp)],
                      ["Bid", ss ? ss.bid.toFixed(dp) : "-"],
                      ["Ask", ss ? ss.ask.toFixed(dp) : "-"],
                      ["Spread $", ss ? `$${ss.spread.toFixed(dp === 2 ? 2 : 4)}` : "-"],
                      ["Spread %", ss ? `${ss.spreadPct.toFixed(3)}%` : "-"],
                      ["Sesión", ss ? ss.sessionLabel : "-"],
                      ["Vol", ss?.isHighVolume ? "⚠ ALTA" : "Normal"],
                      ["Leverage", `${leverageByAsset[asset]}×`],
                    ]];
                  })()[0].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "var(--muted)" }}>{k}</span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <p className="label" style={{ marginBottom: 5 }}>Riesgo base (%)</p>
                <input className="inp" type="number" min={0.2} max={3} step={0.1} value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} />
              </div>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <button className="btn-primary" onClick={() => createSignalAndExecute(tab, asset)}>⚡ Generar + ejecutar señal</button>
                <button className="btn-secondary" onClick={() => void syncRealData()} disabled={isSyncing}>{isSyncing ? "⟳ Sincronizando..." : "↻ Sync Bybit / Binance"}</button>
                <button className="btn-secondary" onClick={() => void runAutoScan()}>🔍 Escanear todos</button>
              </div>
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <p style={{ fontWeight: 600, fontSize: 12 }}>Auto-scan</p>
                  <button onClick={() => setAutoScan(p => !p)} style={{ padding: "3px 10px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 10, background: autoScan ? "#10b981" : "rgba(255,255,255,0.07)", color: autoScan ? "#fff" : "var(--muted)" }}>{autoScan ? "● ON" : "○ OFF"}</button>
                </div>
                {autoScan && <input className="inp" type="number" min={8} max={120} step={1} value={scanEverySec} onChange={e => setScanEverySec(Number(e.target.value))} />}
              </div>
              {bestHours.length > 0 && (
                <div className="card">
                  <p className="label" style={{ marginBottom: 5 }}>Horas edge (real)</p>
                  {bestHours.map(({ hour, edge }) => (
                    <div key={hour} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ color: "var(--muted)" }}>{hour}:00</span>
                      <span style={{ color: edge >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>{edge >= 0 ? "+" : ""}{edge.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="card" style={{ fontSize: 11 }}>
                <p className="label" style={{ marginBottom: 5 }}>Modelo (solo trades reales)</p>
                {[["Trailing ATR", learning.atrTrailMult.toFixed(2)], ["TP scalp", `${learning.scalpingTpAtr.toFixed(2)} ATR`], ["TP intradía", `${learning.intradayTpAtr.toFixed(2)} ATR`], ["Piso conf.", `${learning.confidenceFloor.toFixed(0)}%`], ["Escala riesgo", `${learning.riskScale.toFixed(2)}×`]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <span style={{ color: "var(--muted)" }}>{k}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{v}</span>
                  </div>
                ))}
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>n={realTrades.length} trades reales</p>
              </div>
            </div>

            {/* Centro */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card" style={{ padding: "12px 12px 8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <h2 style={{ fontWeight: 800, fontSize: 15, marginBottom: 1 }}>{asset}</h2>
                    <p style={{ fontSize: 11, color: "var(--muted)" }}>{tab === "intradia" ? "Multi-timeframe confluence" : "Scalping execution"} · Bybit{["XAGUSD", "XAUUSD"].includes(asset) ? "/Binance" : ""}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setShowIndicators(p => !p)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: showIndicators ? "rgba(99,102,241,0.15)" : "transparent", color: showIndicators ? "#a5b4fc" : "var(--muted)", cursor: "pointer", fontWeight: 600 }}>
                      {showIndicators ? "● Indicadores" : "○ Indicadores"}
                    </button>
                    {lastSignal && lastSignal.asset === asset && (
                      <div style={{ display: "flex", gap: 6, fontSize: 10, color: "var(--muted)" }}>
                        {[["HTF", lastSignal.mtf.htf], ["LTF", lastSignal.mtf.ltf], ["Exec", lastSignal.mtf.exec]].map(([k, v]) => (
                          <span key={k as string}>{k}: <strong style={{ color: (v as number) >= 0 ? "#10b981" : "#ef4444" }}>{(v as number).toFixed(2)}</strong></span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.25)", padding: "6px 3px 3px" }}>
                  <CandlestickChart
                    candles={visibleCandles}
                    indicators={showIndicators ? currentIndicators : null}
                    wyckoff={currentWyckoff}
                    showIndicators={showIndicators}
                  />
                </div>
                {/* Legend */}
                {showIndicators && (
                  <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
                    <span style={{ color: "#f59e0b" }}>━ VWAP</span>
                    <span style={{ color: "rgba(245,158,11,0.5)" }}>- - VWAP ±1σ/2σ</span>
                    <span style={{ color: "rgba(99,102,241,0.6)" }}>- - BB(20,2)</span>
                    <span style={{ color: "rgba(16,185,129,0.5)" }}>░ Zona soporte Wyckoff</span>
                    <span style={{ color: "rgba(239,68,68,0.5)" }}>░ Zona resistencia Wyckoff</span>
                    <span style={{ color: "rgba(245,158,11,0.4)" }}>▌ Climax vol.</span>
                  </div>
                )}
              </div>

              {/* Indicators */}
              {currentIndicators && showIndicators && (
                <div className="card" style={{ padding: "10px 12px" }}>
                  <p className="label" style={{ marginBottom: 8 }}>Indicadores técnicos</p>
                  {tab === "scalping" && currentOF && (
                  <OrderFlowPanel of={currentOF} price={prices[asset]} />
                )}
                <IndicatorPanel ind={currentIndicators} mode={tab} />
                </div>
              )}

              {/* Wyckoff */}
              {currentWyckoff && (
                <div className="card" style={{ padding: "10px 12px" }}>
                  <p className="label" style={{ marginBottom: 6 }}>Análisis Wyckoff</p>
                  <WyckoffPanel wyckoff={currentWyckoff} />
                </div>
              )}

              {/* Last signal */}
              {lastSignal && (
                <div className="card" style={{ borderLeft: `3px solid ${lastSignal.direction === "LONG" ? "#10b981" : "#ef4444"}`, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <p className="label">Última señal</p>
                    <span style={{ fontSize: 10, color: lastSignal.confidence >= 70 ? "#10b981" : "#f59e0b", fontWeight: 700 }}>Conf: {lastSignal.confidence.toFixed(0)}%</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
                    {[["Entrada", lastSignal.entry.toFixed(2)], ["Stop Loss", lastSignal.stopLoss.toFixed(2)], ["Take Profit", lastSignal.takeProfit.toFixed(2)]].map(([k, v]) => (
                      <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
                        <p style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</p>
                        <p style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: k === "Stop Loss" ? "#ef4444" : k === "Take Profit" ? "#10b981" : "var(--text)" }}>{v}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 4 }}>{lastSignal.rationale}</p>
                  {lastSignal.aiRationale && (
                    <p style={{ fontSize: 10.5, color: "#a5b4fc", background: "rgba(99,102,241,0.06)", padding: "5px 8px", borderRadius: 6, marginTop: 4 }}>
                      🤖 IA: {lastSignal.aiRationale}
                      {lastSignal.aiRiskNotes && <span style={{ color: "#f59e0b" }}> — ⚠️ {lastSignal.aiRiskNotes}</span>}
                    </p>
                  )}
                </div>
              )}

              {/* Posiciones abiertas */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 13 }}>Posiciones abiertas</h3>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>evaluación cada 1s</span>
                  {openPositions.length > 0 && <span style={{ background: "#f59e0b", color: "#fff", fontSize: 11, fontWeight: 800, padding: "1px 6px", borderRadius: 10 }}>{openPositions.length}</span>}
                </div>
                {openPositions.length === 0
                  ? <div className="card" style={{ textAlign: "center", padding: "22px", color: "var(--muted)", fontSize: 12 }}>Sin posiciones abiertas</div>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {openPositions.map(p => <LivePositionCard key={p.id} position={p} prices={prices} spreadByAsset={spreadByAsset} now={now} onClose={pos => closePosition(pos, prices[pos.signal.asset], "REVERSAL")} />)}
                    </div>
                }
              </div>

              {/* Equity curve movida al header global */}
            </div>

            {/* Der */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <AiChatPanel
                apiKey={apiKey} usingGroq={usingGroq}
                openPositions={openPositions} realTrades={realTrades}
                lastSignal={lastSignal} prices={prices} stats={stats}
              />
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Estadísticas — trades reales</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {[["Trades", stats.total], ["Win rate", `${stats.winRate.toFixed(1)}%`], ["Expectativa", money(stats.expectancy)], ["Factor gan.", stats.profitFactor.toFixed(2)], ["Sharpe", stats.sharpe.toFixed(2)], ["Max DD", `${stats.maxDrawdown.toFixed(1)}%`], ["P&L total", money(stats.pnl)], ["Posiciones", openPositions.length], ["Kelly %", riskMetrics.kellyFraction > 0 ? `${(riskMetrics.kellyFraction*100).toFixed(1)}%` : "N/D"], ["Ruina", riskMetrics.ruinProb !== undefined ? `${riskMetrics.ruinProb.toFixed(0)}%` : "N/D"]].map(([l, v]) => (
                    <div key={l} className="metric"><span className="label" style={{ fontSize: 11, fontWeight: 600 }}>{l}</span><strong style={{ fontSize: 13 }}>{v}</strong></div>
                  ))}
                </div>
              </div>

              {/* Wyckoff multi-activo */}
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Wyckoff — todos los activos</p>
                {assets.map(a => {
                  const w = wyckoffMap[a];
                  if (!w) return <div key={a} style={{ fontSize: 10, color: "var(--muted)", padding: "3px 0" }}>{a}: sin datos</div>;
                  const col = w.bias === "accumulation" ? "#10b981" : w.bias === "distribution" ? "#ef4444" : "#6b7280";
                  return (
                    <div key={a} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 52, color: "var(--text)" }}>{a}</span>
                      <span style={{ fontSize: 10, color: col, fontWeight: 700 }}>{w.bias === "neutral" ? "Neutral" : w.bias === "accumulation" ? "Acum." : "Dist."}</span>
                      {w.phase !== "unknown" && <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, background: `${col}20`, color: col, fontWeight: 700 }}>F{w.phase}</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>{w.events.at(-1)?.label ?? "–"}</span>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Historial real</p>
                <TradeHistory trades={realTrades} />
              </div>
              <div className="card" style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.8 }}>
                <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>Fuentes</p>
                <p>BTC/ETH: Bybit v5 (linear)</p>
                <p>XAUTUSDT (oro) · PAXGUSDT (plata)</p>
                <p>Velas 1m · Wyckoff 120 velas</p>
                <p>Trail: {learning.atrTrailMult.toFixed(2)} ATR</p>
              </div>
            </div>
          </div>
        )}

        {/* ━━━━━━━━━ BACKTEST ━━━━━━━━━ */}
        {appTab === "backtest" && (
          <BacktestTab liveReady={liveReady} backtestSize={backtestSize} setBacktestSize={setBacktestSize}
            riskPct={riskPct} setRiskPct={setRiskPct} runBacktest={runBacktest}
            lastBacktest={lastBacktest} backtestTrades={backtestTrades} />
        )}

        {/* ━━━━━━━━━ CONFIGURACION ━━━━━━━━━ */}
        {appTab === "configuracion" && (
          <div style={{ maxWidth: 580, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>🤖 IA Groq — Trader experto</p>
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)", fontSize: 11, color: "#a5b4fc", marginBottom: 12, lineHeight: 1.7 }}>
                La IA actúa como trader institucional con MSc en Estadística. Evalúa Wyckoff, divergencias RSI, Vol Delta, Bollinger Squeeze y confluencia MTF antes de aprobar cada señal.
              </div>
              <p className="label" style={{ marginBottom: 5 }}>API Key Groq</p>
              <input className="inp" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="gsk_..." />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className={usingGroq ? "btn-primary" : "btn-secondary"} onClick={() => setUsingGroq(p => !p)} style={{ flex: 1 }}>{usingGroq ? "✅ Groq activo" : "○ Motor local"}</button>
                <button className="btn-secondary" onClick={testAiConnection} disabled={!apiKey.trim() || !usingGroq}>Probar</button>
              </div>
              <div style={{ marginTop: 10 }}><AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} /></div>
            </div>
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>📡 Fuentes de datos</p>
              <div style={{ fontSize: 12, lineHeight: 2.1 }}>
              <p><strong>Todos los activos</strong> → Bybit V5 linear (perpetuos, API pública)</p>
              <p>BTCUSDT · ETHUSDT · XAUTUSDT (oro) · PAXGUSDT (plata)</p>
              <p style={{fontSize:10,color:"var(--muted)"}}>Sin API key requerida · Promise.all paralelo · reverse() aplicado</p>
                <p><strong>Estado:</strong> <span style={{ color: liveReady ? "#10b981" : "#ef4444" }}>{feedStatus}</span></p>
              </div>
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => void syncRealData()} disabled={isSyncing}>{isSyncing ? "⟳ Sincronizando..." : "↻ Sync ahora"}</button>
            </div>
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>🧠 Modelo adaptativo</p>
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.18)", fontSize: 11, color: "#6ee7b7", marginBottom: 10 }}>
                El modelo solo aprende de trades reales. Backtest completamente aislado.
              </div>
              <p style={{ fontSize: 11, color: "var(--muted)" }}>Trades reales: <strong style={{ color: "var(--text)" }}>{realTrades.length}</strong> · Backtest (aislado): <strong style={{ color: "#a5b4fc" }}>{backtestTrades.length}</strong></p>
            </div>
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>🔄 Auto-scan</p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <button onClick={() => setAutoScan(p => !p)} style={{ padding: "5px 14px", borderRadius: 18, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 11, background: autoScan ? "#10b981" : "rgba(255,255,255,0.07)", color: autoScan ? "#fff" : "var(--muted)" }}>{autoScan ? "● ON" : "○ OFF"}</button>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{autoScan ? `cada ${scanEverySec}s` : "inactivo"}</span>
              </div>
              <input className="inp" type="number" min={8} max={300} value={scanEverySec} onChange={e => setScanEverySec(Number(e.target.value))} style={{ width: 110 }} />
            </div>
            {/* ── Panel MT5 Bridge ─────────────────────────────────────────────── */}
            <div className="card" style={{ border: mt5Status === "connected" ? "1px solid rgba(16,185,129,0.35)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>📡 MT5 Bridge — PrimeXBT</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                    background: mt5Status === "connected" ? "rgba(16,185,129,0.15)" : mt5Status === "error" ? "rgba(239,68,68,0.15)" : mt5Status === "testing" ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.1)",
                    color: mt5Status === "connected" ? "#10b981" : mt5Status === "error" ? "#ef4444" : mt5Status === "testing" ? "#f59e0b" : "#6b7280" }}>
                    {mt5Status === "connected" ? "● CONECTADO" : mt5Status === "error" ? "● ERROR" : mt5Status === "testing" ? "● PROBANDO…" : "○ DESCONECTADO"}
                  </span>
                </div>
              </div>

              {/* Info de cuenta si está conectado */}
              {mt5Status === "connected" && mt5Account && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: 12, fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>Cuenta: </span><strong style={{ color: "#10b981" }}>{mt5Account}</strong>
                  {mt5Balance !== null && <><span style={{ color: "var(--muted)", marginLeft: 12 }}>Balance: </span><strong>${mt5Balance.toFixed(2)}</strong></>}
                  <span style={{ marginLeft: 12, fontSize: 11, color: "#10b981" }}>DEMO ✓</span>
                </div>
              )}

              <p className="label" style={{ marginBottom: 5 }}>URL del bridge (local)</p>
              <input className="inp" type="text" value={mt5Url} onChange={e => setMt5Url(e.target.value)}
                placeholder="http://localhost:8000" style={{ marginBottom: 10 }} />

              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", fontSize: 11, color: "#fcd34d", marginBottom: 12, lineHeight: 1.7 }}>
                <strong>⚠ Requisitos:</strong> MT5 instalado · PrimeXBT demo logueado · bridge.py corriendo en tu PC
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-secondary" onClick={testMT5Bridge} disabled={mt5Status === "testing"} style={{ flex: 1 }}>
                  {mt5Status === "testing" ? "⟳ Probando…" : "🔌 Probar conexión"}
                </button>
                <button
                  onClick={() => setMt5Enabled(p => !p)}
                  disabled={mt5Status !== "connected"}
                  style={{ flex: 1, padding: "9px 15px", borderRadius: 10, border: "none", cursor: mt5Status === "connected" ? "pointer" : "not-allowed",
                    fontWeight: 700, fontSize: 13, opacity: mt5Status === "connected" ? 1 : 0.4,
                    background: mt5Enabled ? "linear-gradient(135deg,#10b981,#059669)" : "rgba(255,255,255,0.06)",
                    color: mt5Enabled ? "#fff" : "var(--muted)" }}>
                  {mt5Enabled ? "🟢 Ejecución MT5 activa" : "○ Ejecución MT5 inactiva"}
                </button>
              </div>

              {mt5Enabled && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.08)", fontSize: 11, color: "#6ee7b7", lineHeight: 1.8 }}>
                  ✅ Cada señal aprobada por la IA se enviará automáticamente a MT5 PrimeXBT.<br/>
                  Los cierres (TP/SL/manual) también se ejecutarán en MT5.
                </div>
              )}
            </div>

            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>🔁 Reiniciar</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => {
                    if (!confirm("¿Reiniciar todo? Se borrarán trades, aprendizaje y balance.")) return;
                    ["tl_balance","tl_trades","tl_learning","tl_riskPct"].forEach(k => localStorage.removeItem(k));
                    setBalance(100); setOpenPositions([]); setRealTrades([]);
                    setLearning(initialLearning); setLastSignal(null);
                    pushToast("✅ Trading reiniciado — datos borrados.", "info");
                  }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  🗑 Reiniciar todo
                </button>
                <button onClick={() => { setBacktestTrades([]); setLastBacktest(null); pushToast("Backtest borrado.", "info"); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Limpiar backtest</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
