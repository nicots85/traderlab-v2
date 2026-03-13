// ═══════════════════════════════════════════════════════════════════════════════
// QUANTENGINE — Motor Black-Scholes × Wyckoff
// Matemático · Físico · Master en Mercados
//
// Arquitectura:
//   σ (HV)  → volatilidad realizada de velas → input central de BS
//   Δ Delta → 1° derivada: dirección/momentum     → scalp signal
//   Γ Gamma → 2° derivada: convexidad/inflexión   → entry timing
//   Θ Theta → derivada temporal: costo del trade  → sizing/duración
//   V Vega  → ∂V/∂σ: régimen de volatilidad       → filtro expansión
//   ρ Rho   → ∂V/∂r: sesgo macro                  → swing context
//   N(d1/d2)→ integrales acumuladas: P(TP), P(SL) → Expected Value
//
// Wyckoff × BS:
//   El controlador de mercado manipula σ deliberadamente.
//   Acumulación = comprimir σ (Vega baja, Γ alta).
//   Mark-up = liberar σ (Vega sube, Δ > 0.65).
//   Spring/UT = spike de Γ en zona extrema = ventana de entrada.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Tipos propios ─────────────────────────────────────────────────────────────
type QMode = "scalp" | "intradia" | "swing";
type QDir  = "LONG" | "SHORT" | "NEUTRAL";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type BSGreeks = {
  delta:   number;   // Δ: 0–1 (call), -1–0 (put)
  gamma:   number;   // Γ: siempre ≥ 0
  theta:   number;   // Θ: siempre ≤ 0
  vega:    number;   // V: siempre ≥ 0
  rho:     number;   // ρ: + o -
  d1:      number;
  d2:      number;
  sigma:   number;   // HV usada
  T:       number;   // horizonte en años
  pTP:     number;   // N(d_tp): P(precio alcanza TP)
  pSL:     number;   // N(d_sl): P(precio toca SL)
  ev:      number;   // Expected Value del trade
  vegaCross: boolean; // Vega cruzando desde mínimo → expansión inminente
  gammaExtreme: boolean; // Gamma en percentil >75% → punto de inflexión
};

type WyckoffCtx = {
  phase:    "A"|"B"|"C"|"D"|"E"|"unknown";
  bias:     "accumulation"|"distribution"|"neutral";
  narrative: string;
  sigmaCtrl: "compressing"|"expanding"|"neutral"; // lo que el MM hace con σ
  mmAction:  string;
};

type QSignal = {
  id:         number;
  asset:      string;
  mode:       QMode;
  direction:  QDir;
  entry:      number;
  sl:         number;
  tp:         number;
  tp2:        number;
  tp3?:       number;
  size:       number;
  greeks:     BSGreeks;
  wyckoff:    WyckoffCtx;
  confidence: number;   // 0–100 basado en alineación BS × Wyckoff
  rationale:  string;
  generatedAt: number;
  rr:         number;
};

type QPosition = {
  id:          number;
  signal:      QSignal;
  openedAt:    number;
  peak:        number;
  trough:      number;
  tp1Hit:      boolean;
  breakevenAt: number | null;
  currentGreeks?: BSGreeks;
};

type QClosedTrade = {
  id:         number;
  asset:      string;
  mode:       QMode;
  direction:  QDir;
  entry:      number;
  exit:       number;
  pnl:        number;
  result:     "TP1"|"TP2"|"TP3"|"SL"|"TRAIL"|"MANUAL";
  openedAt:   number;
  closedAt:   number;
  greeks:     BSGreeks;
  rrRealized: number;
};

type QStats = {
  totalTrades: number;
  winRate:     number;
  totalPnl:    number;
  avgRR:       number;
  sharpe:      number;
  byMode:      Record<QMode, { n: number; wr: number; pnl: number }>;
};

// ─── Props ─────────────────────────────────────────────────────────────────────
interface QuantEngineProps {
  // Data del bridge (compartida con el motor v1)
  prices:       Record<string, number>;
  candles:      Record<string, Candle[]>;
  candles5m:    Record<string, Candle[]>;
  candles15m:   Record<string, Candle[]>;
  candles4h:    Record<string, Candle[]>;
  candles1d:    Record<string, Candle[]>;
  liveReady:    boolean;
  mt5Enabled:   boolean;
  mt5Status:    string;
  mt5Url:       string;
  balance:      number;
  equity:       number;
  riskPct:      number;
  assets:       string[];
  // Funciones del motor v1 que reusar
  onOpenMT5:    (asset: string, dir: QDir, sl: number, tp: number, size: number) => Promise<boolean>;
  onCloseMT5:   (asset: string, dir: QDir) => Promise<boolean>;
  pushToast:    (msg: string, type: "success"|"error"|"warning"|"info") => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATEMÁTICA PURA — funciones estáticas (fuera del componente)
// ═══════════════════════════════════════════════════════════════════════════════

// Función de distribución normal acumulada — aproximación Abramowitz & Stegun
// Error máximo: 7.5×10⁻⁸
function normCDF(x: number): number {
  if (x > 8)  return 1;
  if (x < -8) return 0;
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const poly = ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x / 2)));
}

// Densidad normal estándar φ(x)
function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Volatilidad histórica realizada — retornos log normales
// lookback en velas; annualFactor convierte a base anual (252 días trading)
function calcHV(closes: number[], lookback = 20, annualFactor = 252): number {
  const n = Math.min(closes.length - 1, lookback);
  if (n < 4) return 0.30; // fallback 30%
  const logRets: number[] = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i-1] > 0) logRets.push(Math.log(closes[i] / closes[i-1]));
  }
  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
  const variance = logRets.reduce((s, v) => s + (v - mean) ** 2, 0) / (logRets.length - 1);
  return Math.sqrt(variance * annualFactor);
}

// Horizonte en años fraccionarios según modo
function modeToT(mode: QMode): number {
  switch (mode) {
    case "scalp":    return 1 / (252 * 24 * 4);   // ~15 min
    case "intradia": return 1 / (252 * 3);         // ~8 horas
    case "swing":    return 5 / 252;               // ~5 días
  }
}

