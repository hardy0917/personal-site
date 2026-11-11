// Cloudflare Worker：台股大盤資料中繼站（給 GitHub Pages 的浮動看盤小工具用）
// 證交所 MIS API 沒開 CORS，瀏覽器不能直接抓，所以由這裡代抓、整理後回傳。
// 只開一個路徑：GET /indices → 加權、櫃買的即時報價 + 當日分時走勢 + 統計

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

async function getJSON(path, ttl) {
  const r = await fetch(MIS + path, {
    headers: UPSTREAM_HEADERS,
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return JSON.parse(await r.text()); // 走勢 API 的 content-type 是 text/html
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// epoch ms → 距離台灣時間 09:00 的分鐘數
function sessionMinute(ms) {
  const secOfDay = ((ms / 1000 + 8 * 3600) % 86400 + 86400) % 86400;
  return Math.min(Math.max(secOfDay / 60 - 540, 0), SESSION_MIN);
}

function parseChart(d) {
  const points = (d.ohlcArray || [])
    .filter((it) => it.t && it.c)
    .map((it) => [
      Math.round(sessionMinute(+it.t) * 100) / 100,
      num(it.c),
      num(it.s), // 該分鐘成交金額（百萬元）
    ]);
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

async function buildIndices() {
  const [q, tse, otc] = await Promise.all([
    getJSON("getStockInfo.jsp?ex_ch=tse_t00.tw%7Cotc_o00.tw&json=1&delay=0", 4),
    getJSON("getChartOhlcStatis.jsp?ex=tse&ch=t00.tw&fqy=1", 10),
    getJSON("getChartOhlcStatis.jsp?ex=otc&ch=o00.tw&fqy=1", 10),
  ]);
  const charts = { t00: parseChart(tse), o00: parseChart(otc) };
  const indices = {};
  for (const it of q.msgArray || []) {
    const prev = num(it.y);
    const price = num(it.z) || prev; // 開盤前 z 可能是 "-"
    indices[it.c] = {
      price, prev,
      open: num(it.o), high: num(it.h), low: num(it.l),
      time: it.t || "",
      date: it.d || "",
      ...(charts[it.c] || { points: [], stats: {} }),
    };
  }
  return { indices, fetchedAt: Date.now() };
}

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
    if (request.method !== "GET" || url.pathname !== "/indices") {
      return new Response("Not found", { status: 404, headers: cors });
    }
    try {
      return Response.json(await buildIndices(), {
        headers: { ...cors, "Cache-Control": "public, max-age=4" },
      });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502, headers: cors });
    }
  },
};
