/* 右下角浮動看盤小工具：加權 / 櫃買 + 自選股
 * 用法：<script src="stock-widget.js" data-api="https://<你的 worker>" defer></script>
 * 資料來源：臺灣證券交易所、Yahoo Finance（經 Cloudflare Worker 中繼，見 worker/worker.js）
 * 自選股清單只存在訪客自己的瀏覽器（localStorage）。
 */
(() => {
  const script = document.currentScript;
  const RAW = window.STOCK_WIDGET_API || (script && script.dataset.api) || "";
  const BASE = RAW.replace(/\/indices\/?$/, "").replace(/\/+$/, "");
  const INDICES = [["t00", "加權"], ["o00", "櫃買"]];
  const SESSION = 270;
  const OPEN_MS = 5000, CLOSED_MS = 60000, CHART_MS = 30000;
  const MAX_WATCH = 20;
  const CODE_RE = /^[0-9]{4,6}[A-Z]?$/;
  const LS_WATCH = "sw-watchlist", LS_VIEW = "sw-view";
  const DEFAULT_WATCH = ["2330", "2317", "0050"];

  /* ---------- 樣式 ---------- */
  const css = `
  .sw-root{--sw-up:#e5484d;--sw-down:#16a34a;--sw-flat:var(--muted,#5a6477);
    font:14px/1.5 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:var(--ink,#0e1422)}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .sw-root{--sw-up:#ff6369;--sw-down:#3dd68c}}
  :root[data-theme="dark"] .sw-root{--sw-up:#ff6369;--sw-down:#3dd68c}
  .sw-root .sw-mono{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
  .sw-root [hidden]{display:none !important}
  .sw-fab{position:fixed;z-index:60;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));
    width:52px;height:52px;border-radius:50%;border:1px solid var(--line,#dce2ec);background:var(--surface,#fff);
    color:var(--accent,#1f5eff);box-shadow:0 6px 20px rgba(0,0,0,.14);display:grid;place-items:center;cursor:pointer;
    transition:transform .15s ease,box-shadow .15s ease;padding:0}
  .sw-fab:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.18)}
  .sw-fab:focus-visible{outline:2px solid var(--accent,#1f5eff);outline-offset:3px}
  .sw-fab svg{width:24px;height:24px}
  .sw-fab .sw-i-close{display:none}
  .sw-fab[aria-expanded="true"] .sw-i-chart{display:none}
  .sw-fab[aria-expanded="true"] .sw-i-close{display:block}
  .sw-panel{position:fixed;z-index:60;right:max(16px,env(safe-area-inset-right));
    bottom:calc(max(16px,env(safe-area-inset-bottom)) + 64px);width:min(380px,calc(100vw - 32px));
    max-height:calc(100dvh - 100px);overflow:auto;background:var(--surface,#fff);border:1px solid var(--line,#dce2ec);
    border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.18);padding:12px 14px 10px;transform-origin:bottom right;
    animation:sw-in .16s ease-out}
  @keyframes sw-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.sw-panel{animation:none}.sw-fab{transition:none}}
  .sw-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
  .sw-head b{font-size:15px}
  .sw-status{font-size:12px;color:var(--muted,#5a6477)}
  .sw-status.sw-err{color:#d97706}
  .sw-row{display:grid;grid-template-columns:2.6em 1fr auto 76px;align-items:center;gap:8px;
    padding:6px 8px;margin:0 -8px;width:calc(100% + 16px);border:0;border-radius:8px;background:none;color:inherit;
    font:inherit;text-align:left;cursor:pointer}
  .sw-row:hover,.sw-row[aria-pressed="true"]{background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-row:focus-visible{outline:2px solid var(--accent,#1f5eff);outline-offset:-2px}
  .sw-srow{grid-template-columns:4.8em 1fr auto 60px 20px}
  .sw-name{font-weight:500}
  .sw-sname{display:flex;flex-direction:column;line-height:1.25;min-width:0}
  .sw-sname b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sw-sname small{font-size:11px;color:var(--muted,#5a6477)}
  .sw-price{font-weight:700;font-size:16px;text-align:right;justify-self:end}
  .sw-price.sw-lim-up{background:var(--sw-up);color:#fff;border-radius:4px;padding:0 4px}
  .sw-price.sw-lim-down{background:var(--sw-down);color:#fff;border-radius:4px;padding:0 4px}
  .sw-chg{font-size:12px;text-align:right;white-space:nowrap}
  .sw-spark{width:100%;height:26px;display:block}
  .sw-del{border:0;background:none;color:var(--muted,#5a6477);cursor:pointer;font-size:16px;line-height:1;
    padding:2px;border-radius:4px;opacity:.45}
  .sw-srow:hover .sw-del,.sw-del:focus-visible{opacity:1}
  .sw-del:hover{color:var(--sw-up);background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-search{position:relative;margin:2px 0 4px}
  .sw-search input{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--line,#dce2ec);border-radius:8px;
    background:var(--bg,#f4f6fa);color:var(--ink,#0e1422);font:inherit;font-size:13px}
  .sw-search input:focus{outline:2px solid var(--accent,#1f5eff);outline-offset:-1px}
  .sw-sugg{position:absolute;left:0;right:0;top:100%;margin:4px 0 0;padding:4px;list-style:none;z-index:2;
    background:var(--surface,#fff);border:1px solid var(--line,#dce2ec);border-radius:8px;box-shadow:0 10px 24px rgba(0,0,0,.14);
    max-height:240px;overflow:auto}
  .sw-sugg li{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px}
  .sw-sugg li small{color:var(--muted,#5a6477)}
  .sw-sugg li[aria-selected="true"],.sw-sugg li:hover{background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-msg{font-size:12px;color:#d97706;margin:0 0 4px}
  .sw-empty{padding:14px 0;color:var(--muted,#5a6477);font-size:13px;text-align:center}
  .sw-detail{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#dce2ec)}
  .sw-dtitle{font-size:13px;font-weight:700;margin-bottom:2px}
  .sw-chart{width:100%;height:200px;display:block;touch-action:pan-y}
  .sw-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;margin:8px 0 0}
  .sw-stats div{min-width:0;padding:4px 8px;border-radius:6px;background:var(--accent-soft,rgba(31,94,255,.06))}
  .sw-stats dt{font-size:11px;line-height:1.3;color:var(--muted,#5a6477)}
  .sw-stats dd{margin:0;font-size:13px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sw-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
  .sw-switch{flex:none;border:1px solid var(--line,#dce2ec);background:var(--surface,#fff);color:var(--accent,#1f5eff);
    font:500 12px/1 "Noto Sans TC","Microsoft JhengHei",sans-serif;padding:7px 11px;border-radius:999px;cursor:pointer}
  .sw-switch:hover{background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-switch:focus-visible{outline:2px solid var(--accent,#1f5eff);outline-offset:2px}
  .sw-src{font-size:11px;color:var(--muted,#5a6477);text-align:right}
  .sw-up{color:var(--sw-up)} .sw-down{color:var(--sw-down)} .sw-flat{color:var(--sw-flat)}
  @media (max-width:420px){
    .sw-row{grid-template-columns:2.3em 1fr auto 52px;gap:6px}
    .sw-srow{grid-template-columns:4.4em 1fr auto 44px 18px}
    .sw-chg{font-size:11px}.sw-price{font-size:15px}}`;

  /* ---------- 工具 ---------- */
  const n2 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (x) => (Number.isFinite(x) && x ? n2(x) : "--");
  // 個股：500 元以上跳動單位是整數，不顯示小數
  const priceFmt = (ref) => (x) => {
    if (!Number.isFinite(x) || !x) return "--";
    const d = ref >= 500 ? 0 : 2;
    return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const big = (n, unit = "") => {
    if (!Number.isFinite(n) || !n) return "--";
    if (n >= 1e8) return n2(n / 1e8) + "億" + unit;
    if (n >= 1e4) return (n / 1e4).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "萬" + unit;
    return n.toLocaleString("en-US") + unit;
  };
  const pctText = (d, prev) => { const p = prev ? (d / prev) * 100 : 0; return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; };
  const cls = (d) => (d > 0 ? "sw-up" : d < 0 ? "sw-down" : "sw-flat");
  const arrow = (d) => (d > 0 ? "▲" : d < 0 ? "▼" : "");
  const minuteLabel = (m) => { m = Math.round(m); return `${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const twNow = () => new Date(Date.now() + 8 * 3600e3);
  const marketOpen = () => {
    const t = twNow(), hm = t.getUTCHours() * 100 + t.getUTCMinutes();
    return t.getUTCDay() >= 1 && t.getUTCDay() <= 5 && hm >= 900 && hm <= 1335;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e;
  };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 無痕模式等情況可忽略 */ } },
  };
  // 用即時報價補上最新一點（走勢資料有延遲）
  function withLive(points, price, time) {
    const pts = (points || []).slice();
    if (pts.length && time && marketOpen()) {
      const [h, m, s] = time.split(":").map(Number);
      const mm = Math.min(Math.max(h * 60 + m - 540 + (s || 0) / 60, 0), SESSION);
      if (mm > pts[pts.length - 1][0]) pts.push([mm, price, 0]);
    }
    return pts;
  }

  /* ---------- 建立 DOM ---------- */
  const style = el("style"); style.textContent = css; document.head.appendChild(style);
  const root = el("div", { class: "sw-root" });
  const fab = el("button", { class: "sw-fab", type: "button", "aria-label": "台股看盤", "aria-expanded": "false", "aria-controls": "sw-panel", title: "台股看盤" },
    `<svg class="sw-i-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>
     <svg class="sw-i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`);
  const panel = el("section", { class: "sw-panel", id: "sw-panel", role: "dialog", "aria-label": "台股看盤" });
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sw-head"><b class="sw-htitle">台股大盤</b><span class="sw-status">載入中…</span></div>
    <div class="sw-vindex"></div>
    <div class="sw-vwatch" hidden>
      <div class="sw-search">
        <input type="text" placeholder="加入自選：輸入代號或名稱，如 2330、台積" aria-label="搜尋股票代號或名稱"
          autocomplete="off" role="combobox" aria-expanded="false" aria-controls="sw-sugg" aria-autocomplete="list">
        <ul class="sw-sugg" id="sw-sugg" role="listbox" hidden></ul>
      </div>
      <p class="sw-msg" hidden></p>
      <div class="sw-wrows"></div>
    </div>
    <div class="sw-detail">
      <div class="sw-dtitle"></div>
      <canvas class="sw-chart" aria-label="分時走勢與成交量"></canvas>
      <dl class="sw-stats"></dl>
    </div>
    <div class="sw-foot"><button class="sw-switch" type="button"></button><span class="sw-src"></span></div>`;
  root.append(panel, fab);
  document.body.appendChild(root);

  const $ = (s) => panel.querySelector(s);
  const status = $(".sw-status"), htitle = $(".sw-htitle");
  const vIndex = $(".sw-vindex"), vWatch = $(".sw-vwatch"), wrows = $(".sw-wrows");
  const input = $(".sw-search input"), sugg = $(".sw-sugg"), msg = $(".sw-msg");
  const detail = $(".sw-detail"), dtitle = $(".sw-dtitle"), chart = $(".sw-chart"), statsBox = $(".sw-stats");
  const switchBtn = $(".sw-switch"), src = $(".sw-src");

  const idxRows = {};
  for (const [code, name] of INDICES) {
    const b = el("button", { class: "sw-row", type: "button", "aria-pressed": "false" },
      `<span class="sw-name">${name}</span><span class="sw-price sw-mono">--</span><span class="sw-chg sw-mono"></span><canvas class="sw-spark"></canvas>`);
    b.addEventListener("click", () => { selIndex = code; hoverX = null; render(); });
    vIndex.appendChild(b);
    idxRows[code] = { btn: b, price: b.querySelector(".sw-price"), chg: b.querySelector(".sw-chg"), spark: b.querySelector(".sw-spark") };
  }

  /* ---------- 狀態 ---------- */
  let view = ls.get(LS_VIEW) === "watch" ? "watch" : "index";
  let watch = (() => {
    try {
      const v = JSON.parse(ls.get(LS_WATCH));
      if (Array.isArray(v)) return v.filter((c) => typeof c === "string" && CODE_RE.test(c)).slice(0, MAX_WATCH);
    } catch { /* 用預設 */ }
    return DEFAULT_WATCH.slice();
  })();
  let indexData = null;          // /indices 回傳
  const stockData = {};          // code → 個股資料（含 points）
  let lastChart = 0;
  let selIndex = "t00", selStock = watch[0] || null;
  let hoverX = null, timer = null, reqId = 0;
  let wRows = {};

  const saveWatch = () => ls.set(LS_WATCH, JSON.stringify(watch));
  const api = async (path) => {
    const r = await fetch(BASE + path, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  };
  const showMsg = (t) => { msg.textContent = t || ""; msg.hidden = !t; };

  /* ---------- 畫圖 ---------- */
  function setupCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const colors = () => {
    const cs = getComputedStyle(root);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    return { up: v("--sw-up", "#e5484d"), down: v("--sw-down", "#16a34a"), muted: v("--muted", "#5a6477"), line: v("--line", "#dce2ec"), ink: v("--ink", "#0e1422") };
  };
  const yRange = (pts, prev) => {
    const vals = pts.map((p) => p[1]).concat(prev ? [prev] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  };
  function priceLine(ctx, pts, prev, X, Y, c, lw) {
    ctx.lineWidth = lw; ctx.lineJoin = "round";
    const col = (d) => (d > 0 ? c.up : d < 0 ? c.down : c.muted);
    const seg = (xa, ya, xb, yb, color) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); };
    for (let i = 1; i < pts.length; i++) {
      const [m0, p0] = pts[i - 1], [m1, p1] = pts[i];
      if ((p0 - prev) * (p1 - prev) < 0) {     // 穿越昨收，切成兩段上色
        const r = (prev - p0) / (p1 - p0), xm = X(m0) + (X(m1) - X(m0)) * r;
        seg(X(m0), Y(p0), xm, Y(prev), col(p0 - prev));
        seg(xm, Y(prev), X(m1), Y(p1), col(p1 - prev));
      } else seg(X(m0), Y(p0), X(m1), Y(p1), col((p0 + p1) / 2 - prev));
    }
  }
  function drawSpark(cv, pts, prev) {
    const { ctx, w, h } = setupCanvas(cv);
    if (!pts || pts.length < 2) return;
    const c = colors(), [lo, hi] = yRange(pts, prev);
    const X = (m) => 1 + (m / SESSION) * (w - 2), Y = (p) => 1 + ((hi - p) / (hi - lo)) * (h - 2);
    if (prev) { ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(0, Y(prev)); ctx.lineTo(w, Y(prev)); ctx.stroke(); ctx.setLineDash([]); }
    priceLine(ctx, pts, prev, X, Y, c, 1.4);
  }

  // 目前下方價量圖要畫什麼（大盤或個股）
  function detailModel() {
    if (view === "index") {
      const it = indexData && indexData.indices[selIndex];
      const name = INDICES.find(([c]) => c === selIndex)[1];
      return {
        title: `${name}指數・價量`, pts: it ? withLive(it.points, it.price, it.time) : [], prev: it ? it.prev : 0,
        fmt, volText: (v) => `${(v / 100).toFixed(1)}億`, volMax: (v) => `${Math.round(v / 100).toLocaleString()}億`, volUnit: "金額/分",
        empty: indexData ? "尚無走勢資料" : "載入中…",
      };
    }
    const s = selStock && stockData[selStock];
    const f = priceFmt(s ? s.prev || s.price : 0);
    return {
      title: s && !s.missing ? `${s.name} ${selStock}・價量` : selStock ? `${selStock}・價量` : "",
      pts: s && s.points ? withLive(s.points, s.price, s.time) : [], prev: s ? s.prev : 0,
      fmt: f, volText: (v) => `${Math.round(v).toLocaleString()}張`, volMax: (v) => `${Math.round(v).toLocaleString()}張`, volUnit: "張/分",
      empty: !s ? "載入中…" : s.points === null ? "走勢資料暫時無法取得" : s.points ? "尚無走勢資料" : "載入中…",
    };
  }

  function drawDetail() {
    const M = detailModel(), pts = M.pts, prev = M.prev;
    const { ctx, w, h } = setupCanvas(chart), c = colors();
    const L = 2, R = 62, T = 18, B = 16, GAP = 6;
    const PH = Math.round((h - T - B - GAP) * 0.7), VH = h - T - B - GAP - PH;
    const right = w - R, vt = T + PH + GAP, vb = vt + VH;
    const X = (m) => L + (m / SESSION) * (right - L);
    ctx.font = '11px "JetBrains Mono", ui-monospace, Consolas, monospace';
    ctx.textBaseline = "middle";

    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.fillStyle = c.muted;
    for (const m of [0, 60, 120, 180, 240, 270]) {
      const x = Math.round(X(m)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, vb); ctx.stroke();
      if (m === 240) continue;
      ctx.textAlign = m === 0 ? "left" : m === 270 ? "right" : "center";
      ctx.fillText(minuteLabel(m), x, vb + B / 2 + 1);
    }
    if (pts.length < 2) {
      ctx.textAlign = "center"; ctx.fillText(M.empty, (L + right) / 2, T + PH / 2);
      return;
    }
    const [lo, hi] = yRange(pts, prev);
    const Y = (p) => T + ((hi - p) / (hi - lo)) * PH;
    const col = (d) => (d > 0 ? c.up : d < 0 ? c.down : c.muted);

    if (prev) { ctx.setLineDash([3, 3]); ctx.strokeStyle = c.muted; ctx.beginPath(); ctx.moveTo(L, Y(prev)); ctx.lineTo(right, Y(prev)); ctx.stroke(); ctx.setLineDash([]); }
    const hiP = Math.max(...pts.map((p) => p[1])), loP = Math.min(...pts.map((p) => p[1]));
    const placed = [];
    ctx.textAlign = "left";
    for (const p of [prev, hiP, loP]) {
      if (!p) continue;
      const y = Y(p);
      if (placed.some((py) => Math.abs(py - y) < 24)) continue;
      placed.push(y);
      ctx.fillStyle = col(p - prev);
      ctx.fillText(M.fmt(p), right + 4, y - 6);
      ctx.fillText(pctText(p - prev, prev), right + 4, y + 7);
    }
    priceLine(ctx, pts, prev, X, Y, c, 1.6);

    // 每分鐘量柱（98 百分位截頂，避免開盤爆量壓扁其他柱）
    const vols = pts.map((p) => p[2]).filter((v) => v > 0).sort((a, b) => a - b);
    if (vols.length) {
      const vmax = vols[Math.min(vols.length - 1, Math.floor(vols.length * 0.98))] * 1.15;
      const bw = Math.max(1, (right - L) / SESSION - 0.3);
      let last = prev;
      for (const [m, p, v] of pts) {
        if (v > 0) { ctx.fillStyle = p >= last ? c.up : c.down; const bh = Math.min(v / vmax, 1) * VH; ctx.fillRect(X(m) - bw / 2, vb - bh, bw, bh); }
        last = p;
      }
      ctx.fillStyle = c.muted;
      ctx.fillText(M.volMax(vmax), right + 4, vt + 6);
    }
    ctx.fillStyle = c.muted;
    ctx.fillText(M.volUnit, right + 4, vb - 6);

    if (hoverX != null) {
      const mAt = ((hoverX - L) / (right - L)) * SESSION;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - mAt) < Math.abs(best[0] - mAt)) best = p;
      const [m, p, v] = best, x = X(m), y = Y(p), d = p - prev;
      ctx.strokeStyle = c.muted; ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, vb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col(d); ctx.textAlign = "left";
      const dTxt = `${d >= 0 ? "+" : "-"}${M.fmt(Math.abs(d)) === "--" ? "0" : M.fmt(Math.abs(d))}`;
      ctx.fillText(`${minuteLabel(m)} ${M.fmt(p)} ${dTxt} (${pctText(d, prev)})${v > 0 ? "  " + M.volText(v) : ""}`, L, T / 2);
    }
  }

  function renderStats(items) {
    statsBox.innerHTML = items.map(([label, value, c = ""]) =>
      `<div><dt>${label}</dt><dd class="sw-mono ${c}">${esc(value)}</dd></div>`).join("");
  }

  /* ---------- 畫面 ---------- */
  function render() {
    const isIdx = view === "index";
    vIndex.hidden = !isIdx; vWatch.hidden = isIdx;
    htitle.textContent = isIdx ? "台股大盤" : "自選股";
    switchBtn.textContent = isIdx ? "☆ 自選股" : "← 大盤";
    switchBtn.setAttribute("aria-label", isIdx ? "切換到自選股" : "切換回大盤");
    src.textContent = isIdx ? "資料：臺灣證券交易所・約延遲 15 秒" : "報價：證交所・走勢：Yahoo Finance";
    if (isIdx) renderIndex(); else renderWatch();
  }

  function setStatus(time) {
    status.className = "sw-status";
    status.textContent = time ? `${marketOpen() ? "盤中" : "收盤"} · ${time}` : "";
  }

  function renderIndex() {
    detail.hidden = false;
    if (!indexData) { drawDetail(); return; }
    let t = "";
    for (const [code] of INDICES) {
      const it = indexData.indices[code], r = idxRows[code];
      r.btn.setAttribute("aria-pressed", String(code === selIndex));
      if (!it) continue;
      t = it.time || t;
      const d = it.price - it.prev;
      r.price.textContent = fmt(it.price); r.price.className = `sw-price sw-mono ${cls(d)}`;
      r.chg.textContent = `${arrow(d)}${n2(Math.abs(d))} (${pctText(d, it.prev)})`;
      r.chg.className = `sw-chg sw-mono ${cls(d)}`;
      drawSpark(r.spark, withLive(it.points, it.price, it.time), it.prev);
    }
    setStatus(t);
    const it = indexData.indices[selIndex];
    dtitle.textContent = detailModel().title;
    drawDetail();
    if (!it) return;
    const s = it.stats || {};
    renderStats([
      ["開盤", fmt(it.open), cls(it.open - it.prev)], ["最高", fmt(it.high), cls(it.high - it.prev)], ["最低", fmt(it.low), cls(it.low - it.prev)],
      ["昨收", fmt(it.prev)], ["成交金額", big(s.amount)], ["成交量", big(s.volume, "張")],
      ["筆數", big(s.trades, "筆")], ["委買", big(s.bid, "張"), "sw-up"], ["委賣", big(s.ask, "張"), "sw-down"],
    ]);
  }

  // 自選股列表結構（清單變動時重建）
  function buildWatchRows() {
    wrows.innerHTML = "";
    wRows = {};
    if (!watch.length) {
      wrows.innerHTML = `<div class="sw-empty">還沒有自選股，從上面搜尋加入吧</div>`;
      return;
    }
    for (const code of watch) {
      const row = el("div", { class: "sw-row sw-srow", role: "button", tabindex: "0", "aria-pressed": "false" },
        `<span class="sw-sname"><b>${esc(code)}</b><small>${esc(code)}</small></span>
         <span class="sw-price sw-mono">--</span><span class="sw-chg sw-mono"></span>
         <canvas class="sw-spark"></canvas>
         <button class="sw-del" type="button" aria-label="從自選移除 ${esc(code)}" title="移除">×</button>`);
      row.addEventListener("click", (e) => { if (!e.target.closest(".sw-del")) selectStock(code); });
      row.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); selectStock(code); } });
      row.querySelector(".sw-del").addEventListener("click", () => removeStock(code));
      wrows.appendChild(row);
      wRows[code] = { row, name: row.querySelector(".sw-sname b"), price: row.querySelector(".sw-price"), chg: row.querySelector(".sw-chg"), spark: row.querySelector(".sw-spark"), del: row.querySelector(".sw-del") };
    }
  }

  function renderWatch() {
    if (Object.keys(wRows).length !== watch.length || watch.some((c) => !wRows[c])) buildWatchRows();
    let t = "";
    for (const code of watch) {
      const r = wRows[code], s = stockData[code];
      r.row.setAttribute("aria-pressed", String(code === selStock));
      if (!s) continue;
      if (s.missing) { r.name.textContent = "查無資料"; continue; }
      t = s.time > t ? s.time : t;
      const f = priceFmt(s.prev || s.price), d = s.price - s.prev;
      r.name.textContent = s.name; r.name.title = s.name;
      r.del.setAttribute("aria-label", `從自選移除 ${s.name}`);
      r.price.textContent = f(s.price);
      const lim = s.limitUp && s.price >= s.limitUp ? " sw-lim-up" : s.limitDown && s.price <= s.limitDown ? " sw-lim-down" : "";
      r.price.className = `sw-price sw-mono ${lim ? "" : cls(d)}${lim}`;
      r.chg.textContent = `${arrow(d)}${f(Math.abs(d)) === "--" ? "0" : f(Math.abs(d))} (${pctText(d, s.prev)})`;
      r.chg.className = `sw-chg sw-mono ${cls(d)}`;
      drawSpark(r.spark, s.points ? withLive(s.points, s.price, s.time) : null, s.prev);
    }
    setStatus(t);

    detail.hidden = !selStock;
    if (!selStock) return;
    dtitle.textContent = detailModel().title;
    drawDetail();
    const s = stockData[selStock];
    if (!s || s.missing) { renderStats([]); return; }
    const f = priceFmt(s.prev || s.price);
    const amp = s.prev && s.high && s.low ? `${(((s.high - s.low) / s.prev) * 100).toFixed(2)}%` : "--";
    renderStats([
      ["開盤", f(s.open), cls(s.open - s.prev)], ["最高", f(s.high), cls(s.high - s.prev)], ["最低", f(s.low), cls(s.low - s.prev)],
      ["昨收", f(s.prev)], ["成交量", s.volume ? `${s.volume.toLocaleString()}張` : "--"], ["振幅", amp],
      ["漲停", f(s.limitUp), "sw-up"], ["跌停", f(s.limitDown), "sw-down"], ["市場", s.ex === "otc" ? "上櫃" : "上市"],
    ]);
  }

  function selectStock(code) { selStock = code; hoverX = null; renderWatch(); }

  function removeStock(code) {
    watch = watch.filter((c) => c !== code);
    delete stockData[code];
    saveWatch();
    if (selStock === code) selStock = watch[0] || null;
    buildWatchRows(); renderWatch();
  }

  async function addStock(code, name) {
    code = String(code).trim().toUpperCase();
    closeSugg(); input.value = "";
    if (!CODE_RE.test(code)) { showMsg("請輸入 4～6 位數的股票代號，或從清單選擇"); return; }
    if (watch.includes(code)) { showMsg(`${name || code} 已經在自選清單裡`); selectStock(code); return; }
    if (watch.length >= MAX_WATCH) { showMsg(`自選股最多 ${MAX_WATCH} 檔`); return; }
    showMsg("");
    try {
      const j = await api(`/stocks?codes=${code}&chart=1`);
      const s = j.stocks[code];
      if (!s) { showMsg(`查無代號 ${code}`); return; }
      stockData[code] = s;
      watch.push(code); saveWatch();
      selStock = code; hoverX = null;
      buildWatchRows(); renderWatch();
    } catch { showMsg("連線失敗，請稍後再試"); }
  }

  /* ---------- 搜尋建議 ---------- */
  let suggItems = [], suggIdx = -1, suggTimer = null, suggReq = 0;
  function closeSugg() { sugg.hidden = true; suggItems = []; suggIdx = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  function paintSugg() {
    sugg.innerHTML = suggItems.map((it, i) =>
      `<li role="option" id="sw-opt-${i}" aria-selected="${i === suggIdx}" data-i="${i}"><span>${esc(it.name)}</span><small class="sw-mono">${esc(it.code)}・${it.ex === "otc" ? "上櫃" : "上市"}</small></li>`).join("");
    sugg.hidden = !suggItems.length;
    input.setAttribute("aria-expanded", String(!!suggItems.length));
    if (suggIdx >= 0) input.setAttribute("aria-activedescendant", `sw-opt-${suggIdx}`); else input.removeAttribute("aria-activedescendant");
  }
  input.addEventListener("input", () => {
    showMsg("");
    clearTimeout(suggTimer);
    const q = input.value.trim();
    if (!q) { suggReq++; closeSugg(); return; }
    suggTimer = setTimeout(async () => {
      const my = ++suggReq;
      try {
        const j = await api(`/search?q=${encodeURIComponent(q)}`);
        if (my !== suggReq) return;
        suggItems = j.results || []; suggIdx = suggItems.length ? 0 : -1; paintSugg();
      } catch { /* 搜尋失敗就不顯示建議 */ }
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && suggItems.length) { e.preventDefault(); suggIdx = (suggIdx + 1) % suggItems.length; paintSugg(); }
    else if (e.key === "ArrowUp" && suggItems.length) { e.preventDefault(); suggIdx = (suggIdx - 1 + suggItems.length) % suggItems.length; paintSugg(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(suggTimer); suggReq++;
      const it = suggItems[suggIdx];
      if (it) addStock(it.code, it.name); else if (input.value.trim()) addStock(input.value);
    } else if (e.key === "Escape" && !sugg.hidden) { e.stopPropagation(); closeSugg(); }
  });
  sugg.addEventListener("mousedown", (e) => {        // mousedown：搶在 input blur 之前
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    const it = suggItems[+li.dataset.i];
    if (it) addStock(it.code, it.name);
  });
  input.addEventListener("blur", () => setTimeout(closeSugg, 100));

  /* ---------- 抓資料 ---------- */
  async function load() {
    clearTimeout(timer);
    if (panel.hidden || document.hidden) return;
    if (!BASE) { status.textContent = "尚未設定資料來源"; status.className = "sw-status sw-err"; return; }
    const my = ++reqId;
    try {
      if (view === "index") {
        const j = await api("/indices");
        if (my !== reqId) return;
        indexData = j;
      } else if (watch.length) {
        const codes = watch.slice();
        const needChart = Date.now() - lastChart > CHART_MS || codes.some((c) => !stockData[c] || stockData[c].points === undefined);
        const j = await api(`/stocks?codes=${codes.join(",")}${needChart ? "&chart=1" : ""}`);
        if (my !== reqId) return;
        for (const c of codes) {
          if (!watch.includes(c)) continue;          // 等待期間被移除
          const s = j.stocks[c];
          if (!s) { stockData[c] = { missing: true }; continue; }
          if (!needChart && stockData[c] && !stockData[c].missing) s.points = stockData[c].points;
          stockData[c] = s;
        }
        if (needChart) lastChart = Date.now();
      }
      render();
    } catch {
      if (my !== reqId) return;
      status.textContent = "連線失敗，稍後重試"; status.className = "sw-status sw-err";
    }
    timer = setTimeout(load, marketOpen() ? OPEN_MS : CLOSED_MS);
  }

  /* ---------- 互動 ---------- */
  function setView(v) {
    view = v; ls.set(LS_VIEW, v); hoverX = null; showMsg(""); closeSugg();
    render(); load();
  }
  switchBtn.addEventListener("click", () => setView(view === "index" ? "watch" : "index"));
  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) { render(); load(); } else { clearTimeout(timer); closeSugg(); }
  }
  fab.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); fab.focus(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !panel.hidden) load(); });
  const hover = (e) => { const r = chart.getBoundingClientRect(); hoverX = e.clientX - r.left; drawDetail(); };
  chart.addEventListener("pointermove", hover);
  chart.addEventListener("pointerdown", hover);
  chart.addEventListener("pointerleave", () => { hoverX = null; drawDetail(); });
  window.addEventListener("resize", () => { if (!panel.hidden) render(); });
  new MutationObserver(() => { if (!panel.hidden) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", () => { if (!panel.hidden) render(); });
})();