// ─── Black-Scholes completo ────────────────────────────────────────────────────
// K = referencia (VWAP, POC, o precio de entrada)
// r = 0 default (funding rate implícito)
function calcBS(
  S: number, K: number, T: number, sigma: number, r = 0,
  targetTP?: number, targetSL?: number
): BSGreeks {
  // Guard: σ mínimo para evitar división por cero
  const sig = Math.max(sigma, 0.005);
  const sqrtT = Math.sqrt(Math.max(T, 1e-8));

  // d1, d2 — corazón de BS
  const d1 = (Math.log(S / Math.max(K, 1e-9)) + (r + sig * sig / 2) * T) / (sig * sqrtT);
  const d2 = d1 - sig * sqrtT;

  // ── Griegas ────────────────────────────────────────────────────────────────
  // Δ: sensibilidad al precio subyacente (call = long)
  const delta = normCDF(d1);

  // Γ: segunda derivada — cuánto cambia Δ por unidad de S
  const gamma = normPDF(d1) / (S * sig * sqrtT);

  // Θ: decaimiento temporal (por año, negativo)
  const theta = -(S * normPDF(d1) * sig) / (2 * sqrtT)
               - r * Math.exp(-r * T) * K * normCDF(d2);

  // V (Vega): sensibilidad a σ
  const vega = S * sqrtT * normPDF(d1);

  // ρ (Rho): sensibilidad a la tasa r
  const rho = K * T * Math.exp(-r * T) * normCDF(d2);

  // ── Integrales: probabilidades de TP y SL ────────────────────────────────
  let pTP = 0.5, pSL = 0.5, ev = 0;
  if (targetTP && targetSL && S > 0) {
    const d_tp = (Math.log(targetTP / S) + (r + sig*sig/2)*T) / (sig * sqrtT);
    const d_sl = (Math.log(targetSL / S) + (r + sig*sig/2)*T) / (sig * sqrtT);
    pTP = normCDF(d_tp);                    // P(precio ≥ TP en T)
    pSL = 1 - normCDF(d_sl);               // P(precio ≤ SL en T)
    const gain = Math.abs(targetTP - S);
    const loss = Math.abs(S - targetSL);
    ev = pTP * gain - pSL * loss;           // EV en unidades de precio
  }

  return { delta, gamma, theta, vega, rho, d1, d2, sigma: sig, T,
           pTP, pSL, ev, vegaCross: false, gammaExtreme: false };
}

// ─── Wyckoff × BS — detectar qué hace el controlador con σ ──────────────────
function interpretWyckoffBS(
  candles4h: Candle[],
  candles1d: Candle[],
  greeks: BSGreeks,
  vegaHistory: number[]
): WyckoffCtx {
  // Usar velas 4H/1D para fase Wyckoff
  const c = candles4h.length > 20 ? candles4h : candles1d;
  if (c.length < 20) {
    return { phase: "unknown", bias: "neutral", narrative: "Sin velas 4H/1D",
             sigmaCtrl: "neutral", mmAction: "Sin datos" };
  }

  const closes  = c.map(x => x.c);
  const volumes = c.map(x => x.v);
  const n = closes.length;
  const price = closes[n-1];

  // ── Detectar fase Wyckoff usando estructura de precio + volumen ───────────
  const highN  = Math.max(...closes.slice(-20));
  const lowN   = Math.min(...closes.slice(-20));
  const range  = highN - lowN;
  const pricePos = range > 0 ? (price - lowN) / range : 0.5; // 0=fondo, 1=techo

  // Volumen relativo (últimas 5 velas vs media 20)
  const avgVol20 = volumes.slice(-20).reduce((a,b)=>a+b,0) / 20;
  const avgVol5  = volumes.slice(-5).reduce((a,b)=>a+b,0) / 5;
  const volRatio = avgVol5 / Math.max(avgVol20, 1);

  // EMA tendencia
  const alpha = 2 / 22;
  const ema21 = closes.slice(-21).reduce((acc,v) => alpha*v + (1-alpha)*acc, closes[n-21] || closes[0]);
  const ema8  = closes.slice(-8).reduce((acc,v) => (2/9)*v + (1-(2/9))*acc, closes[n-8] || closes[0]);
  const trend = ema8 > ema21 ? "up" : "down";

  // Compresión de σ = MM comprimiendo el mercado
  const hvRecent = calcHV(closes, 10);
  const hvLong   = calcHV(closes, 20);
  const sigmaCtrl: WyckoffCtx["sigmaCtrl"] =
    hvRecent < hvLong * 0.75 ? "compressing" :
    hvRecent > hvLong * 1.30 ? "expanding"   : "neutral";

  // Clasificar fase
  let phase: WyckoffCtx["phase"] = "unknown";
  let bias:  WyckoffCtx["bias"]  = "neutral";
  let mmAction = "";
  let narrative = "";

  if (sigmaCtrl === "compressing" && pricePos < 0.35 && volRatio < 0.8) {
    phase = "B"; bias = "accumulation";
    mmAction = "MM comprime σ en fondo — absorbe oferta silenciosamente";
    narrative = `Fase B acumulación: σ cayendo ${((1-hvRecent/hvLong)*100).toFixed(0)}%, precio en fondo, volumen bajo.`;
  } else if (sigmaCtrl === "compressing" && pricePos < 0.25 && volRatio > 1.2) {
    phase = "C"; bias = "accumulation";
    mmAction = "Spring probable — spike volumen en mínimo = trampa bajista";
    narrative = `Fase C — Spring/Test: volumen +${((volRatio-1)*100).toFixed(0)}% en fondo. MM toca stops bajistas.`;
  } else if (sigmaCtrl === "expanding" && trend === "up" && pricePos > 0.5) {
    phase = "D"; bias = "accumulation";
    mmAction = "SOS — señal de fuerza: σ se libera al alza";
    narrative = `Fase D Mark-up: expansión σ +${((hvRecent/hvLong-1)*100).toFixed(0)}% con tendencia alcista.`;
  } else if (pricePos > 0.65 && trend === "up" && volRatio > 1.1) {
    phase = "E"; bias = "accumulation";
    mmAction = "Continúa mark-up — momentum establecido";
    narrative = `Fase E: precio en zona alta, tendencia intacta.`;
  } else if (sigmaCtrl === "compressing" && pricePos > 0.65 && volRatio < 0.8) {
    phase = "B"; bias = "distribution";
    mmAction = "MM comprime σ en techo — distribuye mientras precio lateral";
    narrative = `Fase B distribución: σ cayendo en techo. MM vendiendo silenciosamente.`;
  } else if (sigmaCtrl === "compressing" && pricePos > 0.75 && volRatio > 1.2) {
    phase = "C"; bias = "distribution";
    mmAction = "UTAD probable — spike volumen en máximo = trampa alcista";
    narrative = `Fase C distribución — UTAD: MM toca stops alcistas en máximo.`;
  } else if (sigmaCtrl === "expanding" && trend === "down" && pricePos < 0.5) {
    phase = "D"; bias = "distribution";
    mmAction = "SOW — señal de debilidad: σ se libera a la baja";
    narrative = `Fase D Mark-down: expansión σ con tendencia bajista.`;
  } else {
    phase = "A"; bias = "neutral";
    mmAction = "MM en transición — sin sesgo claro";
    narrative = `Fase A/transición: estructura no definida.`;
  }

  // Cruce de Vega: señal de inicio de expansión
  const vegaCrossDetected = vegaHistory.length >= 5 &&
    greeks.vega > vegaHistory[vegaHistory.length-1] * 1.15 &&
    vegaHistory.slice(-3).every(v => v < greeks.vega);

  if (vegaCrossDetected) {
    mmAction = "⚡ VEGA CROSS: MM libera σ → inicio de movimiento";
    narrative += " | Vega cruzando al alza desde compresión.";
  }

  return { phase, bias, narrative, sigmaCtrl, mmAction };
}

