// ═══════════════════════════════════════════════════════════════════════════════
// QUANTENGINE v2 — Motor Black-Scholes × Wyckoff
// Δ·Γ·Θ·V·ρ · ∫EV · Wyckoff MM · Kelly · Walk-Forward · Multi-TP · Groq Calib
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type QMode = "scalp" | "intradia" | "swing";
type QDir  = "LONG" | "SHORT" | "NEUTRAL";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type BSGreeks = {
  delta: number; gamma: number; theta: number; vega: number; rho: number;
  d1: number;    d2: number;    sigma: number; T: number;
  pTP: number;   pSL: number;   ev: number;
  vegaCross: boolean; gammaExtreme: boolean;
};

type WyckoffCtx = {
  phase:     "A"|"B"|"C"|"D"|"E"|"unknown";
  bias:      "accumulation"|"distribution"|"neutral";
  narrative:  string;
  sigmaCtrl: "compressing"|"expanding"|"neutral";
  mmAction:   string;
};

type QSignal = {
  id:          number;
  asset:       string;
  mode:        QMode;
  direction:   QDir;
  entry:       number;
  sl:          number;
  tp:          number;   // TP1
  tp2:         number;
  tp3?:        number;
  size:        number;
  greeks:      BSGreeks;
  wyckoff:     WyckoffCtx;
  confidence:  number;
  rationale:   string;
  generatedAt: number;
  rr:          number;
};

type QPosition = {
  id:           number;
  signal:       QSignal;
  openedAt:     number;
  peak:         number;
  trough:       number;
  tp1Hit:       boolean;
  tp2Hit:       boolean;
  breakevenSet: boolean;
  currentGreeks?: BSGreeks;
  partialClosed:  number;   // fracción ya cerrada (0–1)
};

type QClosedTrade = {
  id: number; asset: string; mode: QMode; direction: QDir;
  entry: number; exit: number; pnl: number;
  result: "TP1"|"TP2"|"TP3"|"SL"|"TRAIL"|"MANUAL"|"TP1_PARTIAL"|"TP2_PARTIAL";
  openedAt: number; closedAt: number;
  greeks: BSGreeks; rrRealized: number;
};

// Walk-forward por activo
type QCalib = {
  asset: string; n: number; wins: number; wr: number;
  avgRR: number; kellyF: number; floorAdj: number;
  sigmaHistory: number[];   // últimos 50 σ
  evHistory:    number[];   // últimos 50 EV realizados
  lastUpdated:  number;
};

type GroqQCalib = {
  floors:     Record<string, number>;   // por asset+mode
  sizes:      Record<string, number>;   // multiplicadores
  macro:      string;
  note:       string;
  timestamp:  number;
};

type QStats = {
  totalTrades: number; winRate: number; totalPnl: number;
  avgRR: number; sharpe: number; maxDD: number;
  byMode: Record<QMode, { n: number; wr: number; pnl: number; avgRR: number }>;
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface QuantEngineProps {
  prices:     Record<string, number>;
  candles:    Record<string, Candle[]>;
  candles5m:  Record<string, Candle[]>;
  candles15m: Record<string, Candle[]>;
  candles4h:  Record<string, Candle[]>;
  candles1d:  Record<string, Candle[]>;
  liveReady:  boolean;
  mt5Enabled: boolean;
  mt5Status:  string;
  mt5Url:     string;
  balance:    number;
  equity:     number;
  riskPct:    number;
  assets:     string[];
  onOpenMT5:  (asset: string, dir: QDir, sl: number, tp: number, size: number) => Promise<boolean>;
  onCloseMT5: (asset: string, dir: QDir) => Promise<boolean>;
  pushToast:  (msg: string, type: "success"|"error"|"warning"|"info") => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATEMÁTICA PURA — fuera del componente
// ═══════════════════════════════════════════════════════════════════════════════

// CDF normal — Abramowitz & Stegun, error < 7.5e-8
function normCDF(x: number): number {
  if (x >  8) return 1;
  if (x < -8) return 0;
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741,
        a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const poly = ((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x*x/2)));
}

function normPDF(x: number): number {
  return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
}

// σ histórica realizada (log-retornos, anualizada)
function calcHV(closes: number[], lookback = 20, annFactor = 252): number {
  const n = Math.min(closes.length - 1, lookback);
  if (n < 4) return 0.30;
  const logR: number[] = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i-1] > 0) logR.push(Math.log(closes[i] / closes[i-1]));
  }
  const mean = logR.reduce((a,b)=>a+b,0) / logR.length;
  const v = logR.reduce((s,v)=>s+(v-mean)**2,0) / Math.max(logR.length-1,1);
  return Math.sqrt(v * annFactor);
}

// Horizonte T en años según modo y TF de velas disponible
function modeToT(mode: QMode): number {
  return mode === "scalp" ? 1/(252*24*4) : mode === "intradia" ? 1/(252*3) : 5/252;
}

// ATR de velas
function calcAtrCandles(candles: Candle[], period = 14): number {
  const c = candles.slice(-period-1);
  if (c.length < 2) return 0;
  const trs = c.slice(1).map((x,i) =>
    Math.max(x.h-x.l, Math.abs(x.h-c[i].c), Math.abs(x.l-c[i].c)));
  return trs.reduce((a,b)=>a+b,0) / trs.length;
}

// EMA rápida
function ema(arr: number[], period: number): number {
  if (!arr.length) return 0;
  const alpha = 2/(period+1);
  return arr.reduce((acc,v) => alpha*v + (1-alpha)*acc, arr[0]);
}

// Black-Scholes completo
function calcBS(
  S: number, K: number, T: number, sigma: number, r = 0,
  targetTP?: number, targetSL?: number
): BSGreeks {
  const sig   = Math.max(sigma, 0.005);
  const sqrtT = Math.sqrt(Math.max(T, 1e-8));
  const d1 = (Math.log(S / Math.max(K, 1e-9)) + (r + sig*sig/2)*T) / (sig*sqrtT);
  const d2 = d1 - sig*sqrtT;

  const delta = normCDF(d1);
  const gamma = normPDF(d1) / (S * sig * sqrtT);
  const theta = -(S * normPDF(d1) * sig) / (2*sqrtT) - r*Math.exp(-r*T)*K*normCDF(d2);
  const vega  = S * sqrtT * normPDF(d1);
  const rho   = K * T * Math.exp(-r*T) * normCDF(d2);

  let pTP = 0.5, pSL = 0.5, ev = 0;
  if (targetTP && targetSL && S > 0) {
    const d_tp = (Math.log(targetTP/S) + (r+sig*sig/2)*T) / (sig*sqrtT);
    const d_sl = (Math.log(targetSL/S) + (r+sig*sig/2)*T) / (sig*sqrtT);
    pTP = normCDF(d_tp);
    pSL = 1 - normCDF(d_sl);
    ev  = pTP * Math.abs(targetTP-S) - pSL * Math.abs(S-targetSL);
  }
  return { delta, gamma, theta, vega, rho, d1, d2, sigma: sig, T,
           pTP, pSL, ev, vegaCross: false, gammaExtreme: false };
}

// Kelly fraccionario BS
// f* = (p*b - q) / b   donde p=pTP, q=pSL, b=RR
// Fracción: 25% del Kelly completo (conservador)
function calcKellyBS(pTP: number, rr: number): number {
  const p = Math.max(0.01, Math.min(0.99, pTP));
  const q = 1 - p;
  const b = Math.max(0.5, rr);
  const f = (p*b - q) / b;
  return Math.max(0.05, Math.min(0.50, f * 0.25)); // 25% fraccionario, cap 50%
}

