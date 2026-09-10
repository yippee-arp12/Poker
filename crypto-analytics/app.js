"use strict";
// ============================================================
//  CryptoLens — app.js
//  Data: CoinGecko public API (no key required)
// ============================================================

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

// ---- FETCH ----
async function fetchAll() {
  setRefreshing(true);
  try {
    const [coinsRes, globalRes, fgRes] = await Promise.all([
      fetch(COINS_URL),
      fetch(GLOBAL_URL),
      fetch(FG_URL)
    ]);
    if (!coinsRes.ok) throw new Error("CoinGecko rate limit — retrying in 60s");
    const coins  = await coinsRes.json();
    const global = await globalRes.json();
    const fg     = await fgRes.json();
    allCoins = coins;
    renderGlobal(global.data);
    renderStatCards(global.data, fg.data[0]);
    renderCharts(coins);
    renderTable();
    const now = new Date();
    const t = now.toLocaleTimeString();
    document.getElementById("lastUpdate").textContent = "Updated " + t;
    document.getElementById("footerUpdate").textContent = "Last refresh: " + t;
    document.getElementById("refreshDot").style.background = "var(--green)";
  } catch(e) {
    document.getElementById("lastUpdate").textContent = e.message || "Error fetching";
    document.getElementById("refreshDot").style.background = "var(--red)";
    if (allCoins.length === 0) {
      document.getElementById("tableBody").innerHTML = `<tr class="error-row"><td colspan="8">⚠ ${e.message || "Failed to load data. CoinGecko may be rate-limiting. Retrying..."}</td></tr>`;
    }
    showToast("Rate limited — retrying in 60s");
  }
  setRefreshing(false);
}

function setRefreshing(v) {
  const btn = document.getElementById("refreshBtn");
  btn.classList.toggle("spinning", v);
}

// ---- GLOBAL STATS ----
function renderGlobal(g) {
  const el = document.getElementById("globalStats");
  const coins = g.active_cryptocurrencies?.toLocaleString() || "—";
  const markets = g.markets?.toLocaleString() || "—";
  el.innerHTML = `
    <div class="g-stat">Active Coins: <span>${coins}</span></div>
    <div class="g-stat">Markets: <span>${markets}</span></div>
  `;
}

// ---- STAT CARDS ----
function renderStatCards(g, fg) {
  const mcap = g.total_market_cap?.usd;
  const vol  = g.total_volume?.usd;
  const mcapChange = g.market_cap_change_percentage_24h_usd;
  const btcD = g.market_cap_percentage?.btc;
  const ethD = g.market_cap_percentage?.eth;

  document.getElementById("totalMcap").textContent = fmtLarge(mcap);
  const mcapChangeEl = document.getElementById("totalMcapChange");
  mcapChangeEl.textContent = (mcapChange >= 0 ? "▲ " : "▼ ") + Math.abs(mcapChange).toFixed(2) + "% (24h)";
  mcapChangeEl.className = "sc-change " + (mcapChange >= 0 ? "pos" : "neg");

  document.getElementById("totalVol").textContent = fmtLarge(vol);

  document.getElementById("btcDom").textContent = btcD?.toFixed(1) + "%";
  document.getElementById("ethDom").textContent = ethD?.toFixed(1) + "%";
  document.getElementById("btcBar").style.width  = btcD + "%";
  document.getElementById("ethBar").style.width  = ethD + "%";

  if (fg) {
    const fgVal = parseInt(fg.value);
    const fgColors = { "Extreme Fear":"#ef4444","Fear":"#f97316","Neutral":"#eab308","Greed":"#22c55e","Extreme Greed":"#16a34a" };
    const fgEl = document.getElementById("fgValue");
    fgEl.textContent = fgVal;
    fgEl.style.color = fgColors[fg.value_classification] || "var(--text)";
    const fgLbl = document.getElementById("fgLabel");
    fgLbl.textContent = fg.value_classification;
    fgLbl.className = "sc-change " + (fgVal >= 50 ? "pos" : fgVal >= 25 ? "neu" : "neg");
  }
}