// ─── Motor de señal BS × Wyckoff por activo ───────────────────────────────────
function generateBSSignal(
  asset: string,
  mode: QMode,
  candles: Candle[],
  candles4h: Candle[],
  candles1d: Candle[],
  price: number,
  vegaHistory: number[],
  gammaHistory: number[],
): QSignal | null {
  if (!candles || candles.length < 20 || price <= 0) return null;

  const closes = candles.map(c => c.c);
  const n = closes.length;

  // ── 1. Volatilidad realizada (σ) ──────────────────────────────────────────
  const hvPeriod = mode === "scalp" ? 20 : mode === "intradia" ? 30 : 60;
  const sigma = calcHV(closes, Math.min(hvPeriod, n - 1));
  const T = modeToT(mode);

  // ── 2. Referencia K: VWAP simplificado (precio típico × volumen) ─────────
  const recent = candles.slice(-20);
  const totalVol = recent.reduce((s, c) => s + c.v, 0);
  const vwap = totalVol > 0
    ? recent.reduce((s, c) => s + ((c.h+c.l+c.c)/3) * c.v, 0) / totalVol
    : price;

  // ── 3. Calcular griegas BS ────────────────────────────────────────────────
  const atr = Math.max(
    candles.slice(-14).slice(1).reduce((s,c,i) =>
      s + Math.max(c.h-c.l, Math.abs(c.h-candles.slice(-14)[i].c), Math.abs(c.l-candles.slice(-14)[i].c)), 0
    ) / 13,
    price * 0.001
  );

  // SL/TP tentativo para calcular EV
  const slMult = mode === "scalp" ? 0.8 : mode === "intradia" ? 1.2 : 2.0;
  const tpMult = mode === "scalp" ? 1.5 : mode === "intradia" ? 2.5 : 4.0;

  // Primera pasada: calcular Greeks con K=VWAP
  const greeksRaw = calcBS(price, vwap, T, sigma, 0,
    price + atr * tpMult, price - atr * slMult);

  // ── 4. Determinar dirección desde Δ + contexto ────────────────────────────
  // Δ > 0.55 = sesgo alcista, Δ < 0.45 = sesgo bajista
  let direction: QDir = "NEUTRAL";
  if      (greeksRaw.delta > 0.55) direction = "LONG";
  else if (greeksRaw.delta < 0.45) direction = "SHORT";

  // ── 5. Percentiles de Gamma y Vega para extremos ─────────────────────────
  const gammaExtreme = gammaHistory.length >= 10 &&
    greeksRaw.gamma > gammaHistory.slice(-10).sort((a,b)=>a-b)[Math.floor(gammaHistory.length*0.70)];
  const vegaCross = vegaHistory.length >= 5 &&
    greeksRaw.vega > vegaHistory[vegaHistory.length-1] * 1.10 &&
    vegaHistory.slice(-3).every(v => v <= greeksRaw.vega);

  const greeks: BSGreeks = { ...greeksRaw, gammaExtreme, vegaCross };

  // ── 6. Wyckoff × BS ──────────────────────────────────────────────────────
  const wyckoff = interpretWyckoffBS(candles4h, candles1d, greeks, vegaHistory);

  // ── 7. Filtros por modo ───────────────────────────────────────────────────
  // SCALP: Gamma extrema + Delta cruzando 0.5 + volumen
  // INTRADIA: Vega cross + fase Wyckoff identificada + EV > 0
  // SWING: Delta extremo (>0.68 o <0.32) + fase Wyckoff completa + Theta bajo

  if (direction === "NEUTRAL") return null;

  let passesFilter = false;
  let filterNote = "";

  if (mode === "scalp") {
    const deltaStrong = greeks.delta > 0.58 || greeks.delta < 0.42;
    const hasVolume = (() => {
      const vols = candles.slice(-20).map(c => c.v);
      const avgV = vols.reduce((a,b)=>a+b,0)/vols.length;
      return candles[n-1].v > avgV * 1.1;
    })();
    passesFilter = (greeks.gammaExtreme || greeks.vegaCross) && deltaStrong && hasVolume;
    filterNote = `Γ-extreme:${gammaExtreme?1:0} VegaCross:${vegaCross?1:0} Δ:${greeks.delta.toFixed(2)} Vol:${hasVolume?1:0}`;
  } else if (mode === "intradia") {
    const wyckoffActive = wyckoff.bias !== "neutral" && wyckoff.phase !== "unknown";
    const evPositive = greeks.ev > 0;
    const vegaSignal = greeks.vegaCross || wyckoff.sigmaCtrl === "expanding";
    passesFilter = wyckoffActive && evPositive && vegaSignal;
    filterNote = `Wyckoff:${wyckoff.phase}/${wyckoff.bias} EV:${greeks.ev.toFixed(4)} Vega:${vegaSignal?1:0}`;
  } else { // swing
    const deltaExtreme = greeks.delta > 0.68 || greeks.delta < 0.32;
    const wyckoffPhaseComplete = ["D","E"].includes(wyckoff.phase);
    const thetaAcceptable = Math.abs(greeks.theta) / price < 0.002; // Theta < 0.2% del precio por día
    const evStrong = greeks.ev > atr * 0.5;
    passesFilter = deltaExtreme && wyckoffPhaseComplete && thetaAcceptable && evStrong;
    filterNote = `Δ:${greeks.delta.toFixed(2)} Phase:${wyckoff.phase} Θ:${(greeks.theta/price*100).toFixed(3)}% EV:${greeks.ev.toFixed(4)}`;
  }

  if (!passesFilter) return null;

  // ── 8. Alineación direccional BS × Wyckoff ────────────────────────────────
  const wyckoffDir: QDir =
    wyckoff.bias === "accumulation" ? "LONG" :
    wyckoff.bias === "distribution" ? "SHORT" : direction;

  // Penalizar si BS y Wyckoff divergen
  const bsWyckoffAligned = wyckoffDir === direction || wyckoff.bias === "neutral";

  // ── 9. Confidence score ──────────────────────────────────────────────────
  let confidence = 50;
  // Δ contribuye hasta ±20 (cuánto se aleja de 0.5)
  confidence += (Math.abs(greeks.delta - 0.5) - 0.05) * 40;
  // Γ extrema +10
  if (greeks.gammaExtreme) confidence += 10;
  // Vega cross +10
  if (greeks.vegaCross) confidence += 10;
  // EV positivo +8, fuerte +15
  if (greeks.ev > 0)          confidence += 8;
  if (greeks.ev > atr * 0.5)  confidence += 7;
  // Wyckoff alineado +12
  if (bsWyckoffAligned && wyckoff.bias !== "neutral") confidence += 12;
  // Wyckoff en contra -15
  if (!bsWyckoffAligned) confidence -= 15;
  // Fase C (Spring/UTAD) en scalp/intradía: máxima convicción +10
  if (wyckoff.phase === "C") confidence += 10;
  confidence = Math.max(0, Math.min(100, confidence));

  // ── 10. SL/TP finales ────────────────────────────────────────────────────
  const isLong = direction === "LONG";
  const sl  = isLong ? price - atr * slMult : price + atr * slMult;
  const tp1 = isLong ? price + atr * tpMult : price - atr * tpMult;
  const tp2 = isLong ? price + atr * tpMult * 1.8 : price - atr * tpMult * 1.8;
  const tp3 = mode === "swing"
    ? (isLong ? price + atr * tpMult * 3.0 : price - atr * tpMult * 3.0)
    : undefined;
  const rr = Math.abs(tp1 - price) / Math.max(Math.abs(price - sl), 1e-9);

  // Recalcular EV con SL/TP reales
  const finalGreeks = calcBS(price, vwap, T, sigma, 0, tp1, sl);
  finalGreeks.gammaExtreme = gammaExtreme;
  finalGreeks.vegaCross = vegaCross;

  const rationale = `BS/${mode.toUpperCase()} | Δ=${greeks.delta.toFixed(3)} Γ=${greeks.gamma.toFixed(6)} V=${greeks.vega.toFixed(2)} Θ=${(greeks.theta*365).toFixed(2)}/d | EV=${finalGreeks.ev.toFixed(4)} P(TP)=${(finalGreeks.pTP*100).toFixed(0)}% | ${wyckoff.narrative.slice(0,80)} | ${filterNote}`;

  return {
    id: Date.now() + Math.random(),
    asset, mode, direction, entry: price,
    sl, tp: tp1, tp2, tp3,
    size: 0,  // calculado en el componente con Kelly + balance
    greeks: finalGreeks,
    wyckoff,
    confidence,
    rationale,
    generatedAt: Date.now(),
    rr,
  };
}