// Wyckoff × BS: detecta qué hace el MM con σ
function interpretWyckoffBS(
  candles4h: Candle[], candles1d: Candle[],
  greeks: BSGreeks, vegaHistory: number[]
): WyckoffCtx {
  const c = candles4h.length >= 20 ? candles4h : candles1d;
  if (c.length < 20) return {
    phase: "unknown", bias: "neutral",
    narrative: "Sin velas 4H/1D suficientes",
    sigmaCtrl: "neutral", mmAction: "Sin datos"
  };

  const closes  = c.map(x => x.c);
  const volumes = c.map(x => x.v);
  const n = closes.length;
  const price = closes[n-1];

  const hi20  = Math.max(...closes.slice(-20));
  const lo20  = Math.min(...closes.slice(-20));
  const range = hi20 - lo20;
  const pos   = range > 0 ? (price - lo20) / range : 0.5;

  const avgVol20 = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
  const avgVol5  = volumes.slice(-5).reduce((a,b)=>a+b,0)/5;
  const volR     = avgVol5 / Math.max(avgVol20, 1);

  const ema8  = ema(closes.slice(-8),  8);
  const ema21 = ema(closes.slice(-21), 21);
  const trend = ema8 > ema21 ? "up" : "down";

  const hvRecent = calcHV(closes, 10);
  const hvLong   = calcHV(closes, 20);
  const sigmaCtrl: WyckoffCtx["sigmaCtrl"] =
    hvRecent < hvLong * 0.75 ? "compressing" :
    hvRecent > hvLong * 1.30 ? "expanding"   : "neutral";

  let phase: WyckoffCtx["phase"] = "unknown";
  let bias:  WyckoffCtx["bias"]  = "neutral";
  let mmAction = "Sin sesgo claro";
  let narrative = "";

  // Clasificar fase
  if      (sigmaCtrl==="compressing" && pos<0.35 && volR<0.8)
    { phase="B"; bias="accumulation"; mmAction="MM absorbe oferta — σ comprimida en fondo"; narrative=`Fase B Acum: σ ↓${((1-hvRecent/hvLong)*100).toFixed(0)}%, precio en base, vol bajo.`; }
  else if (sigmaCtrl==="compressing" && pos<0.25 && volR>1.2)
    { phase="C"; bias="accumulation"; mmAction="⚡ SPRING — spike vol en mínimo = trampa bajista"; narrative=`Fase C Spring: vol +${((volR-1)*100).toFixed(0)}% en fondo. MM toca stops.`; }
  else if (sigmaCtrl==="expanding"   && trend==="up"   && pos>0.45)
    { phase="D"; bias="accumulation"; mmAction="SOS — σ liberada al alza"; narrative=`Fase D Mark-up: expansión σ +${((hvRecent/hvLong-1)*100).toFixed(0)}%.`; }
  else if (pos>0.65 && trend==="up"  && volR>0.9)
    { phase="E"; bias="accumulation"; mmAction="Mark-up establecido — momentum firme"; narrative=`Fase E: precio en zona alta, tendencia intacta.`; }
  else if (sigmaCtrl==="compressing" && pos>0.65 && volR<0.8)
    { phase="B"; bias="distribution"; mmAction="MM distribuye — σ comprimida en techo"; narrative=`Fase B Dist: σ ↓ en techo. MM vende silenciosamente.`; }
  else if (sigmaCtrl==="compressing" && pos>0.75 && volR>1.2)
    { phase="C"; bias="distribution"; mmAction="⚡ UTAD — spike vol en máximo = trampa alcista"; narrative=`Fase C UTAD: MM toca stops alcistas.`; }
  else if (sigmaCtrl==="expanding"   && trend==="down" && pos<0.55)
    { phase="D"; bias="distribution"; mmAction="SOW — σ liberada a la baja"; narrative=`Fase D Mark-down: expansión σ bajista.`; }
  else
    { phase="A"; bias="neutral"; mmAction="Transición — estructura no definida"; narrative=`Fase A/transición.`; }

  // Vega cross desde historial
  const vCross = vegaHistory.length >= 5 &&
    greeks.vega > vegaHistory[vegaHistory.length-1] * 1.15 &&
    vegaHistory.slice(-3).every(v => v < greeks.vega);
  if (vCross) {
    mmAction = "⚡ VEGA CROSS: MM libera σ → inicio de movimiento";
    narrative += " | Vega cruzando al alza.";
  }

  return { phase, bias, narrative, sigmaCtrl, mmAction };
}

