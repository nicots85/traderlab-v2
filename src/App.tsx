import { useMemo, useState } from "react";

type Asset = "BTCUSD" | "ETHUSD" | "XAGUSD" | "XAUUSD";
type Mode = "scalping" | "intradia";
type Direction = "LONG" | "SHORT";
type ExitReason = "TP" | "SL" | "TRAIL" | "REVERSAL";

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
  mtf: {
    htf: number;
    ltf: number;
    exec: number;
  };
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

const assets: Asset[] = ["BTCUSD", "ETHUSD", "XAGUSD", "XAUUSD"];

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

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, val) => acc + val, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = avg(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  return values.reduce((acc, val) => alpha * val + (1 - alpha) * acc, values[0]);
}

function calcAtr(values: number[], lookback: number) {
  const data = values.slice(-lookback);
  if (data.length < 2) return 0;
  const ranges = data.slice(1).map((value, index) => Math.abs(value - data[index]));
  return avg(ranges);
}

function getSpreadPct(asset: Asset, volumeShock: number) {
  const base = asset === "BTCUSD" ? 0.04 : asset === "ETHUSD" ? 0.05 : 0.03;
  return base * (1 + volumeShock * 1.4);
}

function calcDrawdown(trades: ClosedTrade[]) {
  let running = 100;
  let peak = running;
  let maxDrawdown = 0;
  trades
    .slice()
    .reverse()
    .forEach((trade) => {
      running += trade.pnl;
      if (running > peak) peak = running;
      const dd = ((peak - running) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, dd);
    });
  return maxDrawdown;
}

