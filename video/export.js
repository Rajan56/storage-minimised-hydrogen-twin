const S = require('../sim.js'); const fs = require('fs');
const w = S.makeWorld({});
const R = {}; for (const st of ['A','B','S','C']) R[st] = S.simulate(w, st);
const k = r => ({ statKg: r.statKg, service: r.service, unmet: r.unmet, soH: r.stockoutHours, avgInv: r.avgInventory, price: r.avgPrice, costKg: r.costPerKg, margin: r.margin, km: r.km, trips: r.trips });
const daily = (r) => { const L = r.log, out = []; for (let d = 0; d < 30; d++) out.push(['D1','D2','D3','D4'].map(s => L.unmet[s].slice(d*24, d*24+24).reduce((a,b)=>a+b,0))); return out; };
// supply vs demand illustration: wind-following production (P1 at wind share) vs total demand, days 1-5
const sup = [], dem = [];
for (let t = 24; t < 24*6; t++) { sup.push(Math.min(1, w.wind[t] / 0.5) * 236 * 0.55); dem.push(['D1','D2','D3'].reduce((a,s)=>a+w.demand[s][t],0)); }
// a 48 h window of the twin plan (from hour 13*24)
const t0 = 12*24, C = R.C.log;
const win = { price: C.price.slice(t0, t0+48), prod: C.prod.P1.slice(t0,t0+48).map((x,i)=>x+C.prod.P2[t0+i]), wind: C.wind.slice(t0,t0+48) };
// trips of the twin over days 12-14 for the map animation
const trips = C.trips.filter(tp => tp.tStart >= t0 && tp.tStart < t0 + 72).map(tp => ({ from: tp.from, to: tp.to, s: tp.tStart - t0, a: tp.tArrive - t0, r: tp.tReturn - t0, full: tp.tr != null, h2: tp.h2 }));
const data = { kpi: { A: k(R.A), B: k(R.B), S: k(R.S), C: k(R.C) }, dailyB: daily(R.B), dailyC: daily(R.C), sup, dem, win, trips,
  sites: S.SITES.map(s => ({ id: s.id, type: s.type, short: s.short, x: s.x, y: s.y })), events: S.EVENTS, statA: R.A.cap };
fs.writeFileSync('data.json', JSON.stringify(data));
console.log(JSON.stringify(data.kpi, null, 1)); console.log('trips', trips.length, 'win price', Math.min(...win.price).toFixed(0), Math.max(...win.price).toFixed(0));