// ---- CHARTS ----
function renderCharts(coins) {
  // Dominance doughnut
  const top10 = coins.slice(0, 10);
  const dCtx = document.getElementById("dominanceChart").getContext("2d");
  if (charts.dominance) charts.dominance.destroy();
  charts.dominance = new Chart(dCtx, {
    type: "doughnut",
    data: {
      labels: top10.map(c => c.symbol.toUpperCase()),
      datasets: [{
        data: top10.map(c => c.market_cap),
        backgroundColor: ["#f7931a","#627eea","#26a17b","#e84142","#0033ad","#345d9d","#2775ca","#16213e","#e6007a","#00adef"],
        borderWidth: 2,
        borderColor: "#07080a"
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { color: "#8a8f9a", font: { size: 11, family: "JetBrains Mono" }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtLarge(ctx.raw)} (${((ctx.raw / top10.reduce((a,c)=>a+c.market_cap,0))*100).toFixed(1)}%)` } }
      },
      cutout: "65%"
    }
  });

  // Gainers bar
  const gainers = [...coins].sort((a,b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 8);
  const gCtx = document.getElementById("gainersChart").getContext("2d");
  if (charts.gainers) charts.gainers.destroy();
  charts.gainers = new Chart(gCtx, {
    type: "bar",
    data: {
      labels: gainers.map(c => c.symbol.toUpperCase()),
      datasets: [{ data: gainers.map(c => c.price_change_percentage_24h.toFixed(2)), backgroundColor: "rgba(34,197,94,0.7)", borderRadius: 5, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` +${ctx.raw}%` } } },
      scales: {
        x: { ticks: { color: "#4a4f5a", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#8a8f9a", font: { size: 11, family: "JetBrains Mono" } }, grid: { display: false } }
      }
    }
  });

  // Losers bar
  const losers = [...coins].sort((a,b) => a.price_change_percentage_24h - b.price_change_percentage_24h).slice(0, 8);
  const lCtx = document.getElementById("losersChart").getContext("2d");
  if (charts.losers) charts.losers.destroy();
  charts.losers = new Chart(lCtx, {
    type: "bar",
    data: {
      labels: losers.map(c => c.symbol.toUpperCase()),
      datasets: [{ data: losers.map(c => c.price_change_percentage_24h.toFixed(2)), backgroundColor: "rgba(239,68,68,0.7)", borderRadius: 5, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}%` } } },
      scales: {
        x: { ticks: { color: "#4a4f5a", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#8a8f9a", font: { size: 11, family: "JetBrains Mono" } }, grid: { display: false } }
      }
    }
  });
}

// ---- TABLE ----
function renderTable() {
  let coins = [...allCoins];
  if (searchQuery) coins = coins.filter(c => c.name.toLowerCase().includes(searchQuery) || c.symbol.toLowerCase().includes(searchQuery));
  if (activeFilter === "gainers") coins = coins.filter(c => c.price_change_percentage_24h > 0);
  else if (activeFilter === "losers") coins = coins.filter(c => c.price_change_percentage_24h < 0);
  else if (activeFilter === "volume") coins = [...coins].sort((a,b) => b.total_volume - a.total_volume).slice(0,20);
  coins.sort((a,b) => {
    const map = { rank: [a.market_cap_rank, b.market_cap_rank], price: [a.current_price, b.current_price], change: [a.price_change_percentage_24h, b.price_change_percentage_24h], mcap: [a.market_cap, b.market_cap], volume: [a.total_volume, b.total_volume] };
    const [va, vb] = map[sortState.key] || [a.market_cap_rank, b.market_cap_rank];
    return sortState.dir * (va - vb);
  });

  const tbody = document.getElementById("tableBody");
  if (!coins.length) { tbody.innerHTML = `<tr><td colspan="8" class="loading-row">No results found</td></tr>`; return; }

  tbody.innerHTML = coins.map(c => {
    const chg = c.price_change_percentage_24h || 0;
    const chgCls = chg >= 0 ? "pos" : "neg";
    const chgStr = (chg >= 0 ? "▲ +" : "▼ ") + Math.abs(chg).toFixed(2) + "%";
    const athPct = c.ath > 0 ? ((c.current_price - c.ath) / c.ath * 100).toFixed(1) : null;
    const sparkId = "sp-" + c.id;
    return `<tr>
      <td><span class="rank-val">${c.market_cap_rank}</span></td>
      <td><div class="coin-cell">
        <img class="coin-img" src="${c.image}" alt="${c.name}" loading="lazy"/>
        <div><div class="coin-name">${c.name}</div><div class="coin-sym">${c.symbol.toUpperCase()}</div></div>
      </div></td>
      <td><span class="price-val">${fmtPrice(c.current_price)}</span></td>
      <td><span class="change-val ${chgCls}">${chgStr}</span></td>
      <td><span class="mcap-val">${fmtLarge(c.market_cap)}</span></td>
      <td><span class="vol-val">${fmtLarge(c.total_volume)}</span></td>
      <td class="sparkline-cell"><canvas id="${sparkId}" width="90" height="36"></canvas></td>
      <td><div class="ath-val">${fmtPrice(c.ath)}</div>${athPct ? `<div class="ath-pct">${athPct}%</div>` : ""}</td>
    </tr>`;
  }).join("");

  // Draw sparklines
  coins.forEach(c => {
    const sp = c.sparkline_in_7d?.price;
    if (!sp || !sp.length) return;
    const canvas = document.getElementById("sp-" + c.id);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const min = Math.min(...sp), max = Math.max(...sp);
    const w = 90, h = 36, pad = 2;
    ctx.clearRect(0,0,w,h);
    const pts = sp.map((v,i) => ({ x: pad + (i/(sp.length-1))*(w-pad*2), y: pad + (1-(v-min)/(max-min||1))*(h-pad*2) }));
    const isUp = sp[sp.length-1] >= sp[0];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = isUp ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // fill
    ctx.lineTo(pts[pts.length-1].x, h); ctx.lineTo(pts[0].x, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, isUp ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad; ctx.fill();
  });
}

// ---- FORMAT HELPERS ----
function fmtLarge(n) {
  if (!n) return "—";
  if (n >= 1e12) return "$" + (n/1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n/1e9).toFixed(2) + "B";
  if (n >= 1e6)  return "$" + (n/1e6).toFixed(2) + "M";
  return "$" + n.toLocaleString();
}
function fmtPrice(n) {
  if (!n) return "—";
  if (n >= 1000) return "$" + n.toLocaleString("en-US", {maximumFractionDigits:2});
  if (n >= 1)    return "$" + n.toFixed(4);
  return "$" + n.toFixed(8);
}

// ---- TOAST ----
let toastT;
function showToast(msg) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 3000);
}

// ---- EVENTS ----
document.getElementById("refreshBtn").addEventListener("click", () => { clearTimeout(refreshTimer); fetchAll(); refreshTimer = setInterval(fetchAll, REFRESH_INTERVAL); });

document.getElementById("searchInput").addEventListener("input", e => { searchQuery = e.target.value.toLowerCase().trim(); renderTable(); });

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderTable();
  });
});

document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortState.key === key) sortState.dir *= -1;
    else { sortState.key = key; sortState.dir = key === "rank" ? 1 : -1; }
    document.querySelectorAll("th.sortable").forEach(t => t.classList.remove("sort-active"));
    th.classList.add("sort-active");
    renderTable();
  });
});

// ---- INIT ----
fetchAll();
refreshTimer = setInterval(fetchAll, REFRESH_INTERVAL);