// ─── Componente Greeks Display ────────────────────────────────────────────────
function GreeksCard({ g, mode }: { g: BSGreeks; mode: QMode }) {
  const deltaColor = g.delta > 0.60 ? "#10b981" : g.delta < 0.40 ? "#ef4444" : "#f59e0b";
  const gammaColor = g.gammaExtreme ? "#a78bfa" : "var(--text-2)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
      {[
        { label: "Δ Delta", value: g.delta.toFixed(3), sub: g.delta > 0.5 ? "alcista" : "bajista",
          color: deltaColor, note: "1° orden: dirección" },
        { label: "Γ Gamma", value: g.gamma.toFixed(6), sub: g.gammaExtreme ? "⚡ EXTREMO" : "normal",
          color: gammaColor, note: "2° orden: inflexión" },
        { label: "Θ Theta", value: (g.theta * 365 / 100).toFixed(4), sub: "por día",
          color: "#6b7280", note: "Costo temporal" },
        { label: "V Vega", value: g.vega.toFixed(3), sub: g.vegaCross ? "⚡ CROSS" : "σ estable",
          color: g.vegaCross ? "#f59e0b" : "var(--text-2)", note: "Sensibilidad σ" },
        { label: "ρ Rho", value: g.rho.toFixed(4), sub: g.rho > 0 ? "tasa+" : "tasa-",
          color: "var(--text-2)", note: "Sesgo macro" },
      ].map(item => (
        <div key={item.label} style={{ background: "rgba(255,255,255,0.03)",
          borderRadius: 8, padding: "8px 10px", textAlign: "center",
          border: `1px solid rgba(255,255,255,0.06)` }}>
          <p style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2, textTransform: "uppercase",
            letterSpacing: "0.06em" }}>{item.label}</p>
          <p style={{ fontSize: 15, fontWeight: 800, color: item.color,
            fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</p>
          <p style={{ fontSize: 9, color: item.color, marginTop: 1, fontWeight: 700 }}>{item.sub}</p>
          <p style={{ fontSize: 8, color: "var(--muted)", marginTop: 2 }}>{item.note}</p>
        </div>
      ))}
    </div>
  );
}

// ─── EV Bar component ─────────────────────────────────────────────────────────
function EVBar({ pTP, pSL, ev, atr }: { pTP: number; pSL: number; ev: number; atr: number }) {
  const evColor = ev > 0 ? "#10b981" : "#ef4444";
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>
          EV <span style={{ color: evColor, fontFamily: "'JetBrains Mono', monospace" }}>
            {ev > 0 ? "+" : ""}{ev.toFixed(4)}
          </span>
        </span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>
          ∫ P(TP) = {(pTP*100).toFixed(1)}% · P(SL) = {(pSL*100).toFixed(1)}%
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, overflow: "hidden",
        background: "rgba(255,255,255,0.06)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%",
          width: `${pTP * 100}%`,
          background: "linear-gradient(90deg, #10b981, #34d399)", borderRadius: "4px 0 0 4px" }} />
        <div style={{ position: "absolute", right: 0, top: 0, height: "100%",
          width: `${pSL * 100}%`,
          background: "linear-gradient(90deg, #ef4444, #fca5a5)", borderRadius: "0 4px 4px 0" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 9, color: "#10b981" }}>▲ Alcanza TP</span>
        <span style={{ fontSize: 9, color: "#ef4444" }}>▼ Toca SL</span>
      </div>
    </div>
  );
}

