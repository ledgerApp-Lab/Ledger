/* ---------------- theme (shared across all pages) ---------------- */
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = t === 'dark' ? '🌙' : '☀️');
  try{ localStorage.setItem('ledger-theme', t); }catch(e){}
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
}
(function initTheme(){
  let saved = 'light';
  try{ saved = localStorage.getItem('ledger-theme') || 'light'; }catch(e){}
  applyTheme(saved);
})();

/* ---------------- scroll reveal (marketing pages) ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  },{threshold:0.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
});

/* ---------------- landing page live preview ticker ---------------- */
async function loadPreview(){
  try{
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether&vs_currencies=usd&include_24hr_change=true');
    const d = await res.json();
    const map = {btc:'bitcoin',eth:'ethereum',sol:'solana',usdt:'tether'};
    Object.entries(map).forEach(([key,id]) => {
      const el = document.getElementById('preview-'+key);
      const priceEl = document.getElementById('preview-'+key+'-price');
      if(!el || !d[id]) return;
      const chg = d[id].usd_24h_change || 0;
      el.textContent = (chg>=0?'+':'') + chg.toFixed(2) + '%';
      el.className = 'hv-chg ' + (chg>=0?'up':'down');
      priceEl.textContent = '$' + d[id].usd.toLocaleString(undefined,{maximumFractionDigits:d[id].usd<1?4:0});
    });
  }catch(err){}
}

/* ---------------- dashboard logic ---------------- */
const PLAN_LIMITS = { basic: 3, pro: 15, premium: Infinity };
const PLAN_LABELS = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };
let currentPlan = 'basic';
let currentUserId = null;
let holdings = [];
let prices = {};
let sessionHistory = [];
let chart = null;
let coinList = [];

async function initDashboard(session){
  currentPlan = session.plan;
  currentUserId = session.userId;
  document.getElementById('who-label').textContent = session.label;
  document.getElementById('plan-pill').textContent = PLAN_LABELS[currentPlan];
  const limit = PLAN_LIMITS[currentPlan];
  document.getElementById('limit-note').innerHTML = limit === Infinity
    ? `Premium plan — unlimited holdings.`
    : `${PLAN_LABELS[currentPlan]} plan — up to ${limit} holdings. <a href="index.html#pricing">Upgrade</a>`;
  document.getElementById('csv-lock').style.display = currentPlan === 'basic' ? 'block' : 'none';
  document.getElementById('csv-panel').style.display = currentPlan === 'basic' ? 'none' : 'block';

  holdings = await fetchHoldingsFromDb(currentUserId);
  renderHoldings(); renderMetrics();
  loadCoinList();
  fetchPrices();
  setInterval(fetchPrices, 30000);
}

async function logout(){ await signOutUser(); window.location.href = 'index.html'; }

async function loadCoinList(){
  try{
    const res = await fetch('https://api.coingecko.com/api/v3/coins/list');
    if(!res.ok) throw new Error('failed');
    coinList = await res.json();
    const dl = document.getElementById('asset-list');
    dl.innerHTML = coinList.slice(0, 800).map(c => `<option value="${c.name} (${c.symbol.toUpperCase()})" data-id="${c.id}"></option>`).join('');
  }catch(err){}
}
function resolveAssetInput(text){
  text = text.trim().toLowerCase();
  if(!text) return null;
  const bySymbolMatch = text.match(/\(([a-z0-9]+)\)$/i);
  if(bySymbolMatch){
    const namePart = text.split('(')[0].trim();
    const found = coinList.find(c => c.name.toLowerCase() === namePart);
    if(found) return found;
  }
  return coinList.find(c => c.id === text || c.symbol.toLowerCase() === text || c.name.toLowerCase() === text) || null;
}

async function fetchPrices(){
  const ids = holdings.map(h => h.id);
  if(ids.length === 0){ renderHoldings(); renderMetrics(); return; }
  try{
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    if(!res.ok) throw new Error('fetch failed');
    prices = await res.json();
    renderHoldings(); renderMetrics(); pushHistory();
  }catch(err){ const note = document.getElementById('chart-note'); if(note) note.textContent = 'Live price feed unavailable right now — retrying shortly.'; }
}

