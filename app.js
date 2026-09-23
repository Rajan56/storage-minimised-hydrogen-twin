// app.js: page logic and the live digital twin view. The model itself is in sim.js (window.H2Sim).
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const fmt = (x, d = 0) => Number(x).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const Sim = window.H2Sim;
const COL = { bg: '#0d1626', panel: '#121c2a', line: '#22324a', text: '#eef3f8', muted: '#93a2b4', cyan: '#3ad0f0', amber: '#ffb84d', green: '#46d69b', red: '#ff6b5b', violet: '#b18cff', steel: '#c9d3de', sea: '#10263d' };
const STRATS = [
  { id: 'A', name: 'Storage-first', col: COL.red },
  { id: 'B', name: 'Fixed timetable', col: COL.steel },
  { id: 'S', name: 'Monitoring only', col: COL.amber },
  { id: 'C', name: 'Digital twin', col: COL.cyan }
];
const USERS = ['D1', 'D2', 'D3', 'D4'], UCOL = { D1: COL.amber, D2: COL.violet, D3: COL.green, D4: '#7fb3f0' };
const site = id => Sim.SITES.find(s => s.id === id);

/* ----------------------------------------------------------------- video chapters, nav */
(() => {
  const v = $('#vid'), btns = $$('#chapters button');
  btns.forEach(b => b.addEventListener('click', () => { v.currentTime = parseFloat(b.dataset.t); v.play().catch(() => {}); }));
  v.addEventListener('timeupdate', () => { let on = 0; btns.forEach((b, i) => { if (v.currentTime >= parseFloat(b.dataset.t) - 0.05) on = i; }); btns.forEach((b, i) => b.classList.toggle('on', i === on && v.currentTime > 0)); });
  const links = $$('.nav a.l'), map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { links.forEach(l => l.classList.remove('on')); const a = map.get(e.target.id); if (a) a.classList.add('on'); } }), { rootMargin: '-45% 0px -50% 0px' });
  $$('section[id]').forEach(s => io.observe(s));
})();

