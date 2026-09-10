"use strict";
// CryptoLens — Live crypto analytics
// Data sources: CoinGecko + Alternative.me public APIs

const API = "https://api.coingecko.com/api/v3";
const COINS_URL = `${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h`;
const GLOBAL_URL = `${API}/global`;
const FG_URL = "https://api.alternative.me/fng/?limit=1";
const REFRESH_INTERVAL = 60000;

let allCoins = [];
let charts = {};
let sortState = { key: "rank", dir: 1 };
let activeFilter = "all";
let searchQuery = "";
let refreshTimer;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 429) throw new Error("API rate limit reached — retrying in 60s");
    throw new Error(`API request failed (${res.status})`);
  }
  return res.json();
}

async function fetchAll() {
  setRefreshing(true);
  try {
    const results = await Promise.allSettled([
      fetchJson(COINS_URL),
      fetchJson(GLOBAL_URL),
      fetchJson(FG_URL)
    ]);

    const coinsResult = results[0];
    if (coinsResult.status !== "fulfilled") throw coinsResult.reason;

    const coins = Array.isArray(coinsResult.value) ? coinsResult.value : [];
    if (!coins.length) throw new Error("No market data returned");

    allCoins = coins;
    const global = results[1].status === "fulfilled" ? results[1].value?.data : null;
    const fg = results[2].status === "fulfilled" ? results[2].value?.data?.[0] : null;

    if (global) {
      renderGlobal(global);
      renderStatCards(global, fg);
    } else {
      document.getElementById("globalStats").textContent = "Global stats unavailable";
    }

    renderCharts(coins);
    renderTable();
    const t = new Date().toLocaleTimeString();
    document.getElementById("lastUpdate").textContent = "Updated " + t;
    document.getElementById("footerUpdate").textContent = "Last refresh: " + t;
    document.getElementById("refreshDot").style.background = "var(--green)";
  } catch (e) {
    document.getElementById("lastUpdate").textContent = e.message || "Error fetching data";
    document.getElementById("refreshDot").style.background = "var(--red)";
    if (!allCoins.length) {
      document.getElementById("tableBody").innerHTML = `<tr class="error-row"><td colspan="8">⚠ ${escapeHtml(e.message || "Failed to load market data")}</td></tr>`;
    }
    showToast(e.message || "Failed to load data");
  } finally {
    setRefreshing(false);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function setRefreshing(v) {
  document.getElementById("refreshBtn").classList.toggle("spinning", v);
}

function renderGlobal(g) {
  document.getElementById("globalStats").innerHTML = `
    <div class="g-stat">Active Coins: <span>${(g.active_cryptocurrencies ?? "—").toLocaleString?.() ?? "—"}</span></div>
    <div class="g-stat">Markets: <span>${(g.markets ?? "—").toLocaleString?.() ?? "—"}</span></div>`;
}

function renderStatCards(g, fg) {
  const mcap = g.total_market_cap?.usd;
  const vol = g.total_volume?.usd;
  const mcapChange = Number(g.market_cap_change_percentage_24h_usd) || 0;
  const btcD = Number(g.market_cap_percentage?.btc) || 0;
  const ethD = Number(g.market_cap_percentage?.eth) || 0;

  document.getElementById("totalMcap").textContent = fmtLarge(mcap);
  const mcapChangeEl = document.getElementById("totalMcapChange");
  mcapChangeEl.textContent = (mcapChange >= 0 ? "▲ " : "▼ ") + Math.abs(mcapChange).toFixed(2) + "% (24h)";
  mcapChangeEl.className = "sc-change " + (mcapChange >= 0 ? "pos" : "neg");
  document.getElementById("totalVol").textContent = fmtLarge(vol);
  document.getElementById("btcDom").textContent = btcD.toFixed(1) + "%";
  document.getElementById("ethDom").textContent = ethD.toFixed(1) + "%";
  document.getElementById("btcBar").style.width = Math.min(100, btcD) + "%";
  document.getElementById("ethBar").style.width = Math.min(100, ethD) + "%";

  if (fg) {
    const fgVal = Number(fg.value);
    const fgColors = { "Extreme Fear": "#ef4444", Fear: "#f97316", Neutral: "#eab308", Greed: "#22c55e", "Extreme Greed": "#16a34a" };
    const fgEl = document.getElementById("fgValue");
    fgEl.textContent = Number.isFinite(fgVal) ? fgVal : "—";
    fgEl.style.color = fgColors[fg.value_classification] || "var(--text)";
    const fgLbl = document.getElementById("fgLabel");
    fgLbl.textContent = fg.value_classification || "—";
    fgLbl.className = "sc-change " + (fgVal >= 50 ? "pos" : fgVal >= 25 ? "neu" : "neg");
  }
}

function validChange(c) { return Number.isFinite(Number(c.price_change_percentage_24h)) ? Number(c.price_change_percentage_24h) : 0; }

function renderCharts(coins) {
  const top10 = coins.slice(0, 10);
  const dCtx = document.getElementById("dominanceChart").getContext("2d");
  if (charts.dominance) charts.dominance.destroy();
  charts.dominance = new Chart(dCtx, {
    type: "doughnut",
    data: { labels: top10.map(c => c.symbol.toUpperCase()), datasets: [{ data: top10.map(c => c.market_cap || 0), backgroundColor: ["#f7931a","#627eea","#26a17b","#e84142","#0033ad","#345d9d","#2775ca","#16213e","#e6007a","#00adef"], borderWidth: 2, borderColor: "#07080a" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#8a8f9a", font: { size: 11, family: "JetBrains Mono" }, padding: 10, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtLarge(ctx.raw)}` } } }, cutout: "65%" }
  });

  const gainers = [...coins].sort((a, b) => validChange(b) - validChange(a)).slice(0, 8);
  const losers = [...coins].sort((a, b) => validChange(a) - validChange(b)).slice(0, 8);
  renderBarChart("gainersChart", "gainers", gainers, true);
  renderBarChart("losersChart", "losers", losers, false);
}

function renderBarChart(id, key, coins, positive) {
  const ctx = document.getElementById(id).getContext("2d");
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart(ctx, {
    type: "bar",
    data: { labels: coins.map(c => c.symbol.toUpperCase()), datasets: [{ data: coins.map(validChange), backgroundColor: positive ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)", borderRadius: 5, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}%` } } }, scales: { x: { ticks: { color: "#4a4f5a", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } }, y: { ticks: { color: "#8a8f9a", font: { size: 11, family: "JetBrains Mono" } }, grid: { display: false } } } }
  });
}

function renderTable() {
  let coins = [...allCoins];
  if (searchQuery) coins = coins.filter(c => c.name.toLowerCase().includes(searchQuery) || c.symbol.toLowerCase().includes(searchQuery));
  if (activeFilter === "gainers") coins = coins.filter(c => validChange(c) > 0);
  else if (activeFilter === "losers") coins = coins.filter(c => validChange(c) < 0);
  else if (activeFilter === "volume") coins = [...coins].sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0)).slice(0, 20);

  coins.sort((a, b) => {
    const map = { rank: [a.market_cap_rank || Infinity, b.market_cap_rank || Infinity], price: [a.current_price || 0, b.current_price || 0], change: [validChange(a), validChange(b)], mcap: [a.market_cap || 0, b.market_cap || 0], volume: [a.total_volume || 0, b.total_volume || 0] };
    const [va, vb] = map[sortState.key] || map.rank;
    return sortState.dir * (va - vb);
  });

  const tbody = document.getElementById("tableBody");
  if (!coins.length) { tbody.innerHTML = `<tr><td colspan="8" class="loading-row">No results found</td></tr>`; return; }

  tbody.innerHTML = coins.map(c => {
    const chg = validChange(c);
    const chgCls = chg >= 0 ? "pos" : "neg";
    const chgStr = (chg >= 0 ? "▲ +" : "▼ ") + Math.abs(chg).toFixed(2) + "%";
    const athPct = c.ath > 0 ? ((c.current_price - c.ath) / c.ath * 100).toFixed(1) : null;
    const sparkId = "sp-" + c.id;
    return `<tr><td><span class="rank-val">${c.market_cap_rank ?? "—"}</span></td><td><div class="coin-cell"><img class="coin-img" src="${escapeHtml(c.image || "")}" alt="${escapeHtml(c.name || "Coin")}" loading="lazy"/><div><div class="coin-name">${escapeHtml(c.name || "Unknown")}</div><div class="coin-sym">${escapeHtml((c.symbol || "").toUpperCase())}</div></div></div></td><td><span class="price-val">${fmtPrice(c.current_price)}</span></td><td><span class="change-val ${chgCls}">${chgStr}</span></td><td><span class="mcap-val">${fmtLarge(c.market_cap)}</span></td><td><span class="vol-val">${fmtLarge(c.total_volume)}</span></td><td class="sparkline-cell"><canvas id="${sparkId}" width="90" height="36"></canvas></td><td><div class="ath-val">${fmtPrice(c.ath)}</div>${athPct ? `<div class="ath-pct">${athPct}%</div>` : ""}</td></tr>`;
  }).join("");

  coins.forEach(c => drawSparkline(c));
}

function drawSparkline(c) {
  const sp = c.sparkline_in_7d?.price;
  if (!Array.isArray(sp) || !sp.length) return;
  const canvas = document.getElementById("sp-" + c.id);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const min = Math.min(...sp), max = Math.max(...sp), w = 90, h = 36, pad = 2;
  ctx.clearRect(0, 0, w, h);
  const pts = sp.map((v, i) => ({ x: pad + (i / Math.max(1, sp.length - 1)) * (w - pad * 2), y: pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2) }));
  const isUp = sp[sp.length - 1] >= sp[0];
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = isUp ? "#22c55e" : "#ef4444"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(pts.at(-1).x, h); ctx.lineTo(pts[0].x, h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, isUp ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"); grad.addColorStop(1, "transparent"); ctx.fillStyle = grad; ctx.fill();
}

function fmtLarge(n) {
  if (!Number.isFinite(Number(n)) || Number(n) <= 0) return "—";
  n = Number(n);
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  return "$" + n.toLocaleString();
}
function fmtPrice(n) {
  if (!Number.isFinite(Number(n)) || Number(n) <= 0) return "—";
  n = Number(n);
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(8);
}

let toastT;
function showToast(msg) { const t = document.getElementById("toast"); document.getElementById("toastMsg").textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3000); }

document.getElementById("refreshBtn").addEventListener("click", () => { clearInterval(refreshTimer); fetchAll(); refreshTimer = setInterval(fetchAll, REFRESH_INTERVAL); });
document.getElementById("searchInput").addEventListener("input", e => { searchQuery = e.target.value.toLowerCase().trim(); renderTable(); });
document.querySelectorAll(".filter-btn").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); activeFilter = btn.dataset.filter; renderTable(); }));
document.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => { const key = th.dataset.sort; if (sortState.key === key) sortState.dir *= -1; else { sortState.key = key; sortState.dir = key === "rank" ? 1 : -1; } document.querySelectorAll("th.sortable").forEach(t => t.classList.remove("sort-active")); th.classList.add("sort-active"); renderTable(); }));

fetchAll();
refreshTimer = setInterval(fetchAll, REFRESH_INTERVAL);