// sim.js: digital twin of a storage-minimised local hydrogen system (Northern Finland style, illustrative).
// One winter month, hourly steps. Two electrolysers, four users, a shared fleet of tube trailers.
// Three operating strategies are compared on the same hardware and the same weather:
//   A  storage-first: large stationary tanks at every site, production in cheap hours, reorder-point deliveries
//   B  fixed plan:    small tanks, steady production, reorder-point deliveries, no forecasts
//   C  digital twin:  small tanks, rolling 48 h plan from weather, price and demand forecasts,
//                     trailers used as mobile storage, weather- and road-aware dispatch
// Runs in the browser (window.H2Sim) and in Node (module.exports).
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ parameters
  const P = {
    H: 720,                    // hours simulated (30 days)
    trailerCap: 900,           // kg, Type IV tube trailer at about 500 bar (US DOE: 560 to 900 kg)
    heel: 50,                  // kg left in a trailer that cannot be dispensed
    trailers: 7, tractors: 3,
    speed: 65,                 // km/h, winter road average
    handling: 1.0,             // h, hook-up at producer plus connection at user
    decant: 1.0,               // h extra when a trailer is emptied into a stationary tank (strategy A)
    transfer: 200,             // kg/h trailer to on-site tank transfer (B, C)
    secBase: 55,               // kWh/kg electrolyser system consumption
    secCold: 0.003,            // +0.3 % per degree below 0 °C (heat tracing, balance of plant)
    compress: 2.5,             // kWh/kg to fill trailers at 500 bar
    ppaPrice: 28, ppaMW: 20,   // P1 wind PPA: EUR/MWh and MW of wind output reserved for the electrolyser
    feeP1: 8, feeP2: 12,       // EUR/MWh grid fees on top of spot
    h2Price: 12,               // EUR/kg sale price
    penalty: 10,               // EUR/kg unmet demand on top of lost sale (diesel back-up, contract penalty)
    storageCapex: 1000,        // EUR/kg installed stationary storage (illustrative)
    annuity: 0.10,             // capital recovery factor per year
    truckKm: 2.4, truckStop: 35, // EUR per km and per stop
    stockValue: 5              // EUR/kg used to value the change in hydrogen held at the end of the month
  };
  const SITES = [
    { id: 'P1', type: 'prod', name: 'Coastal wind electrolyser', short: 'Coastal electrolyser', mw: 8, x: 150, y: 150 },
    { id: 'P2', type: 'prod', name: 'Inland electrolyser, industrial park', short: 'Inland electrolyser', mw: 5, x: 560, y: 330 },
    { id: 'D1', type: 'dem', name: 'City bus depot (30 fuel-cell buses)', short: 'Bus depot', base: 600, x: 330, y: 250, bays: 1 },
    { id: 'D2', type: 'dem', name: 'Truck refuelling station, E8/E75 corridor', short: 'Truck station', base: 450, x: 470, y: 150, bays: 1 },
    { id: 'D3', type: 'dem', name: 'Industrial user (process heat and feedstock)', short: 'Industry', base: 700, x: 650, y: 470, bays: 1 },
    { id: 'D4', type: 'dem', name: 'Port: work-vessel bunkering, Tue and Fri', short: 'Port', base: 0, x: 90, y: 330, bays: 2 }
  ];
  const DIST = { P1: { D1: 25, D2: 40, D3: 60, D4: 15 }, P2: { D1: 45, D2: 20, D3: 30, D4: 55 } };
  const PROD = SITES.filter(s => s.type === 'prod'), DEM = SITES.filter(s => s.type === 'dem');
  const PORT_KG = 1100;
  const AVG_DAILY = { D1: 640, D2: 430, D3: 700, D4: 2 * PORT_KG / 7 };   // for sizing rules

  const EVENTS = {
    peak:   { name: 'Refuelling peak', desc: 'Freight surge at the truck station, +60 % demand on day 5', day: 4, from: 6, to: 20, forecastLead: 24 },
    dunkel: { name: 'Calm, dark and expensive', desc: 'Three days of almost no wind and spot prices of 180 to 320 EUR/MWh (days 9 to 11)', day: 8, days: 3, forecastLead: 72 },
    cold:   { name: 'Cold snap', desc: 'Four days at about -28 °C: buses and trucks use more hydrogen, electrolysers lose efficiency (days 15 to 18)', day: 14, days: 4, forecastLead: 72 },
    storm:  { name: 'Snowstorm on the roads', desc: 'Travel times x2.5 for 14 hours on day 22', day: 21, from: 10, to: 24, forecastLead: 12 },
    outage: { name: 'Electrolyser trip', desc: 'The coastal electrolyser fails without warning for 30 hours on day 25', day: 24, from: 6, hours: 30, forecastLead: 0 },
    windy:  { name: 'Windy weekend', desc: 'Strong wind and near-zero prices while demand is low (days 27 and 28)', day: 26, days: 2, forecastLead: 72 }
  };

  // ------------------------------------------------------------------ random numbers
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gaussFrom(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  function hashNoise(a, b, c) { // deterministic N(0,1) from integers
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const r = mulberry(h); return gaussFrom(r);
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sigm = x => 1 / (1 + Math.exp(-x)), logit = p => Math.log(p / (1 - p));

  // ------------------------------------------------------------------ world: weather, prices, demand, events
  function makeWorld(opts = {}) {
    const ev = Object.assign({ peak: true, dunkel: true, cold: true, storm: true, outage: true, windy: true }, opts.events || {});
    const seed = opts.seed || 7, r = mulberry(seed), H = P.H;
    const wind = [], temp = [], price = [], travel = [], p1avail = [];
    let wx = logit(0.38), tx = -9;
    const inDays = (t, e) => { const d = t / 24; return d >= e.day && d < e.day + e.days; };
    const blend = (t, e, ramp = 12) => { const a = e.day * 24, b = (e.day + e.days) * 24; return clamp(Math.min(t - a + ramp, b - t + ramp) / ramp, 0, 1); };
    for (let t = 0; t < H; t++) {
      wx += 0.04 * (logit(0.38) - wx) + 0.26 * gaussFrom(r);
      let cf = sigm(wx);
      tx += 0.02 * (-9 - tx) + 0.55 * gaussFrom(r);
      const hod = t % 24;
      let T = tx + 1.5 * Math.sin((hod - 9) / 24 * 2 * Math.PI);
      if (ev.dunkel) { const k = blend(t, EVENTS.dunkel); cf = cf * (1 - k) + (0.04 + 0.03 * r()) * k; }
      if (ev.windy) { const k = blend(t, EVENTS.windy); cf = cf * (1 - k) + (0.82 + 0.08 * r()) * k; }
      if (ev.cold) { const k = blend(t, EVENTS.cold, 18); T = T * (1 - k) + (-28 + 1.5 * Math.sin(hod / 24 * 2 * Math.PI) + gaussFrom(r)) * k; cf = cf * (1 - 0.4 * k); }
      let pr = 40 + 90 * (0.42 - cf) + (hod >= 7 && hod <= 10 ? 18 : 0) + (hod >= 16 && hod <= 20 ? 24 : 0) + (hod <= 5 ? -10 : 0) + 2.5 * Math.max(0, -12 - T) + 6 * gaussFrom(r);
      if (ev.dunkel) { const k = blend(t, EVENTS.dunkel); pr = pr * (1 - k) + (185 + 90 * r() + (hod >= 16 && hod <= 20 ? 45 : 0)) * k; }
      if (ev.windy) { const k = blend(t, EVENTS.windy); pr = pr * (1 - k) + (-2 + 8 * r()) * k; }
      wind.push(clamp(cf, 0.01, 0.97)); temp.push(T); price.push(clamp(pr, -5, 400));
      let tm = 1; if (ev.storm) { const a = EVENTS.storm.day * 24 + EVENTS.storm.from, b = EVENTS.storm.day * 24 + EVENTS.storm.to; if (t >= a && t < b) tm = 2.5; }
      travel.push(tm);
      let av = 1; if (ev.outage) { const a = EVENTS.outage.day * 24 + EVENTS.outage.from; if (t >= a && t < a + EVENTS.outage.hours) av = 0; }
      p1avail.push(av);
    }
    const world = { seed, events: ev, H, wind, temp, price, travel, p1avail };
    world.demandExp = (id, t, T) => demandProfile(id, t, T, ev);
    // actual demand: expected profile at true temperature with hourly noise
    world.demand = {};
    for (const s of DEM) { world.demand[s.id] = []; for (let t = 0; t < H; t++) { const e = demandProfile(s.id, t, temp[t], ev); world.demand[s.id].push(s.id === 'D4' ? e : Math.max(0, e * (1 + 0.08 * hashNoise(seed, t, s.id.charCodeAt(1))))); } }
    return world;
  }
  const D2W = [0.25, 0.2, 0.2, 0.25, 0.4, 0.8, 1.6, 1.9, 1.8, 1.3, 1.1, 1.0, 1.0, 1.0, 1.1, 1.4, 1.7, 1.8, 1.6, 1.2, 0.9, 0.6, 0.4, 0.3];
  const D2S = D2W.reduce((a, b) => a + b, 0);
  function demandProfile(id, t, T, ev) {
    const hod = t % 24, day = Math.floor(t / 24), dow = day % 7;
    const cold = k => 1 + k * Math.max(0, -5 - T);
    if (id === 'D1') return (hod >= 21 || hod <= 4) ? 600 / 8 * cold(0.006) * (dow >= 5 ? 0.8 : 1) : 0;
    if (id === 'D2') { let d = 450 * D2W[hod] / D2S * cold(0.005) * (dow >= 5 ? 0.6 : 1); if (ev.peak && day === EVENTS.peak.day && hod >= EVENTS.peak.from && hod < EVENTS.peak.to) d *= 1.6; return d; }
    if (id === 'D3') return 700 / 24 * (1 + 0.002 * Math.max(0, -10 - T));
    if (id === 'D4') return ((dow === 1 || dow === 4) && hod >= 12 && hod < 15) ? PORT_KG / 3 : 0;
    return 0;
  }

  // ------------------------------------------------------------------ helpers
  const sec = T => P.secBase * (1 + P.secCold * Math.max(0, -T)) + P.compress;     // kWh/kg incl. compression
  const capKgH = (p, T) => p.mw * 1000 / (P.secBase * (1 + P.secCold * Math.max(0, -T)));
  function elecCost(pid, kg, cf, pr, T) { // EUR for producing kg this hour
    const mwh = kg * sec(T) / 1000;
    if (pid === 'P1') { const windMW = cf * P.ppaMW, ppa = Math.min(mwh, windMW); return ppa * P.ppaPrice + (mwh - ppa) * (pr + P.feeP1); }
    return mwh * (pr + P.feeP2);
  }
  function marginalCost(pid, cf, pr, T, loadMW) { // EUR/MWh for the last MW at this load
    if (pid === 'P1') return loadMW <= cf * P.ppaMW ? P.ppaPrice : pr + P.feeP1;
    return pr + P.feeP2;
  }
  const travelH = (p, d, mult) => DIST[p][d] / P.speed * mult;

  // ------------------------------------------------------------------ storage designs
  function stationaryDesign(strategy, storageDays) {
    const cap = {};
    if (strategy === 'A' && storageDays == null) { cap.D1 = 1800; cap.D2 = 1350; cap.D3 = 2100; cap.D4 = 2200; cap.P1 = 2000; cap.P2 = 2000; }
    else {
      const d = storageDays == null ? 0.25 : storageDays;
      for (const s of DEM) cap[s.id] = Math.round(d * AVG_DAILY[s.id]);
      cap.P1 = strategy === 'A' ? Math.round(d * 700) : 200; cap.P2 = strategy === 'A' ? Math.round(d * 700) : 200;
    }
    return cap;
  }

  // ------------------------------------------------------------------ simulation
  function simulate(world, strategy, cfg = {}) {
    const H = world.H, f = cfg.forecastError == null ? 0.5 : cfg.forecastError, log = cfg.log !== false;
    const cap = stationaryDesign(strategy, cfg.storageDays);
    const stat = {}; for (const k in cap) stat[k] = cap[k] * 0.5;
    const trailers = [];
    const NT = cfg.trailers || P.trailers;
    for (let i = 0; i < NT; i++) trailers.push({ id: i, h2: 450, at: null });
    if (strategy === 'A') trailers.forEach((tr, i) => tr.at = i % 2 ? 'P2' : 'P1');
    else { const order = ['D1', 'D2', 'D3', 'D4', 'D4', 'P1', 'P2', 'P1', 'P2', 'P1', 'P2', 'P1', 'P2']; trailers.forEach((tr, i) => { tr.at = order[i]; tr.h2 = i < 5 ? 600 : 300; }); }
    const trips = [];
    const K = { demand: 0, served: 0, unmet: 0, energyMWh: 0, energyCost: 0, prodKg: 0, km: 0, stops: 0, stockoutHours: 0, unmetBy: {}, demandBy: {}, invSum: 0, statSum: 0, costWeightedPrice: 0, cheapShare: 0 };
    for (const s of DEM) { K.unmetBy[s.id] = 0; K.demandBy[s.id] = 0; }
    const L = { price: [], wind: [], temp: [], prod: { P1: [], P2: [] }, inv: {}, unmet: {}, sys: [], tr: [], stat: [], trips };
    for (const s of DEM) { L.inv[s.id] = []; L.unmet[s.id] = []; }
    const systemStock = () => trailers.reduce((a, tr) => a + tr.h2, 0) + Object.values(stat).reduce((a, b) => a + b, 0);
    const initStock = systemStock();
    const docked = id => trailers.filter(tr => tr.at === id);
    const usable = tr => Math.max(0, tr.h2 - P.heel);
    const pool = id => stat[id] + docked(id).reduce((a, tr) => a + usable(tr), 0);
    const busy = t => trips.filter(tp => tp.tStart <= t && tp.tReturn > t).length;
    const enroute = (id, t) => trips.filter(tp => tp.to === id && tp.tArrive > t && tp.tr != null);
    let priceMean = 60, planCache = { t: -1 };

    // ---- forecast (twin only): truth plus error growing with lead time, deterministic per (target, issue)
    const nc = new Map();
    const noise = (a, k, i) => { const key = (a * 4096 + k) * 256 + i; let v = nc.get(key); if (v === undefined) { v = hashNoise(world.seed + a, k, i); nc.set(key, v); } return v; };
    const fcT = new Map(), fcD = new Map();
    const fcDemand = (id, t, L0) => fc.demandRaw(id, t, L0);
    const fc = {
      temp: (t, L0) => { const k = Math.min(H - 1, t + L0), key = t * 64 + L0; let v = fcT.get(key); if (v === undefined) { v = world.temp[k] + f * 3.5 * Math.sqrt(L0 / 24) * noise(11, k, Math.floor(t / 6)); fcT.set(key, v); } return v; },
      wind: (t, L0) => { const k = Math.min(H - 1, t + L0); return clamp(world.wind[k] + f * 0.18 * Math.sqrt(L0 / 24) * noise(12, k, Math.floor(t / 6)), 0.01, 0.97); },
      price: (t, L0) => { const k = Math.min(H - 1, t + L0); return world.price[k] * (1 + f * 0.25 * Math.sqrt(L0 / 24) * noise(13, k, Math.floor(t / 6))); },
      demand: (id, t, L0) => {
        const key = (t * 64 + L0) * 8 + id.charCodeAt(1); let v = fcD.get(key); if (v !== undefined) return v;
        v = fcDemand(id, t, L0); fcD.set(key, v); return v;
      },
      demandRaw: (id, t, L0) => {
        const k = Math.min(H - 1, t + L0);
        const evs = Object.assign({}, world.events);
        if (evs.peak && k >= EVENTS.peak.day * 24 && t < EVENTS.peak.day * 24 - EVENTS.peak.forecastLead + 0) evs.peak = false;
        return demandProfile(id, k, fc.temp(t, L0), evs) * (1 + f * 0.05 * noise(14, k, id.charCodeAt(1)));
      },
      travel: (t, L0) => { const k = Math.min(H - 1, t + L0); const e = EVENTS.storm; if (!world.events.storm) return 1; const a = e.day * 24 + e.from; return (k >= a && k < e.day * 24 + e.to && t >= a - e.forecastLead) ? 2.5 : 1; },
      p1: (t, L0) => { // the twin sees the outage once it has happened and assumes a 24 h repair
        const k = t + L0; if (!world.events.outage) return 1; const a = EVENTS.outage.day * 24 + EVENTS.outage.from;
        if (t >= a && world.p1avail[Math.min(H - 1, t)] === 0) return k < Math.max(t + 1, a + 24) ? 0 : 1; return 1;
      }
    };

    function dispatch(t, trailer, from, to, back) {
      const mult = world.travel[t], tt = travelH(from, to, mult);
      const tArrive = t + Math.max(1, Math.ceil(tt + P.handling * 0.5));
      const tReturn = tArrive + Math.max(1, Math.ceil(tt + P.handling * 0.5 + (strategy === 'A' ? P.decant : 0)));
      if (trailer) trailer.at = null;
      const trip = { tr: trailer ? trailer.id : null, from, to, tStart: t, tArrive, tReturn, h2: trailer ? trailer.h2 : 0, back: back != null ? back : null, backTo: from, done: false, backDone: false };
      trips.push(trip); K.km += 2 * DIST[from][to]; K.stops += 2;
      return trip;
    }

    for (let t = 0; t < H; t++) {
      const cf = world.wind[t], pr = world.price[t], T = world.temp[t], hod = t % 24;
      // ---- 1. arrivals and returns
      for (const tp of trips) {
        if (!tp.done && tp.tArrive === t) {
          tp.done = true;
          if (tp.tr != null) {
            const tr = trailers[tp.tr];
            if (strategy === 'A') { const q = Math.min(usable(tr), cap[tp.to] - stat[tp.to]); stat[tp.to] += q; tr.h2 -= q; tp.back = tr.id; }
            else {
              const d = docked(tp.to), site = SITES.find(s => s.id === tp.to);
              if (d.length >= site.bays) { const out = d.reduce((a, b) => (a.h2 <= b.h2 ? a : b)); const q = Math.min(usable(out), cap[tp.to] - stat[tp.to]); stat[tp.to] += q; out.h2 -= q; out.at = null; tp.back = out.id; }
              tr.at = tp.to;
            }
          } else if (tp.back != null) { trailers[tp.back].at = null; }
        }
        if (!tp.backDone && tp.tReturn === t) { tp.backDone = true; if (tp.back != null) trailers[tp.back].at = tp.backTo; }
      }
      // ---- 2. production
      const prodNow = { P1: 0, P2: 0 };
      const space = pid => docked(pid).reduce((a, tr) => a + (P.trailerCap - tr.h2), 0) + (cap[pid] - stat[pid]);
      const planned = planProduction(t);
      for (const p of PROD) {
        const avail = p.id === 'P1' ? world.p1avail[t] : 1;
        const want = Math.min(planned[p.id], capKgH(p, T) * avail);
        let kg = Math.min(want, space(p.id));
        K.blocked = (K.blocked || 0) + Math.max(0, want - Math.max(0, kg));
        kg = Math.max(0, kg);
        if (kg > 0) {
          let rest = kg;
          const ds = docked(p.id).sort((a, b) => b.h2 - a.h2);
          for (const tr of ds) { const q = Math.min(rest, P.trailerCap - tr.h2); tr.h2 += q; rest -= q; if (rest <= 0) break; }
          stat[p.id] += rest;
          const cost = elecCost(p.id, kg, cf, pr, T);
          K.energyCost += cost; K.energyMWh += kg * sec(T) / 1000; K.prodKg += kg;
        }
        // move producer buffer into trailers waiting there
        for (const tr of docked(p.id).sort((a, b) => b.h2 - a.h2)) { const q = Math.min(stat[p.id], P.trailerCap - tr.h2); tr.h2 += q; stat[p.id] -= q; }
        prodNow[p.id] = kg;
      }
      // ---- 3. demand
      let anyUnmet = false; const anyUnmetBy = {};
      for (const s of DEM) {
        let need = world.demand[s.id][t]; K.demand += need; K.demandBy[s.id] += need;
        const ds = docked(s.id).sort((a, b) => a.h2 - b.h2);
        for (const tr of ds) { const q = Math.min(need, usable(tr)); tr.h2 -= q; need -= q; if (need <= 1e-9) break; }
        const q = Math.min(need, stat[s.id]); stat[s.id] -= q; need -= q;
        if (need > 0.5) { K.unmet += need; K.unmetBy[s.id] += need; anyUnmet = true; anyUnmetBy[s.id] = true; }
        K.served += world.demand[s.id][t] - Math.max(0, need);
        if (strategy !== 'A') { let room = Math.min(P.transfer, cap[s.id] - stat[s.id]); for (const tr of docked(s.id).sort((a, b) => b.h2 - a.h2)) { const x = Math.min(room, usable(tr)); tr.h2 -= x; stat[s.id] += x; room -= x; if (room <= 0) break; } }
        if (log) { L.inv[s.id].push(pool(s.id)); L.unmet[s.id].push(Math.max(0, need)); }
      }
      if (anyUnmet) K.stockoutHours++;
      // ---- 4. dispatch
      if (strategy === 'A') dispatchA(t); else if (strategy === 'B') dispatchTimetable(t, anyUnmetBy); else if (strategy === 'S') dispatchB(t); else dispatchC(t);
      collectEmpties(t);
      // ---- 5. bookkeeping
      const sys = systemStock(); K.invSum += sys; K.statSum += Object.values(stat).reduce((a, b) => a + b, 0);
      priceMean = priceMean * (1 - 1 / 168) + pr / 168;
      if (log) { L.price.push(pr); L.wind.push(cf); L.temp.push(T); L.prod.P1.push(prodNow.P1); L.prod.P2.push(prodNow.P2); L.sys.push(sys); L.tr.push(trailers.map(tr => [tr.at, Math.round(tr.h2)])); L.stat.push(Object.assign({}, stat)); }
    }

    // ---------------------------------------------------------------- production planning per strategy
    function planProduction(t) {
      const cf = world.wind[t], pr = world.price[t], T = world.temp[t];
      const out = { P1: 0, P2: 0 };
      const sys = systemStock();
      if (strategy === 'A') {
        const capTot = Object.values(cap).reduce((a, b) => a + b, 0) + P.trailers * P.trailerCap;
        const ratio = sys / capTot;
        for (const p of PROD) {
          const c = marginalCost(p.id, cf, pr, T, p.mw);
          if (c <= priceMean + 5 || ratio < 0.3) out[p.id] = 1e9; else if (ratio < 0.5) out[p.id] = capKgH(p, T) * 0.5;
        }
        return out;
      }
      if (strategy === 'B' || strategy === 'S') {
        const planned = 2150 / 24, low = sys < 2500, high = sys > 7000;
        out.P1 = planned * 0.6 * (low ? 2.5 : high ? 0.3 : 1); out.P2 = planned * 0.4 * (low ? 2.5 : high ? 0.3 : 1);
        return out;
      }
      // C: digital twin. Production is planned backwards from the delivery plan (see twinPlan).
      const plan = twinPlan(t);
      return plan.prod;
    }

    // ---------------------------------------------------------------- the twin's rolling 48 h plan
    // 1. For every user, project the hydrogen on site with forecast demand and find when a trailer must arrive.
    // 2. Turn each arrival into a departure deadline (road forecast, cold margin).
    // 3. Schedule electrolyser hours backwards from those deadlines, cheapest forecast power first,
    //    plus a weather-aware reserve kept as one spare full trailer (mobile storage, not tanks).
    function twinPlan(t) {
      if (planCache.t === t) return planCache;
      const HZ = 48, needs = [];
      let minT = 0; for (let h = 0; h < 36; h++) minT = Math.min(minT, fc.temp(t, h));
      const coldMargin = minT < -20 ? 2 : 0;
      for (const s of DEM) {
        const arr = enroute(s.id, t);
        let inv = pool(s.id);
        let peak = 0; for (let h = 0; h < 6; h++) peak = Math.max(peak, fc.demand(s.id, t, h));
        const safety = peak * (cfg.safetyH || 1.5) + 40;
        let first = true;
        for (let h = 1; h <= HZ; h++) {
          for (const tp of arr) if (tp.tArrive === t + h) inv += usable(trailers[tp.tr]);
          inv -= fc.demand(s.id, t, h);
          if (inv < safety) {
            const leads = ['P1', 'P2'].map(pid => { let mult = 1; for (let k = 0; k <= h; k++) mult = Math.max(mult, fc.travel(t, k)); return { pid, lead: Math.ceil(travelH(pid, s.id, mult) + P.handling * 0.5) }; }).sort((x, y) => x.lead - y.lead);
            needs.push({ site: s.id, needBy: h, lead: leads[0].lead, dep: h - leads[0].lead - 2 - coldMargin, first });
            inv += P.trailerCap - P.heel - 50; first = false;
          }
        }
      }
      needs.sort((x, y) => x.dep - y.dep);
      // production: hydrogen ready at producers must cover each departure in time
      const atProd = trailers.filter(tr => tr.at === 'P1' || tr.at === 'P2').reduce((a, tr) => a + tr.h2, 0) + stat.P1 + stat.P2;
      const spare = (cfg.spare == null ? 850 : cfg.spare) + 40 * Math.max(0, -15 - minT);
      const req = new Array(HZ).fill(0);
      for (const n of needs) { const h = clamp(n.dep, 0, HZ - 1); for (let k = h; k < HZ; k++) req[k] += P.trailerCap - 50; }
      for (let k = 0; k < HZ; k++) req[k] += spare * Math.min(1, (k + 1) / 6);
      const slots = [];
      for (let h = 0; h < HZ && t + h < world.H; h++) {
        const Tf = h === 0 ? world.temp[t] : fc.temp(t, h), cff = h === 0 ? world.wind[t] : fc.wind(t, h), prf = h === 0 ? world.price[t] : fc.price(t, h);
        for (const p of PROD) {
          const av = p.id === 'P1' ? (h === 0 ? world.p1avail[t] : fc.p1(t, h)) : 1; if (!av) continue;
          const capk = capKgH(p, Tf);
          if (p.id === 'P1') {
            const ppaKg = Math.min(capk, cff * P.ppaMW * 1000 / sec(Tf));
            if (ppaKg > 0.5) slots.push({ h, p: 'P1', kg: ppaKg, c: P.ppaPrice * sec(Tf) });
            if (capk - ppaKg > 0.5) slots.push({ h, p: 'P1', kg: capk - ppaKg, c: (prf + P.feeP1) * sec(Tf) });
          } else slots.push({ h, p: 'P2', kg: capk, c: (prf + P.feeP2) * sec(Tf) });
        }
      }
      slots.sort((x, y) => x.c - y.c);
      const used = new Array(slots.length).fill(0), prod = { P1: 0, P2: 0 };
      let alloc = 0;
      for (let h = 0; h < HZ; h++) {
        let deficit = req[h] - atProd - alloc;
        if (deficit <= 0) continue;
        for (let i = 0; i < slots.length && deficit > 0; i++) {
          const sl = slots[i]; if (sl.h > Math.max(0, h - 1)) continue;
          const q = Math.min(sl.kg - used[i], deficit); if (q <= 0) continue;
          used[i] += q; alloc += q; deficit -= q; if (sl.h === 0) prod[sl.p] += q;
        }
      }
      // very cheap power: keep filling trailers that are already at the producers (no stationary tanks)
      for (let i = 0; i < slots.length; i++) { const sl = slots[i]; if (sl.h === 0 && sl.c < 22 * sec(world.temp[t])) prod[sl.p] = Math.max(prod[sl.p], used[i] + (sl.kg - used[i])); }
      planCache = { t, needs, prod };
      return planCache;
    }

    // ---------------------------------------------------------------- dispatch rules
    function freeTractor(t) { return busy(t) < (cfg.tractors || P.tractors); }
    function sourceTrailer(minKg, prefer) {
      let best = null;
      for (const p of prefer) for (const tr of docked(p)) if (tr.h2 >= minKg && (!best || tr.h2 > best.tr.h2 + 1)) best = { p, tr };
      return best;
    }
    function dispatchA(t) {
      const order = DEM.slice().sort((a, b) => (stat[a.id] / cap[a.id]) - (stat[b.id] / cap[b.id]));
      for (const s of order) {
        if (!freeTractor(t)) return;
        const inb = enroute(s.id, t).reduce((a, tp) => a + trailers[tp.tr].h2, 0);
        if (stat[s.id] + inb < 0.55 * cap[s.id]) {
          const src = sourceTrailer(650, ['P1', 'P2'].sort((a, b) => DIST[a][s.id] - DIST[b][s.id]));
          if (src) dispatch(t, src.tr, src.p, s.id);
        }
      }
    }
    function dispatchB(t) {
      for (const s of DEM) {
        if (!freeTractor(t)) return;
        const near = ['P1', 'P2'].sort((a, b) => DIST[a][s.id] - DIST[b][s.id]);
        const inb = enroute(s.id, t).reduce((a, tp) => a + usable(trailers[tp.tr]), 0);
        const rop = s.id === 'D4' ? 1150 : AVG_DAILY[s.id] / 24 * (cfg.ropHours || 10) + 250;
        if (pool(s.id) + inb < rop && enroute(s.id, t).length === 0) {
          const src = sourceTrailer(700, near);
          if (src) dispatch(t, src.tr, src.p, s.id);
        }
      }
    }
    // fixed weekly timetable planned from average demand, no live data; a site that runs dry phones in
    function dispatchTimetable(t, dryNow) {
      const hod = t % 24, dow = Math.floor(t / 24) % 7;
      const want = [];
      const every = { D1: 30, D2: 44, D3: 28 }, offset = { D1: 14, D2: 8, D3: 20 };
      for (const id of ['D1', 'D2', 'D3']) if (t >= offset[id] && (t - offset[id]) % every[id] === 0) want.push(id);
      if ((dow === 1 || dow === 4) && (hod === 3 || hod === 5)) want.push('D4');
      for (const id of Object.keys(dryNow)) if (!enroute(id, t).length && !want.includes(id)) want.push(id);
      for (const id of want) {
        if (!freeTractor(t)) return;
        const near = ['P1', 'P2'].sort((a, b) => DIST[a][id] - DIST[b][id]);
        const src = sourceTrailer(600, near) || sourceTrailer(250, near);
        if (src) dispatch(t, src.tr, src.p, id);
      }
    }
    function dispatchC(t) {
      const plan = twinPlan(t), done = {};
      for (const n of plan.needs) {
        if (n.dep > 0 || done[n.site] || !n.first) continue;
        if (!freeTractor(t)) return;
        const site = SITES.find(s => s.id === n.site), d = docked(n.site), arr = enroute(n.site, t);
        const freeBays = site.bays - d.length + d.filter(tr => usable(tr) < 400).length - arr.length;
        if (freeBays <= 0) continue;
        const cands = ['P1', 'P2'].map(pid => ({ pid, lead: Math.ceil(travelH(pid, n.site, world.travel[t]) + P.handling * 0.5) }));
        let best = null;
        for (const c of cands) for (const tr of docked(c.pid)) if (tr.h2 >= 750 && (!best || c.lead < best.lead || (c.lead === best.lead && tr.h2 > best.tr.h2))) best = { ...c, tr };
        if (!best && n.needBy <= Math.min(...cands.map(c => c.lead)) + 1)
          for (const c of cands) for (const tr of docked(c.pid)) if (tr.h2 >= 350 && (!best || tr.h2 > best.tr.h2)) best = { ...c, tr };
        if (best) { dispatch(t, best.tr, best.pid, n.site); done[n.site] = true; }
      }
    }
    function collectEmpties(t) { // bring empty trailers home when producers run short of trailers to fill
      if (strategy === 'A') return;
      const atProd = trailers.filter(tr => tr.at === 'P1' || tr.at === 'P2').length;
      if (strategy === 'C') {
        const portNeed = twinPlan(t).needs.find(n => n.site === 'D4');
        const idle = docked('D4').filter(tr => usable(tr) < 150);
        if (idle.length && (!portNeed || portNeed.needBy > 30) && !enroute('D4', t).length && freeTractor(t)) { const tp = dispatch(t, null, 'P1', 'D4', idle[0].id); tp.backTo = 'P1'; K.stops -= 1; }
      }
      if (atProd >= 2) return;
      for (const s of DEM) {
        if (!freeTractor(t)) return;
        const empties = docked(s.id).filter(tr => tr.h2 - P.heel < 30);
        if (!empties.length || enroute(s.id, t).length) continue;
        const p = ['P1', 'P2'].sort((a, b) => DIST[a][s.id] - DIST[b][s.id])[0];
        const tp = dispatch(t, null, p, s.id, empties[0].id); tp.backTo = p; K.stops -= 1;
        break;
      }
    }

    // ---------------------------------------------------------------- results
    const endStock = systemStock();
    const statKg = Object.values(cap).reduce((a, b) => a + b, 0);
    const storageCost = statKg * P.storageCapex * P.annuity * H / 8760;
    const truckCost = K.km * P.truckKm + K.stops * P.truckStop;
    const revenue = K.served * P.h2Price, penaltyCost = K.unmet * P.penalty;
    const stockAdj = (initStock - endStock) * P.stockValue;
    const totalCost = K.energyCost + truckCost + storageCost + penaltyCost + stockAdj;
    return {
      strategy, cap, statKg,
      service: K.served / K.demand, demand: K.demand, served: K.served, unmet: K.unmet, unmetBy: K.unmetBy, demandBy: K.demandBy,
      stockoutHours: K.stockoutHours, prodKg: K.prodKg, energyMWh: K.energyMWh, energyCost: K.energyCost,
      avgPrice: K.energyCost / Math.max(1, K.energyMWh), km: K.km, trips: trips.filter(tp => tp.tr != null).length,
      truckCost, storageCost, penaltyCost, stockAdj, revenue, totalCost, margin: revenue - totalCost,
      costPerKg: (K.energyCost + truckCost + storageCost + stockAdj) / Math.max(1, K.served),
      avgInventory: K.invSum / H, blocked: K.blocked, avgStationary: K.statSum / H, log: log ? L : null
    };
  }

  // ------------------------------------------------------------------ analyses
  function frontier(world, strategy, daysList, extra = {}) {
    return daysList.map(d => { const r = simulate(world, strategy, Object.assign({ storageDays: d, log: false }, extra)); return { days: d, statKg: r.statKg, service: r.service, margin: r.margin, costPerKg: r.costPerKg }; });
  }
  function minStorageFor(world, strategy, target = 0.995, extra = {}) {
    let lo = 0, hi = 4, rHi = simulate(world, strategy, Object.assign({ storageDays: hi, log: false }, extra));
    if (rHi.service < target) return { days: null, statKg: null };
    const r0 = simulate(world, strategy, Object.assign({ storageDays: 0, log: false }, extra));
    if (r0.service >= target) return { days: 0, statKg: r0.statKg };
    for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; const r = simulate(world, strategy, Object.assign({ storageDays: mid, log: false }, extra)); if (r.service >= target) hi = mid; else lo = mid; }
    const r = simulate(world, strategy, Object.assign({ storageDays: hi, log: false }, extra));
    return { days: hi, statKg: r.statKg };
  }

  const api = { P, SITES, DIST, EVENTS, PORT_KG, makeWorld, simulate, frontier, minStorageFor, demandProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.H2Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
