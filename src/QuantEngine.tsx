@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap");

/* ─── TOKENS ───────────────────────────────────────────────────────────────── */
:root {
  --bg:        #07080f;
  --surface:   #0b0d17;
  --card:      #0f1120;
  --card-2:    #141728;
  --card-3:    #181c30;
  --border:    rgba(255,255,255,0.07);
  --border-md: rgba(255,255,255,0.13);
  --border-hi: rgba(255,255,255,0.22);
  --text:      #dde4f5;
  --text-2:    #8a9bb8;
  --muted:     rgba(138,155,184,0.5);
  --accent:    #6366f1;
  --accent-2:  #818cf8;
  --accent-3:  #a5b4fc;
  --green:     #10b981;
  --green-2:   #34d399;
  --red:       #ef4444;
  --red-2:     #fca5a5;
  --yellow:    #f59e0b;
  --yellow-2:  #fcd34d;
  --radius:    12px;
  --radius-sm: 8px;
  --radius-xs: 5px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { color-scheme: dark; scroll-behavior: smooth; }
body {
  font-family: "Inter", system-ui, sans-serif;
  font-size: 13px; line-height: 1.55;
  background: var(--bg); color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#root { min-height: 100vh; }

/* ─── HEADER PRINCIPAL ──────────────────────────────────────────────────────── */
.app-header {
  position: sticky; top: 0; z-index: 100;
  background: rgba(7,8,15,0.92);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
}
.header-inner {
  max-width: 1440px; margin: 0 auto;
  display: flex; align-items: center;
  padding: 0 20px; height: 52px; gap: 12px;
}
.header-logo {
  font-size: 15px; font-weight: 800;
  background: linear-gradient(135deg, #818cf8, #c4b5fd);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  letter-spacing: -0.02em; flex-shrink: 0;
}
.header-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0;
}
.header-feed {
  font-size: 10.5px; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
}

/* ─── HEADER METRICS ────────────────────────────────────────────────────────── */
.header-metrics {
  display: flex; gap: 0; overflow-x: auto; margin-left: auto;
}
.header-metrics::-webkit-scrollbar { display: none; }
.hm-item {
  display: flex; flex-direction: column; justify-content: center;
  padding: 6px 16px; border-right: 1px solid var(--border);
  min-width: 90px; flex-shrink: 0;
}
.hm-item:last-child { border-right: none; }
.hm-label {
  font-size: 9.5px; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--muted);
  font-weight: 600; margin-bottom: 1px;
}
.hm-value {
  font-size: 13px; font-weight: 700;
  font-family: "JetBrains Mono", monospace;
}

/* ─── NAV ────────────────────────────────────────────────────────────────────── */
.nav-bar {
  background: rgba(11,13,23,0.95);
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
}
.nav-tabs {
  max-width: 1440px; margin: 0 auto;
  display: flex; gap: 2px;
  overflow-x: auto; padding: 6px 0;
}
.nav-tabs::-webkit-scrollbar { display: none; }
.nav-tab {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 13px; border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer; font-weight: 600; font-size: 12.5px;
  background: transparent; color: var(--muted);
  transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
  font-family: "Inter", sans-serif;
  position: relative;
}
.nav-tab:hover {
  background: rgba(255,255,255,0.05);
  color: var(--text-2);
  border-color: var(--border);
}
.nav-tab.active {
  background: rgba(99,102,241,0.14);
  color: var(--accent-3);
  border-color: rgba(99,102,241,0.28);
  font-weight: 700;
}
.nav-tab.active::after {
  content: "";
  position: absolute; bottom: -7px; left: 50%;
  transform: translateX(-50%);
  width: 18px; height: 2px;
  background: var(--accent-2); border-radius: 2px;
}

/* ─── CARD ───────────────────────────────────────────────────────────────────── */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  color: var(--text);
  transition: border-color 0.2s;
}
.card:hover { border-color: rgba(255,255,255,0.11); }
.card-tight { padding: 10px 12px; }

