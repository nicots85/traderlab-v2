import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
// ─── Categorías de activos ────────────────────────────────────────────────────
type AssetCategory = "crypto" | "metals" | "forex_major" | "forex_minor" | "indices" | "energy" | "stocks" | "commodities" | "other";

// Asset es dinámico — string para soportar cualquier símbolo MT5
type Asset = string;

// Activos primarios con parámetros fine-tuned
const PRIMARY_ASSETS = ["BTCUSD","ETHUSD","XAUUSD","XAGUSD"] as const;
type PrimaryAsset = typeof PRIMARY_ASSETS[number];

// Catálogo por categoría — activos conocidos con parámetros optimizados
const ASSET_CATALOG: Record<string, { category: AssetCategory; digits: number; contractSize: number; leverage: number; minAtr: number; spreadPct: number; sessions: string[] }> = {
  // ── Crypto ────────────────────────────────────────────────────────────────
  BTCUSD:   { category:"crypto",      digits:2,  contractSize:1,     leverage:100, minAtr:50,    spreadPct:0.012, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  ETHUSD:   { category:"crypto",      digits:2,  contractSize:1,     leverage:100, minAtr:2,     spreadPct:0.015, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  BNBUSD:   { category:"crypto",      digits:2,  contractSize:1,     leverage:50,  minAtr:0.5,   spreadPct:0.020, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  SOLUSD:   { category:"crypto",      digits:3,  contractSize:1,     leverage:50,  minAtr:0.2,   spreadPct:0.020, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  XRPUSD:   { category:"crypto",      digits:5,  contractSize:1,     leverage:50,  minAtr:0.001, spreadPct:0.025, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  ADAUSD:   { category:"crypto",      digits:5,  contractSize:1,     leverage:50,  minAtr:0.001, spreadPct:0.025, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  DOGEUSD:  { category:"crypto",      digits:5,  contractSize:1,     leverage:20,  minAtr:0.0001,spreadPct:0.030, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  LTCUSD:   { category:"crypto",      digits:2,  contractSize:1,     leverage:50,  minAtr:0.1,   spreadPct:0.022, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  AVAXUSD:  { category:"crypto",      digits:3,  contractSize:1,     leverage:50,  minAtr:0.05,  spreadPct:0.025, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  LINKUSD:  { category:"crypto",      digits:4,  contractSize:1,     leverage:50,  minAtr:0.01,  spreadPct:0.025, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  DOTUSD:   { category:"crypto",      digits:4,  contractSize:1,     leverage:50,  minAtr:0.01,  spreadPct:0.025, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  MATICUSD: { category:"crypto",      digits:5,  contractSize:1,     leverage:20,  minAtr:0.001, spreadPct:0.030, sessions:["NY","London","Asia","Post-NY","Weekend"] },
  // ── Metales ───────────────────────────────────────────────────────────────
  XAUUSD:   { category:"metals",      digits:2,  contractSize:100,   leverage:100, minAtr:0.5,   spreadPct:0.018, sessions:["NY","London"] },
  XAGUSD:   { category:"metals",      digits:3,  contractSize:5000,  leverage:100, minAtr:0.02,  spreadPct:0.025, sessions:["NY","London"] },
  XPTUSD:   { category:"metals",      digits:2,  contractSize:100,   leverage:50,  minAtr:1.0,   spreadPct:0.030, sessions:["NY","London"] },
  // ── Forex Majors ──────────────────────────────────────────────────────────
  EURUSD:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0003,spreadPct:0.003, sessions:["NY","London"] },
  GBPUSD:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0004,spreadPct:0.004, sessions:["NY","London"] },
  USDJPY:   { category:"forex_major", digits:3,  contractSize:100000,leverage:500, minAtr:0.03,  spreadPct:0.003, sessions:["NY","London","Asia"] },
  USDCHF:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0003,spreadPct:0.004, sessions:["NY","London"] },
  AUDUSD:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0002,spreadPct:0.004, sessions:["NY","London","Asia"] },
  USDCAD:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0003,spreadPct:0.004, sessions:["NY","London"] },
  NZDUSD:   { category:"forex_major", digits:5,  contractSize:100000,leverage:500, minAtr:0.0002,spreadPct:0.005, sessions:["NY","London","Asia"] },
  // ── Forex Minors ──────────────────────────────────────────────────────────
  EURGBP:   { category:"forex_minor", digits:5,  contractSize:100000,leverage:200, minAtr:0.0002,spreadPct:0.006, sessions:["London"] },
  EURJPY:   { category:"forex_minor", digits:3,  contractSize:100000,leverage:200, minAtr:0.03,  spreadPct:0.005, sessions:["NY","London","Asia"] },
  GBPJPY:   { category:"forex_minor", digits:3,  contractSize:100000,leverage:200, minAtr:0.05,  spreadPct:0.007, sessions:["NY","London"] },
  AUDJPY:   { category:"forex_minor", digits:3,  contractSize:100000,leverage:200, minAtr:0.03,  spreadPct:0.006, sessions:["Asia","London"] },
  CADJPY:   { category:"forex_minor", digits:3,  contractSize:100000,leverage:200, minAtr:0.03,  spreadPct:0.007, sessions:["NY","Asia"] },
  CHFJPY:   { category:"forex_minor", digits:3,  contractSize:100000,leverage:200, minAtr:0.03,  spreadPct:0.007, sessions:["Asia"] },
  // ── Índices ───────────────────────────────────────────────────────────────
  US30:     { category:"indices",     digits:2,  contractSize:1,     leverage:100, minAtr:20,    spreadPct:0.010, sessions:["NY"] },
  US500:    { category:"indices",     digits:2,  contractSize:1,     leverage:100, minAtr:3,     spreadPct:0.008, sessions:["NY"] },
  USTEC:    { category:"indices",     digits:2,  contractSize:1,     leverage:100, minAtr:15,    spreadPct:0.009, sessions:["NY"] },
  GER40:    { category:"indices",     digits:2,  contractSize:1,     leverage:100, minAtr:20,    spreadPct:0.010, sessions:["London"] },
  UK100:    { category:"indices",     digits:2,  contractSize:1,     leverage:100, minAtr:15,    spreadPct:0.010, sessions:["London"] },
  // ── Energía ───────────────────────────────────────────────────────────────
  USOIL:    { category:"energy",      digits:3,  contractSize:1000,  leverage:100, minAtr:0.2,   spreadPct:0.015, sessions:["NY","London"] },
  UKOIL:    { category:"energy",      digits:3,  contractSize:1000,  leverage:100, minAtr:0.2,   spreadPct:0.015, sessions:["NY","London"] },
  NATGAS:   { category:"energy",      digits:4,  contractSize:10000, leverage:100, minAtr:0.01,  spreadPct:0.020, sessions:["NY"] },
};

// Helpers para obtener parámetros — fallback genérico para activos desconocidos
function getAssetCatalog(a: Asset) {
  return ASSET_CATALOG[a] ?? {
    category:"other" as AssetCategory, digits:5, contractSize:1, leverage:50,
    minAtr:0.001, spreadPct:0.030, sessions:["NY","London"]
  };
}
function getAssetCategory(a: Asset): AssetCategory { return getAssetCatalog(a).category; }
function isCryptoAsset(a: Asset): boolean { return getAssetCategory(a) === "crypto"; }
function isForexAsset(a: Asset): boolean { return getAssetCategory(a).startsWith("forex"); }
function isMetalAsset(a: Asset): boolean { return getAssetCategory(a) === "metals"; }
function isIndexAsset(a: Asset): boolean { return getAssetCategory(a) === "indices"; }
function isEnergyAsset(a: Asset): boolean { return getAssetCategory(a) === "energy"; }

// Label visual por activo
function getAssetLabel(a: Asset): string {
  const labels: Record<string, string> = {
    BTCUSD:"Bitcoin (BTC)", ETHUSD:"Ethereum (ETH)", BNBUSD:"BNB", SOLUSD:"Solana (SOL)",
    XRPUSD:"Ripple (XRP)", ADAUSD:"Cardano (ADA)", DOGEUSD:"Dogecoin", LTCUSD:"Litecoin (LTC)",
    AVAXUSD:"Avalanche (AVAX)", LINKUSD:"Chainlink (LINK)", DOTUSD:"Polkadot (DOT)",
    XAUUSD:"Oro (XAU)", XAGUSD:"Plata (XAG)", XPTUSD:"Platino (XPT)",
    EURUSD:"EUR/USD", GBPUSD:"GBP/USD", USDJPY:"USD/JPY", USDCHF:"USD/CHF",
    AUDUSD:"AUD/USD", USDCAD:"USD/CAD", NZDUSD:"NZD/USD",
    EURGBP:"EUR/GBP", EURJPY:"EUR/JPY", GBPJPY:"GBP/JPY", AUDJPY:"AUD/JPY",
    US30:"Dow Jones (US30)", US500:"S&P 500", USTEC:"NASDAQ 100",
    GER40:"DAX 40", UK100:"FTSE 100",
    USOIL:"WTI Crude Oil", UKOIL:"Brent Crude", NATGAS:"Natural Gas",
  };
  return labels[a] ?? a;
}
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

type AppTab = "trading" | "backtest" | "aprendizaje" | "activos" | "configuracion";

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
  entry: number; stopLoss: number;
  takeProfit: number;   // TP1 (alias para compatibilidad)
  tp1: number; tp2: number; tp3?: number; // TPs escalonados
  confidence: number; spreadPct: number; spreadCostUsd: number; atr: number;
  mtf: { htf: number; ltf: number; exec: number };
  // ── Sistema de anticipación de giro ──────────────────────
  reversalScore: number;       // 0-9: intensidad del agotamiento detectado
  reversalDir: Direction;      // dirección del giro anticipado
  isReversalSetup: boolean;    // true si score >= 5
  wyckoffSizeMult: number;     // multiplicador de size por contexto Wyckoff
  isPyramidAdd?: boolean;      // true si es un add sobre posición existente;
  indicators: Indicators;
  wyckoff: WyckoffAnalysis;
  rationale: string;
  aiRationale?: string;
  aiRiskNotes?: string;
};


// Posición real de MT5 — viene del bridge /positions
type MT5Position = {
  ticket: number;
  symbol: string;      // nombre en MT5 (ej: BTCUSD)
  asset: Asset;        // nombre en TraderLab (ej: BTCUSD)
  type: "LONG" | "SHORT";
  volume: number;
  open_price: number;
  current: number;
  sl: number;
  tp: number;
  profit: number;
  time: string;        // ISO string
};

type Position = {
  id: number; signal: Signal; size: number; marginUsed: number;
  openedAt: string; peak: number; trough: number;
  partialDone?: boolean;   // legacy — reemplazado por tpHit
  tp1Hit?: boolean;        // scalp: TP1 tocado → SL a BE, esperar TP2
  tp2Hit?: boolean;        // scalp: TP2 tocado → cierre
  tp3Hit?: boolean;        // intradía: TP3 tocado → cierre final
  pyramidCount?: number;   // cuántos adds ya se hicieron sobre esta posición
  parentId?: number;       // si es un add, id de la posición original
  isPyramidAdd?: boolean;  // true si es un add de pyramiding
};

type ClosedTrade = {
  id: number; asset: Asset; mode: Mode; direction: Direction;
  entry: number; exit: number; pnl: number; pnlPct: number;
  result: ExitReason; openedAt: string; closedAt: string;
  source: "real" | "backtest";
};

type AssetEdge = {
  wins: number; total: number; pnl: number;
  byHour: Record<number, number>;
};

// ─── AssetIntelligence: aprendizaje profundo por activo ────────────────────
type SessionStat = { trades: number; wins: number; pnl: number; avgSpread: number };
type ModeStat    = { trades: number; wins: number; pnl: number; avgRR: number };
type HourlyStat  = { trades: number; wins: number; pnl: number };

type AssetIntelligence = {
  symbol:          string;
  category:        AssetCategory;
  totalTrades:     number;
  winRate:         number;           // 0-1
  avgRR:           number;
  avgPnl:          number;
  profitFactor:    number;
  sessionStats:    Record<string, SessionStat>;
  modeStats:       Record<string, ModeStat>;
  hourlyStats:     Record<number, HourlyStat>;
  // Parámetros aprendidos
  optimalSLMult:   number;           // ATR mult que minimiza SL prematuros
  optimalTPMult:   number;           // ATR mult que maximiza TP alcanzados
  avgSpreadPct:    number;           // spread real observado
  spreadByHour:    Record<number, number>;
  avgVolatility:   number;           // ATR promedio
  trendStrength:   number;           // 1=muy trendy, -1=muy mean-reverting
  bestMode:        string;           // scalping | intradia
  bestSession:     string;
  bestHourUTC:     number;
  // Correlaciones dinámicas (calculadas sobre últimas 200 velas 1m)
  correlations:    Record<string, number>;   // -1 a +1
  lastUpdated:     string;
};

// ─── Motor de correlación — Pearson sobre retornos 1m ─────────────────────
function calcPearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length, 200);
  if (n < 20) return 0;
  const xa = a.slice(-n); const xb = b.slice(-n);
  // Retornos logarítmicos
  const ra = xa.slice(1).map((v, i) => Math.log(v / Math.max(xa[i], 1e-9)));
  const rb = xb.slice(1).map((v, i) => Math.log(v / Math.max(xb[i], 1e-9)));
  const n2 = ra.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n2;
  const mb = rb.reduce((s, v) => s + v, 0) / n2;
  const num = ra.reduce((s, v, i) => s + (v - ma) * (rb[i] - mb), 0);
  const da  = Math.sqrt(ra.reduce((s, v) => s + (v - ma) ** 2, 0));
  const db  = Math.sqrt(rb.reduce((s, v) => s + (v - mb) ** 2, 0));
  if (da * db < 1e-12) return 0;
  return Math.max(-1, Math.min(1, num / (da * db)));
}

// ── opportunityScore: prioriza qué activos scanear en este momento ─────────
function calcOpportunityScore(
  symbol: Asset,
  intel: AssetIntelligence | undefined,
  currentSession: string,
  currentHour: number,
  openPositionSymbols: Asset[],
  correlationMatrix: Record<string, Record<string, number>>
): number {
  let score = 50; // base

  if (!intel || intel.totalTrades < 3) {
    // Activo desconocido: score medio, preferir sesiones apropiadas
    const cat = getAssetCatalog(symbol);
    if (cat.sessions.includes(currentSession)) score += 10;
    return score;
  }

  // ── 1. Performance histórica (30%) ──
  const pfScore = Math.min(intel.profitFactor * 10, 20); // max 20pts
  score += pfScore;

  // ── 2. Sesión actual (20%) ──
  const sessData = intel.sessionStats[currentSession];
  if (sessData && sessData.trades >= 3) {
    const sessWR = sessData.wins / sessData.trades;
    score += (sessWR - 0.4) * 50; // +10 si WR=60%, -10 si WR=20%
  }

  // ── 3. Hora actual (20%) ──
  const hourData = intel.hourlyStats[currentHour];
  if (hourData && hourData.trades >= 2) {
    const hourWR = hourData.wins / hourData.trades;
    score += (hourWR - 0.4) * 30;
  }

  // ── 4. Spread actual vs promedio aprendido (10%) ──
  const cat = getAssetCatalog(symbol);
  const spreadRatio = intel.avgSpreadPct > 0 ? cat.spreadPct / intel.avgSpreadPct : 1;
  score += (1 - spreadRatio) * 10; // spread mejor que promedio = bonus

  // ── 5. Descorrelación de cartera (20%) ──
  // Bonus por activos que NO correlacionan con las posiciones abiertas
  if (openPositionSymbols.length > 0) {
    const corrWithOpen = openPositionSymbols.map(op => {
      const c = correlationMatrix[symbol]?.[op] ?? 0;
      return Math.abs(c);
    });
    const avgCorr = corrWithOpen.reduce((s, c) => s + c, 0) / corrWithOpen.length;
    score += (1 - avgCorr) * 20; // descorrelacionado = +20pts
  } else {
    score += 10; // sin posiciones abiertas: bonus base
  }

  return Math.max(0, Math.min(100, score));
}
type LearningModel = {
  riskScale: number; confidenceFloor: number;
  scalpingTpAtr: number; intradayTpAtr: number;
  atrTrailMult: number; hourEdge: Record<number, number>;
  assetEdge: Partial<Record<string, AssetEdge>>;
};

type BacktestReport = {
  total: number; winRate: number; expectancy: number;
  profitFactor: number; sharpe: number; maxDrawdown: number;
  grossProfit: number; grossLoss: number; avgWin: number; avgLoss: number;
};

type Toast = { id: number; msg: string; type: "success" | "warning" | "error" | "info" };
type AiStatus = "idle" | "testing" | "ok" | "error" | "disabled";

// ─── Constants ────────────────────────────────────────────────────────────────
// assets se gestiona como estado React (useState) dentro de App — ver abajo



// ── Fuente de datos: exclusivamente MT5 Bridge (PrimeXBT) ───────────────────
// Todos los datos (precios, velas 1m/5m/15m/4H/1D, spread) vienen del bridge.
// No hay fallback a APIs externas — si el bridge no está activo, el feed queda offline.


const initialPrices: Record<Asset, number> = {
  BTCUSD: 71300, ETHUSD: 2080, XAGUSD: 81.8, XAUUSD: 5076,
};

const leverageByAsset: Record<Asset, number> = {
  BTCUSD: 100, ETHUSD: 100, XAGUSD: 50, XAUUSD: 100,
};
// Tamaño mínimo de lote y contract size real del broker (PrimeXBT)
// contractSize dinámico desde ASSET_CATALOG
const contractSize: Record<string, number> = Object.fromEntries(
  Object.entries(ASSET_CATALOG).map(([k, v]) => [k, v.contractSize])
);
const volMin: Record<string, number> = {
  BTCUSD: 0.001, ETHUSD: 0.01, XAUUSD: 0.01, XAGUSD: 0.01,
};
const volStep: Record<string, number> = {
  BTCUSD: 0.001, ETHUSD: 0.01, XAUUSD: 0.01, XAGUSD: 0.01,
};
// ATR mínimo por activo — evita sizing explosivo en mercados de bajo precio
// XAGUSD ~32 usd: ATR 1m mínimo realista = 0.05 usd (0.15%)
// XAUUSD ~3300 usd: ATR 1m mínimo = 1.5 usd
// BTC ~95000 usd: ATR 1m mínimo = 50 usd

const initialLearning: LearningModel = {
  riskScale: 1, confidenceFloor: 52,
  scalpingTpAtr: 2.4,
  intradayTpAtr: 5.0,
  atrTrailMult: 0.35, hourEdge: {}, assetEdge: {},
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
const assetLabel: Record<Asset, string> = {
  BTCUSD: "BTC/USD", ETHUSD: "ETH/USD",
  XAGUSD: "Plata XAG", XAUUSD: "Oro XAU",
};
const minAtrByAsset: Record<Asset, number> = {
  BTCUSD: 100, ETHUSD: 8, XAGUSD: 0.15, XAUUSD: 5.0,
};
const CFD_BASE_SPREAD_PCT: Record<Asset, number> = {
  BTCUSD: 0.00069, ETHUSD: 0.0012, XAUUSD: 0.00006, XAGUSD: 0.00067,
};


// ─── AiChatPanel — panel de chat con la IA ────────────────────────────────────
function AiChatPanel({
  apiKey, usingGroq, groqModel, onGroqCall, canGroqCall,
  openPositions, realTrades, lastSignal, prices, stats,
  correlationMatrix, assetIntelligence,
}: {
  apiKey: string; usingGroq: boolean; groqModel: string;
  onGroqCall: () => void; canGroqCall: () => boolean;
  openPositions: Position[]; realTrades: ClosedTrade[];
  lastSignal: Signal | null; prices: Record<string, number>;
  stats: { winRate: number; pnl: number; profitFactor: number; sharpe: number; total: number; expectancy: number; maxDrawdown: number };
  correlationMatrix: Record<string, Record<string, number>>;
  assetIntelligence: Record<string, AssetIntelligence>;
}) {
  const [messages, setMessages] = React.useState<{role:"user"|"ai"; text:string; ts:string}[]>([]);
  const [input,    setInput]    = React.useState("");
  const [loading,  setLoading]  = React.useState(false);
  const [aiStatus, setAiStatus] = React.useState<string>("idle");
    const endRef = React.useRef<HTMLDivElement>(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function chatStatsByAsset(trades: ClosedTrade[]): string {
    return ["BTCUSD","ETHUSD","XAUUSD","XAGUSD"].map(a => {
      const at = trades.filter(t => t.asset === a);
      if (!at.length) return "  " + a + ": sin trades";
      const wr   = (at.filter(t => t.pnl > 0).length / at.length * 100).toFixed(0);
      const pnl  = at.reduce((s, t) => s + t.pnl, 0).toFixed(3);
      const avgR = (at.reduce((s, t) => s + t.pnl, 0) / at.length).toFixed(3);
      return "  " + a + ": " + at.length + " trades | WR " + wr + "% | PnL $" + pnl + " | avg $" + avgR + "/trade";
    }).join("\n");
  }
  function chatStatsBySession(trades: ClosedTrade[]): string {
    return ["NY","London","Asia","Post-NY","Weekend"].map(sess => {
      const st = trades.filter(t => (t as ClosedTrade & {session?:string}).session === sess);
      if (!st.length) return "  " + sess + ": sin trades";
      const wr  = (st.filter(t => t.pnl > 0).length / st.length * 100).toFixed(0);
      const pnl = st.reduce((s, t) => s + t.pnl, 0).toFixed(3);
      return "  " + sess + ": " + st.length + " trades | WR " + wr + "% | PnL $" + pnl;
    }).join("\n");
  }
  function chatStatsByMode(trades: ClosedTrade[]): string {
    return ["scalping","intradia"].map(m => {
      const mt = trades.filter(t => t.mode === m);
      if (!mt.length) return "  " + m + ": sin trades";
      const wr  = (mt.filter(t => t.pnl > 0).length / mt.length * 100).toFixed(0);
      const pnl = mt.reduce((s, t) => s + t.pnl, 0).toFixed(3);
      return "  " + m + ": " + mt.length + " trades | WR " + wr + "% | PnL $" + pnl;
    }).join("\n");
  }
  function chatBestWorst(trades: ClosedTrade[]): string {
    if (!trades.length) return "  No trades yet";
    const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);
    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    return "  Best:  " + best.asset  + " " + best.direction  + " " + best.mode  + " | +$" + (best.pnl ?? 0).toFixed(3)  + "\n"
         + "  Worst: " + worst.asset + " " + worst.direction + " " + worst.mode + " | $"  + (worst.pnl ?? 0).toFixed(3);
  }
  function chatReversalStats(trades: ClosedTrade[]): string {
    const rev = trades.slice(0,10).filter(t => (t as ClosedTrade & {isReversalSetup?:boolean}).isReversalSetup);
    if (!rev.length) return "  Ninguno en últimos 10 trades";
    return rev.map(t => "  " + t.asset + " " + t.direction + " | " + t.result + " | $" + (t.pnl ?? 0).toFixed(3)).join("\n");
  }

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
- P&L total: $${(stats.pnl ?? 0).toFixed(2)} | Trades: ${stats.total} | Win rate: ${(stats.winRate ?? 0).toFixed(1)}%
- Profit factor: ${(stats.profitFactor ?? 0).toFixed(2)} | Sharpe: ${(stats.sharpe ?? 0).toFixed(2)} | Max DD: ${stats.maxDrawdown?.toFixed(1) ?? "N/A"}%
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
  return `  ${p.signal.asset} ${p.signal.direction} ${p.signal.mode.toUpperCase()} | Entry ${(p.signal.entry ?? 0).toFixed(3)} → now ${prices[p.signal.asset]?.toFixed(3)} | PnL est: $${pnlEst.toFixed(3)} | SL: ${(p.signal.stopLoss ?? 0).toFixed(3)} | TP: ${(p.signal.takeProfit ?? 0).toFixed(3)} | Margin: $${(p.marginUsed ?? 0).toFixed(3)}`;
}).join("\n")}

LAST 5 TRADES:
${realTrades.slice(0,5).map(t =>
  `  ${t.asset} ${t.direction} ${t.mode.toUpperCase()} | ${t.result} | PnL: $${(t.pnl ?? 0).toFixed(3)}`
).join("\n") || "None yet"}

LAST SIGNAL: ${lastSignal ? `${lastSignal.asset} ${lastSignal.direction} ${lastSignal.mode} conf:${(lastSignal.confidence ?? 0).toFixed(0)}% | ${lastSignal.rationale}` : "None"}

BEHAVIOR RULES FOR CHAT:
- When asked about risk, always cite actual numbers (EV, Kelly, ruina, DD)
- When asked why a trade opened/closed, reference the actual signal data
- When asked if should open/close, apply the decision framework: EV positive + RR ≥ 1.5 + DD < 5% = lean OPEN
- Never say "it's just paper trading" — treat everything as real capital
- Max 220 words per response. Be precise and actionable.

PERFORMANCE BY ASSET:
${chatStatsByAsset(realTrades)}

PERFORMANCE BY SESSION:
${chatStatsBySession(realTrades)}

PERFORMANCE BY MODE:
${chatStatsByMode(realTrades)}

BEST/WORST TRADES:
${chatBestWorst(realTrades)}

REVERSAL SETUPS DETECTED (last 10 trades):
${chatReversalStats(realTrades)}

ASSET CORRELATIONS (dynamic, last 200 candles 1m):
${chatCorrelationContext(correlationMatrix)}

ASSET INTELLIGENCE (learned per asset):
${chatAssetIntelContext(assetIntelligence)}`;

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
      if (!canGroqCall()) {
        setMessages(prev => [...prev, { role: "ai", text: "⏸ Groq pausado por rate limit — esperá unos segundos.", ts: "" }]);
        setLoading(false); return;
      }
      onGroqCall();
      const r = await fetch("/api/groq", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: groqModel,
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
      if (!r.ok) {
        let detail = "";
        try { const e = await r.json(); detail = e?.error?.message ?? `HTTP ${r.status}`; } catch { detail = `HTTP ${r.status}`; }
        throw new Error(detail);
      }
      const data = await r.json() as { choices: Array<{ message: { content: string } }> };
      const reply = data?.choices?.[0]?.message?.content?.trim() ?? "Sin respuesta.";
      setMessages(prev => [...prev, { role: "ai", text: reply, ts: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("Failed to fetch") || msg.includes("NetworkError")
        ? "Sin conexión al proxy /api/groq. Verificá el deploy en Vercel."
        : msg.includes("401") ? "API key inválida — regenerala en console.groq.com"
        : msg.includes("404") ? `Modelo no encontrado: ${groqModel}. Reconectá Groq en Configuración.`
        : msg.includes("429") ? "Rate limit de Groq — esperá unos segundos."
        : `Error: ${msg}`;
      setMessages(prev => [...prev, { role: "ai", text: friendly, ts: "" }]);
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

// useLocalStorage reemplazado por useState in-memory (localStorage no disponible en este entorno)
function chatCorrelationContext(corrMatrix: Record<string, Record<string, number>>): string {
  const pairs = Object.entries(corrMatrix).flatMap(([a, row]) =>
    Object.entries(row)
      .filter(([b, c]) => a < b && Math.abs(c) >= 0.6)
      .map(([b, c]) => ({ a, b, c }))
  ).sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 10);
  if (!pairs.length) return "  Sin correlaciones calculadas aún";
  return pairs.map(({a, b, c}) =>
    `  ${a}↔${b}: ${c >= 0 ? "+" : ""}${c.toFixed(2)} (${Math.abs(c) >= 0.75 ? "ALTA — bloqueado abrir mismo lado" : Math.abs(c) >= 0.5 ? "moderada" : "leve"})`
  ).join("\n");
}

function chatAssetIntelContext(intel: Record<string, AssetIntelligence>): string {
  const top = Object.values(intel).filter(i => i.totalTrades >= 3)
    .sort((a,b) => b.profitFactor - a.profitFactor).slice(0, 8);
  if (!top.length) return "  Sin inteligencia aprendida aún";
  return top.map(i =>
    `  ${i.symbol} [${i.category}]: WR=${((i.winRate)*100).toFixed(0)}% PF=${(i.profitFactor ?? 0).toFixed(2)} mejor=${i.bestSession}/${i.bestMode}/${i.bestHourUTC}h`
  ).join("\n");
}

function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  return useState<T>(initial);
}


// ── Error Boundary — muestra el error en pantalla en vez de negro ─────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          background: "#0f172a", color: "#f87171", padding: 32,
          fontFamily: "monospace", fontSize: 14, minHeight: "100vh",
          whiteSpace: "pre-wrap", wordBreak: "break-all"
        }}>
          <h2 style={{ color: "#ef4444", marginBottom: 16 }}>
            💥 TraderLab — Error de render
          </h2>
          <p style={{ color: "#fca5a5", marginBottom: 8 }}><strong>{this.state.error.message}</strong></p>
          <pre style={{ fontSize: 11, opacity: 0.7, marginBottom: 16 }}>{this.state.error.stack}</pre>
          <button onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
            style={{ padding: "8px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>
            🔄 Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
  componentDidCatch(e: Error) { console.error("[TraderLab]", e.message, e.stack); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── COMPONENTES UI ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

// ── ToastList ─────────────────────────────────────────────────────────────────
function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onRemove(t.id)}
          style={{
            pointerEvents: "all", cursor: "pointer", minWidth: 260, maxWidth: 380,
            padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: t.type === "success" ? "rgba(16,185,129,0.92)" : t.type === "error" ? "rgba(239,68,68,0.92)" : t.type === "warning" ? "rgba(245,158,11,0.92)" : "rgba(99,102,241,0.92)",
            color: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── TechTip ───────────────────────────────────────────────────────────────────
const TECH_TIPS: Record<string, string> = {
  Wyckoff: "Metodología de análisis de fases del mercado: Acumulación (A-B-C), Distribución y tendencia (D-E).",
  RSI: "Relative Strength Index — oscilador 0-100. >70 sobrecomprado, <30 sobrevendido.",
  VWAP: "Volume Weighted Average Price — precio promedio ponderado por volumen. Referencia institucional.",
  ATR: "Average True Range — medida de volatilidad. El SL se calcula como múltiplo del ATR.",
  CVD: "Cumulative Volume Delta — diferencia acumulada entre volumen compra/venta.",
};
function TechTip({ term, children }: { term: string; children: React.ReactNode }) {
  const tip = TECH_TIPS[term];
  if (!tip) return <>{children}</>;
  return (
    <span className="tip">
      {children}
      <i className="tip-icon">?</i>
      <span className="tip-box">{tip}</span>
    </span>
  );
}

// ── AiBadge ───────────────────────────────────────────────────────────────────
function AiBadge({ status, onTest, latency }: { status: string; onTest: () => void; latency: number | null }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    idle:     { bg: "rgba(16,185,129,0.15)",  color: "#10b981", label: "IA lista" },
    loading:  { bg: "rgba(245,158,11,0.15)",  color: "#f59e0b", label: "IA procesando" },
    error:    { bg: "rgba(239,68,68,0.15)",   color: "#ef4444", label: "IA error" },
    disabled: { bg: "rgba(255,255,255,0.06)", color: "var(--muted)", label: "IA inactiva" },
  };
  const c = cfg[status] ?? cfg.disabled;
  return (
    <button onClick={onTest} title="Testear conexion IA"
      style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20,
        background: c.bg, color: c.color, border: `1px solid ${c.color}40`,
        fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
      {c.label}
      {latency !== null && <span style={{ opacity: 0.7 }}> {latency}ms</span>}
    </button>
  );
}

// ── CandlestickChart ──────────────────────────────────────────────────────────
function CandlestickChart({
  candles, indicators, wyckoff, showIndicators,
}: {
  candles: Candle[];
  indicators: Indicators | null;
  wyckoff: WyckoffAnalysis | null;
  showIndicators: boolean;
}) {
  const W = 640, H = 220, PL = 52, PR = 8, PT = 10, PB = 22;
  const data = candles.slice(-80);
  if (!data.length) {
    return (
      <div style={{ width: "100%", height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>
        Sin datos de velas — conecta el bridge MT5
      </div>
    );
  }
  const hi = Math.max(...data.map(c => c.h));
  const lo = Math.min(...data.map(c => c.l));
  const range = hi - lo || 1;
  const cW = (W - PL - PR) / data.length;
  const bW = Math.max(1.5, cW * 0.6);
  const py = (p: number) => PT + ((hi - p) / range) * (H - PT - PB);
  const px = (i: number) => PL + i * cW + cW / 2;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (range / 4) * (4 - i));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      <rect width={W} height={H} fill="transparent" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={py(t)} y2={py(t)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
          <text x={PL - 4} y={py(t) + 3.5} textAnchor="end" fontSize={9} fill="rgba(156,163,184,0.5)">
            {t >= 1000 ? t.toFixed(0) : t >= 1 ? t.toFixed(2) : t.toFixed(4)}
          </text>
        </g>
      ))}
      {wyckoff?.supportZone && (
        <rect x={PL} width={W - PL - PR}
          y={py(wyckoff.supportZone[1])} height={Math.max(1, py(wyckoff.supportZone[0]) - py(wyckoff.supportZone[1]))}
          fill="rgba(16,185,129,0.06)" />
      )}
      {wyckoff?.resistanceZone && (
        <rect x={PL} width={W - PL - PR}
          y={py(wyckoff.resistanceZone[1])} height={Math.max(1, py(wyckoff.resistanceZone[0]) - py(wyckoff.resistanceZone[1]))}
          fill="rgba(239,68,68,0.06)" />
      )}
      {showIndicators && indicators && (
        <>
          <path d={data.map((_, i) => `${i===0?"M":"L"} ${px(i)} ${py(indicators.bbUpper)}`).join(" ")}
            fill="none" stroke="rgba(99,102,241,0.35)" strokeWidth={1} strokeDasharray="3,3" />
          <path d={data.map((_, i) => `${i===0?"M":"L"} ${px(i)} ${py(indicators.bbLower)}`).join(" ")}
            fill="none" stroke="rgba(99,102,241,0.35)" strokeWidth={1} strokeDasharray="3,3" />
          <path d={data.map((_, i) => `${i===0?"M":"L"} ${px(i)} ${py(indicators.vwap)}`).join(" ")}
            fill="none" stroke="rgba(245,158,11,0.7)" strokeWidth={1.5} />
          <path d={data.map((_, i) => `${i===0?"M":"L"} ${px(i)} ${py(indicators.vwapUpperBand1)}`).join(" ")}
            fill="none" stroke="rgba(245,158,11,0.3)" strokeWidth={1} strokeDasharray="2,3" />
          <path d={data.map((_, i) => `${i===0?"M":"L"} ${px(i)} ${py(indicators.vwapLowerBand1)}`).join(" ")}
            fill="none" stroke="rgba(245,158,11,0.3)" strokeWidth={1} strokeDasharray="2,3" />
        </>
      )}
      {data.map((c, i) => {
        const bull = c.c >= c.o;
        const col  = bull ? "#10b981" : "#ef4444";
        const bTop = py(Math.max(c.o, c.c));
        const bBot = py(Math.min(c.o, c.c));
        return (
          <g key={i}>
            <line x1={px(i)} x2={px(i)} y1={py(c.h)} y2={py(c.l)} stroke={col} strokeWidth={1} opacity={0.7} />
            <rect x={px(i) - bW / 2} y={bTop} width={bW} height={Math.max(1, bBot - bTop)}
              fill={bull ? "rgba(16,185,129,0.85)" : "rgba(239,68,68,0.85)"} stroke={col} strokeWidth={0.5} />
          </g>
        );
      })}
      {wyckoff?.events.map((ev, i) => {
        const idx = Math.min(ev.candleIndex, data.length - 1);
        return (
          <g key={i}>
            <line x1={px(idx)} x2={px(idx)} y1={PT} y2={H - PB} stroke={ev.color} strokeWidth={1} strokeDasharray="2,3" opacity={0.5} />
            <text x={px(idx)} y={py(ev.price) - 5} textAnchor="middle" fontSize={8} fill={ev.color} fontWeight={700}>{ev.label}</text>
          </g>
        );
      })}
      {data.map((c, i) => {
        if (i % 15 !== 0) return null;
        const d = new Date(c.t * 1000);
        return (
          <text key={i} x={px(i)} y={H - 5} textAnchor="middle" fontSize={8} fill="rgba(156,163,184,0.4)">
            {`${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`}
          </text>
        );
      })}
    </svg>
  );
}

// ── IndicatorPanel ────────────────────────────────────────────────────────────
function IndicatorPanel({ ind, mode }: { ind: Indicators | null; mode: string }) {
  if (!ind) return null;
  const rsiColor = ind.rsi > 70 ? "#ef4444" : ind.rsi < 30 ? "#10b981" : "var(--text)";
  const items = [
    { label: "RSI(14)", value: (ind.rsi ?? 0).toFixed(1), color: rsiColor },
    { label: "Stoch K/D", value: `${(ind.stochK ?? 0).toFixed(1)}/${(ind.stochD ?? 0).toFixed(1)}`, color: ind.stochK > 80 ? "#ef4444" : ind.stochK < 20 ? "#10b981" : "var(--text)" },
    { label: "MA5/20", value: `${(ind.ma5 ?? 0).toFixed(2)}/${(ind.ma20 ?? 0).toFixed(2)}`, color: ind.ma5 > ind.ma20 ? "#10b981" : "#ef4444" },
    { label: "VWAP", value: (ind.vwap ?? 0).toFixed(2), color: "var(--text)" },
    { label: "BB Squeeze", value: ind.bbSqueeze ? "SQ" : "No", color: ind.bbSqueeze ? "#f59e0b" : "var(--muted)" },
    { label: "Vol Delta", value: `${ind.volumeDeltaPct >= 0 ? "+" : ""}${(ind.volumeDeltaPct ?? 0).toFixed(1)}%`, color: ind.volumeDeltaPct > 10 ? "#10b981" : ind.volumeDeltaPct < -10 ? "#ef4444" : "var(--muted)" },
    { label: "ATR", value: (ind.atr ?? 0).toFixed(4), color: "var(--text)" },
    { label: "RSI Div", value: ind.rsiDivergence === "none" ? "-" : ind.rsiDivergence === "bullish" ? "Bull" : "Bear", color: ind.rsiDivergence === "bullish" ? "#10b981" : ind.rsiDivergence === "bearish" ? "#ef4444" : "var(--muted)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 6 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "5px 9px" }}>
          <p style={{ fontSize: 10, color: "var(--muted)", marginBottom: 1 }}>{label}</p>
          <p style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── WyckoffPanel ──────────────────────────────────────────────────────────────
function WyckoffPanel({ wyckoff }: { wyckoff: WyckoffAnalysis }) {
  const phaseColor: Record<string, string> = { A:"#f59e0b",B:"#f59e0b",C:"#ef4444",D:"#10b981",E:"#10b981",unknown:"var(--muted)" };
  const biasColor = wyckoff.bias === "accumulation" ? "#10b981" : wyckoff.bias === "distribution" ? "#ef4444" : "var(--muted)";
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${phaseColor[wyckoff.phase]}22`, color: phaseColor[wyckoff.phase], fontWeight: 700 }}>
          Fase {wyckoff.phase}
        </span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${biasColor}22`, color: biasColor, fontWeight: 700 }}>
          {wyckoff.bias === "accumulation" ? "Acumulacion" : wyckoff.bias === "distribution" ? "Distribucion" : "Neutral"}
        </span>
        {wyckoff.supportZone && <span style={{ fontSize: 10, color:"var(--muted)" }}>S: {wyckoff.supportZone[0].toFixed(2)}-{wyckoff.supportZone[1].toFixed(2)}</span>}
        {wyckoff.resistanceZone && <span style={{ fontSize: 10, color:"var(--muted)" }}>R: {wyckoff.resistanceZone[0].toFixed(2)}-{wyckoff.resistanceZone[1].toFixed(2)}</span>}
      </div>
      {wyckoff.events.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {wyckoff.events.slice(-5).map((ev, i) => (
            <span key={i} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: `${ev.color}22`, color: ev.color, fontWeight: 700 }}>{ev.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── OrderFlowPanel ────────────────────────────────────────────────────────────
function OrderFlowPanel({ of: of_, price }: { of: OrderFlowScore; price: number }) {
  const ctrlColor = of_.control === "bulls" ? "#10b981" : of_.control === "bears" ? "#ef4444" : "#f59e0b";
  const pct = (of_.controlScore + 100) / 2;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Order Flow</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: ctrlColor }}>
          {of_.control === "bulls" ? "Toros" : of_.control === "bears" ? "Osos" : "Disputado"}
          <span style={{ fontSize: 10, marginLeft: 5, opacity: 0.7 }}>{(of_.controlScore ?? 0).toFixed(0)}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 6 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: ctrlColor, borderRadius: 3 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {[
          { label: "CVD", value: (of_.cvdScore ?? 0).toFixed(0) },
          { label: "Footprint", value: (of_.footprintScore ?? 0).toFixed(0) },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center", background: "rgba(255,255,255,0.03)", borderRadius: 5, padding: "3px 0" }}>
            <p style={{ fontSize: 9, color: "var(--muted)" }}>{label}</p>
            <p style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LivePositionCard ──────────────────────────────────────────────────────────
function LivePositionCard({
  position, prices, now, onClose,
}: {
  position: Position; prices: Record<string, number>;
  spreadByAsset?: Record<string, number>; now: number;
  onClose: (p: Position) => void;
}) {
  const sig    = position.signal;
  const dir    = sig.direction;
  const price  = prices[sig.asset] ?? sig.entry;
  const cs     = getAssetCatalog(sig.asset).contractSize ?? 1;
  const pnl    = dir === "LONG"
    ? (price - sig.entry) * position.size * cs
    : (sig.entry - price) * position.size * cs;
  const openTs = typeof (position as Position & {openTime?:number}).openTime === "number"
    ? (position as Position & {openTime:number}).openTime
    : new Date(position.openedAt).getTime();
  const dur    = Math.floor((now - openTs) / 60000);
  const pnlCol = pnl >= 0 ? "#10b981" : "#ef4444";
  return (
    <div className="live-card" style={{ borderLeft: `3px solid ${dir === "LONG" ? "#10b981" : "#ef4444"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{sig.asset}</span>
          <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, fontWeight: 700,
            background: dir === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: dir === "LONG" ? "#10b981" : "#ef4444" }}>{dir}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{sig.mode} · {dur}m</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, fontSize: 14, color: pnlCol }}>
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}$
          </span>
          <button onClick={() => onClose(position)}
            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontWeight: 700 }}>
            X Cerrar
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, fontSize: 11 }}>
        {[["Entrada", (sig.entry ?? 0).toFixed(2)], ["Precio", price.toFixed(2)],
          ["SL", (sig.stopLoss ?? 0).toFixed(2)], ["TP1", (sig.tp1 ?? 0).toFixed(2)]].map(([k, v]) => (
          <div key={k} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 5, padding: "3px 6px" }}>
            <p style={{ fontSize: 9, color: "var(--muted)" }}>{k}</p>
            <p style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TradeHistory ──────────────────────────────────────────────────────────────
function TradeHistory({ trades }: { trades: ClosedTrade[] }) {
  if (!trades.length) return (
    <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 16 }}>Sin trades cerrados aun</p>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
      {[...trades].reverse().slice(0, 40).map((t, i) => {
        const pnlColor = t.pnl >= 0 ? "#10b981" : "#ef4444";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "65px 50px 55px 1fr 65px 60px", gap: 4,
            padding: "5px 8px", borderRadius: 6, background: "rgba(255,255,255,0.025)",
            fontSize: 11, alignItems: "center", fontFamily: "'JetBrains Mono',monospace" }}>
            <span style={{ fontWeight: 700 }}>{t.asset}</span>
            <span style={{ color: t.direction === "LONG" ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.direction}</span>
            <span style={{ color: "var(--muted)" }}>{t.mode}</span>
            <span style={{ color: "var(--muted)", fontSize: 10, fontFamily: "sans-serif", overflow: "hidden", whiteSpace: "nowrap" }}>{t.result}</span>
            <span style={{ color: pnlColor, fontWeight: 800, textAlign: "right" }}>{t.pnl >= 0 ? "+" : ""}{(t.pnl ?? 0).toFixed(2)}$</span>
            <span style={{ color: "var(--muted)", fontSize: 10 }}>{new Date(t.closedAt ?? Date.now()).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── BacktestTab ───────────────────────────────────────────────────────────────
function BacktestTab({
  liveReady, backtestSize, setBacktestSize, riskPct, setRiskPct,
  runBacktest, lastBacktest, backtestTrades,
}: {
  liveReady: boolean; backtestSize: number; setBacktestSize: (n: number) => void;
  riskPct: number; setRiskPct: (n: number) => void;
  runBacktest: () => void; lastBacktest: BacktestReport | null; backtestTrades: ClosedTrade[];
}) {
  return (
    <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Backtest</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <p className="label" style={{ marginBottom: 4 }}>Velas a simular</p>
            <select className="sel" value={backtestSize} onChange={e => setBacktestSize(Number(e.target.value))} style={{ width: 130 }}>
              {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n} velas</option>)}
            </select>
          </div>
          <div>
            <p className="label" style={{ marginBottom: 4 }}>Riesgo / trade</p>
            <select className="sel" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} style={{ width: 110 }}>
              {[0.5, 1, 1.5, 2, 3].map(n => <option key={n} value={n}>{n}%</option>)}
            </select>
          </div>
          <button onClick={runBacktest} disabled={!liveReady}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: liveReady ? "pointer" : "not-allowed",
              background: liveReady ? "rgba(99,102,241,0.7)" : "rgba(99,102,241,0.2)",
              color: "#fff", fontSize: 13, fontWeight: 700 }}>
            Ejecutar
          </button>
        </div>
      </div>
      {lastBacktest && (
        <div className="card">
          <h4 style={{ fontWeight: 700, marginBottom: 10 }}>{lastBacktest.total} trades simulados</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8 }}>
            {[
              { label: "Win Rate",     value: `${(lastBacktest.winRate ?? 0).toFixed(1)}%`,      color: lastBacktest.winRate >= 50 ? "#10b981" : "#ef4444" },
              { label: "P&L",          value: `$${(lastBacktest.grossProfit - lastBacktest.grossLoss).toFixed(2)}`,           color: lastBacktest.grossProfit >= lastBacktest.grossLoss ? "#10b981" : "#ef4444" },
              { label: "Profit Factor",value: (lastBacktest.profitFactor ?? 0).toFixed(2),        color: lastBacktest.profitFactor >= 1.5 ? "#10b981" : "var(--text)" },
              { label: "Max DD",       value: `$${(lastBacktest.maxDrawdown ?? 0).toFixed(2)}`,   color: "#ef4444" },
              { label: "Sharpe",       value: (lastBacktest.sharpe ?? 0).toFixed(2),              color: lastBacktest.sharpe >= 1 ? "#10b981" : "var(--text)" },
              { label: "Expectancy",   value: `$${(lastBacktest.expectancy ?? 0).toFixed(2)}`,    color: lastBacktest.expectancy >= 0 ? "#10b981" : "#ef4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                <p style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{label}</p>
                <p style={{ fontSize: 14, fontWeight: 800, color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {backtestTrades.length > 0 && (
        <div className="card">
          <h4 style={{ fontWeight: 700, marginBottom: 8 }}>Trades del backtest</h4>
          <TradeHistory trades={backtestTrades} />
        </div>
      )}
    </div>
  );
}


export function App() {
  // ── Capturar errores de useEffect que no van a ErrorBoundary ────────────
  React.useEffect(() => {
    const h = (e: ErrorEvent) => console.error("[TraderLab CRASH]", e.message, "\n", e.error?.stack ?? "");
    window.addEventListener("error", h);
    return () => window.removeEventListener("error", h);
  }, []);

  const [assetIntelligence, setAssetIntelligence] = useState<Record<string, AssetIntelligence>>({});
  const [correlationMatrix, setCorrelationMatrix] = useState<Record<string, Record<string, number>>>({});
  const [availableSymbols, setAvailableSymbols] = useState<Array<{name:string;brokerName?:string;category:AssetCategory;spread:number;contractSize:number;digits?:number;volumeMin?:number}>>([]);
  const [assets, setAssets] = useState<Asset[]>(["BTCUSD","ETHUSD","XAGUSD","XAUUSD"]);
  const assetIntelRef  = useRef<Record<string, AssetIntelligence>>({});
  const correlationRef = useRef<Record<string, Record<string, number>>>({});
  const [appTab, setAppTab] = useState<AppTab>("trading");
  const [tab, setTab] = useState<Mode>("scalping");
  const [asset, setAsset] = useState<Asset>("BTCUSD");
  const [prices, setPrices] = useState<Record<Asset, number>>(initialPrices);
  const [series, setSeries] = useState<Record<Asset, number[]>>({
    BTCUSD: Array.from({ length: 120 }, () => initialPrices.BTCUSD),
    ETHUSD: Array.from({ length: 120 }, () => initialPrices.ETHUSD),
    XAGUSD: Array.from({ length: 120 }, () => initialPrices.XAGUSD),
    XAUUSD: Array.from({ length: 120 }, () => initialPrices.XAUUSD),
  });
  const [candles,    setCandles]    = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [candles5m,  setCandles5m]  = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [candles15m, setCandles15m] = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  // Velas 4H y 1D — exclusivamente para Wyckoff macro (intradía/swing)
  const [candles4h,  setCandles4h]  = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [candles1d,  setCandles1d]  = useState<Record<Asset, Candle[]>>({ BTCUSD: [], ETHUSD: [], XAGUSD: [], XAUUSD: [] });
  const [mt5SpreadMap, setMt5SpreadMap] = useState<Partial<Record<Asset, {spread: number; spread_pct: number; bid: number; ask: number}>>>({});
  // Leverage real del broker (leído del bridge) — reemplaza los valores hardcodeados
  const [mt5LeverageMap, setMt5LeverageMap] = useState<Partial<Record<Asset, number>>>({});
  const [balance, setBalance] = useLocalStorage("tl_balance", 100);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [realTrades, setRealTrades] = useLocalStorage<ClosedTrade[]>("tl_trades", []);
  const [backtestTrades, setBacktestTrades] = useState<ClosedTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<Signal | null>(null);
  const [lastOF, setLastOF] = useState<OrderFlowScore | null>(null);
  const [volumeShock, setVolumeShock] = useState(0.28);
  const [learning, setLearning] = useLocalStorage<LearningModel>("tl_learning", initialLearning);
  const [apiKey, setApiKey] = useLocalStorage("tl_apiKey", "");
  const [usingGroq,   setUsingGroq]   = useState(false);
  const [groqModel,   setGroqModel]   = useState("llama-3.3-70b-versatile");
  const [riskPct, setRiskPct] = useLocalStorage("tl_riskPct", 1.2);
  const [backtestSize, setBacktestSize] = useState(40);
  const [lastBacktest, setLastBacktest] = useState<BacktestReport | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [scanEverySec, setScanEverySec] = useState(20);
  // ── Circuit breaker ──────────────────────────────────────────────────────
  const [circuitOpen, setCircuitOpen] = useState(false);   // true = pausado por pérdida diaria
  const [sessionOverride, setSessionOverride] = useState(false); // true = ignorar filtro sesión manual
  const dailyPnlRef     = useRef<{ date: string; pnl: number }>({ date: "", pnl: 0 });
  const circuitOpenRef  = useRef(false);
  const mt5EquityRef    = useRef<number | null>(null);
  const equityRef       = useRef<number>(100);
  const MAX_DAILY_LOSS_PCT = 0.03;   // 3% equity máxima pérdida diaria
  // ── Rate limiter Groq ────────────────────────────────────────────────────
  const groqCallsRef   = useRef<number[]>([]);   // timestamps de llamadas recientes
  const groqPausedRef  = useRef(false);           // true = pausado por rate limit
  const [groqRateInfo, setGroqRateInfo] = useState({ calls: 0, paused: false, pauseUntil: 0 });
  const GROQ_MAX_RPM   = 25;   // límite conservador (Groq free = 30 rpm)
  const GROQ_PAUSE_SEC = 15;   // pausa automática cuando se acerca al límite
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
  const [mt5Equity,      setMt5Equity]      = useState<number|null>(null);
  const [mt5Margin,      setMt5Margin]      = useState<number|null>(null);
  const [mt5FreeMargin,  setMt5FreeMargin]  = useState<number|null>(null);
  const [mt5MarginLevel, setMt5MarginLevel] = useState<number|null>(null);
  const [mt5Positions,   setMt5Positions]   = useState<MT5Position[]>([]);
  const [mt5History,     setMt5History]     = useState<ClosedTrade[]>([]);

  // Indicadores, Wyckoff y control de mercado calculados por activo
  const [indicatorsMap, setIndicatorsMap] = useState<Partial<Record<Asset, Indicators>>>({});
  const [wyckoffMap, setWyckoffMap] = useState<Partial<Record<Asset, WyckoffAnalysis>>>({});
  const [marketControlMap, setMarketControlMap] = useState<Partial<Record<Asset, MarketControl>>>({});

  const toastIdRef = useRef(0);
  const prevPricesRef = useRef(initialPrices);
  const openPositionsRef  = useRef(openPositions);
  const mt5PositionsRef   = useRef(mt5Positions);
  const learningRef = useRef(learning);
  const volumeShockRef = useRef(volumeShock);
  const seriesRef     = useRef(series);
  const candlesRef    = useRef(candles);    // refs para evitar stale closure en setInterval
  const pricesRef     = useRef(prices);
  const candles5mRef  = useRef(candles5m);
  const candles15mRef = useRef(candles15m);

  useEffect(() => { openPositionsRef.current  = openPositions;  }, [openPositions]);
  useEffect(() => { mt5PositionsRef.current   = mt5Positions;   }, [mt5Positions]);
  useEffect(() => { prevPricesRef.current = prices; }, [prices]);
  useEffect(() => { learningRef.current = learning; }, [learning]);
  useEffect(() => { volumeShockRef.current = volumeShock; }, [volumeShock]);
  useEffect(() => { seriesRef.current   = series;    }, [series]);
  useEffect(() => { candlesRef.current   = candles;   }, [candles]);
  useEffect(() => { pricesRef.current    = prices;    }, [prices]);
  useEffect(() => { candles5mRef.current = candles5m; }, [candles5m]);
  useEffect(() => { candles15mRef.current= candles15m;}, [candles15m]);

  // Tick cada segundo
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (openPositionsRef.current.length > 0) evaluatePositionsWithCurrentPrices();
      // Sincronizar posiciones MT5 reales en cada ciclo de autoScan
      if (mt5Enabled && mt5Status === "connected") syncMT5State();
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync inicial al montar — para que liveReady=true desde el arranque
  useEffect(() => {
    void syncRealData();
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

  // Recalcular indicadores y control de mercado al cambiar velas 1m
  useEffect(() => {
    assets.forEach(a => {
      const c = (candles[a] ?? []).filter(x => x.c > 0 && x.h > 0 && x.l > 0);
      if (c.length > 25) {
        try {
          const ind = computeIndicators(c);
          // Guard NaN: si vwap es NaN las velas son malas, ignorar
          if (isNaN(ind.vwap) || !isFinite(ind.vwap)) return;
          setIndicatorsMap(prev => ({ ...prev, [a]: ind }));
          const atrForControl = Math.max(calcAtrFromSeries(c.map(x=>x.c), 20), getAssetMinAtr(a));
          setMarketControlMap(prev => ({ ...prev, [a]: analyzeMarketControl(c, ind, atrForControl) }));
        } catch { /* velas malformadas — ignorar hasta próxima sync */ }
      }
    });
  }, [candles]);

  // Recalcular Wyckoff macro solo cuando cambian velas 4H o 1D reales del bridge
  // Solo para modo intradía — no afecta scalping
  useEffect(() => {
    assets.forEach(a => {
      const c4h = (candles4h[a] ?? []).filter(x => x.c > 0);
      const c1d = (candles1d[a] ?? []).filter(x => x.c > 0);
      try {
        if (c4h.length >= 20 || c1d.length >= 10) {
          setWyckoffMap(prev => ({ ...prev, [a]: analyzeWyckoff(c4h, c1d) }));
        } else {
          setWyckoffMap(prev => ({
            ...prev,
            [a]: {
              phase: "unknown", bias: "neutral", events: [],
              supportZone: null, resistanceZone: null, volumeClimaxIdx: [],
              narrative: "Esperando velas 4H/1D del bridge MT5...",
              wyckoffLotMult: 1.0, tf4h: null, tf1d: null,
            },
          }));
        }
      } catch(e) { console.error("[Wyckoff]", a, e); }
    });
  }, [candles4h, candles1d]);

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
    // Probar modelos en orden hasta encontrar uno activo
    const CANDIDATES = [
      "llama3-70b-8192",
      "llama3-8b-8192",
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "gemma2-9b-it",
      "mixtral-8x7b-32768",
    ];
    let chosenModel = "";
    let lastStatus = 0;
    let lastDetail = "";
    for (const candidate of CANDIDATES) {
      try {
        const r = await fetch("/api/groq", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
          body: JSON.stringify({ model: candidate, temperature: 0, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        });
        lastStatus = r.status;
        if (r.status === 401) { lastDetail = "API key inválida"; break; }
        if (r.status === 429) {
          // Pausa automática de 60s cuando Groq devuelve 429
          groqPausedRef.current = true;
          const pauseUntil = Date.now() + 60000;
          setGroqRateInfo(p => ({ ...p, paused: true, pauseUntil }));
          setTimeout(() => { groqPausedRef.current = false; setGroqRateInfo(p => ({ ...p, paused: false, pauseUntil: 0 })); }, 60000);
          lastDetail = "Rate limit 429 — pausa automática 60s";
          break;
        }
        if (r.ok) { chosenModel = candidate; break; }
        try { const d = await r.json(); lastDetail = d?.error?.message ?? `HTTP ${r.status}`; } catch { lastDetail = `HTTP ${r.status}`; }
      } catch (fetchErr) {
        lastDetail = fetchErr instanceof Error ? fetchErr.message : "fetch error";
        break; // Error de red — no tiene sentido probar más modelos
      }
    }
    try {
      if (!chosenModel) throw new Error(lastDetail || `Ningún modelo disponible (último HTTP ${lastStatus})`);
      setGroqModel(chosenModel);
      setAiLatency(Date.now() - t0); setAiStatus("ok");
      pushToast(`✅ Groq OK — ${chosenModel} — ${Date.now() - t0}ms`, "success");
    } catch (e) {
      setAiStatus("error");
      const msg = e instanceof Error ? e.message : String(e);
      // "Failed to fetch" = CORS o sin internet
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        pushToast("❌ Groq: sin conexión o CORS bloqueado. Verificá internet.", "error");
      } else {
        pushToast(`❌ Groq: ${msg}`, "error");
      }
    }
  }

    // spreadByAsset — usa spread REAL del broker (MT5/PrimeXBT) cuando está disponible.
  // Fallback: spread estimado por calcCFDSpread (sesión + volatilidad) si bridge no entregó datos.
  const spreadByAsset = useMemo(() => {
    const m = {} as Record<Asset, number>;
    assets.forEach(a => {
      const real = mt5SpreadMap[a];
      // spread real = bid-ask absoluto directo de MT5
      m[a] = real ? real.spread : (getSpreadPct(a, volumeShock) / 100) * prices[a];
    });
    return m;
  }, [prices, volumeShock, mt5SpreadMap]);

  // spreadSnapshot — para UI: usa datos reales del bridge si existen
  const spreadSnapshot = useMemo(() => {
    const m = {} as Record<Asset, SpreadSnapshot>;
    assets.forEach(a => {
      const real = mt5SpreadMap[a];
      if (real) {
        // Construir SpreadSnapshot desde datos reales del broker
        const spreadPct = real.spread_pct;
        const base = spreadPct * 0.6 / 100 * prices[a];  // aprox 60% base, resto sesión+vol
        m[a] = {
          spread: real.spread, spreadPct, bid: real.bid, ask: real.ask,
          component: { base, volume: real.spread * 0.2, session: real.spread * 0.2 },
          sessionLabel: "MT5", isHighVolume: spreadPct > 0.05,
        };
      } else {
        m[a] = calcCFDSpread(a, prices[a], volumeShock);
      }
    });
    return m;
  }, [prices, volumeShock, mt5SpreadMap]);

  // getLeverage — leverage real del broker si está disponible, fallback a hardcodeado
  const getLeverage = (asset: Asset): number =>
    mt5LeverageMap[asset] ?? leverageByAsset[asset];

  const unrealized = useMemo(() => openPositions.reduce((acc, p) => {
    const mark = prices[p.signal.asset];
    const spread = spreadByAsset[p.signal.asset];
    const eff = p.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
    return acc + (p.signal.direction === "LONG" ? eff - p.signal.entry : p.signal.entry - eff) * p.size;
  }, 0), [openPositions, prices, spreadByAsset]);

  // Equity real: usar mt5Equity del broker si está conectado, sino el simulado
  const equity = (mt5Enabled && mt5Equity !== null && mt5Equity > 0)
    ? mt5Equity
    : balance + unrealized;
  const riskMetrics = useMemo(() => calcRiskMetrics(realTrades, balance, 5), [realTrades, balance]);

  const currentIndicators = indicatorsMap[asset] ?? null;
  const currentWyckoff = wyckoffMap[asset] ?? null;

  // Order Flow en tiempo real para el activo/modo seleccionado
  const currentOF = useMemo(() => {
    if (tab !== "scalping") return null;
    const c = candles[asset];
    const ind = currentIndicators;
    if (!c?.length || !ind) return null;
    return analyzeOrderFlow(c, prices[asset] ?? 0, ind.vwap, calcAtrFromSeries(series[asset] ?? [], 20));
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
    const c = candles[asset] ?? [];
    return c.length > 0 ? c : deriveSyntheticCandles(series[asset] ?? []);
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
    const minTrades = real.length;
    const floorAdjust = minTrades >= 10 ? clamp(52 + (0.5 - wr) * 16, 48, 62) : 52;
    // ── AssetEdge legacy ──────────────────────────────────────────────────────
    const assetEdge: Partial<Record<string, AssetEdge>> = { ...learningRef.current.assetEdge };
    real.forEach(t => {
      const key = `${t.asset}_${t.mode}`;
      if (!assetEdge[key]) assetEdge[key] = { wins: 0, total: 0, pnl: 0, byHour: {} };
      const ae = assetEdge[key]!;
      ae.total++; if (t.pnl > 0) ae.wins++; ae.pnl += t.pnl;
      const h = new Date(t.closedAt).getHours();
      ae.byHour[h] = (ae.byHour[h] ?? 0) + t.pnl;
    });
    setLearning({
      riskScale: clamp(0.8 + wr * 0.6 + Math.max(exp, 0) * 0.03, 0.7, 1.5),
      confidenceFloor: floorAdjust,
      scalpingTpAtr: clamp(2.0 + wr * 0.8, 1.8, 3.2),
      intradayTpAtr: clamp(4.5 + wr * 1.5, 4.0, 7.0),
      atrTrailMult: clamp(0.25 + wr * 0.3, 0.2, 0.6),
      hourEdge, assetEdge,
    });
    // ── AssetIntelligence: reconstruir desde cero con todos los trades reales ─
    const intelMap: Record<string, AssetIntelligence> = {};
    real.forEach(t => {
      const sym = t.asset;
      if (!intelMap[sym]) {
        intelMap[sym] = {
          symbol: sym, category: getAssetCategory(sym),
          totalTrades: 0, winRate: 0, avgRR: 0, avgPnl: 0, profitFactor: 1,
          sessionStats: {}, modeStats: {}, hourlyStats: {},
          optimalSLMult: 1.0, optimalTPMult: 2.0,
          avgSpreadPct: getAssetCatalog(sym).spreadPct,
          spreadByHour: {}, avgVolatility: 0, trendStrength: 0,
          bestMode: "scalping", bestSession: "NY", bestHourUTC: 14,
          correlations: assetIntelRef.current[sym]?.correlations ?? {},
          lastUpdated: new Date().toISOString(),
        };
      }
      const intel = intelMap[sym];
      intel.totalTrades++;
      if (t.pnl > 0) {
        // wins se computa al final con totalTrades
      }
      intel.avgPnl = (intel.avgPnl * (intel.totalTrades-1) + t.pnl) / intel.totalTrades;
      // Session
      const sess = t.closedAt ? (() => {
        const h = new Date(t.closedAt).getUTCHours();
        const d = new Date(t.closedAt).getUTCDay();
        if (d === 0 || d === 6) return "Weekend";
        if (h >= 13 && h < 21) return "NY";
        if (h >= 7  && h < 16) return "London";
        if (h >= 0  && h < 7 ) return "Asia";
        return "Post-NY";
      })() : "NY";
      const ss = intel.sessionStats[sess] ?? { trades:0, wins:0, pnl:0, avgSpread:0 };
      intel.sessionStats[sess] = { trades:ss.trades+1, wins:ss.wins+(t.pnl>0?1:0), pnl:ss.pnl+t.pnl, avgSpread:ss.avgSpread };
      // Mode
      const ms = intel.modeStats[t.mode] ?? { trades:0, wins:0, pnl:0, avgRR:0 };
      intel.modeStats[t.mode] = { trades:ms.trades+1, wins:ms.wins+(t.pnl>0?1:0), pnl:ms.pnl+t.pnl, avgRR:ms.avgRR };
      // Hour
      const h = new Date(t.closedAt).getUTCHours();
      const hs = intel.hourlyStats[h] ?? { trades:0, wins:0, pnl:0 };
      intel.hourlyStats[h] = { trades:hs.trades+1, wins:hs.wins+(t.pnl>0?1:0), pnl:hs.pnl+t.pnl };
    });
    // Finalizar métricas derivadas
    Object.values(intelMap).forEach(intel => {
      const allWins = Object.values(intel.sessionStats).reduce((s,v)=>s+v.wins,0);
      intel.winRate = intel.totalTrades > 0 ? allWins / intel.totalTrades : 0;
      const grossProfit = Object.values(intel.sessionStats).reduce((s,v)=>s+(v.pnl>0?v.pnl:0),0);
      const grossLoss   = Math.abs(Object.values(intel.sessionStats).reduce((s,v)=>s+(v.pnl<0?v.pnl:0),0));
      intel.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 3 : 1;
      // Best session
      const sessEntries = Object.entries(intel.sessionStats);
      if (sessEntries.length) {
        intel.bestSession = sessEntries.sort((a,b)=>(b[1].pnl/Math.max(b[1].trades,1))-(a[1].pnl/Math.max(a[1].trades,1)))[0][0];
      }
      // Best mode
      const modeEntries = Object.entries(intel.modeStats);
      if (modeEntries.length) {
        intel.bestMode = modeEntries.sort((a,b)=>(b[1].pnl/Math.max(b[1].trades,1))-(a[1].pnl/Math.max(a[1].trades,1)))[0][0];
      }
      // Best hour
      const hourEntries = Object.entries(intel.hourlyStats);
      if (hourEntries.length) {
        intel.bestHourUTC = Number(hourEntries.sort((a,b)=>(b[1].pnl/Math.max(b[1].trades,1))-(a[1].pnl/Math.max(a[1].trades,1)))[0][0]);
      }
    });
    assetIntelRef.current = intelMap;
    setAssetIntelligence(intelMap);
  }


// ══════════════════════════════════════════════════════════════════════════════
// ─── FUNCIONES DE ANÁLISIS TÉCNICO ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── getAssetMinAtr ────────────────────────────────────────────────────────────
// ── deriveSyntheticCandles: genera velas OHLC desde serie de precios ─────────
function deriveSyntheticCandles(prices: number[]): Candle[] {
  if (!prices.length) return [];
  const now = Math.floor(Date.now() / 1000);
  return prices.map((p, i) => {
    const prev = prices[i - 1] ?? p;
    const noise = p * 0.0003;
    return {
      t: now - (prices.length - i) * 60,
      o: prev,
      h: Math.max(prev, p) + noise,
      l: Math.min(prev, p) - noise,
      c: p,
      v: 100 + Math.random() * 200,
    };
  });
}


// ── getSpreadPct: spread estimado % para activo (fallback sin bridge) ─────────
function getSpreadPct(asset: Asset, shock: number): number {
  // 1. Spread del catálogo fine-tuned (si existe)
  const catalog = ASSET_CATALOG[asset];
  const base = catalog?.spreadPct
    ?? CFD_BASE_SPREAD_PCT[asset]
    ?? 0.02; // fallback genérico 0.02%

  // 2. Ajuste por sesión (spread sube fuera de horario prime)
  const session = getSessionProfile().name;
  const sessionMult = session === "Weekend" ? 2.5
    : session === "Post-NY" || session === "Asia — Crypto" ? 1.6
    : 1.0;

  // 3. Ajuste por volatilidad (shock alto = spread mayor en crypto)
  const shockMult = shock > 0.8 ? 1.8 : shock > 0.5 ? 1.35 : shock > 0.3 ? 1.15 : 1.0;

  return base * 100 * sessionMult * shockMult; // retorna en %
}

// ── calcDrawdown: máximo drawdown desde equity curve ─────────────────────────
function calcDrawdown(trades: ClosedTrade[]): number {
  if (trades.length < 2) return 0;
  let peak = 0, maxDD = 0, equity = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function getAssetMinAtr(a: string): number {
  return ASSET_CATALOG[a]?.minAtr ?? 0.0001;
}

// ── calcCFDSpread: spread estimado cuando bridge no entrega datos reales ───────
function calcCFDSpread(asset: string, price: number, shock: number): SpreadSnapshot {
  const session = getSessionProfile();
  const basePct = (ASSET_CATALOG[asset]?.spreadPct ?? CFD_BASE_SPREAD_PCT[asset] ?? 0.002);
  const sessionMult = session.name === "Weekend" ? 2.5
    : (session.name.includes("Post") || session.name.includes("Asia")) ? 1.6 : 1.0;
  const shockMult = shock > 0.8 ? 1.8 : shock > 0.5 ? 1.35 : 1.0;
  const spreadPct = basePct * sessionMult * shockMult;
  const spread = spreadPct * price;
  return {
    spread, spreadPct: spreadPct * 100,
    bid: price - spread / 2, ask: price + spread / 2,
    component: { base: basePct, volume: shockMult - 1, session: sessionMult - 1 },
    sessionLabel: session.name, isHighVolume: spreadPct > 0.0005,
  };
}

// ── computeIndicators: calcula todos los indicadores técnicos desde velas ─────
function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const vols   = candles.map(c => c.v);
  const n = closes.length;

  // RSI(14)
  function calcRsi(arr: number[], p = 14): number {
    if (arr.length < p + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = arr.length - p; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    return 100 - 100 / (1 + rs);
  }

  // Stochastic(14,3)
  function calcStoch(cls: number[], hi: number[], lo: number[], p = 14): [number, number] {
    if (cls.length < p) return [50, 50];
    const slice = cls.slice(-p);
    const hiS = Math.max(...hi.slice(-p));
    const loS = Math.min(...lo.slice(-p));
    const k = loS === hiS ? 50 : ((cls[cls.length - 1] - loS) / (hiS - loS)) * 100;
    const kPrev = loS === hiS ? 50 : ((cls[cls.length - 2] - loS) / (hiS - loS)) * 100;
    return [k, (k + kPrev) / 2];
  }

  // EMA wrapper
  const maFor = (p: number) => ema(closes, p);

  // VWAP
  const totalVolume = vols.reduce((a, b) => a + b, 0) || 1;
  const vwap = candles.reduce((s, c) => s + ((c.h + c.l + c.c) / 3) * c.v, 0) / totalVolume;

  // Bollinger Bands (20, 2)
  const ma20 = maFor(20);
  const slice20 = closes.slice(-20);
  const bbStd = std(slice20);
  const bbUpper = ma20 + 2 * bbStd;
  const bbLower = ma20 - 2 * bbStd;
  const bbMiddle = ma20;

  // Keltner (20, 1.5*ATR)
  const atr = calcAtr(candles, 14);
  const keltnerUpper = ma20 + 1.5 * atr;
  const keltnerLower = ma20 - 1.5 * atr;
  const bbSqueeze = bbUpper < keltnerUpper && bbLower > keltnerLower;

  // VWAP bands (1σ, 2σ)
  const vwapStd = std(closes.slice(-20));
  const vwapUpperBand1 = vwap + vwapStd;
  const vwapLowerBand1 = vwap - vwapStd;
  const vwapUpperBand2 = vwap + 2 * vwapStd;
  const vwapLowerBand2 = vwap - 2 * vwapStd;

  // Volume delta (aprox: verde=compra, rojo=venta)
  const buyVol  = candles.slice(-20).filter(c => c.c >= c.o).reduce((s, c) => s + c.v, 0);
  const sellVol = candles.slice(-20).filter(c => c.c < c.o).reduce((s, c) => s + c.v, 0);
  const totalVol = buyVol + sellVol || 1;
  const volumeDelta = buyVol - sellVol;
  const volumeDeltaPct = (volumeDelta / totalVol) * 100;

  // RSI divergence (simple)
  const rsi = calcRsi(closes);
  const rsiPrev = n > 20 ? calcRsi(closes.slice(0, -5)) : rsi;
  const priceTrend = closes[n - 1] > closes[Math.max(0, n - 6)];
  const rsiTrend = rsi > rsiPrev;
  const rsiDivergence: "bullish" | "bearish" | "none" =
    priceTrend && !rsiTrend ? "bearish" :
    !priceTrend && rsiTrend ? "bullish" : "none";

  // Imbalances (zonas donde bid/ask se cruzaron bruscamente)
  const imbalances: Array<{ idx: number; type: "bullish" | "bearish"; price: number }> = [];
  for (let i = 2; i < Math.min(n, 20); i++) {
    const c = candles[n - i];
    const pct = Math.abs(c.c - c.o) / Math.max(c.o, 0.0001);
    if (pct > 0.003) {
      imbalances.push({ idx: n - i, type: c.c > c.o ? "bullish" : "bearish", price: (c.h + c.l) / 2 });
    }
  }

  const [stochK, stochD] = calcStoch(closes, highs, lows);

  return {
    rsi, rsiDivergence, stochK, stochD,
    ma5: maFor(5), ma10: maFor(10), ma20, ma50: maFor(50),
    vwap, vwapUpperBand1, vwapLowerBand1, vwapUpperBand2, vwapLowerBand2,
    bbUpper, bbMiddle, bbLower, bbSqueeze,
    volumeDelta, volumeDeltaPct,
    imbalances,
    atr, keltnerUpper, keltnerLower,
  };
}

// ── analyzeOrderFlow: genera OrderFlowScore desde velas y datos de mercado ────
function analyzeOrderFlow(
  candles: Candle[], price: number, vwap: number, atr: number
): OrderFlowScore {
  const n = candles.length;
  if (n < 5) return { control: "contested", controlScore: 0, cvdScore: 0, footprintScore: 0 };

  // CVD acumulado últimas 20 velas
  const recent = candles.slice(-20);
  let cvd = 0;
  for (const c of recent) {
    const delta = c.c >= c.o ? c.v : -c.v;
    cvd += delta;
  }
  const maxVol = recent.reduce((s, c) => s + c.v, 0) || 1;
  const cvdScore = clamp((cvd / maxVol) * 100, -100, 100);

  // Footprint: ratio candles alcistas vs bajistas por volumen
  const bullVol = recent.filter(c => c.c >= c.o).reduce((s, c) => s + c.v, 0);
  const bearVol = recent.filter(c => c.c < c.o).reduce((s, c) => s + c.v, 0);
  const footprintScore = clamp(((bullVol - bearVol) / maxVol) * 100, -100, 100);

  // Control neto
  const controlScore = (cvdScore * 0.6 + footprintScore * 0.4);
  const control: "bulls" | "bears" | "contested" =
    controlScore > 20 ? "bulls" : controlScore < -20 ? "bears" : "contested";

  return { control, controlScore, cvdScore, footprintScore };
}

// ── analyzeMarketControl: mapa de control por activo ─────────────────────────
function analyzeMarketControl(
  candles: Candle[], ind: Indicators, atr: number
): { bull: boolean; score: number; reason: string } {
  const price = candles[candles.length - 1]?.c ?? 0;
  let score = 0;
  const reasons: string[] = [];

  if (ind.ma5 > ind.ma20) { score += 20; reasons.push("MA5>MA20"); }
  if (price > ind.vwap)   { score += 15; reasons.push("precio>VWAP"); }
  if (ind.rsi > 55)       { score += 10; reasons.push(`RSI${(ind.rsi ?? 0).toFixed(0)}`); }
  if (ind.volumeDeltaPct > 10) { score += 15; reasons.push("CVD+"); }
  if (ind.bbSqueeze)      { score += 5;  reasons.push("squeeze"); }

  return { bull: score >= 35, score, reason: reasons.join(", ") || "neutral" };
}

// ── analyzeWyckoff: análisis de fases Wyckoff desde velas 4H + 1D ────────────
function analyzeWyckoff(candles4h: Candle[], candles1d: Candle[]): WyckoffAnalysis {
  const neutral: WyckoffAnalysis = {
    phase: "unknown", bias: "neutral",
    events: [], supportZone: null, resistanceZone: null,
  };
  const c = candles4h.length > 0 ? candles4h : candles1d;
  if (c.length < 10) return neutral;

  const closes = c.map(x => x.c);
  const highs  = c.map(x => x.h);
  const lows   = c.map(x => x.l);
  const n = c.length;

  const hiAll = Math.max(...highs);
  const loAll = Math.min(...lows);
  const range = hiAll - loAll || 1;

  // Tendencia macro: últimos 20 vs primeros 20
  const early = avg(closes.slice(0, Math.min(20, Math.floor(n / 2))));
  const late  = avg(closes.slice(-Math.min(20, Math.floor(n / 2))));
  const trend = late > early * 1.02 ? "up" : late < early * 0.98 ? "down" : "flat";

  // Fase simplificada
  const lastClose = closes[n - 1];
  const midRange = loAll + range * 0.5;
  const lowerThird = loAll + range * 0.33;
  const upperThird = loAll + range * 0.66;

  let phase: WyckoffPhase = "unknown";
  let bias: WyckoffBias = "neutral";

  if (trend === "down" && lastClose < midRange) {
    phase = "A"; bias = "accumulation";
  } else if (trend === "flat" && lastClose < midRange) {
    phase = "B"; bias = "accumulation";
  } else if (lastClose < lowerThird && trend !== "up") {
    phase = "C"; bias = "accumulation";
  } else if (trend === "up" && lastClose > midRange) {
    phase = "D"; bias = "accumulation";
  } else if (lastClose > upperThird) {
    phase = "E"; bias = lastClose > hiAll * 0.95 ? "distribution" : "accumulation";
  }

  // Zonas soporte / resistencia
  const supportZone: [number, number] = [loAll, loAll + range * 0.15];
  const resistanceZone: [number, number] = [hiAll - range * 0.15, hiAll];

  // Eventos básicos
  const events: WyckoffEvent[] = [];
  // Spring: mínimo reciente cerca del soporte
  const recentLow = Math.min(...lows.slice(-5));
  if (recentLow <= supportZone[1]) {
    events.push({ label: "Spring", candleIndex: n - lows.slice(-5).indexOf(recentLow) - 1, price: recentLow, color: "#10b981" });
  }

  return { phase, bias, events, supportZone, resistanceZone };
}

// ── calcRiskMetrics: métricas de riesgo y Kelly ───────────────────────────────
function calcRiskMetrics(
  trades: ClosedTrade[], balance: number, maxDailyLossPct: number
): { kellyFraction: number; kellyWR: number; kellyRR: number; ruinProb: number; dailyLossPct: number } {
  if (trades.length < 5) {
    return { kellyFraction: 0, kellyWR: 0, kellyRR: 0, ruinProb: 0, dailyLossPct: 0 };
  }
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const wr     = wins.length / trades.length;
  const avgW   = wins.length  ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length   : 0;
  const avgL   = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
  const rr     = avgL > 0 ? avgW / avgL : 0;
  const kelly  = wr - (1 - wr) / Math.max(rr, 0.01);
  const kellyFraction = Math.max(0, Math.min(kelly * 0.5, 0.25)); // half-Kelly, capped 25%

  // Ruin probability (simple Monte Carlo aprox)
  const ruinProb = Math.max(0, (1 - wr) ** 5 * 100); // prob de 5 losses seguidos

  // Daily loss hoy
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayTrades = trades.filter(t => new Date(t.closedAt) >= todayStart);
  const dailyPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const dailyLossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / balance * 100 : 0;

  return { kellyFraction, kellyWR: wr, kellyRR: rr, ruinProb, dailyLossPct };
}

// ── calcScalpingRisk: racha de pérdidas y métricas de riesgo scalping ─────────
function calcScalpingRisk(
  trades: ClosedTrade[], balance: number, maxDailyLoss: number, maxDailyGain: number
): { streak: number; consecLoss: number; dailyPnl: number; circuitBreaker: boolean } {
  let streak = 0, maxStreak = 0, cur = 0;
  for (const t of [...trades].reverse().slice(0, 20)) {
    if (t.pnl < 0) { cur++; maxStreak = Math.max(maxStreak, cur); }
    else cur = 0;
  }
  streak = maxStreak;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayTrades = trades.filter(t => new Date(t.closedAt) >= todayStart);
  const dailyPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const circuitBreaker = dailyPnl < -Math.abs(maxDailyLoss);

  return { streak, consecLoss: streak, dailyPnl, circuitBreaker };
}


  function getMtfScore(a: Asset, mode: Mode = "intradia") {
    // Usar refs para evitar stale closure (datos del render anterior)
    const vals  = seriesRef.current[a]    ?? [];
    const c5m   = candles5mRef.current[a] ?? [];
    const c15m  = candles15mRef.current[a]?? [];
    const px    = pricesRef.current[a]    ?? prices[a] ?? 0;

    const minLen = mode === "scalping" ? 13 : 20;
    if (!vals || vals.length < minLen) {
      const atrFallback = Math.max(getAssetMinAtr(a) ?? px * 0.001, px * 0.001);
      return { htf: 0, ltf: 0, exec: 0, atr: atrFallback, hasRealTF: false };
    }
    const atr = Math.max(calcAtrFromSeries(vals, 20), getAssetMinAtr(a) ?? px * 0.001);

    if (mode === "scalping") {
      // ── MTF REAL: usa velas 5m y 15m si vienen del bridge ──────────────────
      // Con bridge: HTF = EMA8/21 sobre velas 15m reales, LTF = EMA5/13 sobre 5m reales
      // Sin bridge: sintético (velas 1m agrupadas) — menos preciso
      const real15m = c15m;
      const real5m  = c5m;
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



  // ─── Perfil de sesión: detecta horario y ajusta parámetros automáticamente ───
  // NY semana  → todos los activos, parámetros normales
  // Fuera NY   → solo crypto, SL/TP más conservadores
  // Finde      → solo crypto, parámetros especiales anti-pump
  function getSessionProfile() {
    const now       = new Date();
    const hour      = now.getUTCHours();
    const dow       = now.getUTCDay(); // 0=dom, 6=sab
    const isWeekend = dow === 0 || dow === 6;
    const isNY      = !isWeekend && hour >= 13 && hour < 21;
    const isLondon  = !isWeekend && hour >= 7  && hour < 13;
    const isAsia    = hour >= 0  && hour < 7;

    if (isWeekend) return {
      name:         "Finde — Crypto",
      emoji:        "🪙",
      label:        `Finde semana ${now.toLocaleString("es", { weekday: "short" }).toUpperCase()} ${hour.toString().padStart(2,"0")}:${now.getUTCMinutes().toString().padStart(2,"0")} UTC`,
      isCryptoOnly: true,
      slMult:       1.0,   // SL más ajustado — crypto finde impulsos rápidos
      tp1Mult:      1.0,   // TP1 rápido para asegurar
      tp2Mult:      2.2,   // TP2 moderado (finde = reversiones repentinas)
      confAdjust:   -2,    // piso levemente más permisivo
      spreadTol:    1.25,  // tolerar 25% más spread (liquidez menor)
      maxPositions: 2,     // máximo 2 posiciones crypto simultáneas
      description:  "Mercados cerrados salvo crypto. Bot especializado BTC/ETH.",
    };

    if (isNY) return {
      name:         "NY",
      emoji:        "🗽",
      label:        `NY ${hour.toString().padStart(2,"0")}:${now.getUTCMinutes().toString().padStart(2,"0")} UTC`,
      isCryptoOnly: false,
      slMult:       1.2,
      tp1Mult:      1.2,
      tp2Mult:      2.4,
      confAdjust:   0,
      spreadTol:    1.0,
      maxPositions: 3,
      description:  "Sesión principal. Todos los activos activos.",
    };

    if (isLondon) return {
      name:         "London",
      emoji:        "🏦",
      label:        `London ${hour.toString().padStart(2,"0")}:${now.getUTCMinutes().toString().padStart(2,"0")} UTC`,
      isCryptoOnly: false,
      slMult:       1.1,
      tp1Mult:      1.1,
      tp2Mult:      2.2,
      confAdjust:   0,
      spreadTol:    1.1,
      maxPositions: 3,
      description:  "Sesión London. Oro y crypto activos.",
    };

    if (isAsia) return {
      name:         "Asia — Crypto",
      emoji:        "🌏",
      label:        `Asia ${hour.toString().padStart(2,"0")}:${now.getUTCMinutes().toString().padStart(2,"0")} UTC`,
      isCryptoOnly: true,
      slMult:       0.9,   // Asia = rango lateral → SL ajustado
      tp1Mult:      0.9,
      tp2Mult:      1.8,
      confAdjust:   -3,    // más permisivo, señales menos limpias
      spreadTol:    1.3,
      maxPositions: 2,
      description:  "Sesión Asia. Solo crypto. Rangos laterales frecuentes.",
    };

    // Post-NY (21-00 UTC)
    return {
      name:         "Post-NY — Crypto",
      emoji:        "🌙",
      label:        `Post-NY ${hour.toString().padStart(2,"0")}:${now.getUTCMinutes().toString().padStart(2,"0")} UTC`,
      isCryptoOnly: true,
      slMult:       1.0,
      tp1Mult:      1.0,
      tp2Mult:      2.0,
      confAdjust:   -2,
      spreadTol:    1.2,
      maxPositions: 2,
      description:  "Post cierre NY. Crypto activo con impulsos. Metales cerrados.",
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DETECTOR DE GIRO ANTICIPADO — combina 3 señales de agotamiento
  // Filosofía: el mercado avisa ANTES del giro con divergencias, climax y absorción
  // Wyckoff en 4H/1D es contexto/amplificador, no filtro
  // ═══════════════════════════════════════════════════════════════════════════
  function detectReversalSetup(
    candles: Candle[],
    of: ReturnType<typeof analyzeOrderFlow> | null,
    wyckoff: WyckoffAnalysis | null,
    direction: Direction,  // dirección actual de la tendencia (la que estamos contra)
    atr: number,
  ): { score: number; reversalDir: Direction; components: Record<string, number> } {

    const reversalDir: Direction = direction === "LONG" ? "SHORT" : "LONG";
    // Giramos contra la tendencia actual — buscamos agotamiento del movimiento vigente
    // reversalDir = dirección del giro que anticipamos

    let scoreA = 0, scoreB = 0, scoreC = 0;
    const components: Record<string, number> = {};

    // ── A) CVD DIVERGENCIA con intensidad ─────────────────────────────────
    if (of) {
      const { cvd } = of;
      const priceChange10 = candles.length >= 10
        ? candles[candles.length-1].c - candles[candles.length-10].c : 0;

      // Divergencia alcista (reversal a LONG): precio baja pero CVD sube
      // Divergencia bajista (reversal a SHORT): precio sube pero CVD baja
      const isBullishDiv = priceChange10 < -atr * 0.3 && cvd.slope10 > 0;
      const isBearishDiv = priceChange10 >  atr * 0.3 && cvd.slope10 < 0;
      const hasDivergence = reversalDir === "LONG" ? isBullishDiv : isBearishDiv;

      if (hasDivergence) {
        // Intensidad: ratio entre movimiento del precio y movimiento del CVD
        const divIntensity = Math.abs(cvd.slope10) / Math.max(Math.abs(cvd.slope50) * 0.1, 1e-9);
        scoreA = divIntensity > 2.0 ? 3 : divIntensity > 1.0 ? 2 : 1;
      }
      components.cvdDiv = scoreA;
    }

    // ── B) CLIMAX DE VOLUMEN ───────────────────────────────────────────────
    if (candles.length >= 20) {
      const recent   = candles.slice(-20);
      const lastCandle = candles[candles.length - 1];
      const avgVol   = recent.slice(0, -1).reduce((s, c) => s + c.v, 0) / 19;
      const volRatio = lastCandle.v / Math.max(avgVol, 1e-9);

      // Climax: volumen alto pero precio no avanza (vela con mucha mecha)
      const body    = Math.abs(lastCandle.c - lastCandle.o);
      const range   = Math.max(lastCandle.h - lastCandle.l, atr * 0.1);
      const wickPct = 1 - (body / range);  // % del rango que son mechas

      // Reversal LONG: climax de venta = vela bajista con vol alto + mecha inferior grande
      // Reversal SHORT: climax de compra = vela alcista con vol alto + mecha superior grande
      const isSellingClimax  = lastCandle.c < lastCandle.o && volRatio > 1.8 && wickPct > 0.35;
      const isBuyingClimax   = lastCandle.c > lastCandle.o && volRatio > 1.8 && wickPct > 0.35;
      const hasClimax = reversalDir === "LONG" ? isSellingClimax : isBuyingClimax;

      if (hasClimax) {
        scoreB = volRatio > 3.0 ? 3 : volRatio > 2.2 ? 2 : 1;
      }
      components.volClimax = scoreB;
    }

    // ── C) ABSORCIÓN EN ORDER BOOK (FP extremo sin movimiento) ────────────
    if (of) {
      const { absorptionScore, controlScore } = of;
      // FP extremo en una dirección pero precio absorbe sin moverse = alguien grande compra/vende
      // Absorción alcista: mucha presión vendedora (FP negativo) pero precio no cae
      // Absorción bajista: mucha presión compradora (FP positivo) pero precio no sube
      const priceChange5 = candles.length >= 5
        ? candles[candles.length-1].c - candles[candles.length-5].c : 0;

      const bullishAbsorption = controlScore < -15 && Math.abs(priceChange5) < atr * 0.15;
      const bearishAbsorption = controlScore >  15 && Math.abs(priceChange5) < atr * 0.15;
      const hasAbsorption = reversalDir === "LONG" ? bullishAbsorption : bearishAbsorption;

      if (hasAbsorption) {
        scoreC = absorptionScore > 60 ? 3 : absorptionScore > 35 ? 2 : 1;
      }
      components.absorption = scoreC;
    }

    // ── Multiplicador Wyckoff ──────────────────────────────────────────────
    // Wyckoff alineado con el giro = amplifica. Opuesto = reduce.
    // NO bloquea nada. Solo contexto macro.
    let wyckoffBonus = 0;
    if (wyckoff) {
      const phase = wyckoff.phase;
      const bias  = wyckoff.bias;
      const aligned = (reversalDir === "LONG" && (bias === "bullish" || phase === "C" || phase === "D"))
                   || (reversalDir === "SHORT" && (bias === "bearish" || phase === "C" || phase === "D"));
      const opposed = (reversalDir === "LONG"  && bias === "bearish")
                   || (reversalDir === "SHORT" && bias === "bullish");
      wyckoffBonus = aligned ? 1 : (opposed ? -1 : 0);
    }
    components.wyckoffBonus = wyckoffBonus;

    const rawScore = scoreA + scoreB + scoreC;
    const score    = clamp(rawScore + wyckoffBonus, 0, 9);

    return { score, reversalDir, components };
  }

  // ── Calcular wyckoffSizeMult para scalping y intradía ────────────────────
  function getWyckoffSizeMult(wyckoff: WyckoffAnalysis | null, direction: Direction): number {
    if (!wyckoff) return 1.0;
    const { phase, bias, events } = wyckoff;

    // Spring (fase C acumulación) o Upthrust (fase C distribución) = máxima convicción de giro
    const hasSpring    = events?.some(e => e.type === "spring")   ?? false;
    const hasUpthrust  = events?.some(e => e.type === "upthrust") ?? false;
    const hasSOS       = events?.some(e => e.type === "SOS")      ?? false;
    const hasSOW       = events?.some(e => e.type === "SOW")      ?? false;

    // Fase C con evento confirmado: tamaño máximo (1.5×)
    if (phase === "C") {
      if (direction === "LONG"  && (hasSpring   || bias === "bullish")) return 1.5;
      if (direction === "SHORT" && (hasUpthrust || bias === "bearish")) return 1.5;
    }
    // Fase D/E en tendencia: tamaño ampliado (1.3×) — tendencia confirmada con SOS/SOW
    if (phase === "D" || phase === "E") {
      if (direction === "LONG"  && (bias === "bullish" || hasSOS)) return 1.3;
      if (direction === "SHORT" && (bias === "bearish" || hasSOW)) return 1.3;
    }
    // Fase A/B: mercado en rango, estructura no definida → tamaño reducido
    if (phase === "A" || phase === "B") return 0.8;

    // Wyckoff contradictorio (tendencia opuesta a dirección) → reducir
    const opposed = (direction === "LONG"  && bias === "bearish")
                 || (direction === "SHORT" && bias === "bullish");
    if (opposed) return 0.6;

    // Alineado pero sin evento confirmado
    const aligned = (direction === "LONG"  && bias === "bullish")
                 || (direction === "SHORT" && bias === "bearish");
    if (aligned) return 1.15;

    return 1.0;
  }

  function generateSignal(currentMode: Mode, currentAsset: Asset): Signal {
    // Leer SIEMPRE de refs (no del closure state) para evitar stale data
    // Los refs se actualizan sincrónicamente en cada render via useEffect
    const _prices    = pricesRef.current;
    const _series    = seriesRef.current;
    const _candles   = candlesRef.current;
    const _c5m       = candles5mRef.current;
    const _c15m      = candles15mRef.current;

    const price = _prices[currentAsset];
    if (!price || price <= 0) {
      console.warn(`[TraderLab] generateSignal: sin precio para ${currentAsset} — bridge ok?`);
    }
    const spreadPct = getSpreadPct(currentAsset, volumeShock);
    const spread = (spreadPct / 100) * price;
    const mtf = getMtfScore(currentAsset, currentMode);
    const ind = indicatorsMap[currentAsset] ?? computeIndicators(_candles[currentAsset] ?? []);
    // Wyckoff: solo en intradía, solo del wyckoffMap (calculado desde velas 4H/1D reales)
    // En scalping: se omite completamente — Order Flow es la autoridad
    const wyckoff = currentMode === "intradia"
      ? (wyckoffMap[currentAsset] ?? {
          bias: "neutral" as const, phase: "unknown" as const, events: [],
          supportZone: null, resistanceZone: null, volumeClimaxIdx: [],
          narrative: "Sin datos 4H/1D del bridge.", wyckoffLotMult: 1.0, tf4h: null, tf1d: null,
        })
      : { bias: "neutral" as const, phase: "unknown" as const, events: [],
          supportZone: null, resistanceZone: null, volumeClimaxIdx: [],
          narrative: "N/A (scalping)", wyckoffLotMult: 1.0, tf4h: null, tf1d: null };
    const lrn = learningRef.current;

    // ── Scalping: dirección determinada por control de mercado ────────────────
    // En scalping: Order Flow es la autoridad. MTF confirma, no dicta.
    const price0 = _series[currentAsset]?.[_series[currentAsset].length-1] ?? 0;
    const of = currentMode === "scalping"
      ? analyzeOrderFlow(_candles[currentAsset] ?? [], price0, ind.vwap, mtf.atr)
      : null;
    const mc = currentMode === "scalping"
      ? (marketControlMap[currentAsset] ?? analyzeMarketControl(_candles[currentAsset] ?? [], ind, mtf.atr))
      : null;

    // ── Detección de giro anticipado ─────────────────────────────────────────
    // Corre ANTES de decidir dirección — puede sobreescribir el bias del OF/MTF
    // ── Dirección primaria: OF > MC > MTF (el reversal ajustará después) ───────
    let mtfDir: Direction;
    if (currentMode === "scalping" && of) {
      // Prioridad 1: mean reversion desde extremo — adelantarse al rebote
      const isOversold   = of.narrative.includes("bajo VAL") || of.narrative.includes("aceptación bajista");
      const isOverbought = of.narrative.includes("sobre VAH") || of.narrative.includes("aceptación alcista");
      if (of.longSetup && isOversold && of.cvd.divergence) {
        mtfDir = "LONG";  // rebote desde sobreventa con divergencia
      } else if (of.shortSetup && isOverbought && of.cvd.divergence) {
        mtfDir = "SHORT"; // rebote desde sobrecompra con divergencia
      // Prioridad 2: momentum con control claro
      } else if (of.control === "bulls" && of.longSetup)  mtfDir = "LONG";
      else if   (of.control === "bears" && of.shortSetup) mtfDir = "SHORT";
      else if   (mc && mc.bias !== "neutral")              mtfDir = mc.bias === "bull" ? "LONG" : "SHORT";
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

    // ── Reversal anticipatorio: corre con direction base, puede sobreescribirla ──
    // detectReversalSetup recibe la dirección ACTUAL de la tendencia para buscar su agotamiento
    // Si score ≥ 5: alta convicción de giro → sobreescribir dirección
    // Si score 3-4: señal débil → solo boost de confianza, no cambia dirección
    const reversalData = detectReversalSetup(
      _candles[currentAsset] ?? [],
      of,
      wyckoff,
      direction,
      baseAtr,
    );
    // Sobreescribir dirección si hay setup de giro con alta convicción
    const finalDirection: Direction = reversalData.score >= 5
      ? reversalData.reversalDir
      : direction;

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
      52                                                          // base ligeramente más alta
      + mtfStrength * 8
      + (confirmed ? confirmStrength * 18 : -3)                  // penalización leve si no confirma
      + (ind.rsiDivergence !== "none" ? 5 : 0)
      + mcScore
      + ofSetupBonus
      - divergencePenalty
      - (mcConflict ? 8 : 0)                                     // reducido de 15 → 8
      + (currentMode === "intradia" && wyckoff.bias !== "neutral" ? 5 : 0)
      - (currentMode === "scalping" ? spreadPct * 30 : spreadPct * 12)  // reducido de 55/20
      - (spreadCostRatio > 0.5 ? 6 : spreadCostRatio > 0.35 ? 3 : 0),  // umbral más alto
      46, 96                                                      // mínimo 46 (era 50)
    );

    // ── Paso 5: Sizing — Wyckoff como multiplicador solo en intradía ──────────
    const wyckoffMult = currentMode === "intradia" ? (wyckoff as WyckoffAnalysis & { wyckoffLotMult?: number }).wyckoffLotMult ?? 1.0 : 1.0;

    const entry = direction === "LONG" ? price + spread / 2 : price - spread / 2;
    const baseAtr = mtf.atr;
    // ── SL: bajo/sobre el swing más reciente + buffer ATR ───────────────────
    // Multiplicadores ajustados por sesión (crypto finde vs NY institucional)
    const prof    = getSessionProfile();
    const slMult  = currentMode === "scalping" ? prof.slMult  : 3.0;
    const tp1Mult = currentMode === "scalping" ? prof.tp1Mult : 2.0;
    const tp2Mult = currentMode === "scalping" ? prof.tp2Mult : 5.0;
    // Para scalping: buscar swing low/high reciente en las últimas 8 velas
    const recentC = _candles[currentAsset]?.slice(-8) ?? [];
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

    // ── TPs escalonados: scalping = TP1 + TP2, intradía = TP1 + TP2 + TP3 ─────
    // Scalping: TP1 = 1.2×ATR (rápido, asegurar), TP2 = 2.4×ATR (completo)
    // Intradía: TP1 = 2.0×ATR, TP2 = 4.0×ATR, TP3 = 6.0×ATR (extensión)
    let tp1: number, tp2: number, tp3: number | undefined;
    const dir = finalDirection;

    if (currentMode === "scalping") {
      const tp1Dist = baseAtr * tp1Mult;   // varía por sesión (finde: 1.0, NY: 1.2)
      const tp2Dist = baseAtr * tp2Mult;   // varía por sesión (finde: 2.2, NY: 2.4)
      // Anclar al perfil de volumen si está disponible
      const mcVah = mc?.vah ?? entry + tp2Dist;
      const mcVal = mc?.val ?? entry - tp2Dist;
      tp1 = dir === "LONG"
        ? entry + tp1Dist
        : entry - tp1Dist;
      tp2 = dir === "LONG"
        ? Math.max(mcVah, entry + tp2Dist)
        : Math.min(mcVal, entry - tp2Dist);
    } else {
      // Intradía: niveles 2×, 4× y 6× ATR
      const t1m = lrn.intradayTpAtr * 0.4;  // ~2×ATR
      const t2m = lrn.intradayTpAtr;          // ~5×ATR
      const t3m = lrn.intradayTpAtr * 1.6;  // ~8×ATR
      tp1 = dir === "LONG" ? entry + baseAtr * t1m : entry - baseAtr * t1m;
      tp2 = dir === "LONG" ? entry + baseAtr * t2m : entry - baseAtr * t2m;
      tp3 = dir === "LONG" ? entry + baseAtr * t3m : entry - baseAtr * t3m;
    }
    const takeProfit = tp2; // alias principal = TP final

    // ── Costo real del spread (en USD) — CfD: sin comisión, solo spread ──────
    // Spread real viene del bridge MT5 cuando está conectado, sino se estima
    const realSpreadPct = mt5SpreadMap[currentAsset]?.spread_pct ?? spreadPct;
    const contractSz    = contractSize[currentAsset] ?? 1;
    const lotSize       = 1; // referencia 1 lote para el costo unitario
    const spreadCostUsd = (realSpreadPct / 100) * entry * contractSz * lotSize;

    // ── Paso 6: Rationale ─────────────────────────────────────────────────────
    const mtfCtx = `HTF ${(mtf.htf ?? 0).toFixed(2)} / LTF ${(mtf.ltf ?? 0).toFixed(2)} / Exec ${(mtf.exec ?? 0).toFixed(2)}`;
    const confirmCtx = bestConfirm ? `Confirmación: ${bestConfirm.name} (${(bestConfirm.strength * 100).toFixed(0)}%)` : "Sin confirmación adicional";
    const wyckoffCtx = currentMode === "intradia" && wyckoff.bias !== "neutral"
      ? ` | Wyckoff ${wyckoff.bias === "accumulation" ? "Acum" : "Dist"} F${wyckoff.phase} mult×${wyckoffMult.toFixed(2)}` : "";
    // En scalping: el rationale comienza con el control de mercado (quién manda)
    const controlLabel = (of && currentMode === "scalping")
      ? (of.control === "bulls" ? "🟢 TOROS" : of.control === "bears" ? "🔴 OSOS" : "⚪ DISPUTADO")
      : "";
    const cvdArrow = of ? (of.cvd.trend === "bullish" ? "↑" : of.cvd.trend === "bearish" ? "↓" : "→") : "";
    const mcCtx = (of && currentMode === "scalping")
      ? ` | OF: ${controlLabel} score=${(of.controlScore ?? 0).toFixed(0)} CVD${cvdArrow} FP=${(of.footprintScore ?? 0).toFixed(0)} Vol=${price>of.profile.poc?"▲POC":"▼POC"}`
      : (mc ? ` | Control: ${mc.dominantSide} (${(mc.score ?? 0).toFixed(0)}) CVD${mc.cvdSlope>=0?"↑":"↓"} POC:${(mc.poc ?? 0).toFixed(2)}` : "");
    const rationale = currentMode === "scalping"
      ? `${controlLabel} ${finalDirection} | CVD${cvdArrow} FP:${of?.footprintScore.toFixed(0)??"?"} | ${confirmCtx}${mcCtx}`
      : `${finalDirection} | ${mtfCtx} | ${confirmCtx}${wyckoffCtx}${mcCtx}`;

    // ── Bonus/penalidad por historial de asset+modo ─────────────────────────
    const aeKey = `${currentAsset}_${currentMode}`;
    const ae    = learningRef.current.assetEdge[aeKey];
    let aeBonus = 0;
    if (ae && ae.total >= 5) {
      const aeWr = ae.wins / ae.total;
      aeBonus = clamp((aeWr - 0.5) * 20, -8, 8); // ±8 puntos según historial del activo
    }
    // Sanitizar: si algo se volvió NaN (ej. ema de array vacío), usar base 52
    const safeConf = isNaN(confidence) || !isFinite(confidence) ? 52 : confidence;
    const finalConfidence = clamp(safeConf + aeBonus, 40, 96);

    // ── Reversal setup: detectar agotamiento de la tendencia opuesta ──────────
    // "finalDirection" es hacia donde va el bot — detectamos agotamiento de ESA dirección
    // para saber si hay un giro inminente EN CONTRA (reversalDir = opuesto)
    // También usamos direction=finalDirection para detectar si la tendencia actual está agotada
    const wyckoffSizeMult = getWyckoffSizeMult(wyckoff, finalDirection);

    // Boost de confianza si el setup tiene score de reversión alto y va a favor
    // (el bot ya eligió esta dirección — si hay reversal score es señal de convicción)
    const reversalBoost = reversalData.score >= 7 ? 8
                        : reversalData.score >= 5 ? 4
                        : reversalData.score >= 3 ? 1 : 0;
    const boostedConfidence = clamp(finalConfidence + reversalBoost, 40, 98);

    return {
      asset: currentAsset, mode: currentMode, finalDirection, entry, stopLoss,
      takeProfit, tp1, tp2, tp3,
      confidence: boostedConfidence, spreadPct, spreadCostUsd, atr: baseAtr, mtf,
      indicators: ind, wyckoff, rationale,
      reversalScore:     reversalData.score,
      reversalDir:       reversalData.reversalDir,
      isReversalSetup:   reversalData.score >= 5,
      wyckoffSizeMult,
      isPyramidAdd:      false,
    } as Signal & { _wyckoffMult?: number };
  }

  // ── IA: trader experto con master en estadística ──
  // ── Rate limiter: controla que no supere GROQ_MAX_RPM ──────────────────────
  function canCallGroq(): boolean {
    const now = Date.now();
    // Si está en pausa manual o automática
    if (groqPausedRef.current) return false;
    if (groqRateInfo.pauseUntil > now) return false;
    // Limpiar llamadas que tienen más de 60 segundos
    groqCallsRef.current = groqCallsRef.current.filter(t => now - t < 60000);
    return groqCallsRef.current.length < GROQ_MAX_RPM;
  }

  function trackGroqCall() {
    const now = Date.now();
    groqCallsRef.current.push(now);
    groqCallsRef.current = groqCallsRef.current.filter(t => now - t < 60000);
    const calls = groqCallsRef.current.length;
    // Pausa automática si está a 3 llamadas del límite
    if (calls >= GROQ_MAX_RPM - 3) {
      const pauseUntil = now + GROQ_PAUSE_SEC * 1000;
      setGroqRateInfo({ calls, paused: true, pauseUntil });
      setTimeout(() => setGroqRateInfo(p => ({ ...p, paused: false, pauseUntil: 0 })), GROQ_PAUSE_SEC * 1000);
      pushToast(`⏸ Groq pausado ${GROQ_PAUSE_SEC}s — ${calls}/${GROQ_MAX_RPM} rpm`, "warning");
    } else {
      setGroqRateInfo({ calls, paused: false, pauseUntil: 0 });
    }
  }

  async function aiDecision(signal: Signal): Promise<"OPEN" | "SKIP" | "WAIT"> {
    const lrn = learningRef.current;
    if (!usingGroq || !apiKey.trim()) {
      const floor = signal.mode === "scalping"
        ? Math.max(46, lrn.confidenceFloor - 6)
        : Math.max(50, lrn.confidenceFloor - 2);
      return signal.confidence >= floor ? "OPEN" : "SKIP";
    }
    // Rate limit check — si está pausado, usar decisión local
    if (!canCallGroq()) {
      const floor = signal.mode === "scalping"
        ? Math.max(46, lrn.confidenceFloor - 6)
        : Math.max(50, lrn.confidenceFloor - 2);
      return signal.confidence >= floor ? "OPEN" : "SKIP";
    }
    try {
      // ── Métricas de gestión de riesgo para el prompt ────────────────────────
      const lrnSnap     = learningRef.current;
      const equitySnap  = (mt5Enabled && mt5Equity !== null && mt5Equity > 0) ? mt5Equity : balance + unrealized;
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
        ? `${(riskSnap.kellyFraction * 100).toFixed(1)}% (WR ${(riskSnap.kellyWR*100).toFixed(0)}% / RR ${(riskSnap.kellyRR ?? 0).toFixed(2)})`
        : "insuficiente data";
      const consecLoss = calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain).streak;
      const ruinPct    = (riskSnap.ruinProb ?? 0).toFixed(1);
      // Con pocos trades, el EV histórico no es representativo — usar RR del motor
      const fewTrades  = stats.total < 15;
      const evSign     = fewTrades
        ? "N/A (insufficient history — use RR and confidence)"
        : parseFloat(expectedValue) >= 0 ? "POSITIVE ✓" : "NEGATIVE ✗";

      const systemPrompt = `You are an algorithmic trading system managing a REAL funded account.

IDENTITY AND MANDATE:
- You manage $${initialCap} USDT of real capital. Every dollar lost is permanent until earned back.
- The initial capital ($${initialCap}) is the absolute floor — if equity approaches it, you stop trading.
- Your mandate: GROW capital with controlled risk. Not preserve it at all costs, not gamble it.
- You are NOT risk-averse — you are RISK-CALIBRATED. Edge × frequency = profit.

${fewTrades ? "⚠ COLD START MODE (< 15 real trades): Statistical metrics (EV, Kelly) are NOT reliable yet. Base decision primarily on RR ratio and signal confidence score. DO NOT skip valid setups due to negative EV when sample is too small." : ""}

ACCOUNT STATE RIGHT NOW:
- Equity: $${equitySnap.toFixed(2)} USDT | Initial capital: $${initialCap} USDT
- Drawdown from peak: ${currentDD}% (hard limit: 5% daily, 15% overall)
- Ruin probability next 30 trades: ${ruinPct}% (below 20% = healthy, above 50% = reduce size)
- Consecutive losses: ${consecLoss} (above 5 = mandatory pause)
- Expected value per trade: $${expectedValue} [${evSign}]
- Kelly optimal fraction: ${kellyStr}
- Win rate: ${(stats.winRate ?? 0).toFixed(1)}% | Profit factor: ${(stats.profitFactor ?? 0).toFixed(2)} | Sharpe: ${(stats.sharpe ?? 0).toFixed(2)}
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
Entry: ${(signal.entry ?? 0).toFixed(4)} | SL: ${(signal.stopLoss ?? 0).toFixed(4)} | TP: ${(signal.takeProfit ?? 0).toFixed(4)}
RR: ${rrRatio.toFixed(2)}:1 [${rrQuality}] | Risk USDT: $${(equitySnap * riskPerTrade).toFixed(3)}
Expected value if opened: $${expectedValue} [${evSign}]
Confidence: ${(signal.confidence ?? 0).toFixed(1)}% | Kelly suggests: ${riskSnap.kellyFraction > 0.01 ? "OPEN" : "SKIP (no edge)"}

CFD SPREAD (broker cobra spread, no comisión):
- Spread: $${spreadCostA.toFixed(4)} (${(sigSpread.spreadPct ?? 0).toFixed(3)}%) | Sesión: ${sigSpread.sessionLabel} | Vol alta: ${sigSpread.isHighVolume ? "SÍ ⚠" : "no"}
- Spread vs TP: ${spreadRatioTP}% del objetivo (>35% = setup degradado, >50% = SKIP)
- Spread vs SL: ${spreadRatioSL}% del stop (clave en scalping)
- Desglose: base=$${(sigSpread.component.base ?? 0).toFixed(4)} + volumen=$${(sigSpread.component.volume ?? 0).toFixed(4)} + sesión=$${(sigSpread.component.session ?? 0).toFixed(4)}

TECHNICAL CONTEXT:
MTF → HTF: ${(signal.mtf.htf ?? 0).toFixed(2)} | LTF: ${(signal.mtf.ltf ?? 0).toFixed(2)} | Exec: ${(signal.mtf.exec ?? 0).toFixed(2)}
${signal.mode === "scalping"
  ? `Stoch %K: ${(signal.indicators.stochK ?? 0).toFixed(1)} / %D: ${(signal.indicators.stochD ?? 0).toFixed(1)} | ${signal.indicators.stochK > signal.indicators.stochD ? "K>D alcista" : "K<D bajista"}`
  : `RSI: ${(signal.indicators.rsi ?? 0).toFixed(1)} | Divergencia: ${signal.indicators.rsiDivergence}`}
VWAP: ${signal.entry > signal.indicators.vwap ? "SOBRE" : "BAJO"} (${((signal.entry - signal.indicators.vwap) / signal.indicators.vwap * 100).toFixed(2)}%)
BB Squeeze: ${signal.indicators.bbSqueeze ? "SÍ — expansión de volatilidad inminente" : "NO"}
Vol Delta: ${(signal.indicators.volumeDeltaPct ?? 0).toFixed(1)}% (${signal.indicators.volumeDeltaPct > 0 ? "presión compradora" : "presión vendedora"})
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

      if (!canGroqCall()) {
        setMessages(prev => [...prev, { role: "ai", text: "⏸ Groq pausado por rate limit — esperá unos segundos.", ts: "" }]);
        setLoading(false); return;
      }
      onGroqCall();
      const r = await fetch("/api/groq", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: groqModel, temperature: 0.15, max_tokens: 220,
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
    } catch (e) {
      // Si es 429, activar pausa
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429")) {
        groqPausedRef.current = true;
        setTimeout(() => { groqPausedRef.current = false; }, 60000);
      }
      const floorCatch = signal.mode === "scalping"
        ? Math.max(48, learningRef.current.confidenceFloor - 4)
        : learningRef.current.confidenceFloor;
      return signal.confidence >= floorCatch ? "OPEN" : "SKIP";
    }
  }

  const closePosition = useCallback(async (position: Position, exit: number, result: ExitReason) => {
    // Si MT5 está conectado, cerrar en el broker PRIMERO y esperar confirmación
    if (mt5Enabled && mt5Status === "connected") {
      try {
        const body: Record<string, unknown> = {
          asset: position.signal.asset,
          direction: position.signal.direction,
        };
        const r = await fetch(`${mt5Url}/close`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
        });
        const d = await r.json() as { ok: boolean; closed: number[]; errors?: Array<{ticket:number;error:string}> };
        if (!d.ok || !d.closed?.length) {
          pushToast(`⚠️ MT5 no pudo cerrar ${position.signal.asset}: ${d.errors?.[0]?.error ?? "sin respuesta"}`, "error");
          return; // No registrar el cierre si MT5 falló
        }
      } catch (e) {
        pushToast(`⚠️ MT5 timeout al cerrar ${position.signal.asset}`, "error");
        return;
      }
    }
    // Registrar el cierre localmente
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
        result, openedAt: position.openedAt, closedAt: new Date().toISOString(), source: "real",
      }, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
    // ── Circuit breaker: acumula P&L del día ────────────────────────────────
    {
      const today = new Date().toISOString().slice(0, 10);
      if (dailyPnlRef.current.date !== today) dailyPnlRef.current = { date: today, pnl: 0 };
      dailyPnlRef.current.pnl += pnl;
      const eq = mt5EquityRef.current ?? 1000;
      const lossPct = Math.abs(Math.min(dailyPnlRef.current.pnl, 0)) / eq;
      if (lossPct >= MAX_DAILY_LOSS_PCT && !circuitOpenRef.current) {
        circuitOpenRef.current = true;
        setCircuitOpen(true);
        setAutoScan(false);
        pushToast(`🔴 Circuit breaker: pérdida diaria ${(lossPct * 100).toFixed(1)}% — autoScan pausado hasta que lo reactivés`, "error");
      }
    }
    // Sincronizar MT5 para reflejar el cierre inmediatamente
    if (mt5Enabled && mt5Status === "connected") setTimeout(() => void syncMT5State(), 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mt5Enabled, mt5Status, mt5Url]);

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

      // ── Breakeven: mover SL a entrada cuando ganancia ≥ 50% del TP ──────────
      const tpDist      = Math.abs(pos.signal.takeProfit - pos.signal.entry);
      const profitDist  = isLong ? tradable - pos.signal.entry : pos.signal.entry - tradable;
      const profitRatio = tpDist > 0 ? profitDist / tpDist : 0;
      const bePrice     = pos.signal.entry + (isLong ? 1 : -1) * (pos.signal.atr * 0.1); // entry + pequeño buffer
      const shouldBE    = profitRatio >= 0.5 && (isLong ? newSl < bePrice : newSl > bePrice);
      if (shouldBE) {
        newSl = bePrice; // SL a breakeven
      }

      // ── Lógica multi-TP ─────────────────────────────────────────────────────
      const tp1 = pos.signal.tp1 ?? pos.signal.takeProfit;
      const tp2 = pos.signal.tp2 ?? pos.signal.takeProfit;
      const tp3 = pos.signal.tp3;
      const beBuffer = pos.signal.entry + (isLong ? 1 : -1) * pos.signal.atr * 0.1;

      const hitTp1 = !pos.tp1Hit && (isLong ? tradable >= tp1 : tradable <= tp1);
      const hitTp2 = pos.tp1Hit && !pos.tp2Hit && (isLong ? tradable >= tp2 : tradable <= tp2);
      const hitTp3 = tp3 !== undefined && pos.tp2Hit && !pos.tp3Hit && (isLong ? tradable >= tp3 : tradable <= tp3);

      if (pos.signal.mode === "scalping") {
        if (hitTp2) {
          void closePosition(pos, tradable, "TP"); return;
        }
        if (hitTp1) {
          // Scalp TP1 tocado: mover SL a BE y esperar TP2
          const nextSl = isLong ? Math.max(newSl, beBuffer) : Math.min(newSl, beBuffer);
          setOpenPositions(prev => prev.map(p =>
            p.id === pos.id ? { ...p, tp1Hit: true, signal: { ...p.signal, stopLoss: nextSl } } : p
          ));
          pushToast(`🎯 ${pos.signal.asset} TP1 → SL movido a BE, esperando TP2`, "success");
          return;
        }
      } else {
        // Intradía: TP1 → BE, TP2 → SL a TP1, TP3 → cierre
        if (hitTp3) {
          void closePosition(pos, tradable, "TP"); return;
        }
        if (hitTp2 && tp3 !== undefined) {
          // Mover SL a TP1 para asegurar mínimo ese profit
          const lockSl = tp1;
          setOpenPositions(prev => prev.map(p =>
            p.id === pos.id ? { ...p, tp2Hit: true, signal: { ...p.signal, stopLoss: lockSl } } : p
          ));
          pushToast(`🎯 ${pos.signal.asset} TP2 → SL asegurado en TP1, esperando TP3`, "success");
          return;
        }
        if (hitTp2 && tp3 === undefined) {
          void closePosition(pos, tradable, "TP"); return;
        }
        if (hitTp1 && !pos.tp1Hit) {
          const nextSl = isLong ? Math.max(newSl, beBuffer) : Math.min(newSl, beBuffer);
          setOpenPositions(prev => prev.map(p =>
            p.id === pos.id ? { ...p, tp1Hit: true, signal: { ...p.signal, stopLoss: nextSl } } : p
          ));
          pushToast(`🎯 ${pos.signal.asset} TP1 → SL a BE, esperando TP2/TP3`, "success");
          return;
        }
      }

      // ── Reversión: solo intradía con ganancia minima 1×ATR ─────────────────
      const vals         = sv[pos.signal.asset] ?? [];
      const maFast       = avg(vals.slice(-(pos.signal.mode === "scalping" ? 5 : 10)));
      const maSlow       = avg(vals.slice(-(pos.signal.mode === "scalping" ? 10 : 20)));
      const hasMinProfit = profitDist >= pos.signal.atr * 1.0;
      const maCross      = isLong ? maFast < maSlow : maFast > maSlow;
      const reversal     = pos.signal.mode === "intradia" && hasMinProfit && maCross && pos.tp1Hit;

      // ── SL ──────────────────────────────────────────────────────────────────
      const hitSl = isLong ? tradable <= effectiveSl : tradable >= effectiveSl;
      if (hitSl)    { void closePosition(pos, tradable, trailMoved ? "TRAIL" : "SL"); return; }
      if (reversal) { void closePosition(pos, tradable, "REVERSAL");                  return; }

      if (trailMoved || shouldBE || peak !== pos.peak || trough !== pos.trough) {
        setOpenPositions(prev => prev.map(p =>
          p.id === pos.id
            ? { ...p, peak, trough, signal: { ...p.signal, stopLoss: newSl } }
            : p
        ));
      }
    });
  }


  // ─── Guard de correlación: evitar doble riesgo en activos correlacionados ──
  // BTC/ETH correlación ~0.85 — no abrir mismo lado simultáneamente
  // XAU/XAG correlación ~0.80 — idem
  const CORR_GROUPS: Asset[][] = [
    ["BTCUSD", "ETHUSD"],
    ["XAUUSD", "XAGUSD"],
  ];
  function hasCorrConflict(asset: Asset, direction: Direction, positions: Position[]): boolean {
    if (positions.length === 0) return false;
    // 1. Correlación dinámica aprendida (umbral 0.75 = altamente correlacionados)
    const dynConflict = positions.some(p => {
      if (p.signal.asset === asset) return false;
      if (p.signal.direction !== direction) return false;
      const corr = correlationRef.current[asset]?.[p.signal.asset] ?? 0;
      return Math.abs(corr) >= 0.75;
    });
    if (dynConflict) return true;
    // 2. Fallback estático para activos sin correlación calculada
    const group = CORR_GROUPS.find(g => g.includes(asset));
    if (!group) return false;
    return positions.some(p =>
      group.includes(p.signal.asset) &&
      p.signal.asset !== asset &&
      p.signal.direction === direction
    );
  }

  async function createSignalAndExecute(mode: Mode, targetAsset: Asset, autoLabel = false) {
    if (!liveReady) {
      pushToast("⟳ Sincronizando datos antes de generar señal...", "info");
      await syncRealData();
      if (!liveReady) { pushToast("⚠ Sin datos — verificá el bridge MT5 o la conexión a internet.", "warning"); return; }
    }
    if (circuitOpenRef.current) {
      if (!autoLabel) pushToast("🔴 Circuit breaker activo — límite de pérdida diaria alcanzado. Reactivá el autoScan manualmente cuando estés listo.", "error");
      return;
    }

    // ── Log de diagnóstico del flujo ─────────────────────────────────────────
    console.log(`[FLOW] asset=${targetAsset} mode=${mode} liveReady=${liveReady} mt5=${mt5Status} circuit=${circuitOpenRef.current}`);
    // ── Verificar límites diarios antes de generar señal ─────────────────────
    if (mode === "scalping") {
      const risk = calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain);
      if (risk.blocked) {
        if (!autoLabel) pushToast(`🛑 ${risk.blockReason}`, "warning");
        return;
      }
      // Modo defensivo si expectancy negativa con suficientes trades
      if (risk.mathExpectancy < -0.5 && risk.dailyTrades > 5) {
        if (!autoLabel) pushToast(`⚠️ Expectativa negativa ($${(risk.mathExpectancy ?? 0).toFixed(2)}). Modo defensivo.`, "warning");
      }
    }

    // ── Guard: no abrir si ya hay posición abierta en este activo ─────────────
    const existingInAsset = openPositionsRef.current.filter(p => p.signal.asset === targetAsset);
    if (existingInAsset.length > 0) {
      if (!autoLabel) pushToast(`⏸ ${targetAsset}: ya hay ${existingInAsset.length} posición abierta`, "warning");
      return;
    }
    // ── Guard MT5: verificar posiciones reales del broker ───────────────────
    if (mt5Enabled && mt5Status === "connected") {
      const mt5InAsset = mt5PositionsRef.current.filter(p =>
        p.symbol.startsWith(targetAsset) || p.asset === targetAsset
      );
      if (mt5InAsset.length > 0) {
        if (!autoLabel) pushToast(`⏸ ${targetAsset}: ${mt5InAsset.length} posición real en MT5`, "warning");
        return;
      }
    }

    const signal = generateSignal(mode, targetAsset);
    if (!autoLabel) setLastSignal(signal);

    // ── DEBUG: log completo de la señal para diagnosticar por qué no abre ───
    {
      const rrDbg = Math.abs(signal.tp2 - signal.entry) /
                    Math.max(Math.abs(signal.entry - signal.stopLoss), 1e-9);
      const lrnDbg = learningRef.current;
      const floorDbg = mode === "scalping"
        ? Math.max(46, lrnDbg.confidenceFloor - 4)
        : Math.max(50, lrnDbg.confidenceFloor);
      console.log(`[TraderLab] ${targetAsset} ${mode} | price=${(signal.entry ?? 0).toFixed(2)} | conf=${(signal.confidence ?? 0).toFixed(1)}% (floor=${floorDbg}) | RR=${rrDbg.toFixed(2)} | SL=${(signal.stopLoss ?? 0).toFixed(2)} | TP1=${(signal.tp1 ?? 0).toFixed(2)} TP2=${(signal.tp2 ?? 0).toFixed(2)} | ${signal.rationale.slice(0,80)}`);
    }

    // ── Guard correlación ────────────────────────────────────────────────────
    if (hasCorrConflict(targetAsset, signal.direction, openPositionsRef.current)) {
      if (!autoLabel) pushToast(`⚡ ${targetAsset} ${signal.direction}: correlado con posición abierta — skip`, "warning");
      return;
    }
    // ── Guard sesión basado en perfil ────────────────────────────────────────
    if (mode === "scalping" && !sessionOverride) {
      const sessionProf = getSessionProfile();
      const hour        = new Date().getUTCHours();
      const isCryptoAsset = ["BTCUSD","ETHUSD"].includes(targetAsset);
      const isMetalAsset  = ["XAUUSD","XAGUSD"].includes(targetAsset);

      // Fuera de NY: solo crypto
      if (sessionProf.isCryptoOnly && !isCryptoAsset) {
        if (!autoLabel) pushToast(
          `${sessionProf.emoji} ${sessionProf.name}: ${targetAsset} bloqueado (solo crypto fuera de NY)`,
          "warning"
        );
        return;
      }
      // Hora muerta global crypto (02-07 UTC) — única excepción para crypto
      if (isCryptoAsset && hour >= 2 && hour < 7) {
        if (!autoLabel) pushToast(`⏸ ${targetAsset}: hora muerta 02-07 UTC`, "warning");
        return;
      }
      // Metales fuera de horario institucional
      if (isMetalAsset && !["NY","London"].includes(sessionProf.name)) {
        if (!autoLabel) pushToast(
          `⏸ ${targetAsset}: metales solo en NY/London (ahora ${sessionProf.name})`,
          "warning"
        );
        return;
      }
    }
    // ── Decisión primaria: motor cuantitativo local ─────────────────────────
    const lrnSnap = learningRef.current;
    const prof    = getSessionProfile();
    // Fuera de NY (finde/Asia/post-NY): piso más permisivo (señales menos limpias)
    const floor   = mode === "scalping"
      ? Math.max(44, lrnSnap.confidenceFloor - 4 + prof.confAdjust)
      : Math.max(50, lrnSnap.confidenceFloor);
    const rrActual = Math.abs(signal.tp2 - signal.entry) /
                     Math.max(Math.abs(signal.entry - signal.stopLoss), 1e-9);

    // Log diagnóstico siempre visible (consola del navegador → F12)
    console.log(
      `[SIGNAL] ${targetAsset} ${mode} | price=${(signal.entry ?? 0).toFixed(2)}` +
      ` | conf=${(signal.confidence ?? 0).toFixed(1)}% (piso=${floor})` +
      ` | RR=${rrActual.toFixed(2)} | SL=${(signal.stopLoss ?? 0).toFixed(2)}` +
      ` | TP1=${signal.tp1?.toFixed(2)} TP2=${signal.tp2?.toFixed(2)}` +
      ` | ${signal.rationale?.slice(0,60)}`
    );

    if (isNaN(signal.confidence) || isNaN(rrActual)) {
      console.error(`[TraderLab] NaN detectado — conf=${signal.confidence} RR=${rrActual} para ${targetAsset}`);
      pushToast(`⚠ ${targetAsset}: señal inválida (NaN) — verificá el bridge`, "error");
      return;
    }

    if (signal.confidence < floor) {
      if (!autoLabel) pushToast(`⏭ ${targetAsset} SKIP — conf ${(signal.confidence ?? 0).toFixed(0)}% < piso ${floor.toFixed(0)}% | ${signal.rationale.slice(0,60)}`, "warning");
      return;
    }
    if (rrActual < 1.5) {
      if (!autoLabel) pushToast(`⏭ ${targetAsset} SKIP — RR ${rrActual.toFixed(2)} < 1.5 mínimo`, "warning");
      return;
    }

    // ── Groq como enricher (async, no bloquea) ───────────────────────────────
    // Corre en paralelo: si responde antes de ejecutar, ajusta rationale.
    // Solo puede VETAR si detecta contradicción estructural fuerte (modo intradía).
    let aiVeto = false;
    if (usingGroq && apiKey.trim() && canCallGroq()) {
      try {
        trackGroqCall();
        const groqResult = await Promise.race([
          aiDecision(signal),
          new Promise<"TIMEOUT">((res) => setTimeout(() => res("TIMEOUT"), 4000)),
        ]);
        if (groqResult === "SKIP" && mode === "intradia") {
          // Veto estructural solo en intradía — scalping no se veta
          aiVeto = true;
          if (!autoLabel) pushToast(`🤖 Groq vetó ${targetAsset} intradía — ${signal.aiRationale ?? "contradicción macro"}`, "warning");
        }
        // WAIT → no veta, solo registra
      } catch { /* si falla Groq, continuar */ }
    }
    if (aiVeto) return;
    const lrn = learningRef.current;
    const wyckoffMult = (signal as Signal & { _wyckoffMult?: number })._wyckoffMult ?? 1.0;
    // Ajustar sizing por riesgo de ruina en scalping
    const riskMult = signal.mode === "scalping"
      ? calcScalpingRisk(realTrades, balance, maxDailyLoss, maxDailyGain).sizeMultiplier
      : 1.0;
    // ── Size ajustado por reversal score y Wyckoff ───────────────────────────
    // isReversalSetup: entrada anticipatoria → size reducido (más riesgo de timing)
    // wyckoffSizeMult: amplifica si Wyckoff macro alineado, reduce si opuesto
    // Los dos pueden combinarse: setup anticipatorio + Wyckoff alineado = 0.75× (prudente pero convicción)
    const reversalSizeMult = signal.isReversalSetup
      ? (signal.wyckoffSizeMult > 1.0 ? 0.75 : 0.5)  // Wyckoff alineado → más convicción
      : signal.wyckoffSizeMult;                         // tendencia → usar mult Wyckoff directo
    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * lrn.riskScale * wyckoffMult * riskMult * reversalSizeMult);
    // stopDistance mínimo: el mayor entre el SL calculado y 0.3% del precio
    // Evita que ATR pequeño en plata/gold genere sizes irreales
    const minStop = signal.entry * 0.003;
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), minStop);
    // Calcular lotes respetando volMin y volStep del broker
    const cs   = contractSize[signal.asset] ?? 1;
    const vMin = volMin[signal.asset]       ?? 0.01;
    const vStp = volStep[signal.asset]      ?? 0.01;
    // size en lotes = riskUsd / (stopDistance * contractSize)
    const rawLots = riskUsd / (stopDistance * cs);
    // Redondear al volStep más cercano hacia abajo, asegurar >= volMin
    const size = Math.max(vMin, Math.floor(rawLots / vStp) * vStp);
    const marginUsed = (size * cs * signal.entry) / getLeverage(signal.asset);
    // ── Riesgo de margen total (anti-liquidación) ──────────────────────────
    const totalMarginUsed = openPositionsRef.current.reduce((a, p) => a + p.marginUsed, 0);
    // Usar margen libre real de MT5 si está disponible (fuente de verdad)
    const realEquity    = (mt5Enabled && mt5Equity    !== null && mt5Equity    > 0) ? mt5Equity    : equity;
    const realFreeMargin = (mt5Enabled && mt5FreeMargin !== null && mt5FreeMargin > 0) ? mt5FreeMargin : null;

    // Si tenemos margen libre real de MT5, usarlo directamente
    const freeMarginPct = realFreeMargin !== null && realEquity > 0
      ? (realFreeMargin / realEquity) * 100
      : realEquity > 0
        ? ((realEquity - totalMarginUsed - marginUsed) / realEquity) * 100
        : 100; // si no hay datos, no bloquear

    // Bloquear solo si el margen libre real baja del 20% (umbral de liquidación inminente)
    if (freeMarginPct < 20) {
      pushToast(`🛑 Margen libre crítico: ${freeMarginPct.toFixed(1)}% — operación bloqueada`, "error");
      return;
    }
    if (freeMarginPct < 40) {
      pushToast(`⚠️ Margen libre bajo: ${freeMarginPct.toFixed(1)}%`, "warning");
    }
    // Bloquear solo si la posición usaría más del 40% del equity (era 20%, muy restrictivo)
    if (marginUsed > realEquity * 0.40) {
      pushToast(`⚠️ Posición demasiado grande: $${marginUsed.toFixed(0)} vs equity $${realEquity.toFixed(0)}`, "warning");
      return;
    }
    const multTag = wyckoffMult > 1 ? ` | Wyckoff ×${wyckoffMult.toFixed(2)}` : "";
    if (mt5Enabled && mt5Status === "connected") {
      // MT5 activo: primero ejecutar en el broker, solo agregar al panel si confirma
      await sendToMT5(signal, size, marginUsed, (ticket, execPrice) => {
        const entry = execPrice ?? signal.entry;
        setOpenPositions(prev => [...prev, { id: ticket ?? Date.now(), signal: { ...signal, entry }, size, marginUsed, openedAt: new Date().toISOString(), peak: entry, trough: entry }]);
        const reversalTag = signal.isReversalSetup ? ` | 🔄 GIRO score=${signal.reversalScore}` : "";
        const wyckoffTag  = signal.wyckoffSizeMult !== 1.0 ? ` | Wyckoff×${(signal.wyckoffSizeMult ?? 0).toFixed(1)}` : "";
        if (!autoLabel) pushToast(`🚀 MT5 #${ticket} ${signal.asset} ${signal.direction} @ ${entry.toFixed(2)} | conf ${(signal.confidence ?? 0).toFixed(0)}%${multTag}${reversalTag}${wyckoffTag}`, "success");
      });
    } else {
      // Sin MT5: panel simulado
      setOpenPositions(prev => [...prev, { id: Date.now(), signal, size, marginUsed, openedAt: new Date().toISOString(), peak: signal.entry, trough: signal.entry }]);
      if (!autoLabel) pushToast(`🚀 ${signal.asset} ${signal.direction} @ ${(signal.entry ?? 0).toFixed(2)} | conf ${(signal.confidence ?? 0).toFixed(0)}%${multTag}${signal.aiRationale ? " | " + signal.aiRationale : ""}`, "success");
    }
  }

  // ── MT5: test de conexión ────────────────────────────────────────────────
  // ── Sincronizar posiciones y historial reales desde MT5 ───────────────────
  async function syncMT5State() {
    if (!mt5Enabled || mt5Status !== "connected") return;
    try {
      // Posiciones abiertas reales
      const rPos = await fetch(`${mt5Url}/positions`, { signal: AbortSignal.timeout(5000) });
      if (rPos.ok) {
        const dPos = await rPos.json() as {
          positions: MT5Position[];
          total: number;
          total_profit?: number;
          balance?: number;
          equity?: number;
          margin?: number;
          free_margin?: number;
          margin_level?: number;
        };
        // Mapear symbol → Asset (ej: BTCUSD → BTCUSD)
        const mapped = dPos.positions.map(p => ({
          ...p,
          asset: (assets.find(a => p.symbol.startsWith(a) || a === p.symbol) ?? p.symbol) as Asset,
        }));
        setMt5Positions(mapped);
        // Actualizar datos del encabezado desde /positions (más fresco que /status)
        if (dPos.balance   !== undefined && dPos.balance   !== null) setMt5Balance(dPos.balance);
        if (dPos.equity    !== undefined && dPos.equity    !== null) setMt5Equity(dPos.equity);
        if (dPos.margin    !== undefined && dPos.margin    !== null) setMt5Margin(dPos.margin);
        if (dPos.free_margin !== undefined && dPos.free_margin !== null) setMt5FreeMargin(dPos.free_margin);
        if (dPos.margin_level !== undefined && dPos.margin_level !== null) setMt5MarginLevel(dPos.margin_level);
      }
      // Historial reciente (últimos 7 días)
      const rHist = await fetch(`${mt5Url}/history?days=7`, { signal: AbortSignal.timeout(5000) });
      if (rHist.ok) {
        const dHist = await rHist.json() as { deals: Array<{
          ticket: number; symbol: string; entry: string; type: string;
          volume: number; price: number; profit: number; time: string;
        }> };
        // Convertir deals de cierre a ClosedTrade
        const closedDeals = dHist.deals.filter(d => d.entry === "OUT");
        const mt5Trades: ClosedTrade[] = closedDeals.map(d => {
          const asset = (assets.find(a => d.symbol.startsWith(a) || a === d.symbol) ?? d.symbol) as Asset;
          return {
            id: d.ticket,
            asset,
            mode: "scalping" as Mode,
            direction: d.type === "buy" ? "LONG" : "SHORT" as Direction,
            entry: d.price, // precio aproximado — MT5 no separa entrada/salida en deal OUT
            exit: d.price,
            pnl: d.profit,
            pnlPct: d.profit / Math.max(balance, 1) * 100,
            result: d.profit > 0 ? "TP" : "SL" as ExitReason,
            openedAt: d.time,
            closedAt: d.time,
            source: "real" as const,
          };
        });
        if (mt5Trades.length > 0) setMt5History(mt5Trades);
      }
    } catch { /* sync silencioso — no interrumpir el flujo */ }
  }

  async function testMT5Bridge() {
    setMt5Status("testing");
    try {
      const r = await fetch(`${mt5Url}/status`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as {
        connected: boolean; account?: string; balance?: number;
        equity?: number; demo?: boolean; broker?: string; leverage?: number;
      };
      if (d.connected) {
        setMt5Status("connected");
        setMt5Account(d.account ?? null);
        setMt5Balance(d.balance ?? null);
        if (d.equity !== undefined) setMt5Equity(d.equity);
        // Cargar catálogo de símbolos disponibles en el broker
        void fetchMT5Symbols();
        // Sincronizar posiciones inmediatamente al conectar
        await syncMT5State();
        pushToast(
          `✅ MT5 — Cta ${d.account} | Balance $${d.balance?.toFixed(0)} | ${d.demo ? "DEMO ✓" : "⚠ REAL"} | ${d.broker ?? ""}`,
          "success"
        );
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
  async function sendToMT5(signal: Signal, size: number, marginUsed: number, onConfirm?: (ticket: number, price: number) => void) {
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
      if (d.ok && d.ticket) {
        onConfirm?.(d.ticket, d.price ?? signal.entry);
      } else {
        const errMsg = d.error ?? JSON.stringify(d);
        pushToast(`❌ MT5 rechazó: ${errMsg}`, "error");
        console.error("[sendToMT5] Bridge rechazó:", d);
      }
    } catch { pushToast("MT5: timeout al enviar señal", "error"); }
  }

  // ── MT5: cerrar posición con ticket específico o por asset ──────────────
  async function closeInMT5(asset: Asset, direction?: string, ticket?: number) {
    if (!mt5Enabled || mt5Status !== "connected") return;
    try {
      const body: Record<string, unknown> = { asset };
      if (ticket) body.ticket = ticket;
      if (direction) body.direction = direction;
      const r = await fetch(`${mt5Url}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json() as { ok: boolean; closed: number[]; errors: Array<{ticket:number;error:string}> };
      if (d.closed?.length > 0) {
        pushToast(`📡 MT5: cerradas ${d.closed.length} posición(es) en ${asset}`, "success");
        // Actualizar lista de posiciones MT5
        setMt5Positions(prev => prev.filter(p => !d.closed.includes(p.ticket)));
        // Re-sincronizar para capturar el trade cerrado en historial
        setTimeout(() => syncMT5State(), 1500);
      }
      if (d.errors?.length > 0) {
        d.errors.forEach(e => pushToast(`⚠ MT5 ticket #${e.ticket}: ${e.error}`, "error"));
      }
    } catch (e) {
      pushToast(`MT5 cierre fallido: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  // ── MT5: cerrar por ticket (desde panel de posiciones MT5) ────────────────
  async function closeInMT5ByTicket(ticket: number, asset: Asset) {
    await closeInMT5(asset, undefined, ticket);
  }


  // ─── fetchRealMarketSnapshot: pide precios + velas 1m al bridge MT5 ────────
  // Usa /snapshot que devuelve todos los activos activos en una sola llamada.
  // Para activos no presentes en /snapshot, hace fetch individual de /candles.
  async function fetchRealMarketSnapshot(
    prevPrices: Record<string, number>,
    bridgeUrl: string,
    _useBridge: boolean,
  ): Promise<{
    prices:      Record<string, number>;
    seriesMap:   Record<string, number[]>;
    candleMap:   Record<string, Candle[]>;
    spreadMap:   Record<string, number>;
    leverageMap: Record<string, number>;
    shock:       number;
    sourceNote:  string;
  }> {
    // ── 1. Llamar /snapshot — todos los activos en paralelo ──────────────────
    const resp = await fetch(`${bridgeUrl}/snapshot`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) throw new Error(`Bridge /snapshot HTTP ${resp.status}`);

    const data = await resp.json() as {
      assets: Record<string, {
        price?: number; bid?: number; ask?: number;
        spread?: number; spread_pct?: number;
        leverage?: number; digits?: number;
        candles?: Candle[];
        error?: string;
      }>;
    };

    const prices:      Record<string, number>   = { ...prevPrices };
    const seriesMap:   Record<string, number[]>  = {};
    const candleMap:   Record<string, Candle[]>  = {};
    const spreadMap:   Record<string, number>    = {};
    const leverageMap: Record<string, number>    = {};
    const failed: string[] = [];

    // ── 2. Procesar respuesta del bridge ─────────────────────────────────────
    for (const [asset, d] of Object.entries(data.assets ?? {})) {
      if (d.error || !d.price) { failed.push(asset); continue; }
      prices[asset]  = d.price;
      if (d.spread   !== undefined) spreadMap[asset]   = d.spread;
      if (d.leverage !== undefined) leverageMap[asset] = d.leverage;
      if (d.candles?.length) {
        candleMap[asset]  = d.candles;
        seriesMap[asset]  = d.candles.map(c => c.c);
      }
    }

    // ── 3. Para activos del estado que no vinieron en /snapshot,
    //       intentar fetch individual /candles/{asset}?tf=1m&limit=200 ─────────
    const missing = assets.filter(a => !prices[a] || !seriesMap[a]);
    if (missing.length > 0) {
      await Promise.allSettled(missing.map(async a => {
        try {
          const r = await fetch(`${bridgeUrl}/candles/${a}?tf=1m&limit=200`, {
            signal: AbortSignal.timeout(6000),
          });
          if (!r.ok) return;
          const cd = await r.json() as { candles?: Candle[]; asset?: string };
          if (cd.candles?.length) {
            const last = cd.candles[cd.candles.length - 1];
            prices[a]    = last.c;
            candleMap[a] = cd.candles;
            seriesMap[a] = cd.candles.map(c => c.c);
          }
        } catch { /* activo no disponible en este broker */ }
      }));
    }

    // ── 4. Volatility shock basado en retornos de BTC ────────────────────────
    const btcSeries = seriesMap["BTCUSD"] ?? seriesMap["BTCUSDT"] ?? [];
    let shock = 0.28;
    if (btcSeries.length > 10) {
      const absRet = btcSeries
        .slice(1)
        .map((v, i) => Math.abs((v - btcSeries[i]) / Math.max(btcSeries[i], 1e-9)));
      const meanRet = absRet.reduce((s, v) => s + v, 0) / absRet.length;
      shock = Math.max(0.08, Math.min(1.25, meanRet * 220));
    }

    const ok = Object.keys(prices).filter(a => prices[a] > 0).length;
    const sourceNote = failed.length > 0
      ? `MT5 Bridge: ${ok} activos OK · ${failed.length} sin datos`
      : `MT5 Bridge: ${ok} activos OK`;

    return { prices, seriesMap, candleMap, spreadMap, leverageMap, shock, sourceNote };
  }

    // ─── fetchMT5Symbols: lee activos disponibles del broker ──────────────────
  // Llama a /symbols del bridge (nuevo endpoint) y actualiza la lista de activos
  async function fetchMT5Symbols() {
    if (mt5Status !== "connected") return;
    try {
      const r = await fetch(`${mt5Url}/symbols`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;

      // Bridge v4 devuelve: { symbols: [...], resolved_map: { "BTCUSD": "BTCUSDT", ... }, total: N }
      const data = await r.json() as {
        symbols: Array<{
          name: string; description: string;
          spread: number; bid: number; ask: number;
          trade_mode: number; filling_mode: number;
          digits: number; contract_size: number;
          volume_min: number; volume_step: number;
          currency_base: string; currency_profit: string;
          trade_allowed: boolean; visible: boolean;
        }>;
        resolved_map?: Record<string, string>; // TraderLab name → broker symbol
        total: number;
      };

      if (!data.symbols?.length) return;

      // ── Invertir resolved_map: broker_symbol → TraderLab name ───────────────
      const brokerToTL: Record<string, string> = {};
      if (data.resolved_map) {
        Object.entries(data.resolved_map).forEach(([tl, broker]) => {
          brokerToTL[broker] = tl;
        });
      }

      // ── Filtrar: excluir solo activos con trade_mode=0 (solo conversión/deshabilitado)
      // trade_mode: 0=disabled, 1=long only, 2=short only, 4=full — aceptar 1,2,4
      const tradeable = data.symbols.filter(s => s.trade_mode !== 0 && s.bid > 0);

      // ── Mapear: para cada activo tradeable, usar nombre TraderLab si existe ──
      const mapped = tradeable.map(s => {
        const tlName = brokerToTL[s.name] ?? s.name;
        const known  = ASSET_CATALOG[tlName] ?? ASSET_CATALOG[s.name];
        const cat    = known?.category ?? inferCategoryFromSymbol(s.name, s.description, s.currency_base, s.currency_profit);
        return {
          name:         tlName,
          brokerName:   s.name,
          category:     cat,
          spread:       s.spread,
          contractSize: s.contract_size,
          digits:       s.digits,
          volumeMin:    s.volume_min,
        };
      });

      setAvailableSymbols(mapped);
      pushToast(`📡 ${mapped.length} activos disponibles en el broker`, "info");

      // ── Agregar TODOS los activos tradeables al assets state ─────────────────
      // Estrategia: incluir todo lo que el broker tiene tradeable
      // Prioridad: base 4 activos + catálogo conocido + todos los del broker
      const tlNames = mapped.map(m => m.name);
      const base = ["BTCUSD","ETHUSD","XAGUSD","XAUUSD"];

      setAssets(() => {
        // Orden: primero los base, luego del catálogo, luego el resto del broker
        const fromCatalog = tlNames.filter(n => ASSET_CATALOG[n] && !base.includes(n));
        const fromBroker  = tlNames.filter(n => !ASSET_CATALOG[n] && !base.includes(n));
        return [...new Set([...base, ...fromCatalog, ...fromBroker])];
      });

      // ── También actualizar ASSET_CATALOG en runtime para activos nuevos ──────
      // Esto evita que calcPosSize use parámetros default incorrectos
      mapped.forEach(m => {
        if (!ASSET_CATALOG[m.name]) {
          // Parámetros conservadores para activos desconocidos
          (ASSET_CATALOG as Record<string, typeof ASSET_CATALOG[string]>)[m.name] = {
            category:    m.category,
            digits:      m.digits ?? 5,
            contractSize: m.contractSize ?? 1,
            leverage:    50,
            minAtr:      0.0001,
            spreadPct:   m.spread > 0 ? m.spread / Math.max(m.spread, 0.0001) * 0.01 : 0.02,
            sessions:    ["NY","London","Asia","Post-NY"],
          };
        }
      });

    } catch (e) {
      console.warn("[fetchMT5Symbols] error:", e);
    }
  }

  // ── Infiere categoría desde nombre, descripción y monedas base/profit ───────
  function inferCategoryFromSymbol(
    name: string, desc: string, currBase: string, currProfit: string
  ): AssetCategory {
    const n = name.toUpperCase();
    const d = (desc ?? "").toLowerCase();
    // Crypto: moneda base no es divisa fiat conocida
    const FIATS = new Set(["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD","HKD","SGD","NOK","SEK"]);
    const cryptoNames = ["BTC","ETH","XRP","ADA","SOL","DOT","LINK","LTC","BNB","DOGE","AVAX","MATIC","USDT","POL"];
    if (cryptoNames.some(c => n.startsWith(c) || n.includes(c+"USD") || n.includes(c+"USDT"))) return "crypto";
    // Metales preciosos
    if (n.startsWith("XAU") || n.startsWith("XAG") || n.startsWith("XPT") || n.startsWith("XPD")) return "metals";
    if (d.includes("gold") || d.includes("silver") || d.includes("platinum")) return "metals";
    // Índices
    if (d.includes("index") || d.includes("indice") || d.includes("500") || d.includes("nasdaq") || d.includes("dow")) return "indices";
    if (["US30","US500","USTEC","GER40","UK100","JP225","AUS200","FRA40"].some(x => n.includes(x))) return "indices";
    // Energía
    if (d.includes("crude") || d.includes("oil") || d.includes("brent") || d.includes("gas")) return "energy";
    if (["OIL","WTI","BRENT","USOIL","UKOIL","NATGAS"].some(x => n.includes(x))) return "energy";
    // Forex: ambas monedas son fiat
    if (currBase && currProfit && FIATS.has(currBase) && FIATS.has(currProfit)) {
      // Major: una de las dos es USD
      if (currBase === "USD" || currProfit === "USD") return "forex_major";
      return "forex_minor";
    }
    if (n.length === 6 && FIATS.has(n.slice(0,3)) && FIATS.has(n.slice(3))) {
      return (n.includes("USD") ? "forex_major" : "forex_minor");
    }
    // Commodities
    if (d.includes("wheat") || d.includes("corn") || d.includes("cotton") || d.includes("coffee") || d.includes("sugar")) return "commodities";
    // Acciones
    if (d.includes("stock") || d.includes("share") || d.includes("corp") || d.includes("inc")) return "stocks";
    return "other";
  }

  // Alias para compatibilidad con código existente
  function inferCategory(path: string, name: string): AssetCategory {
    return inferCategoryFromSymbol(name, path, "", "");
  }

  // ─── updateAssetIntelligence: actualiza el aprendizaje tras cerrar un trade ─
  function updateAssetIntelligence(trade: ClosedTrade) {
    const symbol = trade.asset;
    const session = getSessionProfile().name;
    const hour = new Date().getUTCHours();
    const isWin = trade.pnl > 0;
    const rr = (trade as ClosedTrade & {rr?:number}).rr ?? 0;

    setAssetIntelligence(prev => {
      const existing = prev[symbol] ?? {
        symbol, category: getAssetCategory(symbol),
        totalTrades: 0, winRate: 0, avgRR: 0, avgPnl: 0, profitFactor: 1,
        sessionStats: {}, modeStats: {}, hourlyStats: {},
        optimalSLMult: 1.0, optimalTPMult: 2.0, avgSpreadPct: getAssetCatalog(symbol).spreadPct,
        spreadByHour: {}, avgVolatility: 0, trendStrength: 0,
        bestMode: "scalping", bestSession: "NY", bestHourUTC: 14,
        correlations: {}, lastUpdated: new Date().toISOString(),
      } as AssetIntelligence;

      const n = existing.totalTrades;
      const newTotal = n + 1;

      // Session stats
      const ss = existing.sessionStats[session] ?? { trades:0, wins:0, pnl:0, avgSpread:0 };
      const newSS = { trades: ss.trades+1, wins: ss.wins+(isWin?1:0), pnl: ss.pnl+trade.pnl, avgSpread: ss.avgSpread };

      // Mode stats
      const ms = existing.modeStats[trade.mode] ?? { trades:0, wins:0, pnl:0, avgRR:0 };
      const newMS = { trades: ms.trades+1, wins: ms.wins+(isWin?1:0), pnl: ms.pnl+trade.pnl, avgRR: (ms.avgRR*ms.trades+rr)/Math.max(ms.trades+1,1) };

      // Hourly stats
      const hs = existing.hourlyStats[hour] ?? { trades:0, wins:0, pnl:0 };
      const newHS = { trades: hs.trades+1, wins: hs.wins+(isWin?1:0), pnl: hs.pnl+trade.pnl };

      // Running WR y PnL
      const allWins  = Object.values({...existing.sessionStats, [session]: newSS}).reduce((s,v)=>s+v.wins,0);
      const newWR    = allWins / newTotal;
      const newAvgPnl= (existing.avgPnl * n + trade.pnl) / newTotal;
      const newAvgRR = (existing.avgRR * n + rr) / newTotal;

      // Best session y best mode
      const sessEntries = Object.entries({...existing.sessionStats, [session]: newSS});
      const bestSess = sessEntries.sort((a,b) => (b[1].wins/Math.max(b[1].trades,1)) - (a[1].wins/Math.max(a[1].trades,1)))[0]?.[0] ?? "NY";
      const modeEntries = Object.entries({...existing.modeStats, [trade.mode]: newMS});
      const bestMode = modeEntries.sort((a,b) => (b[1].pnl/Math.max(b[1].trades,1)) - (a[1].pnl/Math.max(a[1].trades,1)))[0]?.[0] ?? "scalping";

      // Best hour
      const hourEntries = Object.entries({...existing.hourlyStats, [hour]: newHS});
      const bestHour = hourEntries.sort((a,b) => (b[1].pnl/Math.max(b[1].trades,1)) - (a[1].pnl/Math.max(a[1].trades,1)))[0];

      const updated: AssetIntelligence = {
        ...existing,
        totalTrades: newTotal,
        winRate: newWR,
        avgRR: newAvgRR,
        avgPnl: newAvgPnl,
        sessionStats: { ...existing.sessionStats, [session]: newSS },
        modeStats:    { ...existing.modeStats,    [trade.mode]: newMS },
        hourlyStats:  { ...existing.hourlyStats,  [hour]: newHS },
        bestSession: bestSess,
        bestMode: bestMode,
        bestHourUTC: bestHour ? Number(bestHour[0]) : 14,
        lastUpdated: new Date().toISOString(),
      };
      const next = { ...prev, [symbol]: updated };
      assetIntelRef.current = next;
      return next;
    });
  }

  // ─── updateCorrelationMatrix: recalcula Pearson entre todos los activos ────
  // Se llama cada 5 minutos o cuando llegan velas nuevas
  function updateCorrelationMatrix(seriesData: Record<string, number[]>) {
    const symbols = Object.keys(seriesData).filter(s => seriesData[s].length >= 20);
    if (symbols.length < 2) return;

    const matrix: Record<string, Record<string, number>> = {};
    for (const a of symbols) {
      matrix[a] = {};
      for (const b of symbols) {
        if (a === b) { matrix[a][b] = 1; continue; }
        // Calcular solo si no existe o es > 5min viejo
        const existing = correlationRef.current[a]?.[b];
        matrix[a][b] = existing !== undefined ? existing : calcPearsonCorrelation(seriesData[a], seriesData[b]);
      }
    }
    correlationRef.current = matrix;
    setCorrelationMatrix(matrix);
  }

  async function syncRealData() {
    setIsSyncing(true);
    const usingBridge = mt5Enabled && mt5Status === "connected";

    // Sin bridge: no operar
    if (!usingBridge) {
      setFeedStatus("⚠ MT5 Bridge no conectado — activá el bridge en Configuración");
      setLiveReady(false);
      setIsSyncing(false);
      if (!liveReady) pushToast("Bridge MT5 desconectado. Conectá el bridge para operar.", "warning");
      return;
    }
    try {
      const payload = await fetchRealMarketSnapshot(prevPricesRef.current, mt5Url, true);

      setPrices(payload.prices);
      setSeries(prev => {
        const next = { ...prev };
        assets.forEach(a => { const s = payload.seriesMap[a]; if (s?.length) next[a] = s; else next[a] = [...(prev[a] ?? []).slice(-159), payload.prices[a]]; });
        seriesRef.current = next;
        return next;
      });
      setCandles(prev => {
        const next = { ...prev };
        assets.forEach(a => { if (payload.candleMap[a]?.length) next[a] = payload.candleMap[a]; });
        return next;
      });

      // Spread real del broker (bid-ask directo de MT5/PrimeXBT)
      if (payload.spreadMap && Object.keys(payload.spreadMap).length > 0)
        setMt5SpreadMap(payload.spreadMap);

      // Leverage real del broker — si llega, reemplaza los valores hardcodeados
      if (payload.leverageMap && Object.keys(payload.leverageMap).length > 0)
        setMt5LeverageMap(payload.leverageMap);

      setVolumeShock(payload.shock);

      // Fetch MTF adicional: 5m/15m para ejecución scalping + 4H/1D para Wyckoff macro
      if (usingBridge) {
        try {
          const mtfFetches = await Promise.allSettled(
            assets.map(async (a) => {
              const r = await fetch(
                `${mt5Url}/candles_mtf/${a}?limit_5m=70&limit_15m=55&limit_4h=150&limit_1d=90`,
                { signal: AbortSignal.timeout(8000) }
              );
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const d = await r.json() as {
                candles_5m: Candle[]; candles_15m: Candle[];
                candles_4h: Candle[]; candles_1d: Candle[];
              };
              return {
                a,
                c5m:  d.candles_5m  ?? [],
                c15m: d.candles_15m ?? [],
                c4h:  d.candles_4h  ?? [],
                c1d:  d.candles_1d  ?? [],
              };
            })
          );
          const new5m:  Record<Asset, Candle[]> = {} as Record<Asset, Candle[]>;
          const new15m: Record<Asset, Candle[]> = {} as Record<Asset, Candle[]>;
          const new4h:  Record<Asset, Candle[]> = {} as Record<Asset, Candle[]>;
          const new1d:  Record<Asset, Candle[]> = {} as Record<Asset, Candle[]>;
          mtfFetches.forEach(r => {
            if (r.status === "fulfilled") {
              new5m[r.value.a]  = r.value.c5m;
              new15m[r.value.a] = r.value.c15m;
              new4h[r.value.a]  = r.value.c4h;
              new1d[r.value.a]  = r.value.c1d;
            }
          });
          setCandles5m(prev  => ({ ...prev, ...new5m }));
          setCandles15m(prev => ({ ...prev, ...new15m }));
          setCandles4h(prev  => ({ ...prev, ...new4h }));
          setCandles1d(prev  => ({ ...prev, ...new1d }));
        } catch (e) {
          console.warn("[TraderLab] MTF fetch falló:", e);
          // Sin velas MTF — Wyckoff queda en neutral, scalping usa sintético
        }
      }

      const timeStr = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setFeedStatus(`📡 ${timeStr} — ${payload.sourceNote}`);
      setLiveReady(true);
      updateCorrelationMatrix(seriesRef.current);
      // Auto-cargar símbolos del broker si aún no se cargaron
      if (mt5Enabled && mt5Status === "connected") void fetchMT5Symbols();
    } catch (e) {
      setFeedStatus("❌ Feed no disponible");
      setLiveReady(false);
      pushToast(`Error sync: ${e instanceof Error ? e.message : "red"}`, "error");
    } finally { setIsSyncing(false); }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // PYRAMIDING — agrega lote a posición existente cuando:
  // 1. TP1 fue alcanzado (posición en breakeven, sin riesgo extra)
  // 2. Nueva señal en 15m alineada con la dirección existente
  // 3. CVD confirma (no divergente vs la posición)
  // Size del add = 0.5× del original. MAX 2 adds por posición.
  // ═══════════════════════════════════════════════════════════════════════════
  async function tryPyramidAdd(pos: Position) {
    if (!pos.tp1Hit) return;                    // solo si TP1 ya tocado
    if ((pos.pyramidCount ?? 0) >= 2) return;  // máximo 2 adds
    if (!liveReady) return;
    if (circuitOpenRef.current) return;

    // Generar señal en 15m para el mismo activo
    const signal15m = generateSignal("scalping", pos.signal.asset);

    // Condiciones para agregar
    if (signal15m.direction !== pos.signal.direction) return;  // debe ser misma dirección
    if (signal15m.confidence < 55) return;                     // confianza mínima más alta para add
    if (signal15m.indicators?.cvd?.divergence) return;         // sin divergencia CVD

    // No agregar si hay posición correlacionada en la misma dirección
    const otherPositions = openPositionsRef.current.filter(p => p.id !== pos.id);
    if (hasCorrConflict(pos.signal.asset, pos.signal.direction, otherPositions)) return;

    const lrn       = learningRef.current;
    const realEquity = (mt5Enabled && mt5Equity !== null && mt5Equity > 0) ? mt5Equity : equity;
    const addSize   = pos.size * 0.5;  // 50% del lote original
    const addMargin = (addSize * (contractSize[pos.signal.asset] ?? 1) * signal15m.entry) /
                      getLeverage(pos.signal.asset);

    // Guard de margen para el add
    const totalMarginUsed = openPositionsRef.current.reduce((a, p) => a + p.marginUsed, 0);
    if ((totalMarginUsed + addMargin) / realEquity > 0.35) return;  // max 35% margen total

    // Crear señal de pyramid con campos propios
    const pyramidSignal: Signal = {
      ...signal15m,
      isPyramidAdd:   true,
      isReversalSetup: false,
      wyckoffSizeMult: 1.0,
    };

    if (mt5Enabled && mt5Status === "connected") {
      await sendToMT5(pyramidSignal, addSize, addMargin, (ticket, execPrice) => {
        const addEntry = execPrice ?? pyramidSignal.entry;
        // Actualizar el pyramidCount de la posición original
        setOpenPositions(prev => prev.map(p =>
          p.id === pos.id
            ? { ...p, pyramidCount: (p.pyramidCount ?? 0) + 1 }
            : p
        ));
        // Agregar la nueva posición add como posición independiente (con ref a padre)
        setOpenPositions(prev => [...prev, {
          id: ticket ?? Date.now(),
          signal: { ...pyramidSignal, entry: addEntry },
          size: addSize, marginUsed: addMargin,
          openedAt: new Date().toISOString(),
          peak: addEntry, trough: addEntry,
          parentId: pos.id,  // referencia a la posición original
        }]);
        pushToast(
          `📈 PYRAMID +${addSize.toFixed(3)}L ${pos.signal.asset} ${pos.signal.direction}` +
          ` @ ${addEntry.toFixed(2)} | add #${(pos.pyramidCount ?? 0) + 1}`,
          "success"
        );
      });
    }
  }

  async function runAutoScan() {
    // Sincronizar datos frescos antes de escanear
    if (mt5Enabled && mt5Status === "connected") await syncRealData();
    const prof       = getSessionProfile();
    const sessionName = prof.name.split(" ")[0]; // "NY", "London", "Asia", etc.
    const hourUTC     = new Date().getUTCHours();
    const ALL_ASSETS  = assets;

    // ── Filtrar por sesión si es crypto-only ────────────────────────────────
    const sessionFiltered = prof.isCryptoOnly
      ? ALL_ASSETS.filter(a => isCryptoAsset(a))
      : ALL_ASSETS.filter(a => {
          // Excluir activos no apropiados para la sesión actual según catálogo
          const cat = getAssetCatalog(a);
          if (cat.sessions.length === 0) return true; // sin restricción
          return cat.sessions.some(s => sessionName.includes(s) || s.includes(sessionName));
        });

    if (sessionFiltered.length === 0) return;

    // ── Calcular opportunityScore y ordenar ─────────────────────────────────
    const openSymbols = openPositionsRef.current.map(p => p.signal.asset);
    const scored = sessionFiltered.map(a => ({
      asset: a,
      score: calcOpportunityScore(
        a, assetIntelRef.current[a], sessionName, hourUTC,
        openSymbols, correlationRef.current
      )
    })).sort((a, b) => b.score - a.score);

    // Actualizar correlación cada 5 ciclos (~1-2min con scan cada 15s)
    if (Math.random() < 0.2) {
      updateCorrelationMatrix(seriesRef.current);
    }

    const prevLen = openPositionsRef.current.length;

    // ── Scalping: todos ordenados por score ──────────────────────────────────
    for (const { asset: a } of scored) {
      await createSignalAndExecute("scalping", a, false);
    }

    // ── Intradía: solo en sesiones institucionales (no crypto-only) ─────────
    if (!prof.isCryptoOnly) {
      for (const { asset: a } of scored) {
        await createSignalAndExecute("intradia", a, false);
      }
    }

    // ── Pyramiding ───────────────────────────────────────────────────────────
    const posWithTP1 = openPositionsRef.current.filter(p =>
      p.tp1Hit && !p.isPyramidAdd && (p.pyramidCount ?? 0) < 2
    );
    for (const pos of posWithTP1) await tryPyramidAdd(pos);

    const opened = openPositionsRef.current.length - prevLen;
    if (opened > 0) pushToast(`🤖 ${prof.emoji} ${prof.name}: ${opened} posición(es) abierta(s)`, "success");
  }

  useEffect(() => { void syncRealData(); }, []);
  // Sync de posiciones MT5 cada 1 segundo si hay posiciones abiertas
  useEffect(() => {
    if (!mt5Enabled || mt5Status !== "connected") return;
    const id = window.setInterval(() => {
      const hasOpenPositions = mt5PositionsRef.current.length > 0 || openPositionsRef.current.length > 0;
      if (hasOpenPositions) void syncMT5State();
    }, 1000);
    return () => window.clearInterval(id);
  }, [mt5Enabled, mt5Status]);

  // AutoScan: genera señales y sincroniza datos de mercado
  useEffect(() => {
    if (!autoScan) return;
    const ms = Math.max(8, scanEverySec) * 1000;
    const id = window.setInterval(() => {
      void (async () => {
        // CRÍTICO: sync primero, luego scan — sin datos frescos no tiene sentido scanear
        await syncRealData();
        await runAutoScan();
        if (mt5Enabled && mt5Status === "connected") void syncMT5State();
      })();
    }, ms);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, scanEverySec, mt5Enabled, mt5Status]);

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
      // Costos reales: spread estimado 0.06% + comisión 0.02% ida y vuelta
      const costPct   = mode === "scalping" ? 0.0010 : 0.0006; // scalping más caro por mayor spread relativo
      const tradeCost = entry * size * costPct;
      const rawPnl    = dir === "LONG" ? (exit - entry) * size : (entry - exit) * size;
      const pnl       = rawPnl - tradeCost;
      equityBt += pnl;
      simulated.push({ id: Date.now() + i, asset: sa, mode, direction: dir, entry, exit, pnl, pnlPct: (pnl / Math.max((size * entry) / getLeverage(sa), 0.01)) * 100, result, openedAt: new Date(Date.now() - 60000 * 30).toISOString(), closedAt: new Date().toISOString(), source: "backtest" });
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
    { id: "aprendizaje" as AppTab, label: "Aprendizaje", icon: "🧠" },
    { id: "activos" as AppTab, label: "Activos IA", icon: "🌐" },
    { id: "configuracion" as AppTab, label: "Config", icon: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <ToastList toasts={toasts} onRemove={removeToast} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(10,11,16,0.96)", backdropFilter: "blur(16px)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 24px", height: 52, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
          <span style={{ fontSize: 17 }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>TraderLab</span>
          <span style={{ fontSize: 11, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "2px 5px", borderRadius: 4, fontWeight: 600 }}>v5</span>
        </div>
        <div className="nav-tabs" style={{ flex: 1 }}>
          {NAV.map(t => (
            <button key={t.id} onClick={() => setAppTab(t.id)}
              className={`nav-tab${appTab === t.id ? " active" : ""}`}>
              {t.icon} {t.label}
              {t.id === "trading" && openPositions.length > 0 && <span style={{ background: "#10b981", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: "50%", width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>{openPositions.length}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AiBadge status={aiStatus} onTest={testAiConnection} latency={aiLatency} />
          {usingGroq && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6,
              background: groqRateInfo.paused ? "rgba(239,68,68,0.12)" : groqRateInfo.calls >= GROQ_MAX_RPM - 5 ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.08)",
              border: `1px solid ${groqRateInfo.paused ? "rgba(239,68,68,0.3)" : groqRateInfo.calls >= GROQ_MAX_RPM - 5 ? "rgba(245,158,11,0.3)" : "rgba(16,185,129,0.2)"}`,
              fontSize: 10, fontWeight: 700,
              color: groqRateInfo.paused ? "#ef4444" : groqRateInfo.calls >= GROQ_MAX_RPM - 5 ? "#f59e0b" : "#10b981",
              cursor: "pointer", title: "Click para pausar/reanudar Groq manualmente" }}
              onClick={() => {
                groqPausedRef.current = !groqPausedRef.current;
                setGroqRateInfo(p => ({ ...p, paused: groqPausedRef.current, pauseUntil: 0 }));
                pushToast(groqPausedRef.current ? "⏸ Groq pausado manualmente" : "▶ Groq reanudado", "info");
              }}>
              {groqRateInfo.paused ? "⏸" : "⚡"} {groqRateInfo.calls}/{GROQ_MAX_RPM} rpm
            </div>
          )}
          {circuitOpen && (
            <div style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", fontSize: 11, fontWeight: 800, color: "#ef4444",
              cursor: "pointer" }}
              title="Click para resetear el circuit breaker manualmente"
              onClick={() => { circuitOpenRef.current = false; setCircuitOpen(false); pushToast("🟢 Circuit breaker reseteado manualmente", "info"); }}>
              🔴 CIRCUIT BREAKER — click para resetear
            </div>
          )}
          <div style={{ fontSize: 10, color: liveReady ? "#10b981" : "#6b7280", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: liveReady ? "#10b981" : "#6b7280", animation: liveReady ? "pulse 2s infinite" : "none", display: "inline-block" }} />
            {feedStatus}
          </div>
          {/* Badge sesión activa */}
          {(() => { try {
            const sp = getSessionProfile();
            const bgMap: Record<string,string> = {
              "NY":             "rgba(16,185,129,0.15)",
              "London":         "rgba(59,130,246,0.15)",
              "Finde — Crypto": "rgba(168,85,247,0.15)",
              "Asia — Crypto":  "rgba(245,158,11,0.15)",
              "Post-NY — Crypto":"rgba(99,102,241,0.15)",
            };
            const colorMap: Record<string,string> = {
              "NY":             "#10b981",
              "London":         "#3b82f6",
              "Finde — Crypto": "#a855f7",
              "Asia — Crypto":  "#f59e0b",
              "Post-NY — Crypto":"#818cf8",
            };
            const bg    = bgMap[sp.name]    ?? "rgba(99,102,241,0.12)";
            const color = colorMap[sp.name] ?? "#a5b4fc";
            return (
              <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: bg, color, border: `1px solid ${color}40`, whiteSpace: "nowrap" }}
                title={sp.description}>
                {sp.emoji} {sp.name}
                {sp.isCryptoOnly && <span style={{ marginLeft: 5, opacity: 0.8 }}>BTC·ETH</span>}
              </div>
            );
          } catch(e){console.error("[render]",e);return null;}})()}
        </div>
      </nav>

      {/* Header metrics + Equity Curve */}
      <div style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "12px 20px" }}>
        <div className="header-metrics" style={{ maxWidth: 1440, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          {[
            // Cuando MT5 está conectado: mostrar datos reales del broker
            { label: "Balance",
              value: mt5Enabled && mt5Balance !== null ? `$${(mt5Balance ?? 0).toFixed(2)}` : money(balance),
              color: "var(--text)" },
            { label: "Patrimonio",
              value: mt5Enabled && mt5Equity !== null ? `$${(mt5Equity ?? 0).toFixed(2)}` : money(equity),
              color: mt5Enabled && mt5Equity !== null && mt5Balance !== null
                ? (mt5Equity >= mt5Balance ? "#10b981" : "#ef4444")
                : (equity >= balance ? "#10b981" : "#ef4444") },
            { label: "P&L abierto",
              value: mt5Enabled && mt5Positions.length > 0
                ? money(mt5Positions.reduce((a, p) => a + p.profit, 0))
                : money(unrealized),
              color: (mt5Enabled && mt5Positions.length > 0
                ? mt5Positions.reduce((a, p) => a + p.profit, 0)
                : unrealized) >= 0 ? "#10b981" : "#ef4444" },
            { label: "Win rate", value: `${(stats.winRate ?? 0).toFixed(1)}%`, color: stats.winRate >= 50 ? "#10b981" : "#ef4444" },
            { label: "Factor ganancia", value: (stats.profitFactor ?? 0).toFixed(2), color: stats.profitFactor >= 1.5 ? "#10b981" : "var(--text)" },
            { label: "Sharpe", value: (stats.sharpe ?? 0).toFixed(2), color: stats.sharpe >= 1 ? "#10b981" : "var(--text)" },
            { label: "Trades reales", value: realTrades.length, color: "var(--muted)" },
            { label: mt5Enabled && mt5Margin !== null ? "Margen usado": "Margen usado",
              value: mt5Enabled && mt5Margin !== null ? `$${(mt5Margin ?? 0).toFixed(2)}` : money(openPositions.reduce((a,p)=>a+p.marginUsed,0)),
              color: "var(--muted)" },
            { label: mt5Enabled && mt5FreeMargin !== null ? "Margen libre" : "Posiciones",
              value: mt5Enabled && mt5FreeMargin !== null
                ? `$${(mt5FreeMargin ?? 0).toFixed(2)}${mt5MarginLevel !== null ? ` (${(mt5MarginLevel ?? 0).toFixed(0)}%)` : ""}`
                : String(openPositions.length + (mt5Positions.length > 0 ? ` (+${mt5Positions.length} MT5)` : "")),
              color: mt5Enabled && mt5MarginLevel !== null
                ? (mt5MarginLevel > 500 ? "#10b981" : mt5MarginLevel > 200 ? "#f59e0b" : "#ef4444")
                : (openPositions.length > 0 || mt5Positions.length > 0 ? "#f59e0b" : "var(--muted)") },
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
            </div>
          )}
        </div>
      </div>

      <main className="main-wrap" style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 24px" }}>

        {/* ━━━━━━━━━ TRADING ━━━━━━━━━ */}
        {appTab === "trading" && (
          <ErrorBoundary key="trading-tab">
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
                  {(() => { try {
                    // Categorías dinámicas — usa availableSymbols si hay datos del broker
                    // sino usa los assets fijos con grupos hardcodeados
                    const CAT_LABEL: Record<string, string> = {
                      crypto: "⬡ Crypto", metals: "◈ Metales",
                      forex_major: "₣ Forex Major", forex_minor: "₣ Forex Minor",
                      indices: "▲ Índices", energy: "⛽ Energía",
                      stocks: "📈 Acciones", commodities: "🌾 Commodities", other: "📦 Otros",
                    };
                    // Orden de categorías en el select
                    const CAT_ORDER = ["crypto","metals","forex_major","forex_minor","indices","energy","stocks","commodities","other"];

                    // Construir mapa nombre → categoría desde availableSymbols
                    const symCatMap: Record<string, string> = {};
                    availableSymbols.forEach(s => { symCatMap[s.name] = s.category; });
                    // Fallback: inferir desde ASSET_CATALOG
                    assets.forEach(a => {
                      if (!symCatMap[a]) symCatMap[a] = ASSET_CATALOG[a]?.category ?? "other";
                    });

                    // Agrupar por categoría
                    const groups: Record<string, string[]> = {};
                    assets.forEach(a => {
                      const cat = symCatMap[a] ?? "other";
                      if (!groups[cat]) groups[cat] = [];
                      groups[cat].push(a);
                    });

                    return CAT_ORDER
                      .filter(cat => groups[cat]?.length)
                      .map(cat => (
                        <optgroup key={cat} label={CAT_LABEL[cat] ?? cat}>
                          {groups[cat].map(a => (
                            <option key={a} value={a}>
                              {getAssetLabel(a)}
                              {availableSymbols.find(s=>s.name===a)?.brokerName && availableSymbols.find(s=>s.name===a)?.brokerName !== a
                                ? ` (${availableSymbols.find(s=>s.name===a)?.brokerName})`
                                : ""}
                            </option>
                          ))}
                        </optgroup>
                      ));
                  } catch(e){console.error("[render]",e);return null;}})()}
                </select>
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  {(()=>{ try {
                    const ss = spreadSnapshot[asset];
                    const dp = asset === "BTCUSD" || asset === "ETHUSD" ? 2 : asset === "XAUUSD" ? 2 : 4;
                    return [[
                      ["Precio", (prices[asset] ?? 0).toFixed(dp)],
                      ["Bid", ss && ss.bid != null ? (ss.bid).toFixed(dp) : "-"],
                      ["Ask", ss && ss.ask != null ? (ss.ask).toFixed(dp) : "-"],
                      ["Spread $", ss && ss.spread != null ? `$${(ss.spread ?? 0).toFixed(dp === 2 ? 2 : 4)}` : "-"],
                      ["Spread", ss && ss.spreadPct != null ? `${(ss.spreadPct ?? 0).toFixed(3)}% ${mt5SpreadMap[asset] ? "📡 real" : "~ estimado"}` : "-"],
                      ["Sesión", ss ? ss.sessionLabel : "-"],
                      ["Vol", ss?.isHighVolume ? "⚠ ALTA" : "Normal"],
                      ["Leverage", `${getLeverage(asset)}× ${mt5LeverageMap[asset] ? "📡" : "~"}`],
                    ]];
                  } catch(e){console.error("[render]",e);return null;}})()[0].map(([k, v]) => (
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
                <button className="btn-secondary" onClick={() => void syncRealData()} disabled={isSyncing}>{isSyncing ? "⟳ Sincronizando..." : "↻ Sync MT5 Bridge"}</button>
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
                      <span style={{ color: edge >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>{(edge ?? 0) >= 0 ? "+" : ""}{(edge ?? 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="card" style={{ fontSize: 11 }}>
                <p className="label" style={{ marginBottom: 5 }}>Modelo (solo trades reales)</p>
                {[["Trailing ATR", (learning.atrTrailMult ?? 0.35).toFixed(2)], ["TP scalp", `${(learning.scalpingTpAtr ?? 2.4).toFixed(2)} ATR`], ["TP intradía", `${(learning.intradayTpAtr ?? 5.0).toFixed(2)} ATR`], ["Piso conf.", `${(learning.confidenceFloor ?? 52).toFixed(0)}%`], ["Escala riesgo", `${(learning.riskScale ?? 1).toFixed(2)}×`]].map(([k, v]) => (
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
                    <p style={{ fontSize: 11, color: "var(--muted)" }}>{tab === "intradia" ? "Intradía / Swing · Wyckoff 4H+1D" : "Scalping · Order Flow 1m"} · MT5 / PrimeXBT</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setShowIndicators(p => !p)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: showIndicators ? "rgba(99,102,241,0.15)" : "transparent", color: showIndicators ? "#a5b4fc" : "var(--muted)", cursor: "pointer", fontWeight: 600 }}>
                      {showIndicators ? "● Indicadores" : "○ Indicadores"}
                    </button>
                    {lastSignal && lastSignal.asset === asset && lastSignal.mtf && (
                      <div style={{ display: "flex", gap: 6, fontSize: 10, color: "var(--muted)" }}>
                        {([["HTF", lastSignal.mtf.htf ?? 0], ["LTF", lastSignal.mtf.ltf ?? 0], ["Exec", lastSignal.mtf.exec ?? 0]] as [string,number][]).map(([k, v]) => (
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

              {/* Wyckoff — solo intradía, contexto macro 4H+1D */}
              {tab === "intradia" && currentWyckoff && (
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <p className="label" style={{ margin: 0 }}>
                      <TechTip term="Wyckoff">Wyckoff</TechTip> — Contexto macro
                    </p>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(99,102,241,0.15)", color: "#a5b4fc", fontWeight: 700 }}>4H + 1D</span>
                    {(currentWyckoff as WyckoffAnalysis & { tf4h?: unknown; tf1d?: unknown }).tf4h === null &&
                     (currentWyckoff as WyckoffAnalysis & { tf4h?: unknown; tf1d?: unknown }).tf1d === null && (
                      <span style={{ fontSize: 10, color: "#f59e0b" }}>⚠ Sin datos bridge</span>
                    )}
                  </div>
                  <WyckoffPanel wyckoff={currentWyckoff} />
                </div>
              )}
              {tab === "scalping" && (
                <div className="card" style={{ padding: "10px 12px", opacity: 0.55 }}>
                  <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                    🔍 Wyckoff no aplica en scalping — el Order Flow es la autoridad en 1m
                  </p>
                </div>
              )}

              {/* Last signal */}
              {lastSignal && (
                <div className="card" style={{ borderLeft: `3px solid ${lastSignal.direction === "LONG" ? "#10b981" : "#ef4444"}`, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <p className="label">Última señal</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {/* Diagnóstico inline de por qué abre/no abre */}
                      {(() => { try {
                        const lrn = learningRef.current;
                        const floor = lastSignal.mode === "scalping"
                          ? Math.max(46, lrn.confidenceFloor - 4)
                          : Math.max(50, lrn.confidenceFloor);
                        const rr = Math.abs(lastSignal.tp2 - lastSignal.entry) /
                                   Math.max(Math.abs(lastSignal.entry - lastSignal.stopLoss), 1e-9);
                        const confOk = lastSignal.confidence >= floor;
                        const rrOk   = rr >= 1.5;
                        return (
                          <div style={{ fontSize: 10, display: "flex", gap: 5 }}>
                            <span style={{ padding: "2px 6px", borderRadius: 4, fontWeight: 700,
                              background: confOk ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                              color: confOk ? "#10b981" : "#ef4444" }}>
                              conf {(lastSignal.confidence ?? 0).toFixed(0)}% {confOk ? "✓" : `✗ (piso ${floor})`}
                            </span>
                            <span style={{ padding: "2px 6px", borderRadius: 4, fontWeight: 700,
                              background: rrOk ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                              color: rrOk ? "#10b981" : "#ef4444" }}>
                              RR {(rr ?? 0).toFixed(2)} {rrOk ? "✓" : "✗"}
                            </span>
                          </div>
                        );
                      } catch(e){console.error("[render]",e);return null;}})()}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
                    {/* Entrada + SL */}
                    {[["Entrada", (lastSignal.entry ?? 0).toFixed(2), "var(--text)"], ["Stop Loss", (lastSignal.stopLoss ?? 0).toFixed(2), "#ef4444"]].map(([k, v, c]) => (
                      <div key={k as string} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
                        <p style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</p>
                        <p style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: c as string }}>{v}</p>
                      </div>
                    ))}
                    {/* RR calculado */}
                    <div style={{ background: "rgba(99,102,241,0.08)", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
                      <p style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>RR</p>
                      <p style={{ fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#818cf8" }}>
                        {(Math.abs(lastSignal.tp2 - lastSignal.entry) / Math.max(Math.abs(lastSignal.entry - lastSignal.stopLoss), 0.001)).toFixed(2)}×
                      </p>
                    </div>
                  </div>
                  {/* TPs escalonados */}
                  <div style={{ display: "grid", gridTemplateColumns: lastSignal.tp3 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 5, marginBottom: 8 }}>
                    {[
                      { label: lastSignal.mode === "scalping" ? "TP1 (rápido)" : "TP1", val: lastSignal.tp1, color: "#10b981" },
                      { label: lastSignal.mode === "scalping" ? "TP2 (objetivo)" : "TP2", val: lastSignal.tp2, color: "#059669" },
                      ...(lastSignal.tp3 ? [{ label: "TP3 (extensión)", val: lastSignal.tp3, color: "#047857" }] : []),
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ background: "rgba(16,185,129,0.06)", borderRadius: 6, padding: "5px 8px", textAlign: "center", border: "1px solid rgba(16,185,129,0.15)" }}>
                        <p style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>{label}</p>
                        <p style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color }}>{(val ?? 0).toFixed(2)}</p>
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
                {/* ── Posiciones REALES de MT5 ── */}
                {mt5Enabled && mt5Status === "connected" && mt5Positions.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      📡 Posiciones MT5 Reales ({mt5Positions.length})
                    </div>
                    {mt5Positions.map(p => {
                      const pnlColor = p.profit >= 0 ? "#10b981" : "#ef4444";
                      const isLong = p.type === "LONG";
                      return (
                        <div key={p.ticket} className="live-card" style={{ borderLeft: `3px solid ${isLong ? "#10b981" : "#ef4444"}`, marginBottom: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: isLong ? "#10b981" : "#ef4444", animation: "pulse 1.5s infinite", display: "inline-block" }} />
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{p.symbol}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                                background: isLong ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                                color: isLong ? "#10b981" : "#ef4444" }}>{p.type}</span>
                              <span style={{ fontSize: 10, color: "#6366f1", background: "rgba(99,102,241,0.1)", padding: "2px 6px", borderRadius: 4 }}>#{p.ticket}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontWeight: 700, fontSize: 15, color: pnlColor }}>
                                {(p.profit ?? 0) >= 0 ? "+" : ""}{(p.profit ?? 0).toFixed(2)} USD
                              </span>
                              <button
                                onClick={() => closeInMT5ByTicket(p.ticket, p.asset)}
                                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)",
                                  background: "rgba(239,68,68,0.12)", color: "#ef4444", cursor: "pointer", fontWeight: 700 }}>
                                Cerrar
                              </button>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
                            <span>Entrada: <strong style={{ color: "var(--ink)" }}>{(p.open_price ?? 0).toFixed((p.open_price ?? 0) > 100 ? 2 : 4)}</strong></span>
                            <span>Actual: <strong style={{ color: pnlColor }}>{(p.current ?? 0).toFixed((p.current ?? 0) > 100 ? 2 : 4)}</strong></span>
                            {(p.sl ?? 0) > 0 && <span>SL: <strong style={{ color: "#ef4444" }}>{(p.sl ?? 0).toFixed((p.sl ?? 0) > 100 ? 2 : 4)}</strong></span>}
                            {(p.tp ?? 0) > 0 && <span>TP: <strong style={{ color: "#10b981" }}>{(p.tp ?? 0).toFixed((p.tp ?? 0) > 100 ? 2 : 4)}</strong></span>}
                            <span>Vol: <strong>{p.volume}</strong></span>
                            <span style={{ marginLeft: "auto", color: "#6366f1" }}>
                              {new Date(p.time).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      onClick={syncMT5State}
                      style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.3)",
                        background: "rgba(99,102,241,0.08)", color: "#a5b4fc", cursor: "pointer", width: "100%", marginTop: 4 }}>
                      ↻ Actualizar posiciones MT5
                    </button>
                  </div>
                )}

                {mt5Enabled && mt5Status === "connected" && mt5Positions.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 0", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>📡 Sin posiciones abiertas en MT5</span>
                    <button onClick={syncMT5State} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>↻</button>
                  </div>
                )}

                {/* ── Posiciones simuladas del motor ── */}
                {openPositions.length === 0
                  ? <div className="card" style={{ textAlign: "center", padding: "22px", color: "var(--muted)", fontSize: 12 }}>Sin posiciones abiertas</div>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {openPositions.map(p => <LivePositionCard key={p.id} position={p} prices={prices} spreadByAsset={spreadByAsset} now={now} onClose={pos => void closePosition(pos, prices[pos.signal.asset], "REVERSAL")} />)}
                    </div>
                }
              </div>

              {/* Equity curve movida al header global */}
            </div>

            {/* Der */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <AiChatPanel
                apiKey={apiKey} usingGroq={usingGroq} groqModel={groqModel}
                onGroqCall={trackGroqCall} canGroqCall={canCallGroq}
                openPositions={openPositions} realTrades={realTrades}
                lastSignal={lastSignal} prices={prices} stats={stats}
                correlationMatrix={correlationMatrix}
                assetIntelligence={assetIntelligence}
              />
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Estadísticas — trades reales</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {[["Trades", stats.total], ["Win rate", `${(stats.winRate ?? 0).toFixed(1)}%`], ["Expectativa", money(stats.expectancy)], ["Factor gan.", (stats.profitFactor ?? 0).toFixed(2)], ["Sharpe", (stats.sharpe ?? 0).toFixed(2)], ["Max DD", `${(stats.maxDrawdown ?? 0).toFixed(1)}%`], ["P&L total", money(stats.pnl)], ["Posiciones", openPositions.length], ["Kelly %", riskMetrics.kellyFraction > 0 ? `${(riskMetrics.kellyFraction*100).toFixed(1)}%` : "N/D"], ["Ruina", riskMetrics.ruinProb !== undefined ? `${(riskMetrics.ruinProb ?? 0).toFixed(0)}%` : "N/D"]].map(([l, v]) => (
                    <div key={l} className="metric"><span className="label" style={{ fontSize: 11, fontWeight: 600 }}>{l}</span><strong style={{ fontSize: 13 }}>{v}</strong></div>
                  ))}
                </div>
              </div>

              {/* Wyckoff macro — todos los activos (solo intradía) */}
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <p style={{ fontWeight: 700, fontSize: 13, margin: 0 }}>
                    <TechTip term="Wyckoff">Wyckoff</TechTip> macro
                  </p>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, background: "rgba(99,102,241,0.15)", color: "#a5b4fc", fontWeight: 600 }}>4H · 1D</span>
                </div>
                {assets.map(a => {
                  const w = wyckoffMap[a] as (WyckoffAnalysis & { tf4h?: WyckoffAnalysis | null; tf1d?: WyckoffAnalysis | null }) | undefined;
                  if (!w) return <div key={a} style={{ fontSize: 10, color: "var(--muted)", padding: "3px 0" }}>{a}: sin datos</div>;
                  const col = w.bias === "accumulation" ? "#10b981" : w.bias === "distribution" ? "#ef4444" : "#6b7280";
                  const has4h = w.tf4h && w.tf4h.phase !== "unknown";
                  const has1d = w.tf1d && w.tf1d.phase !== "unknown";
                  return (
                    <div key={a} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, minWidth: 56, color: "var(--text)" }}>{a}</span>
                        <span style={{ fontSize: 10, color: col, fontWeight: 700 }}>
                          {w.bias === "neutral" ? "Neutral" : w.bias === "accumulation" ? "Acum." : "Dist."}
                        </span>
                        {w.phase !== "unknown" && (
                          <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, background: `${col}20`, color: col, fontWeight: 700 }}>F{w.phase}</span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>
                          {w.events.slice(-1)[0]?.label ?? "–"}
                        </span>
                      </div>
                      {/* Sub-row: 4H y 1D */}
                      <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 9.5, color: "var(--muted)" }}>
                        <span style={{ color: has4h ? col : "var(--muted)" }}>
                          4H: {has4h ? `${w.tf4h!.bias === "accumulation" ? "Acum" : w.tf4h!.bias === "distribution" ? "Dist" : "Neu"} F${w.tf4h!.phase}` : "sin datos"}
                        </span>
                        <span style={{ color: has1d ? col : "var(--muted)" }}>
                          1D: {has1d ? `${w.tf1d!.bias === "accumulation" ? "Acum" : w.tf1d!.bias === "distribution" ? "Dist" : "Neu"} F${w.tf1d!.phase}` : "sin datos"}
                        </span>
                      </div>
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
                <p>Fuente: MT5 Bridge / PrimeXBT</p>
                <p>Velas 1m/5m/15m/4H/1D en tiempo real</p>
                <p>Wyckoff: velas 4H + 1D (contexto macro)</p>
                <p>Trail: {(learning.atrTrailMult ?? 0.35).toFixed(2)} ATR</p>
              </div>
            </div>
          </div>
          </ErrorBoundary>
        )}

        {/* ━━━━━━━━━ BACKTEST ━━━━━━━━━ */}
        {appTab === "backtest" && (
          <ErrorBoundary key="backtest-tab"><BacktestTab liveReady={liveReady} backtestSize={backtestSize} setBacktestSize={setBacktestSize}
            riskPct={riskPct} setRiskPct={setRiskPct} runBacktest={runBacktest}
            lastBacktest={lastBacktest} backtestTrades={backtestTrades} /></ErrorBoundary>
        )}

        {/* ━━━━━━━━━ APRENDIZAJE ━━━━━━━━━ */}
        {appTab === "aprendizaje" && (
          <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── Parámetros adaptativos editables ── */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>🧠 Parámetros adaptativos</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
                    Se ajustan automáticamente con cada trade. Podés editarlos manualmente.
                  </span>
                  <button onClick={() => { setLearning(initialLearning); learningRef.current = initialLearning; pushToast("🧠 Aprendizaje reseteado", "info"); }}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
                    Reset
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {/* riskScale */}
                {[
                  { key: "riskScale",       label: "Escala de riesgo",     min: 0.3,  max: 2.5,  step: 0.05, desc: "Multiplica el riesgo por operación. >1 = más agresivo, <1 = defensivo." },
                  { key: "confidenceFloor", label: "Piso de confianza (%)", min: 40,   max: 80,   step: 1,    desc: "Confianza mínima para abrir una operación. Más alto = menos trades." },
                  { key: "scalpingTpAtr",   label: "TP Scalping (×ATR)",   min: 0.8,  max: 3.5,  step: 0.05, desc: "Distancia del take profit en scalping medida en ATR." },
                  { key: "intradayTpAtr",   label: "TP Intradía (×ATR)",   min: 1.5,  max: 8.0,  step: 0.1,  desc: "Distancia del take profit en intradía medida en ATR." },
                  { key: "atrTrailMult",    label: "Buffer trailing (×ATR)", min: 0.1, max: 1.2,  step: 0.05, desc: "Buffer debajo del swing para el trailing stop. Más chico = stop más ajustado." },
                ].map(({ key, label, min, max, step, desc }) => {
                  const val = learning[key as keyof LearningModel] as number;
                  const pct = ((val - min) / (max - min)) * 100;
                  return (
                    <div key={key} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{label}</span>
                        <span style={{ fontWeight: 800, fontSize: 15, color: "#6366f1" }}>{(val ?? 0).toFixed(2)}</span>
                      </div>
                      <input type="range" min={min} max={max} step={step} value={val}
                        onChange={e => {
                          const next = { ...learning, [key]: Number(e.target.value) };
                          setLearning(next); learningRef.current = next;
                        }}
                        style={{ width: "100%", accentColor: "#6366f1", margin: "6px 0" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>
                        <span>{min}</span><span>{max}</span>
                      </div>
                      <p style={{ fontSize: 10, color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>{desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Cómo aprende el bot ── */}
            <div className="card">
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📐 Lógica de aprendizaje automático</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                {[
                  { param: "Escala de riesgo", formula: `0.8 + WR×0.6 + exp×0.03`, range: "0.7 – 1.5", effect: "Con WR 60%: riskScale=1.16. Con WR 30%: riskScale=0.98." },
                  { param: "Piso confianza",   formula: `52 + (0.5−WR)×16`,         range: "48 – 62",  effect: "Con WR 40%: floor=53.6. Con WR 60%: floor=50.4. Solo aplica con ≥10 trades." },
                  { param: "TP Scalping",      formula: `1.2 + WR×0.4`,             range: "1.15 – 1.8", effect: "Con WR 55%: TP=1.42×ATR. Con WR 30%: TP=1.32×ATR." },
                  { param: "TP Intradía",      formula: `3.0 + WR×1.5`,             range: "2.8 – 5.0", effect: "Con WR 55%: TP=3.83×ATR. Con WR 30%: TP=3.45×ATR." },
                  { param: "Buffer trailing",  formula: `0.25 + WR×0.3`,            range: "0.2 – 0.6", effect: "Con WR 55%: buffer=0.42×ATR. Con WR 30%: buffer=0.34×ATR." },
                  { param: "Hour Edge",        formula: "avg(PnL por hora del día)",  range: "libre",    effect: "Registra qué horas son rentables. No bloquea, solo informa." },
                ].map(({ param, formula, range, effect }) => (
                  <div key={param} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontWeight: 700, color: "#a5b4fc", fontSize: 12, marginBottom: 4 }}>{param}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "#6366f1", marginBottom: 4 }}>{formula}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>Rango: {range}</div>
                    <div style={{ fontSize: 11, color: "var(--text)" }}>{effect}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Hour Edge ── */}
            {Object.keys(learning.hourEdge).length > 0 && (
              <div className="card">
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🕐 Rendimiento por hora (Hour Edge)</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const edge = learning.hourEdge[h];
                    if (edge === undefined) return (
                      <div key={h} style={{ width: 44, textAlign: "center", padding: "6px 4px", borderRadius: 6, background: "rgba(255,255,255,0.03)", fontSize: 10, color: "var(--muted)" }}>
                        <div style={{ fontWeight: 700 }}>{h}h</div>
                        <div>—</div>
                      </div>
                    );
                    return (
                      <div key={h} style={{ width: 44, textAlign: "center", padding: "6px 4px", borderRadius: 6,
                        background: edge > 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.1)",
                        border: `1px solid ${edge > 0 ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.2)"}`,
                        fontSize: 10 }}>
                        <div style={{ fontWeight: 700, color: "var(--muted)" }}>{h}h</div>
                        <div style={{ fontWeight: 800, color: edge > 0 ? "#10b981" : "#ef4444" }}>{edge > 0 ? "+" : ""}{(edge ?? 0).toFixed(1)}</div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, margin: "10px 0 0" }}>
                  P&L promedio por hora de cierre. Verde = hora rentable históricamente. El bot no bloquea horas malas, solo te informa.
                </p>
              </div>
            )}

            {/* ── Rendimiento por activo + modo ── */}
            {Object.keys(learning.assetEdge ?? {}).length > 0 && (
              <div className="card">
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Performance por activo y modo</p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Activo", "Modo", "Trades", "Win %", "P&L", "Mejor hora", "Confianza adj."].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, textTransform: "uppercase",
                            letterSpacing: "0.08em", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(learning.assetEdge ?? {}).sort((a, b) => (b[1]?.pnl ?? 0) - (a[1]?.pnl ?? 0)).map(([key, ae]) => {
                        if (!ae) return null;
                        const [asset, mode] = key.split("_");
                        const wr = ae.total > 0 ? (ae.wins / ae.total * 100) : 0;
                        const bestH = Object.entries(ae.byHour).sort((a, b) => b[1] - a[1])[0];
                        const aeBonus = ae.total >= 5 ? clamp((wr / 100 - 0.5) * 20, -8, 8) : 0;
                        return (
                          <tr key={key}>
                            <td style={{ padding: "7px 10px", fontWeight: 700 }}>{asset}</td>
                            <td style={{ padding: "7px 10px", color: mode === "scalping" ? "#818cf8" : "#f59e0b" }}>{mode}</td>
                            <td style={{ padding: "7px 10px" }}>{ae.total}</td>
                            <td style={{ padding: "7px 10px", color: wr >= 50 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{(wr ?? 0).toFixed(1)}%</td>
                            <td style={{ padding: "7px 10px", color: ae.pnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                              {ae.pnl >= 0 ? "+" : ""}{(ae.pnl ?? 0).toFixed(2)}
                            </td>
                            <td style={{ padding: "7px 10px", color: "var(--muted)" }}>
                              {bestH ? `${bestH[0]}h (+${bestH[1].toFixed(2)})` : "—"}
                            </td>
                            <td style={{ padding: "7px 10px", color: aeBonus > 0 ? "#10b981" : aeBonus < 0 ? "#ef4444" : "var(--muted)", fontWeight: 700 }}>
                              {ae.total >= 5 ? `${aeBonus >= 0 ? "+" : ""}${(aeBonus ?? 0).toFixed(1)} pts` : "< 5 trades"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                  Con ≥5 trades por activo+modo, el bot ajusta la confianza de señales futuras (±8 puntos).
                </p>
              </div>
            )}

            {/* ── Diagnóstico de por qué no abre trades ── */}
            <div className="card">
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>🔍 Diagnóstico en tiempo real</p>

              {/* Señal en vivo para debug */}
              {(() => { try {
                const dbgAsset = asset;
                const dbgSeries = series[dbgAsset] ?? [];
                const dbgCandles = candles[dbgAsset] ?? [];
                const dbgC5m = candles5m[dbgAsset] ?? [];
                const dbgC15m = candles15m[dbgAsset] ?? [];
                const dbgPrice = prices[dbgAsset] ?? 0;
                const lrn = learningRef.current ?? { confidenceFloor: 52, atrTrailMult: 0.35, scalpingTpAtr: 2.4, intradayTpAtr: 5.0, riskScale: 1, hourEdge: {}, assetEdge: {} };
                const floor = tab === "scalping"
                  ? Math.max(46, lrn.confidenceFloor - 4)
                  : Math.max(50, lrn.confidenceFloor);
                return (
                  <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8,
                    background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)",
                    fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
                    <div style={{ fontWeight: 700, color: "#a5b4fc", marginBottom: 6, fontFamily: "inherit", display: "flex", justifyContent: "space-between" }}>
                      <span>📡 Datos bridge — {dbgAsset}</span>
                      {lastSignal && lastSignal.asset === dbgAsset && lastSignal.reversalScore >= 3 && (
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                          background: lastSignal.reversalScore >= 7 ? "rgba(16,185,129,0.2)" : lastSignal.reversalScore >= 5 ? "rgba(245,158,11,0.2)" : "rgba(99,102,241,0.15)",
                          color: lastSignal.reversalScore >= 7 ? "#10b981" : lastSignal.reversalScore >= 5 ? "#f59e0b" : "#a5b4fc" }}>
                          🔄 Giro {lastSignal.reversalScore}/9
                        </span>
                      )}
                    </div>
                    {[
                      ["Precio",       dbgPrice > 0 ? `${(dbgPrice ?? 0).toFixed(2)} ✓` : "⚠ SIN PRECIO",  dbgPrice > 0],
                      ["Series 1m",    `${dbgSeries.length} velas ${dbgSeries.length >= 20 ? "✓" : "⚠ pocas (<20)"}`, dbgSeries.length >= 20],
                      ["Candles 1m",   `${dbgCandles.length} velas ${dbgCandles.length >= 5 ? "✓" : "⚠ pocas"}`, dbgCandles.length >= 5],
                      ["Candles 5m",   `${dbgC5m.length} velas ${dbgC5m.length >= 13 ? "✓" : "⚠ /candles_mtf falla?"}`, dbgC5m.length >= 13],
                      ["Candles 15m",  `${dbgC15m.length} velas ${dbgC15m.length >= 21 ? "✓" : "⚠ /candles_mtf falla?"}`, dbgC15m.length >= 21],
                      ["liveReady",    liveReady ? "true ✓" : "false ⚠ — sincronizá bridge", liveReady],
                      ["Sesión",       (() => { const p = getSessionProfile(); return `${p.emoji} ${p.name} | SL×${p.slMult} TP2×${p.tp2Mult}`; })(), true],
                      ["Piso conf",    `${floor}%`, true],
                      ["Spread",       `${getSpreadPct(dbgAsset, volumeShock).toFixed(3)}%`, true],
                    ].map(([k, v, ok]) => (
                      <div key={k as string} style={{ display: "flex", justifyContent: "space-between",
                        padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                        color: ok ? "var(--text-2)" : "#f59e0b" }}>
                        <span style={{ color: "var(--muted)" }}>{k as string}</span>
                        <span style={{ fontWeight: ok ? 500 : 700 }}>{v as string}</span>
                      </div>
                    ))}
                    {lastSignal && lastSignal.asset === dbgAsset && (() => {
                      const rr = Math.abs(lastSignal.tp2 - lastSignal.entry) /
                                 Math.max(Math.abs(lastSignal.entry - lastSignal.stopLoss), 1e-9);
                      return (
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                          <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: 4 }}>Última señal generada:</div>
                          {[
                            ["Confianza", `${(lastSignal.confidence ?? 0).toFixed(1)}% (piso ${floor}%)`, (lastSignal.confidence ?? 0) >= floor],
                            ["RR",        `${(rr ?? 0).toFixed(2)} (mín 1.5)`, rr >= 1.5],
                            ["Dirección", lastSignal.direction, true],
                            ["ATR",       (lastSignal.atr ?? 0).toFixed(4), (lastSignal.atr ?? 0) > 0],
                          ].map(([k, v, ok]) => (
                            <div key={k as string} style={{ display: "flex", justifyContent: "space-between",
                              padding: "2px 0", color: ok ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                              <span style={{ color: "var(--muted)", fontWeight: 400 }}>{k as string}</span>
                              <span>{v as string}</span>
                            </div>
                          ))}
                        </div>
                      );
                    
              })()}
                  </div>
                );
              } catch(e) { return <span style={{color:"#ef4444",fontSize:10}}>⚠ error render diag: {String(e)}</span>; } })()}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                {[
                  { label: "Win rate actual",      value: `${(stats.winRate ?? 0).toFixed(1)}%`,                                      ok: stats.winRate >= 40 },
                  { label: "Trades reales",         value: String(realTrades.filter(t => t.source === "real").length),          ok: realTrades.length >= 5 },
                  { label: "Piso confianza actual", value: `${(learning.confidenceFloor ?? 52).toFixed(0)}%`,                          ok: learning.confidenceFloor <= 58 },
                  { label: "Escala riesgo",         value: `${(learning.riskScale ?? 1).toFixed(2)}×`,                               ok: learning.riskScale >= 0.8 },
                  { label: "Equity usado",          value: mt5Equity !== null ? `$${(mt5Equity ?? 0).toFixed(2)} (MT5 real)` : `$${(equity ?? 0).toFixed(2)} (simulado)`, ok: mt5Equity !== null },
                  { label: "Margen libre",          value: mt5FreeMargin !== null ? `$${(mt5FreeMargin ?? 0).toFixed(2)}` : "N/D",    ok: mt5FreeMargin === null || mt5FreeMargin > 0 },
                  { label: "Bridge conectado",      value: mt5Status === "connected" ? "✅ Sí" : "❌ No",                     ok: mt5Status === "connected" },
                  { label: "IA Groq",               value: aiStatus === "ok" ? `✅ ${groqModel}` : aiStatus,                  ok: aiStatus === "ok" },
                  { label: "Groq rpm (último min)", value: `${groqRateInfo.calls}/${GROQ_MAX_RPM}${groqRateInfo.paused ? " ⏸ PAUSADO" : ""}`, ok: !groqRateInfo.paused && groqRateInfo.calls < GROQ_MAX_RPM - 5 },
                  { label: "Circuit breaker",      value: circuitOpen ? `🔴 ACTIVO — P&L diario: $${(dailyPnlRef.current.pnl ?? 0).toFixed(2)}` : `✅ OK — P&L hoy: $${(dailyPnlRef.current.pnl ?? 0).toFixed(2)}`, ok: !circuitOpen },
                ].map(({ label, value, ok }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", borderRadius: 7,
                    background: ok ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
                    border: `1px solid ${ok ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"}` }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span style={{ fontWeight: 700, color: ok ? "#10b981" : "#ef4444" }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}


        {/* ━━━━━━━━━ ACTIVOS IA ━━━━━━━━━ */}
        {appTab === "activos" && (() => {
          const sessionName = getSessionProfile().name.split(" ")[0];
          const hourUTC = new Date().getUTCHours();
          const openSymbols = openPositions.map(p => p.signal.asset);

          // Agrupar activos por categoría
          const CAT_LABELS: Record<AssetCategory, string> = {
            crypto:"⬡ Crypto", metals:"◈ Metales", forex_major:"₣ Forex Majors",
            forex_minor:"₣ Forex Minors", indices:"▲ Índices", energy:"⛽ Energía",
            stocks:"📈 Acciones", commodities:"🌾 Commodities", other:"Otros",
          };
          const CAT_ORDER: AssetCategory[] = ["crypto","metals","forex_major","forex_minor","indices","energy","stocks","commodities","other"];

          const grouped: Record<string, Asset[]> = {};
          assets.forEach(a => {
            const cat = getAssetCategory(a);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(a);
          });

          // Ordenar dentro de cada grupo por opportunityScore
          Object.keys(grouped).forEach(cat => {
            grouped[cat].sort((a,b) =>
              calcOpportunityScore(b, assetIntelligence[b], sessionName, hourUTC, openSymbols, correlationMatrix)
              - calcOpportunityScore(a, assetIntelligence[a], sessionName, hourUTC, openSymbols, correlationMatrix)
            );
          });

          // Matriz de correlación — top activos con datos
          const assetsWithData = assets.filter(a => assetIntelligence[a] || correlationMatrix[a]);
          const corrAssets = assetsWithData.slice(0, 12); // max 12 para la tabla

          return (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

              {/* ── Header info ── */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <div className="card" style={{ flex:"1 1 200px", minWidth:180, padding:"10px 14px" }}>
                  <p style={{ fontSize:11, color:"var(--muted)", marginBottom:4 }}>Activos monitoreados</p>
                  <p style={{ fontSize:22, fontWeight:800, color:"#6366f1" }}>{assets.length}</p>
                  <p style={{ fontSize:10, color:"var(--muted)" }}>en {Object.keys(grouped).length} categorías</p>
                </div>
                <div className="card" style={{ flex:"1 1 200px", minWidth:180, padding:"10px 14px" }}>
                  <p style={{ fontSize:11, color:"var(--muted)", marginBottom:4 }}>Con inteligencia aprendida</p>
                  <p style={{ fontSize:22, fontWeight:800, color:"#10b981" }}>{Object.keys(assetIntelligence).length}</p>
                  <p style={{ fontSize:10, color:"var(--muted)" }}>de {assets.length} activos totales</p>
                </div>
                <div className="card" style={{ flex:"1 1 200px", minWidth:180, padding:"10px 14px" }}>
                  <p style={{ fontSize:11, color:"var(--muted)", marginBottom:4 }}>Correlaciones calculadas</p>
                  <p style={{ fontSize:22, fontWeight:800, color:"#f59e0b" }}>{Object.keys(correlationMatrix).length}</p>
                  <p style={{ fontSize:10, color:"var(--muted)" }}>pares analizados (200 velas 1m)</p>
                </div>
                <div className="card" style={{ flex:"1 1 200px", minWidth:180, padding:"10px 14px" }}>
                  <p style={{ fontSize:11, color:"var(--muted)", marginBottom:4 }}>Sesión activa</p>
                  <p style={{ fontSize:18, fontWeight:800, color:"#a5b4fc" }}>{getSessionProfile().emoji} {sessionName}</p>
                  <p style={{ fontSize:10, color:"var(--muted)" }}>hora UTC: {hourUTC}:00</p>
                </div>
              </div>

              {/* ── Activos por categoría con score ── */}
              {CAT_ORDER.filter(cat => grouped[cat]?.length > 0).map(cat => (
                <div key={cat} className="card">
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <h3 style={{ fontWeight:800, fontSize:13, margin:0 }}>{CAT_LABELS[cat]}</h3>
                    <span style={{ fontSize:10, color:"var(--muted)", background:"rgba(255,255,255,0.05)", padding:"1px 6px", borderRadius:8 }}>
                      {grouped[cat].length} activos
                    </span>
                  </div>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
                      <thead>
                        <tr>
                          {["Activo","Score","Trades","WR%","P&L","Mejor sesión","Mejor modo","Mejor hora","Precio","Spread"].map(h => (
                            <th key={h} style={{ textAlign:"left", padding:"4px 8px", fontSize:10, textTransform:"uppercase",
                              letterSpacing:"0.07em", color:"var(--muted)", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {grouped[cat].map(a => {
                          const intel = assetIntelligence[a];
                          const score = calcOpportunityScore(a, intel, sessionName, hourUTC, openSymbols, correlationMatrix);
                          const scoreColor = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
                          const scoreBg    = score >= 70 ? "rgba(16,185,129,0.12)" : score >= 50 ? "rgba(245,158,11,0.10)" : "rgba(239,68,68,0.08)";
                          const price = prices[a] ?? 0;
                          const cat2 = getAssetCatalog(a);
                          const dp = cat2.digits > 3 ? 4 : 2;
                          return (
                            <tr key={a} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                              <td style={{ padding:"6px 8px" }}>
                                <div style={{ fontWeight:700 }}>{a}</div>
                                <div style={{ fontSize:10, color:"var(--muted)" }}>{getAssetLabel(a).replace(a+" ","").replace(a,"")}</div>
                              </td>
                              <td style={{ padding:"6px 8px" }}>
                                <span style={{ fontWeight:800, fontSize:13, padding:"2px 8px", borderRadius:8, background:scoreBg, color:scoreColor }}>
                                  {(score ?? 0).toFixed(0)}
                                </span>
                              </td>
                              <td style={{ padding:"6px 8px", color: intel ? "var(--text)" : "var(--muted)" }}>
                                {intel ? intel.totalTrades : "–"}
                              </td>
                              <td style={{ padding:"6px 8px", fontWeight:700, color: intel ? (intel.winRate >= 0.5 ? "#10b981" : intel.winRate >= 0.4 ? "#f59e0b" : "#ef4444") : "var(--muted)" }}>
                                {intel ? (intel.winRate*100).toFixed(1)+"%" : "–"}
                              </td>
                              <td style={{ padding:"6px 8px", fontWeight:700, color: intel ? (intel.avgPnl >= 0 ? "#10b981" : "#ef4444") : "var(--muted)" }}>
                                {intel ? (intel.avgPnl >= 0 ? "+" : "") + (intel.avgPnl ?? 0).toFixed(2) : "–"}
                              </td>
                              <td style={{ padding:"6px 8px", color:"#a5b4fc" }}>
                                {intel?.bestSession ?? "–"}
                              </td>
                              <td style={{ padding:"6px 8px", color: intel?.bestMode === "scalping" ? "#818cf8" : "#f59e0b" }}>
                                {intel?.bestMode ?? "–"}
                              </td>
                              <td style={{ padding:"6px 8px", color:"var(--muted)" }}>
                                {intel ? `${intel.bestHourUTC}:00 UTC` : "–"}
                              </td>
                              <td style={{ padding:"6px 8px", fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>
                                {price > 0 ? (price ?? 0).toFixed(dp) : "–"}
                              </td>
                              <td style={{ padding:"6px 8px", fontSize:10, color:"var(--muted)" }}>
                                {(cat2.spreadPct*100).toFixed(2)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* ── Matriz de correlación ── */}
              {corrAssets.length >= 2 && (
                <div className="card">
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <h3 style={{ fontWeight:800, fontSize:13, margin:0 }}>🔗 Matriz de correlación dinámica</h3>
                    <span style={{ fontSize:10, color:"var(--muted)" }}>Pearson · últimas 200 velas 1m</span>
                  </div>
                  <p style={{ fontSize:11, color:"var(--muted)", marginBottom:10 }}>
                    Verde = descorrelacionado (diversifica cartera) · Rojo = correlacionado (riesgo concentrado) · El bot bloquea posiciones con r ≥ 0.75 en misma dirección.
                  </p>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ borderCollapse:"collapse", fontSize:10 }}>
                      <thead>
                        <tr>
                          <th style={{ padding:"4px 8px", textAlign:"left", fontSize:10, color:"var(--muted)", borderBottom:"1px solid var(--border)" }}>–</th>
                          {corrAssets.map(a => (
                            <th key={a} style={{ padding:"4px 6px", fontSize:9.5, fontWeight:700, color:"var(--muted)", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap" }}>{a}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {corrAssets.map(rowA => (
                          <tr key={rowA}>
                            <td style={{ padding:"4px 8px", fontWeight:700, fontSize:10, color:"var(--text)", whiteSpace:"nowrap", borderRight:"1px solid var(--border)" }}>{rowA}</td>
                            {corrAssets.map(colA => {
                              const corr = rowA === colA ? 1 : (correlationMatrix[rowA]?.[colA] ?? null);
                              if (corr === null) return (
                                <td key={colA} style={{ padding:"4px 6px", textAlign:"center", color:"var(--muted)", fontSize:9 }}>–</td>
                              );
                              const abs = Math.abs(corr);
                              const isDiag = rowA === colA;
                              // Color: verde=descorrelacionado, rojo=muy correlacionado
                              const r = isDiag ? 40 : Math.round(abs * 200);
                              const g = isDiag ? 150 : Math.round((1 - abs) * 150);
                              const bg = isDiag ? "rgba(99,102,241,0.2)" : `rgba(${r},${g},60,${abs*0.4+0.08})`;
                              const textColor = isDiag ? "#a5b4fc" : abs >= 0.75 ? "#ef4444" : abs >= 0.5 ? "#f59e0b" : "#10b981";
                              return (
                                <td key={colA} style={{ padding:"4px 6px", textAlign:"center", background:bg, fontWeight: abs >= 0.6 ? 800 : 500, color: textColor, fontSize:10, borderRadius:3 }}>
                                  {isDiag ? "◆" : (corr ?? 0).toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {corrAssets.length === 0 && (
                    <p style={{ fontSize:11, color:"var(--muted)", textAlign:"center", padding:20 }}>
                      La correlación se calcula automáticamente con las velas 1m del bridge. Sincronicé primero.
                    </p>
                  )}
                </div>
              )}

              {/* ── Intelligence por activo (detalle expandido) ── */}
              {Object.keys(assetIntelligence).length > 0 && (
                <div className="card">
                  <h3 style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>🧠 Inteligencia aprendida por activo</h3>
                  {Object.entries(assetIntelligence).sort((a,b) => (b[1].profitFactor - a[1].profitFactor)).map(([sym, intel]) => (
                    <div key={sym} style={{ marginBottom:14, padding:"10px 12px", borderRadius:10,
                      background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                        <span style={{ fontWeight:800, fontSize:14 }}>{sym}</span>
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:8, fontWeight:700,
                          background:"rgba(99,102,241,0.15)", color:"#a5b4fc" }}>
                          {CAT_LABELS[intel.category] ?? intel.category}
                        </span>
                        <span style={{ fontSize:10, color:"var(--muted)", marginLeft:"auto" }}>
                          {intel.totalTrades} trades · actualizado {new Date(intel.lastUpdated).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}
                        </span>
                      </div>
                      {/* Métricas clave */}
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:8 }}>
                        {[
                          { label:"Win Rate", value:(intel.winRate*100).toFixed(1)+"%", color: intel.winRate >= 0.5 ? "#10b981" : "#ef4444" },
                          { label:"PF",       value:(intel.profitFactor ?? 0).toFixed(2), color: intel.profitFactor >= 1.5 ? "#10b981" : "#f59e0b" },
                          { label:"Avg PnL",  value:(intel.avgPnl >= 0 ? "+" : "")+(intel.avgPnl ?? 0).toFixed(2), color: intel.avgPnl >= 0 ? "#10b981" : "#ef4444" },
                          { label:"Mejor sesión", value:intel.bestSession, color:"#a5b4fc" },
                          { label:"Mejor hora", value:`${intel.bestHourUTC}:00 UTC`, color:"var(--muted)" },
                        ].map(({label,value,color}) => (
                          <div key={label} style={{ textAlign:"center", padding:"5px", background:"rgba(255,255,255,0.03)", borderRadius:6 }}>
                            <div style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", marginBottom:2 }}>{label}</div>
                            <div style={{ fontWeight:800, fontSize:12, color }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      {/* Stats por sesión */}
                      {Object.keys(intel.sessionStats).length > 0 && (
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                          {Object.entries(intel.sessionStats).map(([sess, st]) => (
                            <div key={sess} style={{ fontSize:10, padding:"3px 8px", borderRadius:6,
                              background: (st.wins/Math.max(st.trades,1)) >= 0.5 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)",
                              border: "1px solid rgba(255,255,255,0.07)" }}>
                              <span style={{ color:"var(--muted)" }}>{sess}: </span>
                              <span style={{ fontWeight:700, color: (st.wins/Math.max(st.trades,1)) >= 0.5 ? "#10b981" : "#ef4444" }}>
                                {st.trades}t · {((st.wins/Math.max(st.trades,1))*100).toFixed(0)}%WR · {st.pnl >= 0 ? "+" : ""}{(st.pnl ?? 0).toFixed(1)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Correlaciones más fuertes */}
                      {Object.keys(intel.correlations).length > 0 && (
                        <div style={{ fontSize:10, color:"var(--muted)" }}>
                          <span style={{ fontWeight:700 }}>Correlaciones: </span>
                          {Object.entries(intel.correlations)
                            .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]))
                            .slice(0, 5)
                            .map(([sym2, corr]) => (
                              <span key={sym2} style={{ marginLeft:8,
                                color: Math.abs(corr) >= 0.75 ? "#ef4444" : Math.abs(corr) >= 0.5 ? "#f59e0b" : "#10b981",
                                fontWeight: Math.abs(corr) >= 0.75 ? 800 : 500 }}>
                                {sym2}: {corr >= 0 ? "+" : ""}{co(rr ?? 0).toFixed(2)}
                              </span>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Estado: sin datos aún ── */}
              {Object.keys(assetIntelligence).length === 0 && (
                <div className="card" style={{ textAlign:"center", padding:40, color:"var(--muted)" }}>
                  <p style={{ fontSize:24, marginBottom:12 }}>🧠</p>
                  <p style={{ fontWeight:700, fontSize:15, color:"var(--text)", marginBottom:8 }}>Sin inteligencia aprendida aún</p>
                  <p style={{ fontSize:12 }}>
                    El sistema aprende automáticamente con cada trade real cerrado.<br/>
                    Los scores de oportunidad se activan desde el primer trade.
                  </p>
                </div>
              )}

            </div>
          );
        })()}
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
              <p><strong>Todos los activos</strong> → MT5 Bridge / PrimeXBT (spread real, sin API externas)</p>
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
              <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8,
                background: sessionOverride ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${sessionOverride ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.07)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: sessionOverride ? "#f59e0b" : "var(--text)" }}>
                      🗽 Override sesión NY
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {sessionOverride
                        ? "⚠ Scalping habilitado en cualquier horario — spread puede ser alto"
                        : "Scalping solo en sesión NY (13:00–20:59 UTC) — menor spread"}
                    </div>
                  </div>
                  <button onClick={() => setSessionOverride(p => !p)}
                    style={{ padding: "5px 12px", borderRadius: 16, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 11,
                      background: sessionOverride ? "#f59e0b" : "rgba(255,255,255,0.07)",
                      color: sessionOverride ? "#fff" : "var(--muted)" }}>
                    {sessionOverride ? "● ON" : "○ OFF"}
                  </button>
                </div>
              </div>
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
                  {mt5Balance !== null && <><span style={{ color: "var(--muted)", marginLeft: 12 }}>Balance: </span><strong>${(mt5Balance ?? 0).toFixed(2)}</strong></>}
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
                  className="btn-secondary"
                  onClick={syncMT5State}
                  disabled={mt5Status !== "connected"}
                  style={{ flex: 1 }}>
                  ↻ Sync posiciones
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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                {/* ── Reiniciar aprendizaje ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#f59e0b" }}>🧠 Reiniciar aprendizaje</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Resetea riskScale, confidenceFloor, TP/SL dinámicos y hourEdge.<br/>
                      <span style={{ color: "#6366f1" }}>No toca trades ni balance.</span>
                    </div>
                  </div>
                  <button onClick={() => {
                    if (!confirm("¿Reiniciar el modelo de aprendizaje? Se resetean los parámetros adaptativos (riskScale, TP/SL, confidenceFloor). Los trades y el balance no se tocan.")) return;
                    setLearning(initialLearning);
                    learningRef.current = initialLearning;
                    pushToast("🧠 Aprendizaje reiniciado — parámetros adaptativos reseteados.", "info");
                  }} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.12)", color: "#f59e0b", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Reiniciar
                  </button>
                </div>

                {/* ── Cerrar posiciones abiertas (solo internas) ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#a5b4fc" }}>📋 Limpiar estado interno</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Cierra las posiciones del motor interno y limpia historial.<br/>
                      <span style={{ color: "#f59e0b" }}>No afecta posiciones reales en MT5.</span>
                    </div>
                  </div>
                  <button onClick={() => {
                    if (!confirm("¿Limpiar el estado interno? Se borran posiciones del motor y el historial de trades. Las posiciones reales en MT5 NO se tocan.")) return;
                    setOpenPositions([]);
                    setRealTrades([]);
                    setBacktestTrades([]);
                    setLastBacktest(null);
                    setLastSignal(null);
                    pushToast("📋 Estado interno limpiado — posiciones MT5 intactas.", "info");
                  }} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Limpiar
                  </button>
                </div>

                {/* ── Backtest ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>📊 Limpiar backtest</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Borra los resultados del último backtest.</div>
                  </div>
                  <button onClick={() => {
                    setBacktestTrades([]);
                    setLastBacktest(null);
                    pushToast("Backtest borrado.", "info");
                  }} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "var(--muted)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Limpiar
                  </button>
                </div>

              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AppWithBoundary() {
  const [k, setK] = React.useState(0);
  return (
    <ErrorBoundary key={k} onReset={() => setK(n => n+1)}>
      <App />
    </ErrorBoundary>
  );
}
export default AppWithBoundary;
