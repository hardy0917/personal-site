// Cloudflare Worker：台股資料中繼站（給 GitHub Pages 的浮動看盤小工具用）
// 證交所 MIS API 沒開 CORS，瀏覽器不能直接抓，所以由這裡代抓、整理後回傳。
//   GET /indices                      加權、櫃買：即時報價 + 當日分時走勢 + 統計（證交所）
//   GET /stocks?codes=2330,6488       個股即時報價（證交所，上市 / 上櫃自動判斷）
//   GET /stocks?codes=...&chart=1     另附當日 1 分鐘走勢與量（Yahoo Finance）
//   GET /search?q=台積                依代號或名稱搜尋（證交所）

const ALLOWED_ORIGINS = [
  "https://hardy0917.github.io",
  "http://localhost",
  "http://127.0.0.1",
];

const MIS = "https://mis.twse.com.tw/stock/api/";
const UPSTREAM_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Referer": "https://mis.twse.com.tw/stock/index.jsp",
};
const SESSION_MIN = 270; // 09:00 ~ 13:30
const CODE_RE = /^[0-9]{4,6}[A-Z]?$/;
const MAX_CODES = 20;

async function getJSON(url, ttl, headers = UPSTREAM_HEADERS) {
  const r = await fetch(url.startsWith("http") ? url : MIS + url, {
    headers,
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return JSON.parse(await r.text()); // MIS 走勢 API 的 content-type 是 text/html
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const firstNum = (s) => num(String(s || "").split("_")[0]);

// epoch ms → 距離台灣時間 09:00 的分鐘數
function sessionMinute(ms) {
  const secOfDay = ((ms / 1000 + 8 * 3600) % 86400 + 86400) % 86400;
  return Math.min(Math.max(secOfDay / 60 - 540, 0), SESSION_MIN);
}
const r2 = (x) => Math.round(x * 100) / 100;

/* ---------------- 大盤 ---------------- */
function parseIndexChart(d) {
  const points = (d.ohlcArray || [])
    .filter((it) => it.t && it.c)
    .map((it) => [r2(sessionMinute(+it.t)), num(it.c), num(it.s)]); // s = 該分鐘成交金額（百萬元）
  const so = d.staticObj || {};
  return {
    points,
    stats: {
      amount: num(so.tz), // 成交金額（元）
      volume: num(so.tv), // 成交量（張）
      trades: num(so.tr), // 成交筆數
      bid: num(so.t4), // 累積委買（張）
      ask: num(so.t3), // 累積委賣（張）
    },
  };
}

async function indices() {
  const [q, tse, otc] = await Promise.all([
    getJSON("getStockInfo.jsp?ex_ch=tse_t00.tw%7Cotc_o00.tw&json=1&delay=0", 4),
    getJSON("getChartOhlcStatis.jsp?ex=tse&ch=t00.tw&fqy=1", 10),
    getJSON("getChartOhlcStatis.jsp?ex=otc&ch=o00.tw&fqy=1", 10),
  ]);
  const charts = { t00: parseIndexChart(tse), o00: parseIndexChart(otc) };
  const out = {};
  for (const it of q.msgArray || []) {
    const prev = num(it.y);
    out[it.c] = {
      price: num(it.z) || prev, // 開盤前 z 可能是 "-"
      prev,
      open: num(it.o), high: num(it.h), low: num(it.l),
      time: it.t || "", date: it.d || "",
      ...(charts[it.c] || { points: [], stats: {} }),
    };
  }
  return { indices: out, fetchedAt: Date.now() };
}

/* ---------------- 個股 ---------------- */
async function yahooChart(code, ex) {
  const sym = `${code}.${ex === "otc" ? "TWO" : "TW"}`;
  const d = await getJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`,
    30,
    { "User-Agent": "Mozilla/5.0" },
  );
  const res = d.chart && d.chart.result && d.chart.result[0];
  if (!res) return [];
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close && q.close[i];
    if (c == null) continue;
    // [分鐘, 收盤價, 該分鐘成交量（張）]
    pts.push([r2(sessionMinute(ts[i] * 1000)), r2(c), Math.round(((q.volume && q.volume[i]) || 0) / 100) / 10]);
  }
  return pts;
}

async function stocks(params) {
  const codes = [...new Set(
    (params.get("codes") || "").toUpperCase().split(",").map((s) => s.trim()).filter((c) => CODE_RE.test(c)),
  )].slice(0, MAX_CODES);
  if (!codes.length) return { stocks: {} };

  // 不知道是上市還是上櫃，兩邊都查，查不到的會回傳空項目
  const exCh = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join("|");
  const q = await getJSON(`getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`, 4);
  const out = {};
  for (const it of q.msgArray || []) {
    if (!it.c || !it.ex) continue;
    const prev = num(it.y);
    out[it.c] = {
      name: it.n || it.c,
      ex: it.ex, // tse 上市 / otc 上櫃
      // 盤中某些快照沒有成交（z 為 "-"），依序退回最近成交價、最佳買價、昨收
      price: num(it.z) || num(it.pz) || firstNum(it.b) || prev,
      prev,
      open: num(it.o), high: num(it.h), low: num(it.l),
      volume: num(it.v), // 累積成交量（張）
      limitUp: num(it.u), limitDown: num(it.w),
      time: it.t || "",
    };
  }
  if (params.get("chart") === "1") {
    await Promise.all(Object.entries(out).map(async ([code, s]) => {
      try { s.points = await yahooChart(code, s.ex); } catch { s.points = null; }
    }));
  }
  return { stocks: out, fetchedAt: Date.now() };
}

async function search(params) {
  const q = (params.get("q") || "").trim().slice(0, 20);
  if (!q) return { results: [] };
  const d = await getJSON(`getStockNames.jsp?n=${encodeURIComponent(q)}`, 3600);
  // 排序：代號或名稱完全符合 → 開頭符合（名稱短的優先）→ 其他，同組依代號
  const rank = (x) => (x.c === q || x.n === q ? 0 : x.c.startsWith(q) || x.n.startsWith(q) ? 1 : 2);
  const results = (d.datas || [])
    .filter((x) => /^\d{4}$|^00\d{2,4}[A-Z]?$/.test(x.c)) // 只留股票與 ETF，排除權證
    .sort((a, b) => rank(a) - rank(b) || a.n.length - b.n.length || a.c.localeCompare(b.c))
    .slice(0, 8)
    .map((x) => ({ code: x.c, name: x.n, ex: String(x.key || "").split("_")[0] }));
  return { results };
}

/* ---------------- 路由 ---------------- */
const ROUTES = {
  "/indices": { handler: () => indices(), maxAge: 4 },
  "/stocks": { handler: (p) => stocks(p), maxAge: 4 },
  "/search": { handler: (p) => search(p), maxAge: 3600 },
};

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.some((a) => origin === a || origin.startsWith(a + ":"));
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (request.method !== "GET" || !route) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    try {
      return Response.json(await route.handler(url.searchParams), {
        headers: { ...cors, "Cache-Control": `public, max-age=${route.maxAge}` },
      });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502, headers: cors });
    }
  },
};