.live-card {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  transition: background 0.18s, border-color 0.18s;
}
.live-card:hover {
  background: rgba(255,255,255,0.035);
  border-color: rgba(255,255,255,0.1);
}

/* Señal principal — borde izquierdo coloreado */
.signal-card-long {
  background: rgba(16,185,129,0.04);
  border: 1px solid rgba(16,185,129,0.22);
  border-left: 3px solid var(--green);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.signal-card-short {
  background: rgba(239,68,68,0.04);
  border: 1px solid rgba(239,68,68,0.2);
  border-left: 3px solid var(--red);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.signal-card-neutral {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}

/* ─── PANEL DE CONFIANZA ────────────────────────────────────────────────────── */
.confidence-ring {
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; flex-shrink: 0;
  font-family: "JetBrains Mono", monospace;
}
.confidence-ring .val { font-size: 16px; font-weight: 800; line-height: 1; }
.confidence-ring .lbl { font-size: 8.5px; opacity: 0.7; margin-top: 1px; }

/* ─── MOTOR BADGE ────────────────────────────────────────────────────────────── */
.motor-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 99px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
}
.motor-v1  { background: rgba(99,102,241,0.12); color: var(--accent-3); border: 1px solid rgba(99,102,241,0.25); }
.motor-bs  { background: rgba(20,184,166,0.1);  color: #5eead4;         border: 1px solid rgba(20,184,166,0.25); }
.motor-syn { background: rgba(245,158,11,0.1);  color: #fbbf24;         border: 1px solid rgba(245,158,11,0.25); }

/* ─── GRIEGAS ────────────────────────────────────────────────────────────────── */
.greek-grid {
  display: grid; grid-template-columns: repeat(5,1fr); gap: 5px;
}
.greek-cell {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: var(--radius-sm);
  padding: 7px 6px; text-align: center;
  transition: border-color 0.15s;
}
.greek-cell:hover { border-color: rgba(255,255,255,0.12); }
.greek-lbl { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
.greek-val { font-size: 14px; font-weight: 800; font-family: "JetBrains Mono", monospace; }
.greek-sub { font-size: 9px; font-weight: 700; margin-top: 2px; }
.greek-note { font-size: 8px; color: var(--muted); margin-top: 1px; }

/* ─── EV BAR ─────────────────────────────────────────────────────────────────── */
.ev-bar-wrap {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
}
.ev-bar-track {
  height: 7px; border-radius: 4px;
  overflow: hidden; background: rgba(255,255,255,0.05);
  margin: 6px 0 5px; position: relative;
}
.ev-bar-tp  { position: absolute; left: 0; top: 0; height: 100%; border-radius: 4px 0 0 4px; background: linear-gradient(90deg,#059669,#10b981); }
.ev-bar-sl  { position: absolute; right: 0; top: 0; height: 100%; border-radius: 0 4px 4px 0; background: linear-gradient(90deg,#ef4444,#fca5a5); }

/* ─── WYCKOFF BADGE ──────────────────────────────────────────────────────────── */
.wyckoff-badge {
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border);
}
.wyckoff-badge.acc { border-left: 3px solid var(--green); }
.wyckoff-badge.dist { border-left: 3px solid var(--red); }
.wyckoff-badge.neutral { border-left: 3px solid rgba(255,255,255,0.12); }

/* ─── TP PROGRESS ────────────────────────────────────────────────────────────── */
.tp-progress {
  height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.06);
  overflow: hidden; margin: 6px 0;
}
.tp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #10b981);
  border-radius: 2px;
  transition: width 0.4s ease;
}

/* ─── POSICIÓN ABIERTA ───────────────────────────────────────────────────────── */
.position-row {
  padding: 10px 12px; border-radius: var(--radius-sm);
  margin-bottom: 6px;
  background: rgba(255,255,255,0.02);
  transition: background 0.15s;
}
.position-row:hover { background: rgba(255,255,255,0.035); }
.position-row.pos-long  { border: 1px solid rgba(16,185,129,0.2); }
.position-row.pos-short { border: 1px solid rgba(239,68,68,0.2); }
.position-pnl-positive { color: var(--green); font-weight: 800; }
.position-pnl-negative { color: var(--red);   font-weight: 800; }

/* ─── SIGMA SPARKLINE ────────────────────────────────────────────────────────── */
.sigma-sparkline { display: inline-flex; align-items: center; gap: 6px; }

/* ─── DELTA HEATMAP ──────────────────────────────────────────────────────────── */
.delta-heatmap {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 4px;
}
.delta-cell {
  padding: 6px 7px; border-radius: var(--radius-sm);
  cursor: pointer; border: 1px solid transparent;
  transition: all 0.15s;
}
.delta-cell:hover { border-color: rgba(255,255,255,0.12) !important; }
.delta-cell.selected { border-color: var(--accent) !important; }

/* ─── TRADING GRID ───────────────────────────────────────────────────────────── */
.trading-grid {
  display: grid;
  grid-template-columns: 260px 1fr 300px;
  gap: 14px;
  align-items: start;
}
@media (max-width: 1100px) {
  .trading-grid { grid-template-columns: 240px 1fr; }
}
@media (max-width: 750px) {
  .trading-grid { grid-template-columns: 1fr; }
}

/* ─── BUTTONS ────────────────────────────────────────────────────────────────── */
.btn-primary {
  padding: 8px 15px; border-radius: var(--radius-sm); border: none;
  background: linear-gradient(135deg, #5254cc, #7c7fff);
  color: #fff; font-weight: 700; font-size: 12.5px;
  cursor: pointer; transition: opacity 0.14s, transform 0.1s;
  font-family: "Inter", sans-serif;
  box-shadow: 0 2px 10px rgba(99,102,241,0.3);
}
.btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
.btn-primary:active { transform: translateY(0); }
.btn-primary:disabled { opacity: 0.35; cursor: default; transform: none; box-shadow: none; }

.btn-secondary {
  padding: 8px 15px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-md);
  background: rgba(255,255,255,0.04); color: var(--text);
  font-weight: 600; font-size: 12.5px; cursor: pointer;
  transition: background 0.14s, border-color 0.14s;
  font-family: "Inter", sans-serif;
}
.btn-secondary:hover { background: rgba(255,255,255,0.08); border-color: var(--border-hi); }
.btn-secondary:disabled { opacity: 0.35; cursor: default; }

.btn-long {
  padding: 10px 18px; border-radius: var(--radius-sm); border: none;
  background: linear-gradient(135deg, #059669, #10b981);
  color: #fff; font-weight: 800; font-size: 13px;
  cursor: pointer; transition: opacity 0.14s, transform 0.1s;
  font-family: "Inter", sans-serif;
  box-shadow: 0 2px 12px rgba(16,185,129,0.3);
}
.btn-long:hover { opacity: 0.88; transform: translateY(-1px); }

.btn-short {
  padding: 10px 18px; border-radius: var(--radius-sm); border: none;
  background: linear-gradient(135deg, #dc2626, #ef4444);
  color: #fff; font-weight: 800; font-size: 13px;
  cursor: pointer; transition: opacity 0.14s, transform 0.1s;
  font-family: "Inter", sans-serif;
  box-shadow: 0 2px 12px rgba(239,68,68,0.3);
}
.btn-short:hover { opacity: 0.88; transform: translateY(-1px); }

.btn-close {
  padding: 4px 11px; border-radius: var(--radius-xs); border: none;
  background: rgba(239,68,68,0.1); color: var(--red);
  font-weight: 700; font-size: 11px; cursor: pointer;
  transition: background 0.13s;
}
.btn-close:hover { background: rgba(239,68,68,0.18); }

/* ─── SCAN TOGGLE ────────────────────────────────────────────────────────────── */
.scan-toggle {
  display: flex; align-items: center; gap: 5px; cursor: pointer;
  padding: 5px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-md); background: rgba(255,255,255,0.03);
  color: var(--text); font-size: 12px; font-weight: 600;
  transition: all 0.14s; font-family: "Inter", sans-serif;
}
.scan-toggle:hover { background: rgba(255,255,255,0.06); }
.scan-toggle.active {
  background: rgba(16,185,129,0.09);
  border-color: rgba(16,185,129,0.28);
  color: var(--green);
}

/* ─── INPUTS ─────────────────────────────────────────────────────────────────── */
.inp, .sel {
  width: 100%; background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-md);
  border-radius: var(--radius-sm);
  padding: 8px 11px; color: var(--text);
  font-family: "JetBrains Mono", monospace;
  font-size: 12px; transition: border-color 0.14s, background 0.14s;
}
.inp:focus, .sel:focus {
  outline: none; border-color: rgba(99,102,241,0.5);
  background: rgba(99,102,241,0.04);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.inp::placeholder { color: var(--muted); }

/* ─── TABS (internos) ────────────────────────────────────────────────────────── */
.tab {
  padding: 5px 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent; color: var(--muted);
  font-weight: 600; font-size: 12px; cursor: pointer;
  transition: all 0.12s; font-family: "Inter", sans-serif;
}
.tab:hover { background: rgba(255,255,255,0.05); color: var(--text); }
.tab-active {
  padding: 5px 12px; border-radius: var(--radius-sm);
  border: 1px solid rgba(99,102,241,0.3);
  background: rgba(99,102,241,0.12); color: var(--accent-3);
  font-weight: 700; font-size: 12px; cursor: pointer;
  font-family: "Inter", sans-serif;
}

/* ─── BADGES ─────────────────────────────────────────────────────────────────── */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; border: 1px solid transparent;
}
.badge-green  { background: rgba(16,185,129,0.1);  color: var(--green-2); border-color: rgba(16,185,129,0.22); }
.badge-red    { background: rgba(239,68,68,0.09);  color: var(--red-2);   border-color: rgba(239,68,68,0.18); }
.badge-yellow { background: rgba(245,158,11,0.09); color: var(--yellow-2); border-color: rgba(245,158,11,0.2); }
.badge-blue   { background: rgba(99,102,241,0.1);  color: var(--accent-3); border-color: rgba(99,102,241,0.22); }
.badge-teal   { background: rgba(20,184,166,0.09); color: #5eead4;         border-color: rgba(20,184,166,0.22); }
.badge-soft   { background: rgba(255,255,255,0.05); color: var(--text-2);  border-color: var(--border); }

/* ─── LABELS ─────────────────────────────────────────────────────────────────── */
.label {
  font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--muted); font-weight: 700;
}
.section-title {
  font-size: 11.5px; font-weight: 800; color: var(--text);
  letter-spacing: 0.02em; margin-bottom: 8px;
}

/* ─── METRIC ROW ─────────────────────────────────────────────────────────────── */
.metric-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px;
}
.metric-row:last-child { border-bottom: none; padding-bottom: 0; }
.metric-row .k { color: var(--muted); font-weight: 500; }
.metric-row .v { font-weight: 700; font-family: "JetBrains Mono", monospace; font-size: 11.5px; }

/* ─── TOOLTIP ────────────────────────────────────────────────────────────────── */
.tip { position: relative; display: inline-flex; align-items: center; gap: 3px; }
.tip-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; border-radius: 50%;
  background: rgba(99,102,241,0.12); color: var(--accent-3);
  font-size: 9px; font-weight: 800; cursor: help; flex-shrink: 0;
  border: 1px solid rgba(99,102,241,0.2); font-style: normal;
  transition: background 0.14s;
}
.tip-icon:hover { background: rgba(99,102,241,0.24); }
.tip-box {
  display: none; position: absolute;
  bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: var(--card-2); border: 1px solid rgba(99,102,241,0.22);
  border-radius: 9px; padding: 9px 12px;
  font-size: 11px; color: var(--text-2); width: 230px;
  line-height: 1.5; z-index: 9999; box-shadow: 0 8px 28px rgba(0,0,0,0.6);
  white-space: normal; pointer-events: none; font-weight: 400;
}
.tip-icon:hover + .tip-box { display: block; }

/* ─── TOASTS ─────────────────────────────────────────────────────────────────── */
.toast-list {
  position: fixed; bottom: 20px; right: 20px;
  display: flex; flex-direction: column; gap: 7px;
  z-index: 9999; pointer-events: none;
}
.toast {
  padding: 9px 14px; border-radius: var(--radius-sm);
  font-size: 12.5px; font-weight: 600; max-width: 330px;
  animation: slideIn 0.2s ease;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  border: 1px solid;
}
.toast-info    { background: rgba(20,24,50,0.97);  color: var(--accent-3); border-color: rgba(99,102,241,0.28); }
.toast-success { background: rgba(10,32,24,0.97);  color: var(--green-2);  border-color: rgba(16,185,129,0.28); }
.toast-warning { background: rgba(40,30,8,0.97);   color: var(--yellow-2); border-color: rgba(245,158,11,0.28); }
.toast-error   { background: rgba(40,12,12,0.97);  color: var(--red-2);    border-color: rgba(239,68,68,0.28); }
@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* ─── PANEL MODO SCALP/INTRADÍA ──────────────────────────────────────────────── */
.mode-selector {
  display: flex; gap: 6px; margin-bottom: 12px;
}
.mode-btn {
  flex: 1; padding: 9px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: rgba(255,255,255,0.02);
  cursor: pointer; text-align: left; transition: all 0.14s;
  font-family: "Inter", sans-serif;
}
.mode-btn:hover { background: rgba(255,255,255,0.04); border-color: var(--border-md); }
.mode-btn.active {
  background: rgba(99,102,241,0.1);
  border-color: rgba(99,102,241,0.3);
  border-top-width: 2px;
}
.mode-btn-icon { font-size: 14px; margin-bottom: 2px; }
.mode-btn-name { font-size: 12.5px; font-weight: 800; color: var(--text); }
.mode-btn-desc { font-size: 10px; color: var(--muted); margin-top: 1px; }
.mode-btn-stats { font-size: 10px; margin-top: 3px; }

/* ─── ASSET SELECTOR ─────────────────────────────────────────────────────────── */
.asset-grid {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px;
}
.asset-btn {
  padding: 3px 9px; border-radius: var(--radius-xs); border: none;
  cursor: pointer; font-size: 11px; font-weight: 700;
  transition: all 0.12s; font-family: "Inter", sans-serif;
  background: rgba(255,255,255,0.05); color: var(--text-2);
}
.asset-btn:hover { background: rgba(255,255,255,0.09); color: var(--text); }
.asset-btn.active {
  background: linear-gradient(135deg, #5254cc, #7c7fff);
  color: #fff;
}
.asset-btn.has-signal {
  background: rgba(16,185,129,0.1); color: var(--green-2);
  border: 1px solid rgba(16,185,129,0.2);
}

/* ─── NIVEL CARD ─────────────────────────────────────────────────────────────── */
.level-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;
  margin-bottom: 10px;
}
.level-cell {
  text-align: center; padding: 5px 4px;
  background: rgba(255,255,255,0.03);
  border-radius: var(--radius-xs);
}
.level-lbl { font-size: 8.5px; color: var(--muted); margin-bottom: 2px; }
.level-val {
  font-size: 11.5px; font-weight: 800;
  font-family: "JetBrains Mono", monospace;
}

/* ─── METRIC CHIP ────────────────────────────────────────────────────────────── */
.chip {
  display: inline-flex; align-items: center;
  padding: 3px 8px; border-radius: var(--radius-xs);
  font-size: 10.5px; font-weight: 700;
  background: rgba(255,255,255,0.05); color: var(--text-2);
}
.chip-green { background: rgba(16,185,129,0.09); color: var(--green-2); }
.chip-red   { background: rgba(239,68,68,0.09); color: var(--red-2); }
.chip-blue  { background: rgba(99,102,241,0.09); color: var(--accent-3); }
.chip-amber { background: rgba(245,158,11,0.09); color: var(--yellow-2); }

/* ─── TABLE ──────────────────────────────────────────────────────────────────── */
table { border-collapse: collapse; width: 100%; }
th {
  padding: 5px 8px; text-align: left;
  font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted);
  border-bottom: 1px solid var(--border);
  font-weight: 700;
}
td { padding: 5px 8px; vertical-align: middle; }
tbody tr { border-bottom: 1px solid rgba(255,255,255,0.028); }
tbody tr:hover { background: rgba(255,255,255,0.02) !important; }
tbody tr:last-child { border-bottom: none; }

/* ─── MAIN WRAP ──────────────────────────────────────────────────────────────── */
.main-wrap {
  max-width: 1440px; margin: 0 auto;
  padding: 18px 20px 40px;
  animation: fadeIn 0.22s ease;
}

/* ─── ANIMATIONS ─────────────────────────────────────────────────────────────── */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes glow-green {
  0%, 100% { box-shadow: 0 0 0 rgba(16,185,129,0); }
  50%       { box-shadow: 0 0 14px rgba(16,185,129,0.25); }
}
.fade-in { animation: fadeIn 0.22s ease; }
.pulse-green { animation: glow-green 2s ease-in-out infinite; }

/* ─── SCROLLBAR ──────────────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.09); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }

/* ─── GROQ / IA PANEL ────────────────────────────────────────────────────────── */
.groq-note {
  padding: 8px 12px; border-radius: var(--radius-sm);
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.18);
  font-size: 11px; color: var(--accent-3);
  line-height: 1.5;
}
.groq-note.macro {
  background: rgba(245,158,11,0.05);
  border-color: rgba(245,158,11,0.18);
  color: var(--yellow-2);
}

/* ─── WALKFORWARD / CALIB ────────────────────────────────────────────────────── */
.calib-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0; border-bottom: 1px solid var(--border);
  font-size: 11.5px;
}
.calib-row:last-child { border-bottom: none; }