export function App() {
  const [tab, setTab] = useState<Mode>("scalping");
  const [asset, setAsset] = useState<Asset>("BTCUSD");
  const [prices, setPrices] = useState(initialPrices);
  const [series, setSeries] = useState<Record<Asset, number[]>>({
    BTCUSD: Array.from({ length: 120 }, (_, i) => initialPrices.BTCUSD + Math.sin(i / 6) * 260 + rand(-90, 90)),
    ETHUSD: Array.from({ length: 120 }, (_, i) => initialPrices.ETHUSD + Math.sin(i / 8) * 28 + rand(-11, 11)),
    XAGUSD: Array.from({ length: 120 }, (_, i) => initialPrices.XAGUSD + Math.sin(i / 5) * 0.45 + rand(-0.11, 0.11)),
    XAUUSD: Array.from({ length: 120 }, (_, i) => initialPrices.XAUUSD + Math.sin(i / 6) * 9 + rand(-3.2, 3.2)),
  });
  const [balance, setBalance] = useState(100);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<Signal | null>(null);
  const [volumeShock, setVolumeShock] = useState(0.3);
  const [learning, setLearning] = useState<LearningModel>(initialLearning);
  const [apiKey, setApiKey] = useState("");
  const [usingGroq, setUsingGroq] = useState(false);
  const [riskPct, setRiskPct] = useState(1.2);
  const [backtestSize, setBacktestSize] = useState(40);
  const [lastBacktest, setLastBacktest] = useState<BacktestReport | null>(null);

  const spreadByAsset = useMemo(() => {
    const spreadMap = {} as Record<Asset, number>;
    assets.forEach((item) => {
      spreadMap[item] = (getSpreadPct(item, volumeShock) / 100) * prices[item];
    });
    return spreadMap;
  }, [prices, volumeShock]);

  const unrealized = useMemo(() => {
    return openPositions.reduce((acc, position) => {
      const mark = prices[position.signal.asset];
      const spread = spreadByAsset[position.signal.asset];
      const effectiveExit =
        position.signal.direction === "LONG" ? mark - spread / 2 : mark + spread / 2;
      const pnl =
        position.signal.direction === "LONG"
          ? (effectiveExit - position.signal.entry) * position.size
          : (position.signal.entry - effectiveExit) * position.size;
      return acc + pnl;
    }, 0);
  }, [openPositions, prices, spreadByAsset]);

  const equity = balance + unrealized;

  const stats = useMemo(() => {
    const total = closedTrades.length;
    const wins = closedTrades.filter((trade) => trade.pnl > 0);
    const losses = closedTrades.filter((trade) => trade.pnl <= 0);
    const pnl = closedTrades.reduce((acc, trade) => acc + trade.pnl, 0);
    const expectancy = total ? pnl / total : 0;
    const grossProfit = wins.reduce((acc, trade) => acc + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, trade) => acc + trade.pnl, 0));
    const returns = closedTrades.map((trade) => trade.pnlPct / 100);
    const sharpe = std(returns) === 0 ? 0 : (avg(returns) / std(returns)) * Math.sqrt(Math.max(returns.length, 1));
    return {
      total,
      winRate: total ? (wins.length / total) * 100 : 0,
      pnl,
      expectancy,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      sharpe,
      maxDrawdown: calcDrawdown(closedTrades),
    };
  }, [closedTrades]);

  const bestHours = useMemo(() => {
    return Object.entries(learning.hourEdge)
      .map(([hour, edge]) => ({ hour: Number(hour), edge }))
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 4);
  }, [learning.hourEdge]);

  const chartPoints = useMemo(() => {
    const values = series[asset];
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 100;
        const y = 100 - ((value - min) / Math.max(max - min, 1e-9)) * 100;
        return `${x},${y}`;
      })
      .join(" ");
  }, [asset, series]);

  function refreshLearning(trades: ClosedTrade[]) {
    if (!trades.length) {
      setLearning(initialLearning);
      return;
    }

    const winRate = trades.filter((trade) => trade.pnl > 0).length / trades.length;
    const expectancy = trades.reduce((acc, trade) => acc + trade.pnl, 0) / trades.length;

    const hourMap: Record<number, number[]> = {};
    trades.forEach((trade) => {
      const hour = new Date(trade.closedAt).getHours();
      if (!hourMap[hour]) hourMap[hour] = [];
      hourMap[hour].push(trade.pnl);
    });

    const hourEdge: Record<number, number> = {};
    Object.entries(hourMap).forEach(([hour, values]) => {
      hourEdge[Number(hour)] = avg(values);
    });

    setLearning({
      riskScale: clamp(0.7 + winRate * 0.9 + expectancy * 0.05, 0.6, 1.6),
      confidenceFloor: clamp(60 - expectancy * 2, 52, 72),
      scalpingTpAtr: clamp(1.2 + winRate * 0.4, 1.15, 1.8),
      intradayTpAtr: clamp(2.1 + winRate * 1.05, 2, 3.4),
      atrTrailMult: clamp(0.7 + winRate * 0.45, 0.65, 1.25),
      hourEdge,
    });
  }

  function getMtfScore(currentAsset: Asset) {
    const values = series[currentAsset];
    const atr = Math.max(calcAtr(values, 20), prices[currentAsset] * 0.0005);

    const htfSlice = values.slice(-70);
    const ltfSlice = values.slice(-32);
    const execSlice = values.slice(-8);

    const htf = (ema(htfSlice, 21) - ema(htfSlice, 55)) / atr;
    const ltf = (ema(ltfSlice, 8) - ema(ltfSlice, 21)) / atr;
    const exec = ((execSlice[execSlice.length - 1] ?? 0) - (execSlice[0] ?? 0)) / atr;

    return { htf, ltf, exec, atr };
  }

  function generateSignal(currentMode: Mode, currentAsset: Asset): Signal {
    const price = prices[currentAsset];
    const spreadPct = getSpreadPct(currentAsset, volumeShock);
    const spread = (spreadPct / 100) * price;
    const mtf = getMtfScore(currentAsset);

    const momentum = mtf.exec + rand(-0.35, 0.35);
    const direction: Direction =
      currentMode === "intradia"
        ? mtf.htf > 0 && mtf.ltf > 0 && momentum > 0
          ? "LONG"
          : mtf.htf < 0 && mtf.ltf < 0 && momentum < 0
            ? "SHORT"
            : mtf.ltf + momentum > 0
              ? "LONG"
              : "SHORT"
        : momentum > 0
          ? "LONG"
          : "SHORT";

    const baseAtr = mtf.atr;
    const stopAtr = currentMode === "scalping" ? 1.05 : 1.65;
    const tpAtr = currentMode === "scalping" ? learning.scalpingTpAtr : learning.intradayTpAtr;

    const entry = direction === "LONG" ? price + spread / 2 : price - spread / 2;
    const stopLoss = direction === "LONG" ? entry - baseAtr * stopAtr : entry + baseAtr * stopAtr;
    const takeProfit = direction === "LONG" ? entry + baseAtr * tpAtr : entry - baseAtr * tpAtr;

    const confidence = clamp(
      50 +
        Math.abs(mtf.htf) * 12 +
        Math.abs(mtf.ltf) * 10 +
        Math.abs(mtf.exec) * 8 -
        spreadPct * 45,
      50,
      97,
    );

    return {
      asset: currentAsset,
      mode: currentMode,
      direction,
      entry,
      stopLoss,
      takeProfit,
      confidence,
      spreadPct,
      atr: baseAtr,
      mtf,
      rationale:
        currentMode === "intradia"
          ? "Confluencia HTF + LTF + 1m. TP por momentum y cierre por reversion de media rapida."
          : "Scalping con entrada rapida, SL corto y trailing ATR para cortar perdidas temprano.",
    };
  }

  async function aiDecision(signal: Signal) {
    if (!usingGroq || !apiKey.trim()) {
      return signal.confidence >= learning.confidenceFloor ? "OPEN" : "SKIP";
    }

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.15,
          max_tokens: 2,
          messages: [
            {
              role: "system",
              content:
                "Eres un execution bot de trading simulado. Responde solo OPEN o SKIP sin texto extra.",
            },
            {
              role: "user",
              content: `asset=${signal.asset}; mode=${signal.mode}; conf=${signal.confidence.toFixed(1)}; spread=${signal.spreadPct.toFixed(3)}; htf=${signal.mtf.htf.toFixed(2)}; ltf=${signal.mtf.ltf.toFixed(2)}; exec=${signal.mtf.exec.toFixed(2)};`,
            },
          ],
        }),
      });
      const data = await response.json();
      const output = String(data?.choices?.[0]?.message?.content ?? "SKIP").toUpperCase();
      return output.includes("OPEN") ? "OPEN" : "SKIP";
    } catch {
      return signal.confidence >= learning.confidenceFloor + 3 ? "OPEN" : "SKIP";
    }
  }

  async function createSignalAndExecute() {
    const signal = generateSignal(tab, asset);
    setLastSignal(signal);
    const decision = await aiDecision(signal);
    if (decision !== "OPEN") return;

    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * learning.riskScale);
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), signal.entry * 0.0003);
    const size = riskUsd / stopDistance;
    const marginUsed = (size * signal.entry) / leverageByAsset[signal.asset];

    if (marginUsed > equity * 0.65) return;

    const now = new Date().toISOString();
    const id = Date.now();
    setOpenPositions((prev) => [
      {
        id,
        signal,
        size,
        marginUsed,
        openedAt: now,
        peak: signal.entry,
        trough: signal.entry,
      },
      ...prev,
    ]);
  }

  function closePosition(position: Position, exit: number, result: ExitReason) {
    const pnl =
      position.signal.direction === "LONG"
        ? (exit - position.signal.entry) * position.size
        : (position.signal.entry - exit) * position.size;

    setBalance((prev) => prev + pnl);
    setOpenPositions((prev) => prev.filter((item) => item.id !== position.id));
    setClosedTrades((prev) => {
      const next: ClosedTrade[] = [
        {
          id: position.id,
          asset: position.signal.asset,
          mode: position.signal.mode,
          direction: position.signal.direction,
          entry: position.signal.entry,
          exit,
          pnl,
          pnlPct: (pnl / Math.max(position.marginUsed, 0.01)) * 100,
          result,
          openedAt: position.openedAt,
          closedAt: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 400);
      refreshLearning(next);
      return next;
    });
  }

  function runMarketStep() {
    const nextShock = rand(0.1, 1.1);
    setVolumeShock(nextShock);

    const nextPrices = { ...prices };
    assets.forEach((item) => {
      const vol = item === "BTCUSD" ? 0.0068 : item === "ETHUSD" ? 0.0078 : 0.0022;
      const drift = rand(-vol, vol) + rand(-0.0007, 0.0007);
      nextPrices[item] = Math.max(0.1, prices[item] * (1 + drift));
    });

    setPrices(nextPrices);
    setSeries((prev) => {
      const next = { ...prev };
      assets.forEach((item) => {
        next[item] = [...prev[item], nextPrices[item]].slice(-140);
      });
      return next;
    });

    const values = series;
    openPositions.forEach((position) => {
      const px = nextPrices[position.signal.asset];
      const spread = (getSpreadPct(position.signal.asset, nextShock) / 100) * px;
      const tradable =
        position.signal.direction === "LONG" ? px - spread / 2 : px + spread / 2;

      const peak = Math.max(position.peak, tradable);
      const trough = Math.min(position.trough, tradable);
      const trailDistance = position.signal.atr * learning.atrTrailMult;
      const trailingStop =
        position.signal.direction === "LONG" ? peak - trailDistance : trough + trailDistance;

      const effectiveStop =
        position.signal.direction === "LONG"
          ? Math.max(position.signal.stopLoss, trailingStop)
          : Math.min(position.signal.stopLoss, trailingStop);

      const ma5 = avg(values[position.signal.asset].slice(-5));
      const ma13 = avg(values[position.signal.asset].slice(-13));
      const reversal =
        position.signal.mode === "intradia" &&
        ((position.signal.direction === "LONG" && ma5 < ma13) ||
          (position.signal.direction === "SHORT" && ma5 > ma13));

      const hitTp =
        position.signal.direction === "LONG"
          ? tradable >= position.signal.takeProfit
          : tradable <= position.signal.takeProfit;
      const hitSl =
        position.signal.direction === "LONG"
          ? tradable <= effectiveStop
          : tradable >= effectiveStop;

      if (hitTp) {
        closePosition(position, tradable, "TP");
        return;
      }
      if (hitSl) {
        closePosition(
          position,
          tradable,
          effectiveStop === position.signal.stopLoss ? "SL" : "TRAIL",
        );
        return;
      }
      if (reversal) {
        closePosition(position, tradable, "REVERSAL");
        return;
      }

      setOpenPositions((prev) =>
        prev.map((item) =>
          item.id === position.id
            ? {
                ...item,
                peak,
                trough,
                signal: {
                  ...item.signal,
                  stopLoss: effectiveStop,
                },
              }
            : item,
        ),
      );
    });
  }

  function runBacktest() {
    const simulated: ClosedTrade[] = [];
    const returns: number[] = [];

    for (let i = 0; i < backtestSize; i += 1) {
      const sampleAsset = assets[Math.floor(rand(0, assets.length))];
      const mode: Mode = Math.random() > 0.5 ? "scalping" : "intradia";
      const direction: Direction = Math.random() > 0.5 ? "LONG" : "SHORT";
      const edge = (learning.hourEdge[(8 + i) % 24] ?? 0) * 0.08;
      const winProb = clamp(0.47 + edge + (mode === "intradia" ? 0.03 : 0), 0.34, 0.7);
      const isWin = Math.random() < winProb;
      const pnl = isWin ? rand(0.3, 4.1) : -rand(0.25, 2.8);

      simulated.push({
        id: Date.now() + i,
        asset: sampleAsset,
        mode,
        direction,
        entry: prices[sampleAsset],
        exit: prices[sampleAsset] * (1 + rand(-0.004, 0.004)),
        pnl,
        pnlPct: pnl * 9,
        result: isWin ? "TP" : "SL",
        openedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        closedAt: new Date().toISOString(),
      });
      returns.push(pnl);
    }

    const wins = simulated.filter((trade) => trade.pnl > 0);
    const losses = simulated.filter((trade) => trade.pnl <= 0);
    const grossProfit = wins.reduce((acc, trade) => acc + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, trade) => acc + trade.pnl, 0));

    setLastBacktest({
      total: simulated.length,
      winRate: (wins.length / simulated.length) * 100,
      expectancy: avg(returns),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit,
      sharpe: std(returns) > 0 ? avg(returns) / std(returns) : 0,
    });

    setClosedTrades((prev) => {
      const next = [...simulated, ...prev].slice(0, 400);
      refreshLearning(next);
      return next;
    });
    setBalance((prev) => prev + avg(returns) * 0.5);
  }

  return (
    <div className="min-h-screen bg-shell px-4 py-6 text-ink md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="hero-card">
          <p className="kicker">TraderLab v2 - simulador profesional</p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            Senales IA para BTC, ETH, plata y oro
          </h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="metric-card">
              <span>Balance</span>
              <strong>{money(balance)}</strong>
            </div>
            <div className="metric-card">
              <span>Unrealized P/L</span>
              <strong className={unrealized >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(unrealized)}</strong>
            </div>
            <div className="metric-card">
              <span>Equity cruzada</span>
              <strong>{money(equity)}</strong>
            </div>
            <div className="metric-card">
              <span>Win rate</span>
              <strong>{stats.winRate.toFixed(1)}%</strong>
            </div>
            <div className="metric-card">
              <span>Profit factor</span>
              <strong>{stats.profitFactor.toFixed(2)}</strong>
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1.18fr_1.9fr_1.2fr]">
          <section className="panel">
            <div className="mb-4 flex gap-2">
              <button className={`tab-btn ${tab === "scalping" ? "tab-btn-active" : ""}`} onClick={() => setTab("scalping")}>
                Scalping
              </button>
              <button className={`tab-btn ${tab === "intradia" ? "tab-btn-active" : ""}`} onClick={() => setTab("intradia")}>
                Intradia MTF
              </button>
            </div>

            <label className="label">Activo</label>
            <select className="select-field" value={asset} onChange={(event) => setAsset(event.target.value as Asset)}>
              <option value="BTCUSD">BTCUSD (500x)</option>
              <option value="ETHUSD">ETHUSD (500x)</option>
              <option value="XAGUSD">XAGUSD Plata (1000x)</option>
              <option value="XAUUSD">XAUUSD Oro (1000x)</option>
            </select>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div>
                <label className="label">Riesgo base %</label>
                <input
                  className="input-field"
                  type="number"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={riskPct}
                  onChange={(event) => setRiskPct(Number(event.target.value))}
                />
              </div>
              <div>
                <label className="label">Backtest trades</label>
                <input
                  className="input-field"
                  type="number"
                  min={20}
                  max={180}
                  step={10}
                  value={backtestSize}
                  onChange={(event) => setBacktestSize(Number(event.target.value))}
                />
              </div>
            </div>

            <label className="label mt-4">Groq API key (opcional)</label>
            <input
              className="input-field"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="gsk_..."
            />
            <button
              className={`mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold ${usingGroq ? "bg-amber-500 text-white" : "bg-ink text-white"}`}
              onClick={() => setUsingGroq((prev) => !prev)}
            >
              {usingGroq ? "IA ejecucion: Groq" : "IA ejecucion: motor local"}
            </button>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="cta" onClick={createSignalAndExecute}>
                Generar + ejecutar
              </button>
              <button className="cta-secondary" onClick={runMarketStep}>
                Avanzar 1 vela
              </button>
              <button className="cta-secondary col-span-2" onClick={runBacktest}>
                Backtesting adaptativo
              </button>
            </div>

            {lastSignal && (
              <article className="mt-4 rounded-2xl border border-ink/10 bg-white p-3 text-sm">
                <p className="font-semibold">
                  Ultima senal: {lastSignal.direction} {lastSignal.asset}
                </p>
                <p>
                  Conf: {lastSignal.confidence.toFixed(1)}% | Spread: {lastSignal.spreadPct.toFixed(3)}%
                </p>
                <p>
                  Entry {lastSignal.entry.toFixed(3)} | SL {lastSignal.stopLoss.toFixed(3)} | TP {lastSignal.takeProfit.toFixed(3)}
                </p>
                <p className="text-ink/70">
                  HTF {lastSignal.mtf.htf.toFixed(2)} | LTF {lastSignal.mtf.ltf.toFixed(2)} | 1m {lastSignal.mtf.exec.toFixed(2)}
                </p>
              </article>
            )}
          </section>

          <section className="panel">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="kicker">Flujo de precio simulado</p>
                <h2 className="text-2xl font-semibold">
                  {asset} - {tab === "intradia" ? "Confluencia multi timeframe" : "Ejecucion de scalping"}
                </h2>
              </div>
              <div className="badge-soft">
                Px {prices[asset].toFixed(2)} | Spread {spreadByAsset[asset].toFixed(3)}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-ink/15 bg-white/85 p-3">
              <svg viewBox="0 0 100 100" className="h-72 w-full overflow-visible">
                <defs>
                  <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef7f43" stopOpacity="0.36" />
                    <stop offset="100%" stopColor="#ef7f43" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline fill="none" stroke="#e3d9cf" strokeWidth="0.25" points="0,20 100,20" />
                <polyline fill="none" stroke="#e3d9cf" strokeWidth="0.25" points="0,50 100,50" />
                <polyline fill="none" stroke="#e3d9cf" strokeWidth="0.25" points="0,80 100,80" />
                <polyline fill="url(#lineFill)" stroke="none" points={`0,100 ${chartPoints} 100,100`} />
                <polyline fill="none" stroke="#b7521e" strokeWidth="1.15" points={chartPoints} />
              </svg>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="soft-card text-sm">
                <p className="font-semibold">Condiciones CFD</p>
                <p>Capital: 100 USD | Margen cruzado</p>
                <p>Sin comision | Spread bid/ask dinamico</p>
                <p>Leverage activo: {leverageByAsset[asset]}x</p>
              </div>
              <div className="soft-card text-sm">
                <p className="font-semibold">Reglas salida v2</p>
                <p>Trailing stop: {learning.atrTrailMult.toFixed(2)} ATR</p>
                <p>TP scalping: {learning.scalpingTpAtr.toFixed(2)} ATR</p>
                <p>TP intradia: {learning.intradayTpAtr.toFixed(2)} ATR + cruce MA5/MA13</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white p-3">
              <p className="mb-2 text-sm font-semibold">Posiciones abiertas ({openPositions.length})</p>
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink/60">
                  <tr>
                    <th className="py-1">Activo</th>
                    <th className="py-1">Lado</th>
                    <th className="py-1">Entry</th>
                    <th className="py-1">SL</th>
                    <th className="py-1">TP</th>
                    <th className="py-1">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.slice(0, 8).map((position) => (
                    <tr key={position.id} className="border-t border-ink/10">
                      <td className="py-1">{position.signal.asset}</td>
                      <td className="py-1">{position.signal.direction}</td>
                      <td className="py-1">{position.signal.entry.toFixed(3)}</td>
                      <td className="py-1">{position.signal.stopLoss.toFixed(3)}</td>
                      <td className="py-1">{position.signal.takeProfit.toFixed(3)}</td>
                      <td className="py-1">{money(position.marginUsed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h3 className="text-lg font-semibold">Bot IA propio - aprendizaje</h3>
            <p className="text-sm text-ink/70">
              Aprende de trades cerrados y backtests para ajustar confianza minima, trailing y objetivo ATR.
            </p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="soft-card">
                <p>Conf floor: {learning.confidenceFloor.toFixed(1)}%</p>
                <p>Risk scaler: {learning.riskScale.toFixed(2)}x</p>
                <p>Expectancy: {money(stats.expectancy)}</p>
                <p>Max drawdown: {stats.maxDrawdown.toFixed(2)}%</p>
                <p>Sharpe sim: {stats.sharpe.toFixed(2)}</p>
              </div>
            </div>

            <h4 className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-ink/65">Horas con mejor edge</h4>
            <div className="mt-2 space-y-2">
              {bestHours.length ? (
                bestHours.map((item) => (
                  <div key={item.hour} className="hour-row">
                    <span>{String(item.hour).padStart(2, "0")}:00</span>
                    <strong className={item.edge >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(item.edge)}</strong>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink/55">Aun sin datos suficientes.</p>
              )}
            </div>

            {lastBacktest && (
              <div className="mt-4 soft-card text-sm">
                <p className="font-semibold">Ultimo backtest</p>
                <p>Trades: {lastBacktest.total}</p>
                <p>Win rate: {lastBacktest.winRate.toFixed(1)}%</p>
                <p>Expectancy: {money(lastBacktest.expectancy)}</p>
                <p>Profit factor: {lastBacktest.profitFactor.toFixed(2)}</p>
                <p>Sharpe: {lastBacktest.sharpe.toFixed(2)}</p>
              </div>
            )}
          </section>
        </div>

        <section className="panel overflow-hidden">
          <h3 className="text-lg font-semibold">Historial de trades cerrados</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-ink/60">
                <tr>
                  <th className="py-2">Activo</th>
                  <th className="py-2">Modo</th>
                  <th className="py-2">Lado</th>
                  <th className="py-2">Entrada</th>
                  <th className="py-2">Salida</th>
                  <th className="py-2">P/L</th>
                  <th className="py-2">P/L %</th>
                  <th className="py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.slice(0, 14).map((trade) => (
                  <tr key={trade.id} className="border-t border-ink/10">
                    <td className="py-2">{trade.asset}</td>
                    <td className="py-2 capitalize">{trade.mode}</td>
                    <td className="py-2">{trade.direction}</td>
                    <td className="py-2">{trade.entry.toFixed(3)}</td>
                    <td className="py-2">{trade.exit.toFixed(3)}</td>
                    <td className={`py-2 font-semibold ${trade.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {money(trade.pnl)}
                    </td>
                    <td className={`py-2 ${trade.pnlPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {pct(trade.pnlPct)}
                    </td>
                    <td className="py-2">{trade.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