async function addHolding(){
  const searchInput = document.getElementById('add-search');
  const amtInput = document.getElementById('add-amount');
  const limitHit = document.getElementById('limit-hit');
  const limit = PLAN_LIMITS[currentPlan];
  if(holdings.length >= limit){ limitHit.classList.add('show'); return; }
  limitHit.classList.remove('show');
  const match = resolveAssetInput(searchInput.value);
  if(!match){ searchInput.style.borderColor = 'var(--loss)'; return; }
  searchInput.style.borderColor = '';
  const amt = parseFloat(amtInput.value);
  if(!amt || amt <= 0){ amtInput.style.borderColor = 'var(--loss)'; return; }
  amtInput.style.borderColor = '';

  const existing = holdings.find(h => h.id === match.id);
  if(existing){
    const newAmount = existing.amount + amt;
    existing.amount = newAmount;
    if(existing.dbId) await updateHoldingAmountInDb(existing.dbId, newAmount);
  } else {
    const holding = {id: match.id, sym: match.symbol.toUpperCase(), name: match.name, amount: amt};
    const dbId = await saveHoldingToDb(currentUserId, holding);
    holding.dbId = dbId;
    holdings.push(holding);
  }
  searchInput.value = ''; amtInput.value = '';
  fetchPrices();
}
async function removeHolding(id){
  const target = holdings.find(h => h.id === id);
  holdings = holdings.filter(h => h.id !== id);
  document.getElementById('limit-hit').classList.remove('show');
  renderHoldings(); renderMetrics();
  if(target && target.dbId) await deleteHoldingFromDb(target.dbId);
}
function renderHoldings(){
  const body = document.getElementById('holdings-body');
  const emptyNote = document.getElementById('empty-note');
  const limit = PLAN_LIMITS[currentPlan];
  document.getElementById('m-count-sub').textContent = limit === Infinity ? 'unlimited' : `of ${limit} slots used`;
  if(holdings.length === 0){ body.innerHTML=''; emptyNote.style.display='block'; return; }
  emptyNote.style.display = 'none';
  body.innerHTML = holdings.map(h => {
    const p = prices[h.id];
    const price = p ? p.usd : 0;
    const chg = p ? (p.usd_24h_change || 0) : 0;
    const value = price * h.amount;
    const chgClass = chg >= 0 ? 'up' : 'down';
    const chgSign = chg >= 0 ? '+' : '';
    return `<tr>
      <td><div class="asset-name"><span class="asset-dot"></span><div><div>${h.sym}</div><div class="asset-sym">${h.name}</div></div></div></td>
      <td class="mono">${h.amount.toLocaleString(undefined,{maximumFractionDigits:6})}</td>
      <td class="mono">$${price.toLocaleString(undefined,{maximumFractionDigits:price<1?6:2})}</td>
      <td><span class="chg-pill ${chgClass}">${chgSign}${chg.toFixed(2)}%</span></td>
      <td class="mono">$${value.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
      <td><button class="remove-btn" onclick="removeHolding('${h.id}')" aria-label="Remove ${h.sym}">×</button></td>
    </tr>`;
  }).join('');
}
function renderMetrics(){
  let total = 0, best = null;
  holdings.forEach(h => {
    const p = prices[h.id]; if(!p) return;
    total += p.usd * h.amount;
    const chg = p.usd_24h_change || 0;
    if(best === null || chg > best.chg){ best = {sym: h.sym, chg}; }
  });
  document.getElementById('m-total').textContent = '$' + total.toLocaleString(undefined,{maximumFractionDigits:2});
  document.getElementById('m-count').textContent = holdings.length;
  if(best){
    document.getElementById('m-best').textContent = best.sym;
    const sub = document.getElementById('m-best-sub');
    sub.textContent = (best.chg>=0?'+':'') + best.chg.toFixed(2) + '% today';
    sub.className = 'metric-sub ' + (best.chg>=0?'up':'down');
  } else {
    document.getElementById('m-best').textContent = '—';
    document.getElementById('m-best-sub').textContent = 'add a holding';
  }
}
function pushHistory(){
  let total = 0;
  holdings.forEach(h => { const p = prices[h.id]; if(p) total += p.usd * h.amount; });
  const now = new Date();
  sessionHistory.push({t: now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), v: total});
  if(sessionHistory.length > 40) sessionHistory.shift();
  updateChart();
}
function updateChart(){
  const ctx = document.getElementById('valueChart');
  if(!ctx) return;
  const labels = sessionHistory.map(p => p.t);
  const values = sessionHistory.map(p => p.v);
  document.getElementById('chart-note').textContent = sessionHistory.length > 1 ? 'Tracking live since you opened this session' : 'Building as prices update…';
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? '#8A7A66' : '#9C8E7E';
  if(chart){ chart.data.labels = labels; chart.data.datasets[0].data = values; chart.update(); return; }
  chart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{ label:'Portfolio value', data: values, borderColor:'#F2792A', backgroundColor:'rgba(242,121,42,0.1)', borderWidth:2.5, pointRadius:0, tension:0.3, fill:true }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:{grid:{display:false},ticks:{color:tickColor,maxTicksLimit:6,font:{size:11}}},
               y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:11},callback:v=>'$'+v.toLocaleString()}} } }
  });
}
function exportCsv(){
  if(currentPlan === 'basic') return;
  let csv = 'Asset,Symbol,Amount,Price(USD),24h Change(%),Value(USD)\n';
  holdings.forEach(h => {
    const p = prices[h.id]; const price = p ? p.usd : 0; const chg = p ? (p.usd_24h_change||0) : 0;
    csv += `${h.name},${h.sym},${h.amount},${price},${chg.toFixed(2)},${(price*h.amount).toFixed(2)}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ledger-holdings.csv';
  link.click();
}
