/* 右下角浮動看盤小工具：加權 / 櫃買
 * 用法：<script src="stock-widget.js" data-api="https://<你的 worker>/indices" defer></script>
 * 資料來源：臺灣證券交易所（經 Cloudflare Worker 中繼，見 worker.js）
 */
(() => {
  const script = document.currentScript;
  const API = window.STOCK_WIDGET_API || (script && script.dataset.api) || "";
  const ORDER = [["t00", "加權"], ["o00", "櫃買"]];
  const SESSION = 270;
  const OPEN_MS = 5000, CLOSED_MS = 60000;

  /* ---------- 樣式 ---------- */
  const css = `
  .sw-root{--sw-up:#e5484d;--sw-down:#16a34a;--sw-flat:var(--muted,#5a6477);
    font:14px/1.5 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:var(--ink,#0e1422)}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .sw-root{--sw-up:#ff6369;--sw-down:#3dd68c}}
  :root[data-theme="dark"] .sw-root{--sw-up:#ff6369;--sw-down:#3dd68c}
  .sw-root .sw-mono{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
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
  .sw-panel[hidden]{display:none}
  @keyframes sw-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.sw-panel{animation:none}.sw-fab{transition:none}}
  .sw-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
  .sw-head b{font-size:15px}
  .sw-status{font-size:12px;color:var(--muted,#5a6477)}
  .sw-status.sw-err{color:#d97706}
  .sw-row{display:grid;grid-template-columns:2.6em 1fr auto 76px;align-items:center;gap:8px;width:100%;
    padding:6px 8px;margin:0 -8px;width:calc(100% + 16px);border:0;border-radius:8px;background:none;color:inherit;
    font:inherit;text-align:left;cursor:pointer}
  .sw-row:hover{background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-row[aria-pressed="true"]{background:var(--accent-soft,rgba(31,94,255,.09))}
  .sw-row:focus-visible{outline:2px solid var(--accent,#1f5eff);outline-offset:-2px}
  .sw-name{font-weight:500}
  .sw-price{font-weight:700;font-size:16px;text-align:right}
  .sw-chg{font-size:12px;text-align:right;white-space:nowrap}
  .sw-spark{width:76px;height:26px;display:block}
  @media (max-width:420px){.sw-row{grid-template-columns:2.3em 1fr auto 52px;gap:6px}.sw-spark{width:52px}.sw-chg{font-size:11px}.sw-price{font-size:15px}}
  .sw-detail{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#dce2ec)}
  .sw-dtitle{font-size:13px;font-weight:700;margin-bottom:2px}
  .sw-chart{width:100%;height:200px;display:block;touch-action:pan-y}
  .sw-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;margin:8px 0 0}
  .sw-stats div{min-width:0;padding:4px 8px;border-radius:6px;background:var(--accent-soft,rgba(31,94,255,.06))}
  .sw-stats dt{font-size:11px;line-height:1.3;color:var(--muted,#5a6477)}
  .sw-stats dd{margin:0;font-size:13px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sw-foot{margin-top:8px;font-size:11px;color:var(--muted,#5a6477)}
  .sw-up{color:var(--sw-up)} .sw-down{color:var(--sw-down)} .sw-flat{color:var(--sw-flat)}
`;

  /* ---------- 工具 ---------- */
  const fmt = (x, d = 2) => (Number.isFinite(x) && x ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--");
  const big = (n, unit = "") => {
    if (!Number.isFinite(n) || !n) return "--";
    if (n >= 1e8) return (n / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + "億" + unit;
    if (n >= 1e4) return (n / 1e4).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "萬" + unit;
    return n.toLocaleString("en-US") + unit;
  };
  const n2 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (x) => (x >= 0 ? "+" : "-") + n2(Math.abs(x));
  const cls = (d) => (d > 0 ? "sw-up" : d < 0 ? "sw-down" : "sw-flat");
  const minuteLabel = (m) => { m = Math.round(m); return `${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const twNow = () => new Date(Date.now() + 8 * 3600e3); // 用 UTC 欄位讀台灣時間
  const marketOpen = () => {
    const t = twNow(), hm = t.getUTCHours() * 100 + t.getUTCMinutes();
    return t.getUTCDay() >= 1 && t.getUTCDay() <= 5 && hm >= 900 && hm <= 1335;
  };
  const el = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e;
  };

  /* ---------- 建立 DOM ---------- */
  const style = el("style"); style.textContent = css; document.head.appendChild(style);
  const root = el("div", { class: "sw-root" });
  const fab = el("button", { class: "sw-fab", type: "button", "aria-label": "台股大盤指數", "aria-expanded": "false", "aria-controls": "sw-panel", title: "台股大盤" },
    `<svg class="sw-i-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>
     <svg class="sw-i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`);
  const panel = el("section", { class: "sw-panel", id: "sw-panel", role: "dialog", "aria-label": "台股大盤指數" });
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sw-head"><b>台股大盤</b><span class="sw-status">載入中…</span></div>
    <div class="sw-rows"></div>
    <div class="sw-detail">
      <div class="sw-dtitle"></div>
      <canvas class="sw-chart" aria-label="分時走勢與成交金額"></canvas>
      <dl class="sw-stats"></dl>
    </div>
    <div class="sw-foot">資料來源：臺灣證券交易所・約延遲 15 秒・僅供參考</div>`;
  root.append(panel, fab);
  document.body.appendChild(root);

  const $ = (s) => panel.querySelector(s);
  const status = $(".sw-status"), rowsBox = $(".sw-rows"), chart = $(".sw-chart"), statsBox = $(".sw-stats"), dtitle = $(".sw-dtitle");
  const rows = {};
  for (const [code, name] of ORDER) {
    const b = el("button", { class: "sw-row", type: "button", "aria-pressed": "false" },
      `<span class="sw-name">${name}</span><span class="sw-price sw-mono">--</span><span class="sw-chg sw-mono"></span><canvas class="sw-spark"></canvas>`);
    b.addEventListener("click", () => select(code));
    rowsBox.appendChild(b);
    rows[code] = { btn: b, price: b.querySelector(".sw-price"), chg: b.querySelector(".sw-chg"), spark: b.querySelector(".sw-spark") };
  }
  const STAT_KEYS = [["open", "開盤"], ["high", "最高"], ["low", "最低"], ["prev", "昨收"], ["amount", "成交金額"], ["volume", "成交量"], ["trades", "筆數"], ["bid", "委買"], ["ask", "委賣"]];
  const statEls = {};
  for (const [k, label] of STAT_KEYS) {
    const d = el("div", {}, `<dt>${label}</dt><dd class="sw-mono">--</dd>`);
    statsBox.appendChild(d); statEls[k] = d.querySelector("dd");
  }

  /* ---------- 狀態 ---------- */
  let data = null, selected = "t00", hoverX = null, timer = null, inflight = false;

  function series(code) {
    const it = data && data.indices[code];
    if (!it) return [];
    const pts = it.points.slice();
    if (pts.length && it.time && marketOpen()) {  // 用即時報價補上最新一點
      const [h, m, s] = it.time.split(":").map(Number);
      const mm = Math.min(Math.max(h * 60 + m - 540 + s / 60, 0), SESSION);
      if (mm > pts[pts.length - 1][0]) pts.push([mm, it.price, 0]);
    }
    return pts;
  }

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
    for (let i = 1; i < pts.length; i++) {
      const [m0, p0] = pts[i - 1], [m1, p1] = pts[i];
      const seg = (xa, ya, xb, yb, color) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); };
      if ((p0 - prev) * (p1 - prev) < 0) {
        const r = (prev - p0) / (p1 - p0), xm = X(m0) + (X(m1) - X(m0)) * r;
        seg(X(m0), Y(p0), xm, Y(prev), col(p0 - prev));
        seg(xm, Y(prev), X(m1), Y(p1), col(p1 - prev));
      } else seg(X(m0), Y(p0), X(m1), Y(p1), col((p0 + p1) / 2 - prev));
    }
  }
  function drawSpark(cv, pts, prev) {
    const { ctx, w, h } = setupCanvas(cv);
    if (pts.length < 2) return;
    const c = colors(), [lo, hi] = yRange(pts, prev);
    const X = (m) => 1 + (m / SESSION) * (w - 2), Y = (p) => 1 + ((hi - p) / (hi - lo)) * (h - 2);
    if (prev) { ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(0, Y(prev)); ctx.lineTo(w, Y(prev)); ctx.stroke(); ctx.setLineDash([]); }
    priceLine(ctx, pts, prev, X, Y, c, 1.4);
  }
  function drawDetail() {
    const pts = series(selected), it = data && data.indices[selected];
    const prev = it ? it.prev : 0;
    const { ctx, w, h } = setupCanvas(chart), c = colors();
    const L = 2, R = 62, T = 18, B = 16, GAP = 6;
    const PH = Math.round((h - T - B - GAP) * 0.7), VH = h - T - B - GAP - PH;
    const right = w - R, vt = T + PH + GAP, vb = vt + VH;
    const X = (m) => L + (m / SESSION) * (right - L);
    ctx.font = '11px "JetBrains Mono", ui-monospace, Consolas, monospace';
    ctx.textBaseline = "middle";

    // 時間格線
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.fillStyle = c.muted;
    for (const m of [0, 60, 120, 180, 240, 270]) {
      const x = Math.round(X(m)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, vb); ctx.stroke();
      if (m === 240) continue;
      ctx.textAlign = m === 0 ? "left" : m === 270 ? "right" : "center";
      ctx.fillText(minuteLabel(m), x, vb + B / 2 + 1);
    }
    if (pts.length < 2) {
      ctx.textAlign = "center"; ctx.fillText(data ? "尚無走勢資料" : "載入中…", (L + right) / 2, T + PH / 2);
      return;
    }
    const [lo, hi] = yRange(pts, prev);
    const Y = (p) => T + ((hi - p) / (hi - lo)) * PH;
    const col = (d) => (d > 0 ? c.up : d < 0 ? c.down : c.muted);

    // 昨收線 + 右側刻度
    if (prev) { ctx.setLineDash([3, 3]); ctx.strokeStyle = c.muted; ctx.beginPath(); ctx.moveTo(L, Y(prev)); ctx.lineTo(right, Y(prev)); ctx.stroke(); ctx.setLineDash([]); }
    const hiP = Math.max(...pts.map((p) => p[1])), loP = Math.min(...pts.map((p) => p[1]));
    const placed = [];
    ctx.textAlign = "left";
    for (const p of [prev, hiP, loP]) {
      if (!p) continue;
      const y = Y(p);
      if (placed.some((py) => Math.abs(py - y) < 24)) continue;
      placed.push(y);
      const pct = prev ? ((p - prev) / prev) * 100 : 0;
      ctx.fillStyle = col(p - prev);
      ctx.fillText(fmt(p), right + 4, y - 6);
      ctx.fillText(`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`, right + 4, y + 7);
    }
    priceLine(ctx, pts, prev, X, Y, c, 1.6);

    // 每分鐘成交金額柱（98 百分位截頂，避免開盤爆量壓扁其他柱）
    const vols = pts.map((p) => p[2]).filter((v) => v > 0).sort((a, b) => a - b);
    const vmax = (vols.length ? vols[Math.min(vols.length - 1, Math.floor(vols.length * 0.98))] : 1) * 1.15;
    const bw = Math.max(1, (right - L) / SESSION - 0.3);
    let last = prev;
    for (const [m, p, v] of pts) {
      if (v > 0) { ctx.fillStyle = p >= last ? c.up : c.down; const bh = Math.min(v / vmax, 1) * VH; ctx.fillRect(X(m) - bw / 2, vb - bh, bw, bh); }
      last = p;
    }
    ctx.fillStyle = c.muted;
    ctx.fillText(`${Math.round(vmax / 100).toLocaleString()}億`, right + 4, vt + 6);
    ctx.fillText("金額/分", right + 4, vb - 6);

    // 滑鼠 / 觸控查看
    if (hoverX != null) {
      const mAt = ((hoverX - L) / (right - L)) * SESSION;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - mAt) < Math.abs(best[0] - mAt)) best = p;
      const [m, p, v] = best, x = X(m), y = Y(p), d = p - prev, pct = prev ? (d / prev) * 100 : 0;
      ctx.strokeStyle = c.muted; ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, vb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col(d); ctx.textAlign = "left";
      const vol = v > 0 ? `  ${(v / 100).toFixed(1)}億` : "";
      ctx.fillText(`${minuteLabel(m)} ${fmt(p)} ${signed(d)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)${vol}`, L, T / 2);
    }
  }

  /* ---------- 畫面更新 ---------- */
  function render() {
    if (!data) return;
    let t = "";
    for (const [code] of ORDER) {
      const it = data.indices[code], r = rows[code];
      r.btn.setAttribute("aria-pressed", String(code === selected));
      if (!it) continue;
      t = it.time || t;
      const d = it.price - it.prev, pct = it.prev ? (d / it.prev) * 100 : 0;
      r.price.textContent = fmt(it.price); r.price.className = `sw-price sw-mono ${cls(d)}`;
      r.chg.textContent = `${d > 0 ? "▲" : d < 0 ? "▼" : ""}${n2(Math.abs(d))} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      r.chg.className = `sw-chg sw-mono ${cls(d)}`;
      drawSpark(r.spark, series(code), it.prev);
    }
    status.className = "sw-status";
    status.textContent = `${marketOpen() ? "盤中" : "收盤"} · ${t}`;
    renderDetail();
  }
  function renderDetail() {
    const name = ORDER.find(([c]) => c === selected)[1];
    dtitle.textContent = `${name}指數・價量`;
    drawDetail();
    const it = data && data.indices[selected];
    if (!it) return;
    for (const k of ["open", "high", "low", "prev"]) {
      statEls[k].textContent = fmt(it[k]);
      statEls[k].className = `sw-mono ${k === "prev" ? "" : cls(it[k] - it.prev)}`;
    }
    const s = it.stats || {};
    statEls.amount.textContent = big(s.amount);
    statEls.volume.textContent = big(s.volume, "張");
    statEls.trades.textContent = big(s.trades, "筆");
    statEls.bid.textContent = big(s.bid, "張"); statEls.bid.className = "sw-mono sw-up";
    statEls.ask.textContent = big(s.ask, "張"); statEls.ask.className = "sw-mono sw-down";
  }
  function select(code) { selected = code; hoverX = null; render(); }

  /* ---------- 抓資料 ---------- */
  async function load() {
    clearTimeout(timer);
    if (panel.hidden || document.hidden) return;
    if (!API) { status.textContent = "尚未設定資料來源"; status.className = "sw-status sw-err"; return; }
    if (!inflight) {
      inflight = true;
      try {
        const r = await fetch(API, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        if (!j.indices) throw new Error("bad data");
        data = j; render();
      } catch (e) {
        status.textContent = "連線失敗，稍後重試"; status.className = "sw-status sw-err";
      } finally { inflight = false; }
    }
    timer = setTimeout(load, marketOpen() ? OPEN_MS : CLOSED_MS);
  }

  /* ---------- 互動 ---------- */
  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) { render(); drawDetail(); load(); } else clearTimeout(timer);
  }
  fab.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); fab.focus(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !panel.hidden) load(); });
  const hover = (e) => { const r = chart.getBoundingClientRect(); hoverX = e.clientX - r.left; drawDetail(); };
  chart.addEventListener("pointermove", hover);
  chart.addEventListener("pointerdown", hover);
  chart.addEventListener("pointerleave", () => { hoverX = null; drawDetail(); });
  window.addEventListener("resize", () => { if (!panel.hidden) render(); });
  // 切換深淺色時重畫
  new MutationObserver(() => { if (!panel.hidden) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!panel.hidden) render(); });
})();