// ─── Wyckoff Phase Badge ──────────────────────────────────────────────────────
function WyckoffBadge({ ctx }: { ctx: WyckoffCtx }) {
  const phaseColors: Record<string, string> = {
    A: "#6b7280", B: "#6366f1", C: "#f59e0b",
    D: "#10b981", E: "#3b82f6", unknown: "#374151"
  };
  const biasColors: Record<string, string> = {
    accumulation: "#10b981", distribution: "#ef4444", neutral: "#6b7280"
  };
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px",
      borderLeft: `3px solid ${biasColors[ctx.bias]}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
          background: phaseColors[ctx.phase] + "20", color: phaseColors[ctx.phase] }}>
          Fase {ctx.phase}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: biasColors[ctx.bias] }}>
          {ctx.bias === "accumulation" ? "🐂 Acumulación" :
           ctx.bias === "distribution" ? "🐻 Distribución" : "⚖ Neutro"}
        </span>
        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5,
          background: ctx.sigmaCtrl === "compressing" ? "rgba(99,102,241,0.12)"
                    : ctx.sigmaCtrl === "expanding"   ? "rgba(245,158,11,0.12)"
                    : "rgba(255,255,255,0.05)",
          color: ctx.sigmaCtrl === "compressing" ? "#a5b4fc"
               : ctx.sigmaCtrl === "expanding"   ? "#fbbf24" : "var(--muted)" }}>
          σ {ctx.sigmaCtrl}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{ctx.mmAction}</p>
      <p style={{ fontSize: 10, color: "var(--text-2)", fontStyle: "italic" }}>{ctx.narrative}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — QuantEngine
// ═══════════════════════════════════════════════════════════════════════════════
export default function QuantEngine({
  prices, candles, candles5m, candles15m, candles4h, candles1d,
  liveReady, mt5Enabled, mt5Status, mt5Url,
  balance, equity, riskPct, assets,
  onOpenMT5, onCloseMT5, pushToast
}: QuantEngineProps) {

  // ─── Estado ─────────────────────────────────────────────────────────────────
  const [activeMode,    setActiveMode]    = useState<QMode>("intradia");
  const [activeAsset,   setActiveAsset]   = useState<string>(assets[0] ?? "BTCUSD");
  const [openPositions, setOpenPositions] = useState<QPosition[]>([]);
  const [closedTrades,  setClosedTrades]  = useState<QClosedTrade[]>([]);
  const [lastSignals,   setLastSignals]   = useState<Record<string, QSignal>>({});
  const [greeksMap,     setGreeksMap]     = useState<Record<string, BSGreeks>>({});
  const [wyckoffMap,    setWyckoffMap]    = useState<Record<string, WyckoffCtx>>({});
  const [scanning,      setScanning]      = useState(false);
  const [autoScan,      setAutoScan]      = useState(false);

  // Historial de Vega y Gamma por activo — para detectar cruces y percentiles
  const vegaHistRef  = useRef<Record<string, number[]>>({});
  const gammaHistRef = useRef<Record<string, number[]>>({});
  const openRef      = useRef<QPosition[]>([]);
  openRef.current    = openPositions;

  // ─── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo<QStats>(() => {
    const t = closedTrades;
    if (!t.length) return {
      totalTrades: 0, winRate: 0, totalPnl: 0, avgRR: 0, sharpe: 0,
      byMode: { scalp: {n:0,wr:0,pnl:0}, intradia: {n:0,wr:0,pnl:0}, swing: {n:0,wr:0,pnl:0} }
    };
    const wins = t.filter(x => x.pnl > 0).length;
    const pnls = t.map(x => x.pnl);
    const meanPnl = pnls.reduce((a,b)=>a+b,0) / pnls.length;
    const stdPnl = Math.sqrt(pnls.reduce((s,v)=>s+(v-meanPnl)**2,0)/Math.max(pnls.length-1,1));
    const byMode = (["scalp","intradia","swing"] as QMode[]).reduce((acc, m) => {
      const mt = t.filter(x => x.mode === m);
      acc[m] = {
        n: mt.length,
        wr: mt.length ? mt.filter(x=>x.pnl>0).length/mt.length : 0,
        pnl: mt.reduce((s,x)=>s+x.pnl,0)
      };
      return acc;
    }, {} as QStats["byMode"]);
    return {
      totalTrades: t.length,
      winRate: wins / t.length,
      totalPnl: pnls.reduce((a,b)=>a+b,0),
      avgRR: t.reduce((s,x)=>s+x.rrRealized,0)/t.length,
      sharpe: stdPnl > 0 ? meanPnl / stdPnl * Math.sqrt(252) : 0,
      byMode
    };
  }, [closedTrades]);

  // ─── Scan: calcular griegas para todos los activos ──────────────────────────
  const runScan = useCallback(async () => {
    if (!liveReady || scanning) return;
    setScanning(true);

    const newGreeks:  Record<string, BSGreeks>  = {};
    const newWyckoff: Record<string, WyckoffCtx> = {};
    const newSignals: Record<string, QSignal>    = {};

    for (const asset of assets) {
      try {
        const c    = candles[asset]  ?? [];
        const c4h  = candles4h[asset] ?? [];
        const c1d  = candles1d[asset] ?? [];
        const px   = prices[asset] ?? 0;
        if (!c.length || !px) continue;

        const closes = c.map(x => x.c);
        const sigma  = calcHV(closes, Math.min(20, closes.length-1));
        const T      = modeToT(activeMode);
        const recent = c.slice(-20);
        const totVol = recent.reduce((s,x)=>s+x.v,0);
        const vwap   = totVol > 0 ? recent.reduce((s,x)=>s+((x.h+x.l+x.c)/3)*x.v,0)/totVol : px;
        const g = calcBS(px, vwap, T, sigma);

        // Actualizar historiales
        if (!vegaHistRef.current[asset])  vegaHistRef.current[asset]  = [];
        if (!gammaHistRef.current[asset]) gammaHistRef.current[asset] = [];
        vegaHistRef.current[asset]  = [...vegaHistRef.current[asset],  g.vega ].slice(-50);
        gammaHistRef.current[asset] = [...gammaHistRef.current[asset], g.gamma].slice(-50);

        const wyckoff = interpretWyckoffBS(c4h, c1d, g, vegaHistRef.current[asset]);
        newGreeks[asset]  = { ...g,
          gammaExtreme: g.gamma > (gammaHistRef.current[asset].slice(-10).sort((a,b)=>a-b)[7] ?? 0),
          vegaCross: vegaHistRef.current[asset].length >= 5 &&
            g.vega > vegaHistRef.current[asset][vegaHistRef.current[asset].length-2] * 1.10
        };
        newWyckoff[asset] = wyckoff;

        // Intentar generar señal
        const sig = generateBSSignal(
          asset, activeMode, c, c4h, c1d, px,
          vegaHistRef.current[asset], gammaHistRef.current[asset]
        );
        if (sig && sig.confidence >= 52) {
          // Calcular size con Kelly implícito
          const atr = sig.greeks.ev / Math.max(sig.rr, 0.5);
          const stopDist = Math.abs(sig.entry - sig.sl);
          const kellyFrac = Math.max(0.1, Math.min(0.5, sig.greeks.pTP - (1 - sig.greeks.pTP) / sig.rr));
          const riskUsd = equity * (riskPct / 100) * kellyFrac;
          sig.size = Math.max(0.01, riskUsd / Math.max(stopDist, sig.entry * 0.001));
          newSignals[asset] = sig;
        }
      } catch (e) {
        console.warn(`[QuantEngine] ${asset} error:`, e);
      }
    }

    setGreeksMap(newGreeks);
    setWyckoffMap(newWyckoff);
    if (Object.keys(newSignals).length > 0) {
      setLastSignals(prev => ({ ...prev, ...newSignals }));
      const top = Object.values(newSignals).sort((a,b) => b.confidence - a.confidence)[0];
      pushToast(`📐 BS ${activeMode}: ${top.asset} ${top.direction} conf=${top.confidence.toFixed(0)}% Δ=${top.greeks.delta.toFixed(2)}`, "info");
    }
    setScanning(false);
  }, [liveReady, scanning, assets, candles, candles4h, candles1d, prices, activeMode, equity, riskPct, pushToast]);

  // ─── AutoScan cada 60s ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoScan) return;
    const id = window.setInterval(() => void runScan(), 60_000);
    return () => clearInterval(id);
  }, [autoScan, runScan]);

  // ─── Abrir posición ──────────────────────────────────────────────────────────
  const openPosition = useCallback(async (sig: QSignal) => {
    if (!mt5Enabled || mt5Status !== "connected") {
      pushToast("⚠ Bridge no conectado", "warning"); return;
    }
    // Verificar no duplicar asset en este motor
    if (openRef.current.some(p => p.signal.asset === sig.asset)) {
      pushToast(`⚠ Ya hay posición abierta en ${sig.asset} (Motor Quant)`, "warning"); return;
    }
    const ok = await onOpenMT5(sig.asset, sig.direction, sig.sl, sig.tp, sig.size);
    if (!ok) return;
    const pos: QPosition = {
      id: Date.now(),
      signal: sig,
      openedAt: Date.now(),
      peak: sig.entry,
      trough: sig.entry,
      tp1Hit: false,
      breakevenAt: null,
    };
    setOpenPositions(prev => [...prev, pos]);
    pushToast(`✅ BS ${sig.mode.toUpperCase()} ${sig.asset} ${sig.direction} | Δ=${sig.greeks.delta.toFixed(2)} conf=${sig.confidence.toFixed(0)}%`, "success");
  }, [mt5Enabled, mt5Status, onOpenMT5, pushToast]);

  // ─── Cerrar posición ─────────────────────────────────────────────────────────
  const closePosition = useCallback(async (pos: QPosition, result: QClosedTrade["result"]) => {
    const px = prices[pos.signal.asset] ?? pos.signal.entry;
    const ok = await onCloseMT5(pos.signal.asset, pos.signal.direction);
    if (!ok && mt5Enabled) return;
    const isLong = pos.signal.direction === "LONG";
    const pnl = isLong ? (px - pos.signal.entry) * pos.signal.size
                       : (pos.signal.entry - px) * pos.signal.size;
    const rrRealized = Math.abs(px - pos.signal.entry) / Math.max(Math.abs(pos.signal.entry - pos.signal.sl), 1e-9);
    const closed: QClosedTrade = {
      id: pos.id, asset: pos.signal.asset, mode: pos.signal.mode,
      direction: pos.signal.direction, entry: pos.signal.entry, exit: px,
      pnl, result, openedAt: pos.openedAt, closedAt: Date.now(),
      greeks: pos.signal.greeks, rrRealized,
    };
    setOpenPositions(prev => prev.filter(p => p.id !== pos.id));
    setClosedTrades(prev => [closed, ...prev].slice(0, 200));
    const icon = pnl >= 0 ? "✅" : "❌";
    pushToast(`${icon} BS ${pos.signal.asset} ${result} | ${pnl>=0?"+":""}$${pnl.toFixed(2)} | RR=${rrRealized.toFixed(2)}`, pnl >= 0 ? "success" : "error");
  }, [prices, onCloseMT5, mt5Enabled, pushToast]);

  // ─── Evaluación de posiciones (trailing + TP) ───────────────────────────────
  useEffect(() => {
    if (!openPositions.length) return;
    const id = window.setInterval(() => {
      setOpenPositions(prev => prev.map(pos => {
        const px = prices[pos.signal.asset];
        if (!px) return pos;
        const isLong = pos.signal.direction === "LONG";
        const peak   = isLong ? Math.max(pos.peak, px) : pos.peak;
        const trough = isLong ? pos.trough : Math.min(pos.trough, px);

        // Actualizar griegas en tiempo real
        const c = candles[pos.signal.asset] ?? [];
        if (c.length >= 5) {
          const closes = c.map(x => x.c);
          const sigma = calcHV(closes, Math.min(20, closes.length-1));
          const T = modeToT(pos.signal.mode);
          const updated = calcBS(px, pos.signal.entry, T, sigma, 0, pos.signal.tp, pos.signal.sl);
          pos = { ...pos, currentGreeks: updated };
        }

        // TP1 hit → breakeven
        const hitTP1 = isLong ? px >= pos.signal.tp : px <= pos.signal.tp;
        if (hitTP1 && !pos.tp1Hit) {
          void closePosition(pos, "TP1");
          return pos;
        }

        // SL hit
        const hitSL = isLong ? px <= pos.signal.sl : px >= pos.signal.sl;
        if (hitSL) {
          void closePosition(pos, "SL");
          return pos;
        }

        // Trailing ATR (swing: más amplio)
        const atrMult = pos.signal.mode === "swing" ? 2.0 : 1.2;
        const c2 = candles[pos.signal.asset] ?? [];
        const atr = c2.length > 14
          ? c2.slice(-14).slice(1).reduce((s,x,i)=>s+Math.max(x.h-x.l,Math.abs(x.h-c2.slice(-14)[i].c),Math.abs(x.l-c2.slice(-14)[i].c)),0)/13
          : Math.abs(pos.signal.entry - pos.signal.sl);
        const trailSL = isLong ? peak - atr * atrMult : trough + atr * atrMult;
        const newSL = isLong
          ? Math.max(pos.signal.sl, trailSL)
          : Math.min(pos.signal.sl, trailSL);

        return { ...pos, peak, trough,
          signal: { ...pos.signal, sl: newSL }
        };
      }));
    }, 2000);
    return () => clearInterval(id);
  }, [openPositions, prices, candles, closePosition]);

  // ─── Señal activa para el activo seleccionado ──────────────────────────────
  const activeSignal = lastSignals[activeAsset];
  const activeGreeks = greeksMap[activeAsset];
  const activeWyck   = wyckoffMap[activeAsset];

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 16px 40px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 0 12px", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>
            📐 Motor Quant <span style={{ fontSize: 13, color: "#a5b4fc", fontWeight: 600 }}>
              Black-Scholes × Wyckoff
            </span>
          </h1>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "3px 0 0" }}>
            Δ·Γ·Θ·V·ρ + ∫ EV + Control de mercado
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Stats rápidas */}
          {stats.totalTrades > 0 && (
            <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>
                Trades: <strong style={{ color: "var(--text)" }}>{stats.totalTrades}</strong>
              </span>
              <span style={{ color: "var(--muted)" }}>
                WR: <strong style={{ color: stats.winRate > 0.5 ? "#10b981" : "#ef4444" }}>
                  {(stats.winRate*100).toFixed(0)}%</strong>
              </span>
              <span style={{ color: "var(--muted)" }}>
                P&L: <strong style={{ color: stats.totalPnl >= 0 ? "#10b981" : "#ef4444" }}>
                  {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}</strong>
              </span>
            </div>
          )}
          {/* AutoScan toggle */}
          <button
            onClick={() => setAutoScan(p => !p)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 12,
              background: autoScan ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(255,255,255,0.06)",
              color: autoScan ? "#fff" : "var(--text-2)" }}>
            {autoScan ? "⏹ Auto ON" : "▶ Auto OFF"}
          </button>
          <button
            onClick={() => void runScan()}
            disabled={scanning || !liveReady}
            style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 12,
              background: "linear-gradient(135deg,#3b82f6,#6366f1)",
              color: "#fff", opacity: scanning || !liveReady ? 0.5 : 1 }}>
            {scanning ? "⟳ Escaneando..." : "🔍 Escanear"}
          </button>
        </div>
      </div>

      {/* ── Modo selector ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["scalp","intradia","swing"] as QMode[]).map(m => {
          const icons = { scalp: "⚡", intradia: "📊", swing: "🌊" };
          const desc  = { scalp: "Γ extrema · Δ flip · 15m-2h",
                          intradia: "Vega cross · Wyckoff · 2-8h",
                          swing: "EV fuerte · Δ extremo · 2-10d" };
          const n = stats.byMode[m];
          return (
            <button key={m} onClick={() => setActiveMode(m)}
              style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none",
                cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                background: activeMode === m
                  ? "linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.15))"
                  : "rgba(255,255,255,0.03)",
                borderTop: activeMode === m ? "2px solid #6366f1" : "2px solid transparent" }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{icons[m]} {m.charAt(0).toUpperCase()+m.slice(1)}</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{desc[m]}</div>
              {n.n > 0 && <div style={{ fontSize: 10, marginTop: 3, color: n.wr > 0.5 ? "#10b981" : "#ef4444" }}>
                {n.n} trades · WR {(n.wr*100).toFixed(0)}% · ${n.pnl.toFixed(1)}
              </div>}
            </button>
          );
        })}
      </div>

      {/* ── Grid principal ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

        {/* ── Columna izquierda: activo + griegas ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Asset selector */}
          <div className="card" style={{ padding: "12px 14px" }}>
            <p style={{ fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
              Activo — griegas en tiempo real
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {assets.slice(0, 12).map(a => {
                const g = greeksMap[a];
                const sig = lastSignals[a];
                const hasSig = sig && sig.mode === activeMode;
                return (
                  <button key={a} onClick={() => setActiveAsset(a)}
                    style={{ padding: "4px 10px", borderRadius: 7, border: "none",
                      cursor: "pointer", fontSize: 11, fontWeight: 700,
                      background: activeAsset === a
                        ? "linear-gradient(135deg,#6366f1,#8b5cf6)"
                        : hasSig ? "rgba(16,185,129,0.12)"
                        : "rgba(255,255,255,0.05)",
                      color: activeAsset === a ? "#fff"
                           : hasSig ? "#10b981" : "var(--text-2)" }}>
                    {a.replace("USD","").replace("USDT","")}
                    {g && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>
                      Δ{g.delta.toFixed(2)}
                    </span>}
                  </button>
                );
              })}
            </div>

            {/* Griegas del activo activo */}
            {activeGreeks ? (
              <>
                <GreeksCard g={activeGreeks} mode={activeMode} />
                <div style={{ marginTop: 8 }}>
                  <EVBar pTP={activeGreeks.pTP} pSL={activeGreeks.pSL}
                    ev={activeGreeks.ev} atr={0} />
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 8, fontSize: 10, color: "var(--muted)" }}>
                  <span>σ HV: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>
                    {(activeGreeks.sigma*100).toFixed(1)}%/año
                  </strong></span>
                  <span>T: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>
                    {activeMode === "scalp" ? "15min" : activeMode === "intradia" ? "8h" : "5d"}
                  </strong></span>
                  <span>d1: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>
                    {activeGreeks.d1.toFixed(3)}
                  </strong></span>
                  <span>d2: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>
                    {activeGreeks.d2.toFixed(3)}
                  </strong></span>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>
                Presioná "Escanear" para calcular las griegas
              </p>
            )}
          </div>

          {/* Wyckoff context */}
          {activeWyck && (
            <div className="card" style={{ padding: "12px 14px" }}>
              <p style={{ fontWeight: 800, fontSize: 12, marginBottom: 8 }}>
                Wyckoff × σ — Controlador de mercado
              </p>
              <WyckoffBadge ctx={activeWyck} />
            </div>
          )}

          {/* Mapa de Delta por activo */}
          {Object.keys(greeksMap).length > 0 && (
            <div className="card" style={{ padding: "12px 14px" }}>
              <p style={{ fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
                Mapa Δ — todos los activos
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
                {assets.slice(0, 16).map(a => {
                  const g = greeksMap[a];
                  if (!g) return null;
                  const dir = g.delta > 0.58 ? "↑" : g.delta < 0.42 ? "↓" : "→";
                  const col = g.delta > 0.58 ? "#10b981" : g.delta < 0.42 ? "#ef4444" : "#6b7280";
                  return (
                    <div key={a} onClick={() => setActiveAsset(a)}
                      style={{ padding: "5px 8px", borderRadius: 7, cursor: "pointer",
                        background: "rgba(255,255,255,0.03)",
                        border: activeAsset === a ? "1px solid #6366f1" : "1px solid transparent" }}>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>
                        {a.replace("USD","").replace("USDT","")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ color: col, fontWeight: 700, fontSize: 11 }}>{dir}</span>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: col }}>
                          {g.delta.toFixed(3)}
                        </span>
                      </div>
                      {g.gammaExtreme && <div style={{ fontSize: 8, color: "#a78bfa" }}>Γ⚡</div>}
                      {g.vegaCross    && <div style={{ fontSize: 8, color: "#f59e0b" }}>V↑</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Columna derecha: señal + posiciones ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Señal activa */}
          {activeSignal && activeSignal.mode === activeMode ? (
            <div className="card" style={{ padding: "14px 16px",
              border: `1px solid ${activeSignal.direction === "LONG" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 18, fontWeight: 900,
                    color: activeSignal.direction === "LONG" ? "#10b981" : "#ef4444" }}>
                    {activeSignal.direction === "LONG" ? "🐂 LONG" : "🐻 SHORT"}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>
                    {activeSignal.asset} · {activeSignal.mode}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14,
                    background: activeSignal.confidence > 70
                      ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.12)",
                    color: activeSignal.confidence > 70 ? "#10b981" : "#f59e0b",
                    border: `2px solid ${activeSignal.confidence > 70 ? "#10b981" : "#f59e0b"}` }}>
                    {activeSignal.confidence.toFixed(0)}
                  </div>
                  <button onClick={() => void openPosition(activeSignal)}
                    style={{ padding: "10px 18px", borderRadius: 9, border: "none",
                      cursor: "pointer", fontWeight: 800, fontSize: 13,
                      background: activeSignal.direction === "LONG"
                        ? "linear-gradient(135deg,#059669,#10b981)"
                        : "linear-gradient(135deg,#dc2626,#ef4444)",
                      color: "#fff" }}>
                    Abrir trade
                  </button>
                </div>
              </div>

              {/* Levels */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Entry", value: activeSignal.entry, color: "var(--text)" },
                  { label: "SL", value: activeSignal.sl, color: "#ef4444" },
                  { label: "TP1", value: activeSignal.tp, color: "#10b981" },
                  { label: "TP2", value: activeSignal.tp2, color: "#34d399" },
                ].map(lv => (
                  <div key={lv.label} style={{ textAlign: "center", padding: "6px 8px",
                    background: "rgba(255,255,255,0.03)", borderRadius: 7 }}>
                    <p style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2 }}>{lv.label}</p>
                    <p style={{ fontSize: 13, fontWeight: 800, color: lv.color,
                      fontFamily: "'JetBrains Mono', monospace" }}>
                      {lv.value > 10 ? lv.value.toFixed(2) : lv.value.toFixed(5)}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                  background: "rgba(255,255,255,0.05)", color: "var(--text-2)" }}>
                  RR {activeSignal.rr.toFixed(2)}×
                </span>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                  background: "rgba(255,255,255,0.05)", color: "var(--text-2)" }}>
                  Size {activeSignal.size.toFixed(3)} lotes
                </span>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                  background: activeSignal.greeks.ev > 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                  color: activeSignal.greeks.ev > 0 ? "#10b981" : "#ef4444" }}>
                  EV {activeSignal.greeks.ev > 0 ? "+" : ""}{activeSignal.greeks.ev.toFixed(4)}
                </span>
              </div>

              <p style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace",
                lineHeight: 1.5 }}>{activeSignal.rationale}</p>
            </div>
          ) : (
            <div className="card" style={{ padding: "30px 20px", textAlign: "center" }}>
              <p style={{ fontSize: 16 }}>📐</p>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                Sin señal activa para {activeAsset} en modo {activeMode}
              </p>
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Escaneá para calcular Δ·Γ·Θ·V·ρ y generar señales BS×Wyckoff
              </p>
            </div>
          )}

          {/* Posiciones abiertas */}
          {openPositions.length > 0 && (
            <div className="card" style={{ padding: "12px 14px" }}>
              <p style={{ fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
                Posiciones abiertas — Motor Quant ({openPositions.length})
              </p>
              {openPositions.map(pos => {
                const px = prices[pos.signal.asset] ?? pos.signal.entry;
                const isLong = pos.signal.direction === "LONG";
                const pnl = isLong ? (px - pos.signal.entry) * pos.signal.size
                                   : (pos.signal.entry - px) * pos.signal.size;
                const g = pos.currentGreeks ?? pos.signal.greeks;
                return (
                  <div key={pos.id} style={{ padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${pnl >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13 }}>
                        {isLong ? "🐂" : "🐻"} {pos.signal.asset}
                        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>
                          {pos.signal.mode} · BS
                        </span>
                      </span>
                      <span style={{ fontWeight: 800, color: pnl >= 0 ? "#10b981" : "#ef4444" }}>
                        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                      </span>
                    </div>
                    {/* Griegas en vivo */}
                    <div style={{ display: "flex", gap: 8, fontSize: 10, color: "var(--muted)",
                      marginBottom: 8, flexWrap: "wrap" }}>
                      <span>Δ <strong style={{ color: "var(--text)" }}>{g.delta.toFixed(3)}</strong></span>
                      <span>Γ <strong style={{ color: g.gammaExtreme?"#a78bfa":"var(--text)" }}>{g.gamma.toFixed(6)}</strong></span>
                      <span>EV <strong style={{ color: g.ev>=0?"#10b981":"#ef4444" }}>
                        {g.ev>=0?"+":""}{g.ev.toFixed(4)}</strong></span>
                      <span>P(TP) <strong style={{ color: "#10b981" }}>{(g.pTP*100).toFixed(0)}%</strong></span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => void closePosition(pos, "MANUAL")}
                        style={{ padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                          background: "rgba(239,68,68,0.12)", color: "#ef4444", fontWeight: 700, fontSize: 11 }}>
                        Cerrar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Últimos trades */}
          {closedTrades.length > 0 && (
            <div className="card" style={{ padding: "12px 14px" }}>
              <p style={{ fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
                Historial BS ({closedTrades.length} trades)
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                      {["Activo","Modo","Dir","Entrada","Salida","P&L","RR","Δ entrada","Result"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left",
                          fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                          color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closedTrades.slice(0,15).map(t => (
                      <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 700 }}>{t.asset.replace("USD","")}</td>
                        <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{t.mode}</td>
                        <td style={{ padding: "6px 10px",
                          color: t.direction === "LONG" ? "#10b981" : "#ef4444",
                          fontWeight: 700 }}>
                          {t.direction === "LONG" ? "🐂" : "🐻"}
                        </td>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>
                          {t.entry > 10 ? t.entry.toFixed(2) : t.entry.toFixed(5)}
                        </td>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>
                          {t.exit > 10 ? t.exit.toFixed(2) : t.exit.toFixed(5)}
                        </td>
                        <td style={{ padding: "6px 10px", fontWeight: 800,
                          color: t.pnl >= 0 ? "#10b981" : "#ef4444" }}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>
                          {t.rrRealized.toFixed(2)}×
                        </td>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "var(--muted)" }}>
                          Δ{t.greeks.delta.toFixed(3)}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700,
                            background: t.result.includes("TP") ? "rgba(16,185,129,0.12)"
                                      : t.result === "SL" ? "rgba(239,68,68,0.1)"
                                      : "rgba(255,255,255,0.05)",
                            color: t.result.includes("TP") ? "#10b981"
                                 : t.result === "SL" ? "#ef4444" : "var(--text-2)" }}>
                            {t.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
