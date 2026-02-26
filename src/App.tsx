import { useEffect, useMemo, useState } from "react";

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
  return base * (1 + volumeShock * 1.35);
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

function parseMetalsSpot(payload: unknown) {
  const result: Partial<Record<"gold" | "silver", number>> = {};
  if (!Array.isArray(payload)) return result;
  payload.forEach((row) => {
    if (row && typeof row === "object") {
      const entries = Object.entries(row as Record<string, unknown>);
      entries.forEach(([key, value]) => {
        const low = key.toLowerCase();
        if (typeof value === "number") {
          if (low.includes("gold") || low.includes("xau")) result.gold = value;
          if (low.includes("silver") || low.includes("xag")) result.silver = value;
        }
      });
    }
  });
  return result;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchRealMarketSnapshot() {
  const [btcTicker, ethTicker, btcKline, ethKline, metals] = await Promise.all([
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
    fetchJson<{ price: string }>("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"),
    fetchJson<Array<[number, string, string, string, string]>>(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120",
    ),
    fetchJson<Array<[number, string, string, string, string]>>(
      "https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=120",
    ),
    fetchJson<unknown>("https://api.metals.live/v1/spot"),
  ]);

  const metalSpot = parseMetalsSpot(metals);
  const btcSeries = btcKline.map((bar) => Number(bar[4]));
  const ethSeries = ethKline.map((bar) => Number(bar[4]));
  const btcAbsRet = avg(
    btcSeries.slice(1).map((value, index) => Math.abs((value - btcSeries[index]) / Math.max(btcSeries[index], 1e-9))),
  );
  const ethAbsRet = avg(
    ethSeries.slice(1).map((value, index) => Math.abs((value - ethSeries[index]) / Math.max(ethSeries[index], 1e-9))),
  );
  const shock = clamp(((btcAbsRet + ethAbsRet) / 2) * 220, 0.08, 1.25);

  return {
    prices: {
      BTCUSD: Number(btcTicker.price),
      ETHUSD: Number(ethTicker.price),
      XAUUSD: metalSpot.gold ?? initialPrices.XAUUSD,
      XAGUSD: metalSpot.silver ?? initialPrices.XAGUSD,
    } as Record<Asset, number>,
    series: {
      BTCUSD: btcSeries,
      ETHUSD: ethSeries,
    },
    shock,
  };
}

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
  const [alerts, setAlerts] = useState<string[]>([]);
  const [feedStatus, setFeedStatus] = useState("Waiting live feed...");
  const [liveReady, setLiveReady] = useState(false);

  useEffect(() => {
    const envKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
    if (envKey && !apiKey) setApiKey(envKey);
  }, [apiKey]);

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

  function pushAlert(msg: string) {
    setAlerts((prev) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...prev].slice(0, 8));
  }

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

    const momentum = mtf.exec;
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
          ? "MTF confluence HTF + LTF + 1m. TP ATR y cierre por cruce de medias rapidas."
          : "Scalping rapido con SL corto y trailing ATR para proteger capital.",
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
                "You are a trading execution gate for a simulated account. Reply with exactly OPEN or SKIP.",
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

  async function createSignalAndExecute(mode: Mode, targetAsset: Asset, autoLabel = false) {
    if (!liveReady) {
      pushAlert("Live feed not ready yet. Sync real data first.");
      return;
    }
    const signal = generateSignal(mode, targetAsset);
    setLastSignal(signal);
    const decision = await aiDecision(signal);
    if (decision !== "OPEN") {
      if (autoLabel) pushAlert(`Auto-scan: ${targetAsset} SKIP (conf ${signal.confidence.toFixed(1)}%)`);
      return;
    }

    const riskUsd = Math.max(0.5, equity * (riskPct / 100) * learning.riskScale);
    const stopDistance = Math.max(Math.abs(signal.entry - signal.stopLoss), signal.entry * 0.0003);
    const size = riskUsd / stopDistance;
    const marginUsed = (size * signal.entry) / leverageByAsset[signal.asset];

    if (marginUsed > equity * 0.65) {
      if (autoLabel) pushAlert(`Auto-scan: ${targetAsset} blocked by margin control`);
      return;
    }

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
    if (autoLabel) pushAlert(`Auto-scan: OPEN ${signal.direction} ${signal.asset} conf ${signal.confidence.toFixed(1)}%`);
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

  function evaluateOpenPositions(
    nextPrices: Record<Asset, number>,
    nextShock: number,
    values: Record<Asset, number[]>,
  ) {
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

  async function syncRealData() {
    setIsSyncing(true);
    try {
      const payload = await fetchRealMarketSnapshot();
      setPrices(payload.prices);
      setSeries((prev) => {
        const nextSeries = {
          BTCUSD: payload.series.BTCUSD.length ? payload.series.BTCUSD : prev.BTCUSD,
          ETHUSD: payload.series.ETHUSD.length ? payload.series.ETHUSD : prev.ETHUSD,
          XAGUSD: [...prev.XAGUSD.slice(-159), payload.prices.XAGUSD],
          XAUUSD: [...prev.XAUUSD.slice(-159), payload.prices.XAUUSD],
        };
        evaluateOpenPositions(payload.prices, payload.shock, nextSeries);
        return nextSeries;
      });
      setVolumeShock(payload.shock);
      setFeedStatus("Live feed synced");
      setLiveReady(true);
    } catch {
      setFeedStatus("Live feed unavailable. No simulated fallback is enabled.");
      setLiveReady(false);
    } finally {
      setIsSyncing(false);
    }
  }

  async function runAutoScan() {
    for (const item of assets) {
      await createSignalAndExecute("intradia", item, true);
    }
  }

  useEffect(() => {
    void syncRealData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoScan) return;
    const ms = Math.max(8, scanEverySec) * 1000;
    const id = window.setInterval(() => {
      void syncRealData();
      void runAutoScan();
    }, ms);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, scanEverySec]);

  function runBacktest() {
    if (!liveReady) {
      pushAlert("Backtest needs live history first.");
      return;
    }
    const simulated: ClosedTrade[] = [];
    const returns: number[] = [];

    for (let i = 0; i < backtestSize; i += 1) {
      const sampleAsset = assets[i % assets.length];
      const mode: Mode = i % 2 === 0 ? "scalping" : "intradia";
      const values = series[sampleAsset];
      const start = Math.max(25, values.length - (backtestSize + 25));
      const idx = start + i;
      if (idx >= values.length - 2) break;

      const history = values.slice(0, idx + 1);
      const entry = values[idx];
      const maFast = avg(history.slice(-5));
      const maSlow = avg(history.slice(-13));
      const direction: Direction = maFast >= maSlow ? "LONG" : "SHORT";
      const atr = Math.max(calcAtr(history, 20), entry * 0.0004);
      const stopDist = atr * (mode === "scalping" ? 1.05 : 1.65);
      const tpDist = atr * (mode === "scalping" ? learning.scalpingTpAtr : learning.intradayTpAtr);
      const stop = direction === "LONG" ? entry - stopDist : entry + stopDist;
      const tp = direction === "LONG" ? entry + tpDist : entry - tpDist;
      const horizon = mode === "scalping" ? 6 : 22;
      let exit = values[Math.min(idx + horizon, values.length - 1)];
      let result: ExitReason = "REVERSAL";

      for (let j = idx + 1; j <= Math.min(idx + horizon, values.length - 1); j += 1) {
        const px = values[j];
        const hitTp = direction === "LONG" ? px >= tp : px <= tp;
        const hitSl = direction === "LONG" ? px <= stop : px >= stop;
        if (hitTp) {
          exit = px;
          result = "TP";
          break;
        }
        if (hitSl) {
          exit = px;
          result = "SL";
          break;
        }
      }

      const riskUsd = Math.max(0.5, equity * (riskPct / 100));
      const size = riskUsd / Math.max(stopDist, entry * 0.0003);
      const pnl = direction === "LONG" ? (exit - entry) * size : (entry - exit) * size;

      simulated.push({
        id: Date.now() + i,
        asset: sampleAsset,
        mode,
        direction,
        entry,
        exit,
        pnl,
        pnlPct: (pnl / Math.max((size * entry) / leverageByAsset[sampleAsset], 0.01)) * 100,
        result,
        openedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        closedAt: new Date().toISOString(),
      });
      returns.push(pnl);
    }

    if (!simulated.length) {
      pushAlert("Not enough real candles to run backtest yet.");
      return;
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
      <div className="ambient-grid" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="hero-card">
          <p className="kicker">TraderLab v3 - realistic paper trading desk</p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            AI signals for BTC, ETH, silver and gold with live snapshot + simulation engine
          </h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="metric-card">
              <span>Balance</span>
              <strong>{money(balance)}</strong>
            </div>
            <div className="metric-card">
              <span>Unrealized P/L</span>
              <strong className={unrealized >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(unrealized)}</strong>
            </div>
            <div className="metric-card">
              <span>Cross equity</span>
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
            <div className="metric-card">
              <span>Feed status</span>
              <strong className="text-sm">{feedStatus}</strong>
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1.18fr_1.9fr_1.2fr]">
          <section className="panel">
            <div className="mb-4 flex gap-2">
              <button className={`tab-btn pressable ${tab === "scalping" ? "tab-btn-active" : ""}`} onClick={() => setTab("scalping")}>
                Scalping
              </button>
              <button className={`tab-btn pressable ${tab === "intradia" ? "tab-btn-active" : ""}`} onClick={() => setTab("intradia")}>
                Intraday MTF
              </button>
            </div>

            <label className="label">Asset</label>
            <select className="select-field" value={asset} onChange={(event) => setAsset(event.target.value as Asset)}>
              <option value="BTCUSD">BTCUSD (500x)</option>
              <option value="ETHUSD">ETHUSD (500x)</option>
              <option value="XAGUSD">XAGUSD Silver (1000x)</option>
              <option value="XAUUSD">XAUUSD Gold (1000x)</option>
            </select>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div>
                <label className="label">Risk base %</label>
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

            <label className="label mt-4">Groq API key (optional)</label>
            <input
              className="input-field"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="gsk_..."
            />
            <button
              className={`mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold pressable ${usingGroq ? "bg-amber-500 text-white" : "bg-ink text-white"}`}
              onClick={() => setUsingGroq((prev) => !prev)}
            >
              {usingGroq ? "Execution AI: Groq" : "Execution AI: local engine"}
            </button>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="cta pressable" onClick={() => createSignalAndExecute(tab, asset)}>
                Generate + execute
              </button>
              <button className="cta-secondary pressable" onClick={() => void syncRealData()}>
                {isSyncing ? "Syncing..." : "Sync real data"}
              </button>
              <button className="cta-secondary pressable" onClick={() => void runAutoScan()}>
                Scan now
              </button>
              <button className="cta-secondary pressable" onClick={runBacktest}>
                Adaptive backtest
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Auto-scan intraday</p>
                <button
                  className={`scan-toggle ${autoScan ? "scan-toggle-on" : ""}`}
                  onClick={() => setAutoScan((prev) => !prev)}
                >
                  <span className="scan-dot" />
                  {autoScan ? "ON" : "OFF"}
                </button>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="w-full">
                  <label className="label">scan each (sec)</label>
                  <input
                    className="input-field"
                    type="number"
                    min={8}
                    max={90}
                    step={1}
                    value={scanEverySec}
                    onChange={(event) => setScanEverySec(Number(event.target.value))}
                  />
                </div>
              </div>
            </div>

            {lastSignal && (
              <article className="mt-4 rounded-2xl border border-ink/10 bg-white p-3 text-sm">
                <p className="font-semibold">
                  Last signal: {lastSignal.direction} {lastSignal.asset}
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
                <p className="kicker">Paper trading market stream</p>
                <h2 className="text-2xl font-semibold">
                  {asset} - {tab === "intradia" ? "Multi timeframe confluence" : "Scalping execution"}
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
                <p className="font-semibold">CFD simulation conditions</p>
                <p>Capital: 100 USD | Cross margin | no commissions</p>
                <p>Dynamic bid/ask spread in high activity windows</p>
                <p>Leverage by asset: {leverageByAsset[asset]}x</p>
              </div>
              <div className="soft-card text-sm">
                <p className="font-semibold">Exit logic v3</p>
                <p>Trailing stop: {learning.atrTrailMult.toFixed(2)} ATR</p>
                <p>TP scalping: {learning.scalpingTpAtr.toFixed(2)} ATR</p>
                <p>TP intraday: {learning.intradayTpAtr.toFixed(2)} ATR + MA5/MA13 reversal</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white p-3">
              <p className="mb-2 text-sm font-semibold">Open positions ({openPositions.length})</p>
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink/60">
                  <tr>
                    <th className="py-1">Asset</th>
                    <th className="py-1">Side</th>
                    <th className="py-1">Entry</th>
                    <th className="py-1">SL</th>
                    <th className="py-1">TP</th>
                    <th className="py-1">Margin</th>
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
            <h3 className="text-lg font-semibold">AI learning engine</h3>
            <p className="text-sm text-ink/70">
              Learns from closed trades plus backtesting samples to tune confidence, risk and ATR exits.
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

            <h4 className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-ink/65">Best hour edge</h4>
            <div className="mt-2 space-y-2">
              {bestHours.length ? (
                bestHours.map((item) => (
                  <div key={item.hour} className="hour-row">
                    <span>{String(item.hour).padStart(2, "0")}:00</span>
                    <strong className={item.edge >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(item.edge)}</strong>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink/55">No enough data yet.</p>
              )}
            </div>

            {lastBacktest && (
              <div className="mt-4 soft-card text-sm">
                <p className="font-semibold">Last backtest</p>
                <p>Trades: {lastBacktest.total}</p>
                <p>Win rate: {lastBacktest.winRate.toFixed(1)}%</p>
                <p>Expectancy: {money(lastBacktest.expectancy)}</p>
                <p>Profit factor: {lastBacktest.profitFactor.toFixed(2)}</p>
                <p>Sharpe: {lastBacktest.sharpe.toFixed(2)}</p>
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-3">
              <p className="mb-2 text-sm font-semibold">Auto-scan alerts</p>
              <div className="space-y-2 text-xs">
                {alerts.length ? (
                  alerts.map((item) => (
                    <p key={item} className="rounded-lg border border-ink/10 bg-white/90 p-2">
                      {item}
                    </p>
                  ))
                ) : (
                  <p className="text-ink/50">No alerts yet.</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="panel overflow-hidden">
          <h3 className="text-lg font-semibold">Closed trades history</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-ink/60">
                <tr>
                  <th className="py-2">Asset</th>
                  <th className="py-2">Mode</th>
                  <th className="py-2">Side</th>
                  <th className="py-2">Entry</th>
                  <th className="py-2">Exit</th>
                  <th className="py-2">P/L</th>
                  <th className="py-2">P/L %</th>
                  <th className="py-2">Reason</th>
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