// ─── Generador de señal ───────────────────────────────────────────────────────
function generateBSSignal(
  asset: string, mode: QMode,
  candles1m: Candle[], candles5m: Candle[], candles15m: Candle[],
  candles4h: Candle[], candles1d: Candle[],
  price: number,
  vegaHist: number[], gammaHist: number[],
  calib: QCalib | null,
  groqFloor: number | null,
): QSignal | null {
  // Elegir TF según modo
  const c = mode === "scalp"
    ? (candles5m.length  >= 20 ? candles5m  : candles1m)
    : mode === "intradia"
    ? (candles15m.length >= 20 ? candles15m : candles1m)
    : candles1m;

  if (!c.length || c.length < 14 || price <= 0) return null;

  const closes = c.map(x => x.c);
  const n = closes.length;
  const sigma = calcHV(closes, Math.min(mode === "swing" ? 60 : 20, n-1));
  const T = modeToT(mode);
  const atr = calcAtrCandles(c);

  // VWAP (últimas 20 velas)
  const rec = c.slice(-20);
  const tvol = rec.reduce((s,x)=>s+x.v, 0);
  const vwap = tvol > 0 ? rec.reduce((s,x)=>s+((x.h+x.l+x.c)/3)*x.v, 0)/tvol : price;

  // ── Griegas ────────────────────────────────────────────────────────────────
  const slMult = mode === "scalp" ? 0.8 : mode === "intradia" ? 1.2 : 2.0;
  const tpMult = mode === "scalp" ? 1.5 : mode === "intradia" ? 2.5 : 4.0;
  const slRef = price - atr*slMult;
  const tpRef = price + atr*tpMult;

  const g = calcBS(price, vwap, T, sigma, 0, tpRef, slRef);

  // Percentiles Gamma y Vega
  const gammaExtreme = gammaHist.length >= 10 &&
    g.gamma > (gammaHist.slice(-10).sort((a,b)=>a-b)[7] ?? 0);
  const vegaCross = vegaHist.length >= 5 &&
    g.vega > vegaHist[vegaHist.length-1] * 1.10 &&
    vegaHist.slice(-3).every(v => v <= g.vega);
  g.gammaExtreme = gammaExtreme;
  g.vegaCross    = vegaCross;

  // Wyckoff
  const wyckoff = interpretWyckoffBS(candles4h, candles1d, g, vegaHist);

  // ── Dirección ─────────────────────────────────────────────────────────────
  // Delta base + sesgos adicionales
  const emaShort = ema(closes.slice(-8),  8);
  const emaLong  = ema(closes.slice(-21), 21);
  const emaTrend = emaShort > emaLong ? 1 : -1;
  const roc5 = n > 5 ? (closes[n-1]-closes[n-6])/closes[n-6] : 0;

  // Wyckoff sesgo direccional
  const wyckBias = wyckoff.bias === "accumulation" ? 1 : wyckoff.bias === "distribution" ? -1 : 0;

  // Voto combinado
  const bullVotes = [g.delta > 0.52, emaTrend > 0, roc5 > 0, wyckBias > 0].filter(Boolean).length;
  const bearVotes = [g.delta < 0.48, emaTrend < 0, roc5 < 0, wyckBias < 0].filter(Boolean).length;

  let direction: QDir = "NEUTRAL";
  if      (bullVotes >= 2 && bullVotes > bearVotes) direction = "LONG";
  else if (bearVotes >= 2 && bearVotes > bullVotes) direction = "SHORT";
  if (direction === "NEUTRAL") return null;

  const isLong = direction === "LONG";

  // SL/TP ajustados a dirección
  const sl  = isLong ? price - atr*slMult        : price + atr*slMult;
  const tp1 = isLong ? price + atr*tpMult        : price - atr*tpMult;
  const tp2 = isLong ? price + atr*tpMult*1.8    : price - atr*tpMult*1.8;
  const tp3 = isLong ? price + atr*tpMult*3.0    : price - atr*tpMult*3.0;
  const rr  = Math.abs(tp1-price) / Math.max(Math.abs(price-sl), 1e-9);

  // Recalcular EV con SL/TP reales
  const gFinal = calcBS(price, vwap, T, sigma, 0, tp1, sl);
  gFinal.gammaExtreme = gammaExtreme;
  gFinal.vegaCross    = vegaCross;

  // ── Filtros por modo ───────────────────────────────────────────────────────
  const hasVol = (() => {
    const vols = c.slice(-20).map(x=>x.v);
    const avg = vols.reduce((a,b)=>a+b,0)/vols.length;
    return c[c.length-1].v > avg * 0.9;
  })();

  let passes = false;
  if (mode === "scalp") {
    const deltaOk = Math.abs(g.delta - 0.5) > 0.06;
    passes = deltaOk && (gammaExtreme || vegaCross) && hasVol;
  } else if (mode === "intradia") {
    const wyckActive = wyckoff.bias !== "neutral" && wyckoff.phase !== "unknown";
    const evOk = gFinal.ev > 0;
    passes = wyckActive && evOk && (vegaCross || wyckoff.sigmaCtrl === "expanding");
  } else { // swing
    const deltaExt = g.delta > 0.66 || g.delta < 0.34;
    const phaseOk  = ["D","E"].includes(wyckoff.phase);
    const thetaOk  = Math.abs(g.theta) / price < 0.003;
    const evStr    = gFinal.ev > atr * 0.4;
    passes = deltaExt && phaseOk && thetaOk && evStr;
  }
  if (!passes) return null;

  // ── Confidence ────────────────────────────────────────────────────────────
  let conf = 50;
  conf += (Math.abs(g.delta - 0.5) - 0.05) * 40;
  if (gammaExtreme) conf += 10;
  if (vegaCross)    conf += 10;
  if (gFinal.ev > 0) conf += 8;
  if (gFinal.ev > atr*0.5) conf += 7;
  if (wyckoff.bias !== "neutral") conf += 12;
  if (wyckoff.phase === "C") conf += 10;
  // Wyckoff vs dirección: si contradice, penalizar
  const wyckBiasDir: QDir = wyckoff.bias === "accumulation" ? "LONG" : wyckoff.bias === "distribution" ? "SHORT" : direction;
  if (wyckBiasDir !== direction && wyckoff.bias !== "neutral") conf -= 18;
  // Walk-forward ajuste
  if (calib) {
    conf += calib.floorAdj;
    if (calib.wr > 0.55) conf += 5;
    if (calib.wr < 0.40) conf -= 8;
  }
  conf = Math.max(0, Math.min(100, conf));

  // ── Floor mínimo ──────────────────────────────────────────────────────────
  const baseFloor = mode === "scalp" ? 52 : mode === "intradia" ? 55 : 58;
  const floor = groqFloor ?? (baseFloor + (calib?.floorAdj ?? 0));
  if (conf < floor) return null;

  // ── Kelly size ────────────────────────────────────────────────────────────
  // Sobrescrito en el componente con equity real
  const kellyF = calcKellyBS(gFinal.pTP, rr);
  const stopDist = Math.abs(price - sl);
  const size = kellyF; // placeholder — el componente multiplica por equity/riskPct

  const filterNote = mode === "scalp"
    ? `Δ=${g.delta.toFixed(3)} Γ-ext:${gammaExtreme?1:0} VegaX:${vegaCross?1:0}`
    : mode === "intradia"
    ? `W:${wyckoff.phase}/${wyckoff.bias} EV=${gFinal.ev.toFixed(4)} VegaX:${vegaCross?1:0}`
    : `Δ=${g.delta.toFixed(3)} Phase:${wyckoff.phase} Θ%=${(Math.abs(g.theta)/price*100).toFixed(3)}`;

  return {
    id: Date.now() + Math.random(), asset, mode, direction,
    entry: price, sl, tp: tp1, tp2, tp3,
    size, greeks: gFinal, wyckoff, confidence: conf,
    rationale: `BS${mode.toUpperCase()} Δ=${g.delta.toFixed(3)} Γ=${g.gamma.toFixed(6)} V=${g.vega.toFixed(2)} σ=${(sigma*100).toFixed(1)}% | EV=${gFinal.ev.toFixed(4)} P(TP)=${(gFinal.pTP*100).toFixed(0)}% P(SL)=${(gFinal.pSL*100).toFixed(0)}% | ${filterNote} | ${wyckoff.mmAction.slice(0,60)}`,
    generatedAt: Date.now(), rr,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function GreeksCard({ g, mode }: { g: BSGreeks; mode: QMode }) {
  const dC = g.delta > 0.60 ? "#10b981" : g.delta < 0.40 ? "#ef4444" : "#f59e0b";
  const gC = g.gammaExtreme ? "#a78bfa" : "var(--text-2)";
  const vC = g.vegaCross    ? "#f59e0b" : "var(--text-2)";
  const items = [
    { lbl:"Δ Delta",  val:g.delta.toFixed(3),   sub: g.delta>0.6?"alcista":g.delta<0.4?"bajista":"neutral",   col:dC, note:"1° orden: dirección" },
    { lbl:"Γ Gamma",  val:g.gamma.toFixed(6),   sub: g.gammaExtreme?"⚡ EXTREMO":"normal",  col:gC, note:"2° orden: inflexión" },
    { lbl:"Θ Theta",  val:(g.theta*365/100).toFixed(4), sub:"por día %",  col:"#6b7280", note:"Costo temporal" },
    { lbl:"V Vega",   val:g.vega.toFixed(3),    sub: g.vegaCross?"⚡ CROSS":"σ estable", col:vC, note:"Sens. volatilidad" },
    { lbl:"ρ Rho",    val:g.rho.toFixed(4),     sub: g.rho>0?"tasa↑":"tasa↓",  col:"var(--text-2)", note:"Sesgo macro" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
      {items.map(it => (
        <div key={it.lbl} style={{ background:"rgba(255,255,255,0.03)", borderRadius:8,
          padding:"8px 6px", textAlign:"center", border:"1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ fontSize:9, color:"var(--muted)", marginBottom:2, textTransform:"uppercase",
            letterSpacing:"0.05em" }}>{it.lbl}</p>
          <p style={{ fontSize:14, fontWeight:800, color:it.col,
            fontFamily:"'JetBrains Mono',monospace" }}>{it.val}</p>
          <p style={{ fontSize:9, color:it.col, marginTop:1, fontWeight:700 }}>{it.sub}</p>
          <p style={{ fontSize:8, color:"var(--muted)", marginTop:2 }}>{it.note}</p>
        </div>
      ))}
    </div>
  );
}

function EVBar({ pTP, pSL, ev }: { pTP:number; pSL:number; ev:number }) {
  const col = ev > 0 ? "#10b981" : "#ef4444";
  return (
    <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"10px 12px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{ fontSize:11, fontWeight:700 }}>
          Expected Value{" "}
          <span style={{ color:col, fontFamily:"'JetBrains Mono',monospace" }}>
            {ev>0?"+":""}{ev.toFixed(5)}
          </span>
        </span>
        <span style={{ fontSize:10, color:"var(--muted)" }}>
          ∫N(d₁) = {(pTP*100).toFixed(1)}% · ∫N(d₂) = {(pSL*100).toFixed(1)}%
        </span>
      </div>
      <div style={{ position:"relative", height:8, borderRadius:4,
        overflow:"hidden", background:"rgba(255,255,255,0.06)" }}>
        <div style={{ position:"absolute", left:0, top:0, height:"100%",
          width:`${pTP*100}%`,
          background:"linear-gradient(90deg,#059669,#10b981)", borderRadius:"4px 0 0 4px" }} />
        <div style={{ position:"absolute", right:0, top:0, height:"100%",
          width:`${pSL*100}%`,
          background:"linear-gradient(90deg,#ef4444,#fca5a5)", borderRadius:"0 4px 4px 0" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
        <span style={{ fontSize:9, color:"#10b981" }}>P(TP) ↑</span>
        <span style={{ fontSize:9, color:"#ef4444" }}>P(SL) ↓</span>
      </div>
    </div>
  );
}

function WyckoffBadge({ ctx }: { ctx:WyckoffCtx }) {
  const phC: Record<string,string> = {
    A:"#6b7280",B:"#6366f1",C:"#f59e0b",D:"#10b981",E:"#3b82f6",unknown:"#374151"
  };
  const biC: Record<string,string> = {
    accumulation:"#10b981",distribution:"#ef4444",neutral:"#6b7280"
  };
  const scC: Record<string,string> = {
    compressing:"#a5b4fc",expanding:"#fbbf24",neutral:"var(--muted)"
  };
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", borderRadius:8, padding:"10px 12px",
      borderLeft:`3px solid ${biC[ctx.bias]}` }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
        <span style={{ fontSize:11, fontWeight:800, padding:"2px 8px", borderRadius:6,
          background:phC[ctx.phase]+"20", color:phC[ctx.phase] }}>
          Fase {ctx.phase}
        </span>
        <span style={{ fontSize:11, fontWeight:700, color:biC[ctx.bias] }}>
          {ctx.bias==="accumulation"?"🐂 Acumulación":ctx.bias==="distribution"?"🐻 Distribución":"⚖ Neutro"}
        </span>
        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:5,
          background:scC[ctx.sigmaCtrl]+"18", color:scC[ctx.sigmaCtrl] }}>
          σ {ctx.sigmaCtrl}
        </span>
      </div>
      <p style={{ fontSize:11, color:"var(--text)", marginBottom:3, fontWeight:600 }}>{ctx.mmAction}</p>
      <p style={{ fontSize:10, color:"var(--muted)", fontStyle:"italic" }}>{ctx.narrative}</p>
    </div>
  );
}

// Mini sparkline de σ histórico
function SigmaSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 120, h = 30;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = Math.max(mx - mn, 0.001);
  const pts = data.slice(-20).map((v,i,arr) =>
    `${(i/(arr.length-1))*w},${h - ((v-mn)/range)*h}`
  ).join(" ");
  const last = data[data.length-1];
  const prev = data[data.length-2];
  const col  = last > prev ? "#f59e0b" : "#6b7280";
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
      <svg width={w} height={h} style={{ overflow:"visible" }}>
        <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize:11, fontFamily:"monospace", color:col, fontWeight:700 }}>
        {(last*100).toFixed(1)}%/a
      </span>
    </div>
  );
}

