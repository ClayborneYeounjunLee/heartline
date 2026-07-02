#!/usr/bin/env node
/**
 * make_samples.js — 데모용 가짜 러닝 데이터 생성 → data/samples/
 * 실제 GPS가 아닌 합성 데이터 (공개 리포에 포함해도 안전).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "data", "samples");
fs.mkdirSync(OUT, { recursive: true });

/* 결정적 의사난수 (실행할 때마다 같은 샘플) */
let seed = 42;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

/* 중심점 기준 루프 경로 합성: 반지름을 천천히 변조한 폐곡선 + 노이즈 */
function makeLoop(centerLat, centerLng, radiusM, points, wobble) {
  const latlng = [];
  const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  for (let i = 0; i < points; i++) {
    const th = 2 * Math.PI * i / points;
    const r = radiusM * (1 + wobble * Math.sin(3 * th) + 0.15 * wobble * Math.sin(7 * th + 1.3) + 0.02 * (rnd() - 0.5));
    latlng.push([
      centerLat + (r * Math.sin(th)) / mPerDegLat,
      centerLng + (r * Math.cos(th)) / mPerDegLng,
    ]);
  }
  latlng.push(latlng[0]);
  return latlng;
}
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeRun(cfg) {
  const ll = makeLoop(cfg.lat, cfg.lng, cfg.radius, cfg.points, cfg.wobble);
  let dist = 0;
  for (let i = 1; i < ll.length; i++) dist += haversine(ll[i - 1], ll[i]);
  const n = ll.length;
  const time_s = [], hr = [], alt_m = [];
  const paceSec = cfg.paceSecPerKm;
  let t = 0, cum = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) { cum += haversine(ll[i - 1], ll[i]); t = Math.round(cum / 1000 * paceSecAt(i / n, cfg)); }
    time_s.push(t);
    hr.push(Math.round(hrAt(i / n, cfg) + 3 * Math.sin(i / 5) + 2 * (rnd() - 0.5)));
    alt_m.push(Math.round((cfg.altBase + cfg.altAmp * Math.sin(2 * Math.PI * i / n + 0.7) + cfg.altAmp * 0.4 * Math.sin(6 * Math.PI * i / n)) * 10) / 10);
  }
  function paceSecAt(p, c) { return paceSec * (c.intervals ? (Math.sin(p * 24) > 0.3 ? 0.82 : 1.12) : (1 + 0.06 * Math.sin(p * 5))); }
  function hrAt(p, c) {
    const warm = Math.min(1, p / 0.12);                        // 워밍업 램프
    let base = c.hrBase + (c.hrPeak - c.hrBase) * warm * (0.85 + 0.15 * p);
    if (c.intervals && Math.sin(p * 24) > 0.3) base += 18;     // 인터벌 스파이크
    if (c.altAmp > 20) base += 10 * Math.max(0, Math.sin(2 * Math.PI * p + 0.7)); // 오르막 반응
    return base;
  }
  const moving = time_s[n - 1];
  const avgHr = Math.round(hr.reduce((a, b) => a + b, 0) / n);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: ll.map(p => [Number(p[1].toFixed(6)), Number(p[0].toFixed(6))]) },
    properties: {
      id: cfg.id, name: cfg.name, sport_type: "Run", start_date: cfg.date,
      distance_m: Math.round(dist), moving_time_s: moving, elapsed_time_s: moving + 40,
      elev_gain_m: cfg.altAmp > 20 ? Math.round(cfg.altAmp * 2.4) : Math.round(cfg.altAmp * 0.8),
      avg_hr: avgHr, max_hr: Math.max(...hr),
      streams: { hr, time_s, alt_m },
    },
  };
}

const runs = [
  makeRun({ id: "sample-1", name: "한강 아침 러닝 (샘플)", date: "2026-06-28T07:10:00",
    lat: 37.5279, lng: 126.9345, radius: 1250, points: 420, wobble: 0.25,
    paceSecPerKm: 330, hrBase: 118, hrPeak: 158, altBase: 14, altAmp: 6 }),
  makeRun({ id: "sample-2", name: "남산 언덕 러닝 (샘플)", date: "2026-06-25T18:40:00",
    lat: 37.5512, lng: 126.9882, radius: 900, points: 300, wobble: 0.35,
    paceSecPerKm: 395, hrBase: 122, hrPeak: 172, altBase: 90, altAmp: 55 }),
  makeRun({ id: "sample-3", name: "인터벌 400m×8 (샘플)", date: "2026-06-22T19:05:00",
    lat: 37.5666, lng: 126.8975, radius: 640, points: 360, wobble: 0.12,
    paceSecPerKm: 305, hrBase: 115, hrPeak: 150, altBase: 8, altAmp: 3, intervals: true }),
];

for (const r of runs) fs.writeFileSync(path.join(OUT, r.properties.id + ".geojson"), JSON.stringify(r), "utf8");
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({
  runs: runs.map(r => ({
    id: r.properties.id, file: r.properties.id + ".geojson", name: r.properties.name,
    sport_type: "Run", start_date: r.properties.start_date, distance_m: r.properties.distance_m,
    moving_time_s: r.properties.moving_time_s, elev_gain_m: r.properties.elev_gain_m,
    avg_hr: r.properties.avg_hr, max_hr: r.properties.max_hr, has_hr: true,
  })),
}, null, 1), "utf8");
console.log("✔ 샘플 " + runs.length + "건 생성 → data/samples/");