/* ─── MODO SELECTOR QUANT ────────────────────────────────────────────────────── */
.qmode-selector {
  display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;
}
.qmode-btn {
  flex: 1; min-width: 120px; padding: 9px 10px;
  border-radius: var(--radius-sm); border: 1px solid var(--border);
  background: rgba(255,255,255,0.02); cursor: pointer;
  text-align: left; transition: all 0.13s;
  font-family: "Inter", sans-serif;
}
.qmode-btn:hover { background: rgba(255,255,255,0.04); }
.qmode-btn.active {
  background: rgba(20,184,166,0.08);
  border-color: rgba(20,184,166,0.3);
  border-top: 2px solid #14b8a6;
}

/* ─── VISTA SELECTOR ─────────────────────────────────────────────────────────── */
.view-selector {
  display: flex; gap: 3px;
}
.view-btn {
  padding: 5px 11px; border-radius: var(--radius-sm);
  border: none; cursor: pointer; font-size: 11.5px; font-weight: 600;
  transition: all 0.12s; font-family: "Inter", sans-serif;
  background: rgba(255,255,255,0.04); color: var(--muted);
}
.view-btn:hover { background: rgba(255,255,255,0.07); color: var(--text-2); }
.view-btn.active {
  background: rgba(99,102,241,0.15);
  color: var(--accent-3);
}

/* ─── BANNER BRIDGE ──────────────────────────────────────────────────────────── */
.bridge-banner {
  margin-bottom: 14px; padding: 12px 16px;
  border-radius: var(--radius);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.bridge-banner.warn {
  background: rgba(245,158,11,0.06);
  border: 1px solid rgba(245,158,11,0.22);
}
.bridge-banner.error {
  background: rgba(239,68,68,0.06);
  border: 1px solid rgba(239,68,68,0.2);
}
.bridge-banner.connecting {
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.2);
}