/* ----------------------------------------------------------------- 2. reframing */
(() => {
  const rows = [
    ['Question asked', 'How big must each tank be to be safe?', 'When must hydrogen be where, and what is the cheapest way to get it there?'],
    ['Unit of design', 'Each site on its own', 'The flow across the whole local system'],
    ['Where flexibility sits', 'In stationary tanks at every site', 'In timing: when to produce, when to move, which trailer waits where'],
    ['Information used', 'Averages and worst cases', 'Live levels, weather, price and demand forecasts, truck positions'],
    ['Who decides', 'Each actor, for its own risk', 'A shared plan the actors agree to follow'],
    ['Main risk managed by', 'Oversizing', 'Anticipation and re-planning every hour'],
    ['Key measure', 'Tank capacity installed', 'Service level per kg of hydrogen held'],
    ['Typical result', 'Reliable but capital-heavy; hydrogen waits in tanks', 'Reliable with far less storage; hydrogen waits on wheels, briefly']
  ];
  const draw = k => {
    $$('#reSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const i = k === 'infra' ? 1 : 2;
    $('#reTable').innerHTML = `<thead><tr><th></th><th class="${k === 'infra' ? 'red' : 'cyan'}">${k === 'infra' ? 'Infrastructure view' : 'Logistics intelligence view'}</th></tr></thead><tbody>` + rows.map(r => `<tr><td class="muted">${r[0]}</td><td>${r[i]}</td></tr>`).join('') + '</tbody>';
  };
  $$('#reSeg button').forEach(b => b.addEventListener('click', () => draw(b.dataset.k)));
  draw('infra');
})();

/* ----------------------------------------------------------------- 3. case map (SVG) */
const SITE_INFO = {
  P1: ['Coastal wind electrolyser', '8 MW PEM electrolyser next to a coastal wind farm. Takes up to 20 MW of wind output at a fixed €28/MWh and buys the rest on the spot market. About 145 kg/h at full load.', 'green'],
  P2: ['Inland electrolyser, industrial park', '5 MW electrolyser on the grid, paying spot price plus fees. About 90 kg/h at full load. Close to the truck corridor and the plant.', 'green'],
  D1: ['City bus depot', '30 fuel-cell buses refuel overnight, about 600 kg a night on weekdays, more in hard frost when cabins need heat.', 'amber'],
  D2: ['Truck refuelling station', 'On the main road corridor. Morning and afternoon peaks, quieter weekends, about 450 kg a day. A freight surge adds 60 % on one day.', 'amber'],
  D3: ['Industrial user', 'Process heat and feedstock, a steady 700 kg a day. The largest and most constant customer.', 'amber'],
  D4: ['Port', 'Work vessels bunker 1.1 t on Tuesdays and Fridays between 12:00 and 15:00. Large, short, scheduled peaks.', 'amber']
};
(() => {
  const svg = $('#caseMap'); let sel = 'P1';
  const X = x => 20 + x, Y = y => 20 + y;
  const draw = () => {
    let s = '';
    let coast = 'M0 0'; for (let i = 0; i <= 24; i++) { const y = -20 + i * 25; coast += ` L${X(60 + 30 * Math.sin(i * 1.3) + 18 * Math.sin(i * 0.47)).toFixed(0)} ${Y(y).toFixed(0)}`; }
    s += `<path d="${coast} L0 600 Z" fill="${COL.sea}"/><text x="30" y="560" fill="#5d87ad" font-size="16" font-style="italic">Gulf of Bothnia</text>`;
    for (const p of ['P1', 'P2']) for (const d of USERS) { const a = site(p), b = site(d); s += `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#2c4260" stroke-width="3"/><text x="${(X(a.x) + X(b.x)) / 2}" y="${(Y(a.y) + Y(b.y)) / 2 - 4}" fill="#5f7390" font-size="12" text-anchor="middle">${Sim.DIST[p][d]} km</text>`; }
    for (const st of Sim.SITES) {
      const c = st.type === 'prod' ? COL.green : COL.amber;
      s += `<g class="site${st.id === sel ? ' on' : ''}" data-id="${st.id}" tabindex="0" role="button" aria-label="${st.short}"><circle cx="${X(st.x)}" cy="${Y(st.y)}" r="26" fill="${COL.panel}" stroke="${c}" stroke-width="3"/><text x="${X(st.x)}" y="${Y(st.y) + 6}" text-anchor="middle" font-size="16" font-weight="700" fill="${c}">${st.type === 'prod' ? 'H₂' : st.id}</text><text x="${X(st.x)}" y="${Y(st.y) + 48}" text-anchor="middle" font-size="15" font-weight="700" fill="${COL.text}">${st.short}</text></g>`;
    }
    svg.innerHTML = s;
    $$('#caseMap .site').forEach(g => { g.addEventListener('click', () => { sel = g.dataset.id; draw(); }); g.addEventListener('keydown', e => { if (e.key === 'Enter') { sel = g.dataset.id; draw(); } }); });
    const [n, d, c] = SITE_INFO[sel];
    const dist = sel.startsWith('P') ? USERS.map(u => `${site(u).short}: ${Sim.DIST[sel][u]} km`).join(' · ') : ['P1', 'P2'].map(p => `${site(p).short}: ${Sim.DIST[p][sel]} km`).join(' · ');
    $('#siteCard').innerHTML = `<div class="kicker" style="color:var(--${c})">${sel.startsWith('P') ? 'Producer' : 'User'}</div><h3>${n}</h3><p>${d}</p><p class="small muted">Road distances: ${dist}</p><p class="small muted">Storage-first design would install ${fmt(Sim.simulate ? STORE_A[sel] : 0)} kg of stationary tanks here; the other strategies about ${fmt(SMALL[sel])} kg.</p>`;
  };
  window.__drawCase = draw;
})();
const STORE_A = { D1: 1800, D2: 1350, D3: 2100, D4: 2200, P1: 2000, P2: 2000 };
const SMALL = { D1: 160, D2: 108, D3: 175, D4: 79, P1: 200, P2: 200 };
window.__drawCase();

/* ----------------------------------------------------------------- 4. architecture */
(() => {
  const L = [
    ['1', 'Physical system', 'electrolysers, trailers, users', 'Two electrolysers, seven tube trailers with three tractors, four users with small tanks. Everything the hydrogen touches.', ['Electrolyser load and efficiency, including cold penalties', 'Trailer pressure and kg, position, hook-up status', 'Tank levels and dispenser activity']],
    ['2', 'Data and connectivity', 'sensors, telematics, forecasts', 'The twin is fed by live measurements and by forecasts it does not produce itself.', ['Weather forecasts: wind and temperature', 'Day-ahead and intraday power prices', 'Timetables: bus rosters, port bunkering slots, plant stoppages', 'Truck telematics and road conditions']],
    ['3', 'Models', 'physics, demand, logistics', 'Models turn data into expectations: what each site will need, what each hour of production will cost, how long each trip will take.', ['Electrolyser energy per kg as a function of temperature', 'Demand forecast per site from timetables and temperature', 'Travel times with road-weather multipliers', 'Projected hydrogen on site, hour by hour, 48 hours ahead']],
    ['4', 'Decision engine', 'rolling 48 h plan', 'Every hour the twin re-plans. It works backwards from the moment each user will run short.', ['When must a full trailer arrive at each site?', 'When must it leave, given the road forecast and a cold margin?', 'Which electrolyser hours, cheapest first, fill it in time?', 'How large a reserve to keep on wheels for the unforeseen?']],
    ['5', 'Actions and governance', 'back to the physical system', 'Decisions go back as set-points and work orders, under rules the actors have agreed.', ['Electrolyser set-points hour by hour', 'Dispatch orders for tractors and trailers', 'Early warnings to users; agreed priority rules when supply is short', 'Data-sharing agreements between producers, haulier and users']]
  ];
  const box = $('#arch');
  box.innerHTML = L.map((l, i) => `<button class="layer" data-i="${i}"><b>${l[0]} · ${l[1]}</b><small>${l[2]}</small></button>`).join('');
  const show = i => { $$('.layer').forEach(b => b.classList.toggle('on', +b.dataset.i === i)); const l = L[i]; $('#archDetail').innerHTML = `<h3>${l[1]}</h3><p>${l[3]}</p><ul>${l[4].map(x => `<li>${x}</li>`).join('')}</ul>`; };
  $$('.layer').forEach(b => b.addEventListener('click', () => show(+b.dataset.i)));
  show(3);
})();

/* ----------------------------------------------------------------- canvas helpers */
function fitCanvas(cv, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 700;
  if (cv.__w !== w || cv.__h !== h || cv.__d !== dpr) { cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.__w = w; cv.__h = h; cv.__d = dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); return { ctx, w, h };
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ----------------------------------------------------------------- 5. live twin */
const state = { strat: 'C', events: { peak: true, dunkel: true, cold: true, storm: true, outage: true, windy: true }, fleet: 7, fe: 0.5, seed: 7, h: 0, playing: true, speed: 8, res: null, world: null, runId: 0 };
(() => {
  $('#strats').innerHTML = STRATS.map(s => `<button class="strat${s.id === state.strat ? ' on' : ''}" data-id="${s.id}"><i style="background:${s.col}"></i>${s.name}</button>`).join('');
  $$('.strat').forEach(b => b.addEventListener('click', () => { state.strat = b.dataset.id; $$('.strat').forEach(x => x.classList.toggle('on', x === b)); drawKPI(); drawLog(); }));
  $('#evs').innerHTML = Object.entries(Sim.EVENTS).map(([k, e]) => `<label class="ev" title="${e.desc}"><input type="checkbox" data-k="${k}" checked><span>${e.name}</span></label>`).join('');
  $$('#evs input').forEach(i => i.addEventListener('change', () => { state.events[i.dataset.k] = i.checked; runAll(); }));
  const lab = () => { $('#vFleet').textContent = state.fleet + ' trailers'; $('#vFe').textContent = state.fe === 0 ? 'perfect' : '×' + state.fe; };
  $('#fleet').addEventListener('input', e => { state.fleet = +e.target.value; lab(); });
  $('#fleet').addEventListener('change', () => runAll());
  $('#fe').addEventListener('input', e => { state.fe = +e.target.value; lab(); });
  $('#fe').addEventListener('change', () => runAll());
  $('#seed').addEventListener('change', e => { state.seed = +e.target.value; runAll(); });
  $('#play').addEventListener('click', () => { state.playing = !state.playing; $('#play').textContent = state.playing ? 'Pause' : 'Play'; });
  $('#speed').addEventListener('change', e => state.speed = +e.target.value);
  $('#scrub').addEventListener('input', e => { state.h = +e.target.value; state.playing = false; $('#play').textContent = 'Play'; drawLog(); });
  lab();
})();

function runAll() {
  const id = ++state.runId; $('#busy').textContent = 'Running the month for all four strategies…';
  const world = Sim.makeWorld({ seed: state.seed, events: state.events });
  const res = {}; let i = 0;
  const step = () => {
    if (id !== state.runId) return;
    const s = STRATS[i];
    res[s.id] = Sim.simulate(world, s.id, { trailers: state.fleet, forecastError: state.fe });
    i++;
    if (i < STRATS.length) setTimeout(step, 0);
    else { state.world = world; state.res = res; $('#busy').textContent = ''; drawKPI(); drawLog(); updateHeadline(); }
  };
  setTimeout(step, 20);
}

function drawKPI() {
  if (!state.res) return;
  const R = state.res;
  const rows = [
    ['Service level', r => r.service * 100, v => fmt(v, 2) + ' %', 'max'],
    ['Hours without fuel', r => r.stockoutHours, v => fmt(v), 'min'],
    ['Unmet demand', r => r.unmet, v => fmt(v) + ' kg', 'min'],
    ['Stationary storage installed', r => r.statKg, v => fmt(v) + ' kg', 'min'],
    ['Hydrogen held, average', r => r.avgInventory, v => fmt(v) + ' kg', 'min'],
    ['Average power price paid', r => r.avgPrice, v => '€' + fmt(v, 1) + '/MWh', 'min'],
    ['Electricity cost', r => r.energyCost, v => '€' + fmt(v / 1000) + 'k', 'min'],
    ['Truck kilometres', r => r.km, v => fmt(v), 'min'],
    ['Stationary storage cost (month)', r => r.storageCost, v => '€' + fmt(v / 1000, 1) + 'k', 'min'],
    ['Cost per kg delivered', r => r.costPerKg, v => '€' + fmt(v, 2), 'min'],
    ['Operating margin (month)', r => r.margin, v => '€' + fmt(v / 1000) + 'k', 'max']
  ];
  let h = `<thead><tr><th>Month result</th>${STRATS.map(s => `<th class="num" style="color:${s.col}">${s.name}</th>`).join('')}</tr></thead><tbody>`;
  for (const [n, get, f, dir] of rows) {
    const vals = STRATS.map(s => get(R[s.id])), best = dir === 'max' ? Math.max(...vals) : Math.min(...vals), worst = dir === 'max' ? Math.min(...vals) : Math.max(...vals);
    h += `<tr><td>${n}</td>${vals.map((v, i) => `<td class="num${Math.abs(v - best) < 1e-9 ? ' best' : Math.abs(v - worst) < 1e-9 ? ' worst' : ''}"${STRATS[i].id === state.strat ? ' style="background:rgba(58,208,240,.06)"' : ''}>${f(v)}</td>`).join('')}</tr>`;
  }
  $('#kpiTable').innerHTML = h + '</tbody>';
}
function updateHeadline() {
  const R = state.res; if (!R || state.seed !== 7 || state.fleet !== 7 || state.fe !== 0.5 || Object.values(state.events).some(v => !v)) return;
  const A = R.A, Z = R.C;
  $('#h1').textContent = '−' + Math.round((1 - Z.statKg / A.statKg) * 100) + ' %';
  $('#h2').textContent = '−' + Math.round((1 - Z.avgInventory / A.avgInventory) * 100) + ' %';
  $('#h3').textContent = fmt(Z.service * 100, Z.service > 0.9995 ? 0 : 1) + ' %';
  $('#h4').textContent = (Z.margin >= A.margin ? '+€' : '−€') + fmt(Math.abs(Z.margin - A.margin) / 1000) + 'k';
}
function drawLog() {
  if (!state.res) return;
  const r = state.res[state.strat], L = r.log, h = Math.floor(state.h), out = [];
  const hh = t => `D${Math.floor(t / 24) + 1} ${String(t % 24).padStart(2, '0')}:00`;
  for (const tp of L.trips) if (tp.tStart <= h) out.push([tp.tStart, tp.tr != null ? `${hh(tp.tStart)} ${site(tp.from).short} → ${site(tp.to).short}, ${fmt(tp.h2)} kg` : `${hh(tp.tStart)} collect empty trailer at ${site(tp.to).short}`]);
  for (let t = 0; t <= h && t < L.price.length; t++) for (const u of USERS) if (L.unmet[u][t] > 0.5 && (t === 0 || L.unmet[u][t - 1] <= 0.5)) out.push([t, `<span class="red">${hh(t)} ${site(u).short} runs out of hydrogen</span>`]);
  out.sort((a, b) => b[0] - a[0]);
  $('#logWho').textContent = '· ' + STRATS.find(s => s.id === state.strat).name;
  $('#log').innerHTML = out.slice(0, 40).map(x => `<div>${x[1]}</div>`).join('') || '<div class="muted">No trips yet.</div>';
}

// ---- map drawing
function drawMap(h) {
  const cv = $('#map'), { ctx, w, h: H } = fitCanvas(cv, 430);
  const res = state.res; if (!res) return;
  const r = res[state.strat], L = r.log, world = state.world, t = Math.min(719, Math.floor(h));
  const sc = Math.min((w - 40) / 780, (H - 30) / 580), ox = (w - 760 * sc) / 2, oy = 14;
  const X = x => ox + x * sc, Y = y => oy + y * sc;
  // sea
  ctx.fillStyle = COL.sea; ctx.beginPath(); ctx.moveTo(0, 0);
  for (let i = 0; i <= 24; i++) { const y = -20 + i * 25; ctx.lineTo(X(60 + 30 * Math.sin(i * 1.3) + 18 * Math.sin(i * 0.47)), Y(y)); }
  ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  // snow storm tint on roads
  const storm = world.travel[t] > 1;
  ctx.lineWidth = 3; ctx.strokeStyle = storm ? '#6d7f99' : '#2c4260'; ctx.setLineDash(storm ? [6, 5] : []);
  for (const p of ['P1', 'P2']) for (const d of USERS) { ctx.beginPath(); ctx.moveTo(X(site(p).x), Y(site(p).y)); ctx.lineTo(X(site(d).x), Y(site(d).y)); ctx.stroke(); }
  ctx.setLineDash([]);
  // sites
  const trAt = L.tr[t] || [];
  for (const s of Sim.SITES) {
    const x = X(s.x), y = Y(s.y), c = s.type === 'prod' ? COL.green : COL.amber;
    ctx.fillStyle = COL.panel; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.type === 'prod' ? 'H₂' : s.id, x, y + 5);
    ctx.fillStyle = COL.text; ctx.font = '700 12.5px Inter, sans-serif'; ctx.fillText(s.short, x, y + 40);
    if (s.type === 'prod') {
      const kg = L.prod[s.id][t] || 0, cap = s.mw * 1000 / 55, off = s.id === 'P1' && world.p1avail[t] === 0;
      ctx.fillStyle = '#1b2a3f'; ctx.fillRect(x - 30, y + 48, 60, 7); ctx.fillStyle = off ? COL.red : COL.green; ctx.fillRect(x - 30, y + 48, 60 * clamp(kg / cap, 0, 1), 7);
      ctx.fillStyle = off ? COL.red : COL.muted; ctx.font = '11px Inter, sans-serif'; ctx.fillText(off ? 'TRIPPED' : `${fmt(kg)} kg/h`, x, y + 68);
    } else {
      const inv = L.inv[s.id][t] || 0, un = L.unmet[s.id][t] > 0.5, ref = s.id === 'D4' ? 1800 : 900;
      ctx.fillStyle = '#1b2a3f'; ctx.fillRect(x + 28, y - 22, 8, 44);
      const f = clamp(inv / ref, 0, 1); ctx.fillStyle = un ? COL.red : f < 0.15 ? COL.amber : COL.cyan; ctx.fillRect(x + 28, y + 22 - 44 * f, 8, 44 * f);
      ctx.fillStyle = un ? COL.red : COL.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(un ? 'OUT' : fmt(inv) + ' kg', x + 40, y + 4); ctx.textAlign = 'center';
      if (un) { ctx.strokeStyle = COL.red; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 30 + 4 * Math.sin(h * 6), 0, 7); ctx.stroke(); }
    }
    // docked trailers
    const here = trAt.filter(q => q[0] === s.id);
    here.forEach((q, i) => drawTrailer(ctx, x - 20 + i * 26 - (here.length - 1) * 4, y - 36 - (s.type === 'prod' ? (i % 2) * 14 : 0), q[1] / 900, 0.85));
  }
  // moving trailers
  for (const tp of L.trips) {
    if (h < tp.tStart || h >= tp.tReturn) continue;
    const a = site(tp.from), b = site(tp.to);
    let k, full;
    if (h < tp.tArrive) { k = (h - tp.tStart) / Math.max(0.5, tp.tArrive - tp.tStart); full = tp.tr != null ? tp.h2 / 900 : -1; drawTruck(ctx, lerp(X(a.x), X(b.x), k), lerp(Y(a.y), Y(b.y), k), full); }
    else { k = (h - tp.tArrive) / Math.max(0.5, tp.tReturn - tp.tArrive); const backKg = tp.back != null ? 0.06 : -1; drawTruck(ctx, lerp(X(b.x), X(a.x), k), lerp(Y(b.y), Y(a.y), k), backKg); }
  }
  // weather box
  const bx = w - 190, by = 10;
  ctx.fillStyle = 'rgba(18,28,42,.92)'; roundRect(ctx, bx, by, 178, 92, 10); ctx.fill(); ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = 'left'; ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = COL.muted;
  ctx.fillText('Wind', bx + 12, by + 22); ctx.fillText('Temperature', bx + 12, by + 44); ctx.fillText('Spot price', bx + 12, by + 66); ctx.fillText('Roads', bx + 12, by + 86);
  ctx.textAlign = 'right'; ctx.font = '700 12.5px Inter, sans-serif';
  ctx.fillStyle = COL.green; ctx.fillText(Math.round(world.wind[t] * 100) + ' %', bx + 166, by + 22);
  ctx.fillStyle = world.temp[t] < -20 ? '#7fb3f0' : COL.text; ctx.fillText(world.temp[t].toFixed(0) + ' °C', bx + 166, by + 44);
  ctx.fillStyle = world.price[t] > 150 ? COL.red : COL.amber; ctx.fillText('€' + world.price[t].toFixed(0) + '/MWh', bx + 166, by + 66);
  ctx.fillStyle = storm ? COL.red : COL.text; ctx.fillText(storm ? 'snowstorm' : 'normal', bx + 166, by + 86);
  // legend
  ctx.textAlign = 'left'; ctx.font = '11.5px Inter, sans-serif'; ctx.fillStyle = COL.muted;
  drawTrailer(ctx, 26, H - 16, 1, 0.8); ctx.fillText('trailer, fill level', 44, H - 12);
  ctx.fillStyle = COL.cyan; ctx.fillRect(160, H - 22, 7, 12); ctx.fillStyle = COL.muted; ctx.fillText('hydrogen on site', 172, H - 12);
}
function drawTrailer(ctx, x, y, f, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = COL.bg; ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5; roundRect(ctx, -12, -5, 24, 10, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = COL.cyan; if (f > 0.02) { roundRect(ctx, -10, -3, 20 * clamp(f, 0, 1), 6, 2); ctx.fill(); }
  ctx.restore();
}
function drawTruck(ctx, x, y, f) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = f < 0 ? COL.steel : COL.amber; roundRect(ctx, 10, -6, 9, 12, 2); ctx.fill();
  if (f >= 0) { ctx.fillStyle = COL.bg; ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5; roundRect(ctx, -14, -6, 24, 12, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = COL.cyan; if (f > 0.02) { roundRect(ctx, -12, -4, 20 * clamp(f, 0, 1), 8, 2); ctx.fill(); } }
  ctx.restore();
}

// ---- time charts
function drawCharts(h) {
  const res = state.res; if (!res) return;
  const r = res[state.strat], L = r.log, world = state.world;
  { // chart A: price and production
    const { ctx, w, h: H } = fitCanvas($('#chartA'), 200), pad = { l: 46, r: 46, t: 18, b: 22 };
    const X = t => pad.l + (w - pad.l - pad.r) * t / 720;
    ctx.font = '11.5px Inter, sans-serif'; ctx.fillStyle = COL.muted; ctx.textAlign = 'left'; ctx.fillText('Electrolyser output (bars, kg/h) and spot price (line, €/MWh)', pad.l, 12);
    drawEventBands(ctx, X, pad.t, H - pad.b);
    const maxP = 240, maxPr = 320, Yb = v => H - pad.b - (H - pad.t - pad.b) * v / maxP, Yp = v => H - pad.b - (H - pad.t - pad.b) * clamp(v, 0, maxPr) / maxPr;
    ctx.fillStyle = 'rgba(70,214,155,.55)';
    for (let t = 0; t < 720; t++) { const v = L.prod.P1[t] + L.prod.P2[t]; if (v > 0) ctx.fillRect(X(t), Yb(v), Math.max(1, X(1) - X(0)), H - pad.b - Yb(v)); }
    ctx.strokeStyle = COL.amber; ctx.lineWidth = 1.3; ctx.beginPath(); for (let t = 0; t < 720; t++) { t ? ctx.lineTo(X(t), Yp(world.price[t])) : ctx.moveTo(X(t), Yp(world.price[t])); } ctx.stroke();
    axisDays(ctx, X, H - pad.b + 14);
    ctx.textAlign = 'right'; ctx.fillStyle = COL.green; ctx.fillText('240', pad.l - 6, pad.t + 8); ctx.textAlign = 'left'; ctx.fillStyle = COL.amber; ctx.fillText('€320', w - pad.r + 6, pad.t + 8);
    cursor(ctx, X(h), pad.t, H - pad.b);
  }
  { // chart B: hydrogen at users + unmet
    const { ctx, w, h: H } = fitCanvas($('#chartB'), 220), pad = { l: 46, r: 46, t: 18, b: 22 };
    const X = t => pad.l + (w - pad.l - pad.r) * t / 720, maxI = 2000, Y = v => H - pad.b - (H - pad.t - pad.b) * clamp(v, 0, maxI) / maxI;
    ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = COL.muted; ctx.fillText('Hydrogen available at each user (kg); red marks: user out of hydrogen', pad.l, 12);
    drawEventBands(ctx, X, pad.t, H - pad.b);
    for (const u of USERS) { ctx.strokeStyle = UCOL[u]; ctx.lineWidth = 1.3; ctx.beginPath(); for (let t = 0; t < 720; t++) { const v = L.inv[u][t]; t ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)); } ctx.stroke(); }
    ctx.fillStyle = COL.red; for (const u of USERS) for (let t = 0; t < 720; t++) if (L.unmet[u][t] > 0.5) ctx.fillRect(X(t) - 1, H - pad.b - 8, 3, 8);
    axisDays(ctx, X, H - pad.b + 14);
    ctx.textAlign = 'right'; ctx.fillStyle = COL.muted; ctx.fillText('2,000', pad.l - 6, pad.t + 8);
    let lx = w - pad.r - 300; USERS.forEach(u => { ctx.fillStyle = UCOL[u]; ctx.fillRect(lx, 5, 10, 3); ctx.textAlign = 'left'; ctx.fillText(site(u).short, lx + 14, 10); lx += 76; });
    cursor(ctx, X(h), pad.t, H - pad.b);
  }
}
function drawEventBands(ctx, X, y0, y1) {
  const E = Sim.EVENTS, ev = state.events;
  const band = (k, d0, d1, c) => { if (!ev[k]) return; ctx.fillStyle = c; ctx.fillRect(X(d0 * 24), y0, X(d1 * 24) - X(d0 * 24), y1 - y0); };
  band('cold', E.cold.day, E.cold.day + E.cold.days, 'rgba(127,179,240,.1)');
  band('dunkel', E.dunkel.day, E.dunkel.day + E.dunkel.days, 'rgba(154,169,187,.1)');
  band('windy', E.windy.day, E.windy.day + E.windy.days, 'rgba(70,214,155,.08)');
  band('storm', E.storm.day + E.storm.from / 24, E.storm.day + E.storm.to / 24, 'rgba(238,243,248,.14)');
  band('outage', E.outage.day + E.outage.from / 24, E.outage.day + (E.outage.from + E.outage.hours) / 24, 'rgba(255,107,91,.14)');
  band('peak', E.peak.day + E.peak.from / 24, E.peak.day + E.peak.to / 24, 'rgba(255,184,77,.16)');
}
function axisDays(ctx, X, y) { ctx.fillStyle = COL.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; for (let d = 0; d <= 30; d += 5) ctx.fillText('day ' + (d + 1), X(Math.min(d, 29.5) * 24), y); }
function cursor(ctx, x, y0, y1) { ctx.strokeStyle = COL.text; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]); }