// Heatmap Δ × todos los activos
function DeltaHeatmap({ greeksMap, assets, activeAsset, onSelect }:{
  greeksMap: Record<string,BSGreeks>; assets:string[];
  activeAsset:string; onSelect:(a:string)=>void;
}) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
      {assets.slice(0,16).map(a => {
        const g = greeksMap[a];
        if (!g) return (
          <div key={a} style={{ padding:"5px 6px", borderRadius:7,
            background:"rgba(255,255,255,0.02)", cursor:"pointer" }}
            onClick={()=>onSelect(a)}>
            <div style={{ fontSize:9, color:"var(--muted)" }}>
              {a.replace("USDT","").replace("USD","")}
            </div>
            <div style={{ fontSize:9, color:"var(--muted)" }}>—</div>
          </div>
        );
        const d = g.delta;
        // Color: rojo intenso < 0.35, verde intenso > 0.65, amarillo en 0.5
        const heat = d > 0.65 ? `rgba(16,185,129,${(d-0.5)*1.5})`
                   : d < 0.35 ? `rgba(239,68,68,${(0.5-d)*1.5})`
                   : `rgba(245,158,11,${0.08})`;
        const arrow = d > 0.58 ? "↑" : d < 0.42 ? "↓" : "→";
        const col   = d > 0.58 ? "#10b981" : d < 0.42 ? "#ef4444" : "#f59e0b";
        return (
          <div key={a} onClick={()=>onSelect(a)}
            style={{ padding:"6px 7px", borderRadius:7, cursor:"pointer",
              background: heat,
              border: activeAsset===a ? "1px solid #6366f1" : "1px solid transparent",
              transition:"all 0.2s" }}>
            <div style={{ fontSize:9, color:"var(--muted)", marginBottom:1 }}>
              {a.replace("USDT","").replace("USD","")}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:2 }}>
              <span style={{ color:col, fontWeight:800, fontSize:12 }}>{arrow}</span>
              <span style={{ fontSize:11, fontFamily:"monospace", color:col, fontWeight:700 }}>
                {d.toFixed(3)}
              </span>
            </div>
            <div style={{ display:"flex", gap:3, marginTop:1 }}>
              {g.gammaExtreme && <span style={{ fontSize:7, color:"#a78bfa" }}>Γ⚡</span>}
              {g.vegaCross    && <span style={{ fontSize:7, color:"#f59e0b" }}>V↑</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── useLocalStorage ──────────────────────────────────────────────────────────
function useQStorage<T>(key: string, init: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch { return init; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch { /* ignorar quota */ }
  }, [key, val]);
  return [val, setVal];
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export default function QuantEngine({
  prices, candles, candles5m, candles15m, candles4h, candles1d,
  liveReady, mt5Enabled, mt5Status, mt5Url,
  balance, equity, riskPct, assets,
  onOpenMT5, onCloseMT5, pushToast
}: QuantEngineProps) {

  const [activeMode,    setActiveMode]  = useState<QMode>("intradia");
  const [activeAsset,   setActiveAsset] = useState<string>(assets[0] ?? "BTCUSD");
  const [activeView,    setActiveView]  = useState<"signals"|"greeks"|"history">("signals");
  const [scanning,      setScanning]    = useState(false);
  const [autoScan,      setAutoScan]    = useState(false);

  // Persistencia
  const [openPositions, setOpenPositions] = useQStorage<QPosition[]>("tl_q_open", []);
  const [closedTrades,  setClosedTrades]  = useQStorage<QClosedTrade[]>("tl_q_closed", []);
  const [calibMap,      setCalibMap]      = useQStorage<Record<string,QCalib>>("tl_q_calib", {});
  const [groqCalib,     setGroqCalib]     = useQStorage<GroqQCalib|null>("tl_q_groq", null);
  const [lastSignals,   setLastSignals]   = useState<Record<string,QSignal>>({});
  const [greeksMap,     setGreeksMap]     = useState<Record<string,BSGreeks>>({});
  const [wyckoffMap,    setWyckoffMap]    = useState<Record<string,WyckoffCtx>>({});
  const [sigmaHistMap,  setSigmaHistMap]  = useState<Record<string,number[]>>({});

  const vegaHistRef  = useRef<Record<string,number[]>>({});
  const gammaHistRef = useRef<Record<string,number[]>>({});
  const openRef = useRef(openPositions);
  openRef.current = openPositions;
  const groqTimerRef = useRef<number>(0);

  // ─── Walk-forward: actualiza calib tras cada cierre ──────────────────────
  const updateCalib = useCallback((t: QClosedTrade) => {
    setCalibMap(prev => {
      const key = `${t.asset}_${t.mode}`;
      const old = prev[key] ?? { asset: t.asset, n:0, wins:0, wr:0.5, avgRR:1.5,
        kellyF:0.25, floorAdj:0, sigmaHistory:[], evHistory:[], lastUpdated:0 };
      const wins = old.wins + (t.pnl > 0 ? 1 : 0);
      const n    = old.n + 1;
      const wr   = wins / n;
      const avgRR = (old.avgRR * old.n + t.rrRealized) / n;
      // Kelly adaptativo
      const kellyF = Math.max(0.05, Math.min(0.50, (wr * avgRR - (1-wr)) / avgRR * 0.25));
      // Floor: si WR < 40% elevar piso, si > 55% bajarlo
      let floorAdj = old.floorAdj;
      if (n >= 5) {
        if (wr < 0.40) floorAdj = Math.min(old.floorAdj + 2, 12);
        if (wr > 0.55) floorAdj = Math.max(old.floorAdj - 1, -8);
      }
      const sigH = [...(old.sigmaHistory ?? []), t.greeks.sigma].slice(-50);
      const evH  = [...(old.evHistory  ?? []), t.pnl].slice(-50);
      return { ...prev, [key]: { asset:t.asset, n, wins, wr, avgRR, kellyF, floorAdj,
        sigmaHistory:sigH, evHistory:evH, lastUpdated:Date.now() } };
    });
  }, [setCalibMap]);

  // ─── Groq calibrador — cada 20 min ───────────────────────────────────────
  const runGroqCalib = useCallback(async () => {
    if (!liveReady) return;
    try {
      // Resumen compacto del estado para el prompt
      const calibSummary = Object.entries(calibMap).slice(0, 8).map(([k,c]) =>
        `${k}: n=${c.n} wr=${(c.wr*100).toFixed(0)}% rr=${c.avgRR.toFixed(1)} kelly=${(c.kellyF*100).toFixed(0)}%`
      ).join("; ");

      const topGreeks = Object.entries(greeksMap).slice(0,5).map(([a,g]) =>
        `${a.replace("USDT","").replace("USD","")}: Δ=${g.delta.toFixed(2)} Γ=${g.gamma.toFixed(5)} V=${g.vega.toFixed(2)} σ=${(g.sigma*100).toFixed(1)}%`
      ).join("; ");

      const recentPnl = closedTrades.slice(0,5).map(t=>
        `${t.asset} ${t.mode} ${t.direction}: $${t.pnl.toFixed(2)} (${t.result})`
      ).join("; ");

      const prompt = `Eres un calibrador cuantitativo de un motor Black-Scholes × Wyckoff.
Griegas actuales: ${topGreeks || "sin datos"}
Walk-forward por activo/modo: ${calibSummary || "sin historial"}
Últimos trades: ${recentPnl || "sin trades"}
Modo activo: ${activeMode}

Responde SOLO con JSON sin markdown:
{"floors":{"BTC_scalp":52,"ETH_intradia":55},"sizes":{"BTC":1.0,"ETH":0.9},"macro":"nota breve","note":"insight clave sobre griegas o Wyckoff","bump_assets":["BTCUSD"]}

"floors" = ajuste al confidence floor por activo+modo (valores entre 48-70).
"sizes" = multiplicador de sizing (0.5-1.5).
"bump_assets" = activos que merecen re-scan urgente.
Sé conciso y preciso.`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await resp.json() as { content: Array<{type:string; text:string}> };
      const raw = data.content?.find(b => b.type === "text")?.text ?? "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as GroqQCalib;
      setGroqCalib({ ...parsed, timestamp: Date.now() });
      if (parsed.note) pushToast(`📐 Groq Quant: ${parsed.note}`, "info");
    } catch { /* ignorar — no bloquear */ }
  }, [liveReady, calibMap, greeksMap, closedTrades, activeMode, pushToast, setGroqCalib]);

  useEffect(() => {
    if (!autoScan) return;
    groqTimerRef.current = window.setInterval(() => void runGroqCalib(), 20*60*1000);
    return () => clearInterval(groqTimerRef.current);
  }, [autoScan, runGroqCalib]);

  // ─── Scan principal ───────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (!liveReady || scanning) return;
    setScanning(true);

    const newG:  Record<string,BSGreeks>   = {};
    const newW:  Record<string,WyckoffCtx> = {};
    const newS:  Record<string,QSignal>    = {};
    const newSH: Record<string,number[]>   = { ...sigmaHistMap };

    for (const asset of assets) {
      try {
        const c1  = candles[asset]   ?? [];
        const c5  = candles5m[asset]  ?? [];
        const c15 = candles15m[asset] ?? [];
        const c4h = candles4h[asset]  ?? [];
        const c1d = candles1d[asset]  ?? [];
        const px  = prices[asset] ?? 0;
        if (!c1.length || !px) continue;

        const closes = c1.map(x => x.c);
        const sigma  = calcHV(closes, Math.min(20, closes.length-1));
        const T      = modeToT(activeMode);
        const rec    = c1.slice(-20);
        const tvol   = rec.reduce((s,x)=>s+x.v,0);
        const vwap   = tvol>0 ? rec.reduce((s,x)=>s+((x.h+x.l+x.c)/3)*x.v,0)/tvol : px;
        const g      = calcBS(px, vwap, T, sigma);

        // Actualizar historiales
        if (!vegaHistRef.current[asset])  vegaHistRef.current[asset]  = [];
        if (!gammaHistRef.current[asset]) gammaHistRef.current[asset] = [];
        vegaHistRef.current[asset]  = [...vegaHistRef.current[asset],  g.vega ].slice(-50);
        gammaHistRef.current[asset] = [...gammaHistRef.current[asset], g.gamma].slice(-50);
        newSH[asset] = [...(newSH[asset] ?? []), sigma].slice(-50);

        const wyckoff = interpretWyckoffBS(c4h, c1d, g, vegaHistRef.current[asset]);
        newG[asset] = { ...g,
          gammaExtreme: g.gamma > (gammaHistRef.current[asset].slice(-10).sort((a,b)=>a-b)[7] ?? 0),
          vegaCross: vegaHistRef.current[asset].length >= 5 &&
            g.vega > vegaHistRef.current[asset][vegaHistRef.current[asset].length-2] * 1.10
        };
        newW[asset] = wyckoff;

        // Intentar señal
        const calibKey = `${asset}_${activeMode}`;
        const calib = calibMap[calibKey] ?? null;
        const groqFloor = groqCalib?.floors?.[`${asset.replace("USDT","").replace("USD","")}_${activeMode}`] ?? null;
        const groqSizeMult = groqCalib?.sizes?.[asset.replace("USDT","").replace("USD","")] ?? 1.0;

        const sig = generateBSSignal(asset, activeMode, c1, c5, c15, c4h, c1d, px,
          vegaHistRef.current[asset], gammaHistRef.current[asset], calib, groqFloor);

        if (sig) {
          // Sizing con Kelly + equity + riskPct + Groq mult
          const atr = calcAtrCandles(c1);
          const stopDist = Math.abs(sig.entry - sig.sl);
          const kellyF = calib ? calib.kellyF : calcKellyBS(sig.greeks.pTP, sig.rr);
          const riskUsd = equity * (riskPct / 100) * kellyF * groqSizeMult;
          sig.size = Math.max(0.01, Math.round(riskUsd / Math.max(stopDist, sig.entry*0.001) * 100) / 100);
          newS[asset] = sig;
        }
      } catch (e) { console.warn(`[QE] ${asset}:`, e); }
    }

    setGreeksMap(newG);
    setWyckoffMap(newW);
    setSigmaHistMap(newSH);

    if (Object.keys(newS).length > 0) {
      setLastSignals(prev => ({ ...prev, ...newS }));
      const top = Object.values(newS).sort((a,b) => b.confidence - a.confidence)[0];
      pushToast(`📐 ${top.asset} ${top.direction} conf=${top.confidence.toFixed(0)} Δ=${top.greeks.delta.toFixed(2)} EV=${top.greeks.ev.toFixed(4)}`, "info");
    } else {
      // Limpiar señales antiguas del modo actual
      setLastSignals(prev => {
        const next = { ...prev };
        assets.forEach(a => { if (next[a]?.mode === activeMode) delete next[a]; });
        return next;
      });
    }
    setScanning(false);
  }, [liveReady, scanning, assets, candles, candles5m, candles15m, candles4h,
      candles1d, prices, activeMode, calibMap, groqCalib, equity, riskPct,
      pushToast, sigmaHistMap]);

  useEffect(() => {
    if (!autoScan) return;
    const id = window.setInterval(() => void runScan(), 60_000);
    return () => clearInterval(id);
  }, [autoScan, runScan]);

  // ─── Cerrar posición ─────────────────────────────────────────────────────
  const closePosition = useCallback(async (
    pos: QPosition, result: QClosedTrade["result"], exitPx?: number
  ) => {
    const px = exitPx ?? prices[pos.signal.asset] ?? pos.signal.entry;
    if (mt5Enabled && mt5Status === "connected") {
      await onCloseMT5(pos.signal.asset, pos.signal.direction);
    }
    const isLong = pos.signal.direction === "LONG";
    const pnl = (isLong ? px - pos.signal.entry : pos.signal.entry - px)
      * pos.signal.size * (1 - pos.partialClosed);
    const rrR = Math.abs(px - pos.signal.entry) /
      Math.max(Math.abs(pos.signal.entry - pos.signal.sl), 1e-9);
    const closed: QClosedTrade = {
      id: pos.id, asset: pos.signal.asset, mode: pos.signal.mode,
      direction: pos.signal.direction, entry: pos.signal.entry, exit: px,
      pnl, result, openedAt: pos.openedAt, closedAt: Date.now(),
      greeks: pos.signal.greeks, rrRealized: rrR,
    };
    setOpenPositions(prev => prev.filter(p => p.id !== pos.id));
    setClosedTrades(prev => [closed, ...prev].slice(0, 300));
    updateCalib(closed);
    const icon = pnl >= 0 ? "✅" : "❌";
    pushToast(`${icon} BS ${pos.signal.asset} ${result} | ${pnl>=0?"+":""}$${pnl.toFixed(2)} RR=${rrR.toFixed(2)}`,
      pnl >= 0 ? "success" : "error");
  }, [prices, mt5Enabled, mt5Status, onCloseMT5, updateCalib,
      setOpenPositions, setClosedTrades, pushToast]);

  // ─── Abrir posición ───────────────────────────────────────────────────────
  const openPosition = useCallback(async (sig: QSignal) => {
    if (openRef.current.some(p => p.signal.asset === sig.asset)) {
      pushToast(`⚠ Ya hay posición BS en ${sig.asset}`, "warning"); return;
    }
    if (mt5Enabled && mt5Status === "connected") {
      const ok = await onOpenMT5(sig.asset, sig.direction, sig.sl, sig.tp, sig.size);
      if (!ok) return;
    }
    const pos: QPosition = {
      id: Date.now(), signal: sig, openedAt: Date.now(),
      peak: sig.entry, trough: sig.entry,
      tp1Hit: false, tp2Hit: false, breakevenSet: false, partialClosed: 0
    };
    setOpenPositions(prev => [...prev, pos]);
    pushToast(`✅ BS ${sig.mode.toUpperCase()} ${sig.asset} ${sig.direction} | Δ=${sig.greeks.delta.toFixed(2)} conf=${sig.confidence.toFixed(0)}%`, "success");
  }, [mt5Enabled, mt5Status, onOpenMT5, pushToast, setOpenPositions]);

  // ─── Evaluación de posiciones: Multi-TP + Trailing ───────────────────────
  useEffect(() => {
    if (!openPositions.length) return;
    const id = window.setInterval(() => {
      setOpenPositions(prev => {
        const next: QPosition[] = [];
        for (const pos of prev) {
          const px = prices[pos.signal.asset];
          if (!px) { next.push(pos); continue; }
          const isLong = pos.signal.direction === "LONG";
          let updated = { ...pos };
          updated.peak   = isLong ? Math.max(pos.peak,   px) : pos.peak;
          updated.trough = isLong ? pos.trough : Math.min(pos.trough, px);

          // Actualizar griegas en vivo
          const c = candles[pos.signal.asset] ?? [];
          if (c.length >= 5) {
            const cl = c.map(x=>x.c);
            const sigma = calcHV(cl, Math.min(20,cl.length-1));
            const T = modeToT(pos.signal.mode);
            updated.currentGreeks = calcBS(px, pos.signal.entry, T, sigma, 0,
              pos.signal.tp, pos.signal.sl);
          }

          // SL
          const hitSL = isLong ? px <= updated.signal.sl : px >= updated.signal.sl;
          if (hitSL) { void closePosition(updated, "SL"); continue; }

          // TP1 → cerrar 40% + mover SL a breakeven
          if (!pos.tp1Hit) {
            const hitTP1 = isLong ? px >= pos.signal.tp : px <= pos.signal.tp;
            if (hitTP1) {
              // Registrar cierre parcial (40%)
              const px1 = pos.signal.tp;
              const pnlParcial = (isLong ? px1-pos.signal.entry : pos.signal.entry-px1) * pos.signal.size * 0.40;
              const partial: QClosedTrade = {
                id: pos.id*10+1, asset: pos.signal.asset, mode: pos.signal.mode,
                direction: pos.signal.direction, entry: pos.signal.entry, exit: px1,
                pnl: pnlParcial, result: "TP1_PARTIAL",
                openedAt: pos.openedAt, closedAt: Date.now(),
                greeks: pos.signal.greeks, rrRealized: 1.0
              };
              setClosedTrades(ct => [partial, ...ct].slice(0,300));
              pushToast(`📐 TP1 ${pos.signal.asset} +$${pnlParcial.toFixed(2)} (40% cerrado) → SL a breakeven`, "success");
              updated = { ...updated,
                tp1Hit: true, partialClosed: 0.40, breakevenSet: true,
                signal: { ...updated.signal, sl: pos.signal.entry } // SL a entry
              };
            }
          }

          // TP2 → cerrar otro 40%
          if (pos.tp1Hit && !pos.tp2Hit) {
            const hitTP2 = isLong ? px >= pos.signal.tp2 : px <= pos.signal.tp2;
            if (hitTP2) {
              const px2 = pos.signal.tp2;
              const pnlParcial2 = (isLong ? px2-pos.signal.entry : pos.signal.entry-px2) * pos.signal.size * 0.40;
              const partial2: QClosedTrade = {
                id: pos.id*10+2, asset: pos.signal.asset, mode: pos.signal.mode,
                direction: pos.signal.direction, entry: pos.signal.entry, exit: px2,
                pnl: pnlParcial2, result: "TP2_PARTIAL",
                openedAt: pos.openedAt, closedAt: Date.now(),
                greeks: pos.signal.greeks, rrRealized: 2.0
              };
              setClosedTrades(ct => [partial2, ...ct].slice(0,300));
              pushToast(`📐 TP2 ${pos.signal.asset} +$${pnlParcial2.toFixed(2)} (40% cerrado)`, "success");
              updated = { ...updated, tp2Hit: true, partialClosed: 0.80 };
              // Si no hay TP3, cerrar el 20% restante aquí
              if (!pos.signal.tp3) {
                void closePosition(updated, "TP2"); continue;
              }
            }
          }

          // TP3 → cerrar el 20% restante (solo swing)
          if (pos.tp1Hit && pos.tp2Hit && pos.signal.tp3) {
            const hitTP3 = isLong ? px >= pos.signal.tp3 : px <= pos.signal.tp3;
            if (hitTP3) { void closePosition(updated, "TP3"); continue; }
          }

          // Trailing ATR adaptativo según modo
          const atrMult = pos.signal.mode === "swing" ? 2.0 : pos.signal.mode === "intradia" ? 1.4 : 1.0;
          const c2 = candles[pos.signal.asset] ?? [];
          const atr = c2.length > 14 ? calcAtrCandles(c2) : Math.abs(pos.signal.entry - pos.signal.sl);
          const trailLevel = isLong ? updated.peak - atr*atrMult : updated.trough + atr*atrMult;
          const newSL = isLong
            ? Math.max(updated.signal.sl, trailLevel)
            : Math.min(updated.signal.sl, trailLevel);
          updated = { ...updated, signal: { ...updated.signal, sl: newSL } };
          next.push(updated);
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [openPositions.length, prices, candles, closePosition, pushToast, setClosedTrades]);

  // ─── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo<QStats>(() => {
    const t = closedTrades;
    if (!t.length) return {
      totalTrades:0, winRate:0, totalPnl:0, avgRR:0, sharpe:0, maxDD:0,
      byMode: { scalp:{n:0,wr:0,pnl:0,avgRR:0}, intradia:{n:0,wr:0,pnl:0,avgRR:0}, swing:{n:0,wr:0,pnl:0,avgRR:0} }
    };
    const wins   = t.filter(x=>x.pnl>0).length;
    const pnls   = t.map(x=>x.pnl);
    const mean   = pnls.reduce((a,b)=>a+b,0)/pnls.length;
    const std    = Math.sqrt(pnls.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(pnls.length-1,1));
    // MaxDD
    let peak2 = 0, dd = 0, maxDD = 0;
    pnls.reduce((cum,p) => {
      const c = cum+p; peak2 = Math.max(peak2,c);
      dd = peak2 - c; maxDD = Math.max(maxDD,dd); return c;
    }, 0);
    const byMode = (["scalp","intradia","swing"] as QMode[]).reduce((acc,m) => {
      const mt = t.filter(x=>x.mode===m);
      acc[m] = { n:mt.length, wr:mt.length?mt.filter(x=>x.pnl>0).length/mt.length:0,
        pnl:mt.reduce((s,x)=>s+x.pnl,0), avgRR:mt.length?mt.reduce((s,x)=>s+x.rrRealized,0)/mt.length:0 };
      return acc;
    }, {} as QStats["byMode"]);
    return { totalTrades:t.length, winRate:wins/t.length,
      totalPnl:pnls.reduce((a,b)=>a+b,0), avgRR:t.reduce((s,x)=>s+x.rrRealized,0)/t.length,
      sharpe: std>0 ? mean/std*Math.sqrt(252) : 0, maxDD, byMode };
  }, [closedTrades]);

  const activeSignal = lastSignals[activeAsset];
  const activeGreeks = greeksMap[activeAsset];
  const activeWyck   = wyckoffMap[activeAsset];
  const activeSigmaH = sigmaHistMap[activeAsset] ?? [];
  const activeCalib  = calibMap[`${activeAsset}_${activeMode}`];

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 16px 40px" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"16px 0 12px", borderBottom:"1px solid var(--border)", marginBottom:16 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:900, margin:0 }}>
            📐 Motor Quant{"  "}
            <span style={{ fontSize:13, color:"#a5b4fc", fontWeight:600 }}>
              Black-Scholes × Wyckoff v2
            </span>
          </h1>
          <p style={{ fontSize:11, color:"var(--muted)", margin:"3px 0 0" }}>
            Δ·Γ·Θ·V·ρ · ∫EV · MM Analysis · Kelly Walk-Forward · Multi-TP
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {stats.totalTrades > 0 && (
            <div style={{ display:"flex", gap:10, fontSize:11 }}>
              <span style={{ color:"var(--muted)" }}>
                T:<strong style={{ color:"var(--text)" }}> {stats.totalTrades}</strong>
              </span>
              <span>
                WR:<strong style={{ color:stats.winRate>0.5?"#10b981":"#ef4444" }}>
                  {" "}{(stats.winRate*100).toFixed(0)}%</strong>
              </span>
              <span>
                P&L:<strong style={{ color:stats.totalPnl>=0?"#10b981":"#ef4444" }}>
                  {" "}{stats.totalPnl>=0?"+":""}${stats.totalPnl.toFixed(2)}</strong>
              </span>
              <span>
                Sharpe:<strong style={{ color:stats.sharpe>1?"#10b981":stats.sharpe>0?"#f59e0b":"#ef4444" }}>
                  {" "}{stats.sharpe.toFixed(2)}</strong>
              </span>
            </div>
          )}
          {groqCalib && (
            <span style={{ fontSize:10, padding:"3px 8px", borderRadius:6,
              background:"rgba(99,102,241,0.1)", color:"#a5b4fc" }}>
              🤖 {groqCalib.note?.slice(0,40) ?? "Groq calibrado"}
            </span>
          )}
          <button onClick={()=>setAutoScan(p=>!p)}
            style={{ padding:"7px 12px", borderRadius:8, border:"none", cursor:"pointer",
              fontWeight:700, fontSize:11,
              background:autoScan?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.06)",
              color:autoScan?"#fff":"var(--text-2)" }}>
            {autoScan ? "⏹ Auto ON" : "▶ Auto"}
          </button>
          <button onClick={()=>void runScan()} disabled={scanning||!liveReady}
            style={{ padding:"7px 14px", borderRadius:8, border:"none", cursor:"pointer",
              fontWeight:700, fontSize:12,
              background:"linear-gradient(135deg,#3b82f6,#6366f1)", color:"#fff",
              opacity:scanning||!liveReady?0.5:1 }}>
            {scanning?"⟳ Escaneando...":"🔍 Escanear"}
          </button>
          <button onClick={()=>void runGroqCalib()} disabled={!liveReady}
            style={{ padding:"7px 12px", borderRadius:8, border:"none", cursor:"pointer",
              fontWeight:700, fontSize:11,
              background:"rgba(99,102,241,0.12)", color:"#a5b4fc",
              opacity:!liveReady?0.5:1 }}>
            🤖 Calibrar
          </button>
        </div>
      </div>

      {/* Selectores modo + vista */}
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {(["scalp","intradia","swing"] as QMode[]).map(m => {
          const icons = { scalp:"⚡", intradia:"📊", swing:"🌊" };
          const desc  = { scalp:"Γ extrema · Δ flip · 5m",
                          intradia:"Vega cross · Wyckoff · 15m", swing:"EV fuerte · Δ ext · 1d" };
          const bm    = stats.byMode[m];
          return (
            <button key={m} onClick={()=>setActiveMode(m)}
              style={{ flex:1, minWidth:140, padding:"10px 12px", borderRadius:10, border:"none",
                cursor:"pointer", textAlign:"left",
                background:activeMode===m
                  ? "linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.15))"
                  : "rgba(255,255,255,0.03)",
                borderTop:activeMode===m?"2px solid #6366f1":"2px solid transparent" }}>
              <div style={{ fontSize:13, fontWeight:800 }}>
                {icons[m]} {m.charAt(0).toUpperCase()+m.slice(1)}
              </div>
              <div style={{ fontSize:10, color:"var(--muted)", marginTop:2 }}>{desc[m]}</div>
              {bm.n>0 && (
                <div style={{ fontSize:10, marginTop:3,
                  color:bm.wr>0.5?"#10b981":"#ef4444" }}>
                  {bm.n} trades · WR {(bm.wr*100).toFixed(0)}% · RR {bm.avgRR.toFixed(1)}
                </div>
              )}
            </button>
          );
        })}
        {/* Sub-vista */}
        <div style={{ display:"flex", gap:4, alignItems:"center" }}>
          {(["signals","greeks","history"] as const).map(v => (
            <button key={v} onClick={()=>setActiveView(v)}
              style={{ padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer",
                fontSize:11, fontWeight:700,
                background:activeView===v?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.04)",
                color:activeView===v?"#a5b4fc":"var(--text-2)" }}>
              {v==="signals"?"📡":v==="greeks"?"📊":"📒"} {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Vista: SIGNALS ── */}
      {activeView === "signals" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>

          {/* Izq: activo + griegas + Wyckoff */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

            {/* Selector de activo */}
            <div className="card" style={{ padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <p style={{ fontWeight:800, fontSize:12 }}>Activo activo</p>
                {activeSigmaH.length > 2 && <SigmaSparkline data={activeSigmaH} />}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
                {assets.slice(0,16).map(a => {
                  const sig = lastSignals[a];
                  const hasSig = sig?.mode === activeMode;
                  return (
                    <button key={a} onClick={()=>setActiveAsset(a)}
                      style={{ padding:"4px 9px", borderRadius:7, border:"none",
                        cursor:"pointer", fontSize:11, fontWeight:700,
                        background:activeAsset===a
                          ? "linear-gradient(135deg,#6366f1,#8b5cf6)"
                          : hasSig ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)",
                        color:activeAsset===a?"#fff":hasSig?"#10b981":"var(--text-2)" }}>
                      {a.replace("USDT","").replace("USD","")}
                      {greeksMap[a] && (
                        <span style={{ marginLeft:3, fontSize:9, opacity:0.8 }}>
                          Δ{greeksMap[a].delta.toFixed(2)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {activeGreeks ? (
                <>
                  <GreeksCard g={activeGreeks} mode={activeMode} />
                  <div style={{ marginTop:8 }}>
                    <EVBar pTP={activeGreeks.pTP} pSL={activeGreeks.pSL} ev={activeGreeks.ev} />
                  </div>
                  <div style={{ marginTop:6, display:"flex", gap:10, fontSize:10, color:"var(--muted)", flexWrap:"wrap" }}>
                    <span>σ=<strong style={{ color:"var(--text)", fontFamily:"monospace" }}>
                      {(activeGreeks.sigma*100).toFixed(1)}%/a</strong></span>
                    <span>d₁=<strong style={{ color:"var(--text)", fontFamily:"monospace" }}>
                      {activeGreeks.d1.toFixed(3)}</strong></span>
                    <span>d₂=<strong style={{ color:"var(--text)", fontFamily:"monospace" }}>
                      {activeGreeks.d2.toFixed(3)}</strong></span>
                    {activeCalib && (
                      <>
                        <span>Kelly=<strong style={{ color:"#10b981", fontFamily:"monospace" }}>
                          {(activeCalib.kellyF*100).toFixed(0)}%</strong></span>
                        <span>WF-Adj=<strong style={{ color:activeCalib.floorAdj>0?"#ef4444":"#10b981",
                          fontFamily:"monospace" }}>
                          {activeCalib.floorAdj>0?"+":""}{activeCalib.floorAdj}</strong></span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p style={{ fontSize:12, color:"var(--muted)", textAlign:"center", padding:"18px 0" }}>
                  Presioná Escanear para calcular griegas BS
                </p>
              )}
            </div>

            {/* Wyckoff */}
            {activeWyck && (
              <div className="card" style={{ padding:"12px 14px" }}>
                <p style={{ fontWeight:800, fontSize:12, marginBottom:8 }}>
                  Wyckoff × σ — Acción del Market Maker
                </p>
                <WyckoffBadge ctx={activeWyck} />
              </div>
            )}

            {/* Groq macro note */}
            {groqCalib?.macro && (
              <div style={{ padding:"10px 14px", borderRadius:10,
                background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.2)" }}>
                <p style={{ fontSize:10, color:"#a5b4fc", fontWeight:700, marginBottom:3 }}>
                  🤖 Groq Macro
                </p>
                <p style={{ fontSize:11, color:"var(--text-2)" }}>{groqCalib.macro}</p>
              </div>
            )}
          </div>

          {/* Der: señal + posiciones */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

            {activeSignal && activeSignal.mode === activeMode ? (
              <div className="card" style={{ padding:"14px 16px",
                border:`1px solid ${activeSignal.direction==="LONG"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}` }}>
                {/* Header señal */}
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                  <div>
                    <span style={{ fontSize:18, fontWeight:900,
                      color:activeSignal.direction==="LONG"?"#10b981":"#ef4444" }}>
                      {activeSignal.direction==="LONG"?"🐂 LONG":"🐻 SHORT"}
                    </span>
                    <span style={{ fontSize:13, color:"var(--muted)", marginLeft:8 }}>
                      {activeSignal.asset} · {activeSignal.mode}
                    </span>
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    {/* Confidence circle */}
                    <div style={{ width:44, height:44, borderRadius:"50%",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontWeight:900, fontSize:14,
                      background:activeSignal.confidence>70
                        ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.12)",
                      color:activeSignal.confidence>70?"#10b981":"#f59e0b",
                      border:`2px solid ${activeSignal.confidence>70?"#10b981":"#f59e0b"}` }}>
                      {activeSignal.confidence.toFixed(0)}
                    </div>
                    <button onClick={()=>void openPosition(activeSignal)}
                      style={{ padding:"10px 16px", borderRadius:9, border:"none",
                        cursor:"pointer", fontWeight:800, fontSize:13,
                        background:activeSignal.direction==="LONG"
                          ? "linear-gradient(135deg,#059669,#10b981)"
                          : "linear-gradient(135deg,#dc2626,#ef4444)",
                        color:"#fff" }}>
                      Abrir
                    </button>
                  </div>
                </div>

                {/* Niveles */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:12 }}>
                  {[
                    { lbl:"Entry", val:activeSignal.entry,  col:"var(--text)" },
                    { lbl:"SL",    val:activeSignal.sl,     col:"#ef4444" },
                    { lbl:"TP1",   val:activeSignal.tp,     col:"#6ee7b7" },
                    { lbl:"TP2",   val:activeSignal.tp2,    col:"#10b981" },
                    { lbl:"TP3",   val:activeSignal.tp3??activeSignal.tp2*1.2, col:"#059669" },
                  ].map(lv => (
                    <div key={lv.lbl} style={{ textAlign:"center", padding:"6px 4px",
                      background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
                      <p style={{ fontSize:9, color:"var(--muted)", marginBottom:2 }}>{lv.lbl}</p>
                      <p style={{ fontSize:12, fontWeight:800, color:lv.col,
                        fontFamily:"'JetBrains Mono',monospace" }}>
                        {lv.val > 10 ? lv.val.toFixed(2) : lv.val.toFixed(5)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Métricas */}
                <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                  {[
                    { lbl:`RR ${activeSignal.rr.toFixed(2)}×` },
                    { lbl:`Size ${activeSignal.size.toFixed(3)}L` },
                    { lbl:`EV ${activeSignal.greeks.ev>0?"+":""}${activeSignal.greeks.ev.toFixed(4)}`,
                      col:activeSignal.greeks.ev>0?"#10b981":"#ef4444" },
                    { lbl:`P(TP) ${(activeSignal.greeks.pTP*100).toFixed(0)}%`, col:"#10b981" },
                    { lbl:`σ ${(activeSignal.greeks.sigma*100).toFixed(1)}%/a` },
                    ...(activeCalib ? [{ lbl:`Kelly ${(activeCalib.kellyF*100).toFixed(0)}%`, col:"#a5b4fc" }] : []),
                  ].map((b,i) => (
                    <span key={i} style={{ fontSize:11, padding:"3px 8px", borderRadius:6,
                      background:`rgba(${b.col?"16,185,129":"255,255,255"},0.06)`,
                      color:b.col ?? "var(--text-2)" }}>{b.lbl}</span>
                  ))}
                </div>

                {/* Multi-TP info */}
                <div style={{ padding:"8px 10px", borderRadius:8,
                  background:"rgba(99,102,241,0.06)", marginBottom:8 }}>
                  <p style={{ fontSize:10, color:"#a5b4fc", fontWeight:700, marginBottom:3 }}>
                    Gestión Multi-TP
                  </p>
                  <p style={{ fontSize:10, color:"var(--text-2)" }}>
                    TP1 → cierra 40% + SL a breakeven · TP2 → cierra 40% · TP3 → cierra 20% restante
                  </p>
                </div>

                <p style={{ fontSize:9, color:"var(--muted)", fontFamily:"monospace",
                  lineHeight:1.6, wordBreak:"break-all" }}>
                  {activeSignal.rationale}
                </p>
              </div>
            ) : (
              <div className="card" style={{ padding:"30px 20px", textAlign:"center" }}>
                <p style={{ fontSize:20 }}>📐</p>
                <p style={{ fontSize:13, color:"var(--muted)", marginTop:6 }}>
                  Sin señal BS para {activeAsset} en modo {activeMode}
                </p>
                <p style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>
                  Requiere: filtros Δ·Γ·Wyckoff + EV positivo + conf ≥ floor
                </p>
              </div>
            )}

            {/* Posiciones abiertas */}
            {openPositions.length > 0 && (
              <div className="card" style={{ padding:"12px 14px" }}>
                <p style={{ fontWeight:800, fontSize:12, marginBottom:10 }}>
                  Posiciones BS abiertas ({openPositions.length})
                </p>
                {openPositions.map(pos => {
                  const px = prices[pos.signal.asset] ?? pos.signal.entry;
                  const isLong = pos.signal.direction === "LONG";
                  const pnl = (isLong ? px-pos.signal.entry : pos.signal.entry-px) * pos.signal.size;
                  const g = pos.currentGreeks ?? pos.signal.greeks;
                  const pct = pos.tp2Hit ? 80 : pos.tp1Hit ? 40 : 0;
                  return (
                    <div key={pos.id} style={{ padding:"10px 12px", borderRadius:8, marginBottom:6,
                      background:"rgba(255,255,255,0.02)",
                      border:`1px solid ${pnl>=0?"rgba(16,185,129,0.2)":"rgba(239,68,68,0.2)"}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontWeight:800, fontSize:13 }}>
                          {isLong?"🐂":"🐻"} {pos.signal.asset}
                          <span style={{ fontSize:10, color:"var(--muted)", marginLeft:6 }}>
                            {pos.signal.mode}
                          </span>
                          {pct > 0 && (
                            <span style={{ fontSize:9, marginLeft:6, padding:"1px 6px",
                              borderRadius:5, background:"rgba(16,185,129,0.1)", color:"#10b981" }}>
                              {pct}% cerrado
                            </span>
                          )}
                        </span>
                        <span style={{ fontWeight:800,
                          color:pnl>=0?"#10b981":"#ef4444" }}>
                          {pnl>=0?"+":""}${pnl.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display:"flex", gap:8, fontSize:10, color:"var(--muted)",
                        marginBottom:8, flexWrap:"wrap" }}>
                        <span>Δ <strong style={{ color:"var(--text)" }}>{g.delta.toFixed(3)}</strong></span>
                        <span>Γ <strong style={{ color:g.gammaExtreme?"#a78bfa":"var(--text)" }}>
                          {g.gamma.toFixed(6)}</strong></span>
                        <span>EV <strong style={{ color:g.ev>=0?"#10b981":"#ef4444" }}>
                          {g.ev>=0?"+":""}{g.ev.toFixed(4)}</strong></span>
                        <span>P(TP) <strong style={{ color:"#10b981" }}>
                          {(g.pTP*100).toFixed(0)}%</strong></span>
                        <span>SL <strong style={{ color:"#ef4444", fontFamily:"monospace" }}>
                          {pos.signal.sl.toFixed(2)}</strong></span>
                      </div>
                      {/* TP progress bar */}
                      <div style={{ height:4, borderRadius:2, background:"rgba(255,255,255,0.06)",
                        marginBottom:8, overflow:"hidden" }}>
                        <div style={{ height:"100%", borderRadius:2,
                          width:`${Math.min(100, Math.max(0,
                            (isLong ? px-pos.signal.entry : pos.signal.entry-px) /
                            (pos.signal.tp-pos.signal.entry) * 100
                          ))}%`,
                          background:"linear-gradient(90deg,#6366f1,#10b981)" }} />
                      </div>
                      <button onClick={()=>void closePosition(pos,"MANUAL")}
                        style={{ padding:"4px 12px", borderRadius:6, border:"none",
                          cursor:"pointer", background:"rgba(239,68,68,0.1)", color:"#ef4444",
                          fontWeight:700, fontSize:11 }}>
                        Cerrar manual
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Vista: GREEKS ── */}
      {activeView === "greeks" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div className="card" style={{ padding:"14px" }}>
            <p style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>
              Heatmap Δ — todos los activos
            </p>
            <DeltaHeatmap greeksMap={greeksMap} assets={assets}
              activeAsset={activeAsset} onSelect={setActiveAsset} />
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {/* Walk-forward stats */}
            <div className="card" style={{ padding:"14px" }}>
              <p style={{ fontWeight:800, fontSize:13, marginBottom:10 }}>
                Walk-Forward por activo
              </p>
              {Object.keys(calibMap).length === 0 ? (
                <p style={{ fontSize:12, color:"var(--muted)" }}>
                  Sin historial aún — se actualiza tras cada trade
                </p>
              ) : (
                <div style={{ overflowY:"auto", maxHeight:300 }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                    <thead>
                      <tr style={{ background:"rgba(255,255,255,0.03)" }}>
                        {["Activo/Modo","N","WR","Avg RR","Kelly","Floor adj"].map(h=>(
                          <th key={h} style={{ padding:"5px 8px", textAlign:"left",
                            fontSize:9, textTransform:"uppercase", color:"var(--muted)",
                            borderBottom:"1px solid var(--border)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(calibMap).slice(0,15).map(([k,c]) => (
                        <tr key={k} style={{ borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                          <td style={{ padding:"5px 8px", fontWeight:700, fontSize:11 }}>{k}</td>
                          <td style={{ padding:"5px 8px", color:"var(--muted)" }}>{c.n}</td>
                          <td style={{ padding:"5px 8px",
                            color:c.wr>0.5?"#10b981":"#ef4444", fontWeight:700 }}>
                            {(c.wr*100).toFixed(0)}%</td>
                          <td style={{ padding:"5px 8px", fontFamily:"monospace" }}>
                            {c.avgRR.toFixed(2)}</td>
                          <td style={{ padding:"5px 8px", color:"#a5b4fc", fontFamily:"monospace" }}>
                            {(c.kellyF*100).toFixed(0)}%</td>
                          <td style={{ padding:"5px 8px",
                            color:c.floorAdj>0?"#ef4444":"#10b981", fontFamily:"monospace" }}>
                            {c.floorAdj>0?"+":""}{c.floorAdj}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {/* σ histórico del activo activo */}
            {activeSigmaH.length > 2 && (
              <div className="card" style={{ padding:"14px" }}>
                <p style={{ fontWeight:800, fontSize:12, marginBottom:8 }}>
                  σ histórica — {activeAsset}
                </p>
                <SigmaSparkline data={activeSigmaH} />
                <div style={{ marginTop:8, fontSize:10, color:"var(--muted)" }}>
                  Min: {(Math.min(...activeSigmaH)*100).toFixed(1)}% ·
                  Max: {(Math.max(...activeSigmaH)*100).toFixed(1)}% ·
                  Último: {(activeSigmaH[activeSigmaH.length-1]*100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Vista: HISTORY ── */}
      {activeView === "history" && (
        <div>
          {/* Stats por modo */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
            {(["scalp","intradia","swing"] as QMode[]).map(m => {
              const bm = stats.byMode[m];
              return (
                <div key={m} className="card" style={{ padding:"12px 14px" }}>
                  <p style={{ fontWeight:800, fontSize:12, marginBottom:6 }}>
                    {m==="scalp"?"⚡":m==="intradia"?"📊":"🌊"} {m.charAt(0).toUpperCase()+m.slice(1)}
                  </p>
                  {bm.n === 0 ? (
                    <p style={{ fontSize:11, color:"var(--muted)" }}>Sin trades</p>
                  ) : (
                    <div style={{ fontSize:11 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ color:"var(--muted)" }}>Trades:</span>
                        <strong>{bm.n}</strong>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ color:"var(--muted)" }}>WR:</span>
                        <strong style={{ color:bm.wr>0.5?"#10b981":"#ef4444" }}>
                          {(bm.wr*100).toFixed(0)}%</strong>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ color:"var(--muted)" }}>Avg RR:</span>
                        <strong style={{ color:"#a5b4fc" }}>{bm.avgRR.toFixed(2)}×</strong>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <span style={{ color:"var(--muted)" }}>P&L:</span>
                        <strong style={{ color:bm.pnl>=0?"#10b981":"#ef4444" }}>
                          {bm.pnl>=0?"+":""}${bm.pnl.toFixed(2)}</strong>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tabla de trades */}
          <div className="card" style={{ padding:"14px", overflowX:"auto" }}>
            <p style={{ fontWeight:800, fontSize:12, marginBottom:10 }}>
              Historial completo ({closedTrades.length} trades)
            </p>
            {closedTrades.length === 0 ? (
              <p style={{ fontSize:12, color:"var(--muted)" }}>Sin trades aún</p>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ background:"rgba(255,255,255,0.03)" }}>
                    {["Activo","Modo","Dir","Entry","Exit","P&L","RR","Δ","EV","Result","Fecha"].map(h=>(
                      <th key={h} style={{ padding:"6px 8px", textAlign:"left",
                        fontSize:9, textTransform:"uppercase", color:"var(--muted)",
                        borderBottom:"1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.slice(0,30).map(t => (
                    <tr key={t.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding:"6px 8px", fontWeight:700 }}>{t.asset.replace("USDT","").replace("USD","")}</td>
                      <td style={{ padding:"6px 8px", color:"var(--muted)", fontSize:10 }}>{t.mode}</td>
                      <td style={{ padding:"6px 8px", color:t.direction==="LONG"?"#10b981":"#ef4444", fontWeight:700 }}>
                        {t.direction==="LONG"?"↑":"↓"}</td>
                      <td style={{ padding:"6px 8px", fontFamily:"monospace", fontSize:10 }}>
                        {t.entry>10?t.entry.toFixed(2):t.entry.toFixed(5)}</td>
                      <td style={{ padding:"6px 8px", fontFamily:"monospace", fontSize:10 }}>
                        {t.exit>10?t.exit.toFixed(2):t.exit.toFixed(5)}</td>
                      <td style={{ padding:"6px 8px", fontWeight:800,
                        color:t.pnl>=0?"#10b981":"#ef4444" }}>
                        {t.pnl>=0?"+":""}${t.pnl.toFixed(2)}</td>
                      <td style={{ padding:"6px 8px", fontFamily:"monospace" }}>{t.rrRealized.toFixed(2)}×</td>
                      <td style={{ padding:"6px 8px", fontFamily:"monospace", fontSize:10, color:"var(--muted)" }}>
                        {t.greeks.delta.toFixed(3)}</td>
                      <td style={{ padding:"6px 8px", fontFamily:"monospace", fontSize:10,
                        color:t.greeks.ev>=0?"#10b981":"#ef4444" }}>
                        {t.greeks.ev>=0?"+":""}{t.greeks.ev.toFixed(4)}</td>
                      <td style={{ padding:"6px 8px" }}>
                        <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, fontWeight:700,
                          background:t.result.includes("TP")?"rgba(16,185,129,0.12)":t.result==="SL"?"rgba(239,68,68,0.1)":"rgba(255,255,255,0.05)",
                          color:t.result.includes("TP")?"#10b981":t.result==="SL"?"#ef4444":"var(--text-2)" }}>
                          {t.result}</span></td>
                      <td style={{ padding:"6px 8px", fontSize:9, color:"var(--muted)" }}>
                        {new Date(t.closedAt).toLocaleString("es",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