function banner(t) {
  const E = Sim.EVENTS, ev = state.events, d = t / 24, msgs = [];
  if (ev.peak && d >= E.peak.day && d < E.peak.day + 1) msgs.push('Freight peak at the truck station');
  if (ev.dunkel && d >= E.dunkel.day && d < E.dunkel.day + E.dunkel.days) msgs.push('Calm, dark and expensive: little wind, high prices');
  if (ev.cold && d >= E.cold.day && d < E.cold.day + E.cold.days) msgs.push('Cold snap: higher demand, lower electrolyser efficiency');
  if (ev.storm && state.world && state.world.travel[Math.floor(t)] > 1) msgs.push('Snowstorm: trips take 2.5 times longer');
  if (ev.outage && state.world && state.world.p1avail[Math.floor(t)] === 0) msgs.push('Coastal electrolyser tripped');
  if (ev.windy && d >= E.windy.day && d < E.windy.day + E.windy.days) msgs.push('Windy weekend: power almost free');
  const dow = Math.floor(d) % 7, hod = Math.floor(t) % 24; if ((dow === 1 || dow === 4) && hod >= 12 && hod < 15) msgs.push('Port bunkering 1.1 t');
  $('#banner').textContent = msgs.join(' · ');
}

let last = performance.now(), lastLog = -1, visible = true;
new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe($('#map'));
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.res && visible) {
    if (state.playing) { state.h += dt * state.speed; if (state.h >= 720) state.h = 0; $('#scrub').value = Math.floor(state.h); }
    const h = state.h, t = Math.floor(h);
    drawMap(h); drawCharts(h); banner(h);
    $('#clock').textContent = `Day ${Math.floor(t / 24) + 1} ${String(t % 24).padStart(2, '0')}:00 · ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Math.floor(t / 24) % 7]}`;
    if (t !== lastLog && t % 3 === 0) { lastLog = t; drawLog(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
runAll();

/* ----------------------------------------------------------------- 6. event cards */
(() => {
  const TXT = {
    peak: 'Bookings show the surge a day ahead. The twin moves the next truck-station delivery forward and fills a trailer in the cheapest hours before it.',
    dunkel: 'Forecasts show three calm, expensive days coming. The twin produces more in the last windy hours before them and schedules deliveries so that trailers, not tanks, carry the buffer.',
    cold: 'Buses and trucks need more hydrogen and electrolysers need more power per kg. The twin adds a cold margin to every departure and raises its reserve on wheels.',
    storm: 'The road forecast warns 12 hours ahead. The twin sends trailers early so every site holds enough to ride out 14 hours of slow roads.',
    outage: 'The trip cannot be foreseen. Within the hour the twin re-plans with the inland electrolyser alone and draws on the spare full trailer.',
    windy: 'Power is almost free while demand is low. The twin fills empty trailers, not new tanks, and takes that cheap hydrogen into the following week.'
  };
  $('#evcards').innerHTML = Object.entries(Sim.EVENTS).map(([k, e]) => `<div class="evcard"><h3>${e.name}</h3><p class="small muted">${e.desc}</p><p class="small">${TXT[k]}</p><button class="go" data-day="${e.day}">Watch day ${e.day + 1} in the live twin</button></div>`).join('');
  $$('.evcard .go').forEach(b => b.addEventListener('click', () => { state.h = +b.dataset.day * 24 - 6; if (state.h < 0) state.h = 0; state.playing = true; $('#play').textContent = 'Pause'; document.getElementById('live').scrollIntoView(); }));
})();

/* ----------------------------------------------------------------- 7. frontier and sensitivity */
function runQueue(jobs, done, progress) {
  const out = []; let i = 0;
  const step = () => { if (i >= jobs.length) return done(out); out.push(jobs[i]()); i++; if (progress) progress(i, jobs.length); setTimeout(step, 0); };
  setTimeout(step, 20);
}
$('#frontGo').addEventListener('click', () => {
  const world = Sim.makeWorld({ seed: 7 });
  const aDays = [0.5, 0.75, 1, 1.25, 1.5, 2, 3], spares = [0, 150, 300, 500, 700, 850, 1300, 2000];
  const jobs = aDays.map(d => () => ({ s: 'A', x: d, r: Sim.simulate(world, 'A', { storageDays: d, log: false }) }))
    .concat(spares.map(sp => () => ({ s: 'C', x: sp, r: Sim.simulate(world, 'C', { spare: sp, log: false }) })));
  $('#frontText').innerHTML = '<p class="busy">Running…</p>';
  runQueue(jobs, out => {
    const A = out.filter(o => o.s === 'A'), Z = out.filter(o => o.s === 'C');
    drawFrontier(A, Z);
    const firstOK = arr => arr.filter(o => o.r.service >= 0.995).sort((a, b) => a.r.avgInventory - b.r.avgInventory)[0];
    const a = firstOK(A), z = firstOK(Z);
    $('#frontText').innerHTML = `<p>To supply at least 99.5 % of demand in the stressed month:</p><ul>
      <li><b class="red">Storage-first</b> needs about <b>${a ? fmt(a.r.statKg) : 'more than ' + fmt(A[A.length - 1].r.statKg)} kg</b> of stationary tanks and holds <b>${a ? fmt(a.r.avgInventory) : '?'} kg</b> of hydrogen on average.</li>
      <li><b class="cyan">The digital twin</b> needs <b>${z ? fmt(z.r.statKg) : '?'} kg</b> of stationary tanks and holds <b>${z ? fmt(z.r.avgInventory) : '?'} kg</b> on average, with a reserve on wheels of ${z ? fmt(z.x) : '?'} kg.</li></ul>
      <p class="muted">The difference is what coordination replaces. The trailers are the same in both designs.</p>`;
  }, (i, n) => { $('#frontText').innerHTML = `<p class="busy">Running ${i} of ${n}…</p>`; });
});
function drawFrontier(A, Z) {
  const { ctx, w, h: H } = fitCanvas($('#frontChart'), 330), pad = { l: 56, r: 16, t: 26, b: 42 };
  const all = A.concat(Z), maxX = Math.max(...all.map(o => o.r.avgInventory)) * 1.08, minY = 95;
  const X = v => pad.l + (w - pad.l - pad.r) * v / maxX, Y = v => H - pad.b - (H - pad.t - pad.b) * (v - minY) / (100.5 - minY);
  ctx.strokeStyle = COL.line; ctx.fillStyle = COL.muted; ctx.font = '11.5px Inter, sans-serif'; ctx.lineWidth = 1;
  for (let v = Math.ceil(minY); v <= 100; v += 1) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(v + ' %', pad.l - 6, Y(v) + 4); }
  for (let v = 0; v <= maxX; v += 2000) { ctx.textAlign = 'center'; ctx.fillText(fmt(v / 1000) + ' t', X(v), H - pad.b + 16); }
  ctx.fillText('hydrogen held on average', (pad.l + w - pad.r) / 2, H - 8);
  ctx.strokeStyle = COL.amber; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.l, Y(99.5)); ctx.lineTo(w - pad.r, Y(99.5)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = COL.amber; ctx.textAlign = 'left'; ctx.fillText('99.5 % service', pad.l + 6, Y(99.5) - 6);
  const line = (arr, c, label) => {
    const pts = arr.map(o => [X(o.r.avgInventory), Y(Math.max(minY, o.r.service * 100)), o.r.service * 100]).sort((a, b) => a[0] - b[0]);
    ctx.font = '11px Inter, sans-serif'; let nlow = 0; pts.forEach(p => { if (p[2] < minY) { ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.fillText(fmt(p[2], 0) + ' % ↓', p[0], p[1] - 8 - 14 * (nlow++ % 2)); } });
    ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    ctx.fillStyle = c; pts.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 7); ctx.fill(); });
    ctx.font = '700 13px Inter, sans-serif'; ctx.fillText(label, pts[pts.length - 1][0] - 110, pts[pts.length - 1][1] - 10);
  };
  line(A, COL.red, 'storage-first'); line(Z, COL.cyan, 'digital twin');
}
$('#sensGo').addEventListener('click', () => {
  const world = Sim.makeWorld({ seed: 7 });
  const fleets = [5, 6, 7, 8, 10], fes = [0, 1, 2];
  const jobs = [];
  for (const n of fleets) for (const s of ['B', 'S', 'C']) jobs.push(() => ({ k: 'fleet', n, s, r: Sim.simulate(world, s, { trailers: n, log: false }) }));
  for (const f of fes) jobs.push(() => ({ k: 'fe', f, r: Sim.simulate(world, 'C', { forecastError: f, log: false }) }));
  $('#sensText').innerHTML = '<p class="busy">Running…</p>';
  runQueue(jobs, out => {
    let h = '<p>Service level with the same small tanks, by fleet size:</p><table><thead><tr><th>Trailers</th><th class="num">Timetable</th><th class="num">Monitoring</th><th class="num">Twin</th></tr></thead><tbody>';
    for (const n of fleets) { const g = s => out.find(o => o.k === 'fleet' && o.n === n && o.s === s).r.service * 100; h += `<tr><td>${n}</td><td class="num">${fmt(g('B'), 1)} %</td><td class="num">${fmt(g('S'), 1)} %</td><td class="num cyan">${fmt(g('C'), 1)} %</td></tr>`; }
    h += '</tbody></table><p style="margin-top:12px">Twin with worse forecasts (error ×0, ×1, ×2): ' + fes.map(f => { const r = out.find(o => o.k === 'fe' && o.f === f).r; return `${fmt(r.service * 100, 1)} % service, €${fmt(r.margin / 1000)}k margin`; }).join('; ') + '.</p><p class="muted">Below about six trailers no strategy keeps up without more tanks: coordination needs some mobile capacity to work with.</p>';
    $('#sensText').innerHTML = h;
  }, (i, n) => { $('#sensText').innerHTML = `<p class="busy">Running ${i} of ${n}…</p>`; });
});
