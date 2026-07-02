#!/usr/bin/env node
/**
 * strava_pull.js — Strava 러닝 기록 → data/runs/*.geojson 수집기 (의존성 제로, Node 18+)
 *
 * 사용법:
 *   node tools/strava_pull.js --auth          # 1단계: 브라우저 인증 URL 출력
 *   node tools/strava_pull.js --token <code>  # 2단계: 인증 code → refresh_token 저장
 *   node tools/strava_pull.js --check         # Mi Fitness→Strava 심박 동기화 검증 (약한 고리 테스트)
 *   node tools/strava_pull.js                 # 동기화: 새 활동 → GeoJSON 저장 + index.json 갱신
 *   node tools/strava_pull.js --force         # 이미 받은 활동도 다시 받기
 *
 * 설정: tools/.env (tools/.env.example 참고 — 절대 커밋 금지, .gitignore 처리됨)
 *
 * ⚠️ Strava 약관(2024 개정): API로 받은 데이터는 "본인에게만" 표시 가능.
 *    → data/runs/ 를 공개 저장소/공개 사이트에 올리지 말 것. AI 모델 입력도 금지.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(__dirname, ".env");
const RUNS_DIR = path.join(ROOT, "data", "runs");

/* ── .env 읽기/쓰기 (refresh token 회전 시 새 값 저장이 필수라 쓰기도 지원) ── */
function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_PATH)) return env;
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
function saveEnvKey(key, value) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const re = new RegExp("^\\s*" + key + "\\s*=.*$", "m");
  if (re.test(text)) text = text.replace(re, key + "=" + value);
  else text += (text.endsWith("\n") || text === "" ? "" : "\n") + key + "=" + value + "\n";
  fs.writeFileSync(ENV_PATH, text, "utf8");
}

const ENV = loadEnv();
const CLIENT_ID = ENV.STRAVA_CLIENT_ID;
const CLIENT_SECRET = ENV.STRAVA_CLIENT_SECRET;
const TRIM_METERS = Number(ENV.TRIM_METERS ?? 200);       // 집 위치 보호: 시작/끝 N m 잘라내기
const ACTIVITY_TYPES = (ENV.ACTIVITY_TYPES || "Run,TrailRun,VirtualRun").split(",").map(s => s.trim());
const MAX_ACTIVITIES = Number(ENV.MAX_ACTIVITIES ?? 200);

function die(msg) { console.error("✖ " + msg); process.exit(1); }
function requireApp() {
  if (!CLIENT_ID || !CLIENT_SECRET)
    die("tools/.env 에 STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET 를 먼저 채워주세요 (.env.example 참고).\n  발급: https://www.strava.com/settings/api");
}

/* ── OAuth ── */
async function tokenRequest(params) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  if (!res.ok) die("토큰 요청 실패 HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  return res.json();
}

async function getAccessToken() {
  requireApp();
  if (!ENV.STRAVA_REFRESH_TOKEN)
    die("refresh token이 없습니다. 먼저:\n  1) node tools/strava_pull.js --auth\n  2) node tools/strava_pull.js --token <code>");
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: ENV.STRAVA_REFRESH_TOKEN });
  /* ⚠️ refresh token 회전: 새 값이 오면 반드시 저장 (안 하면 며칠 뒤 조용히 죽음) */
  if (j.refresh_token && j.refresh_token !== ENV.STRAVA_REFRESH_TOKEN) {
    saveEnvKey("STRAVA_REFRESH_TOKEN", j.refresh_token);
    console.log("↻ refresh token 회전됨 → .env 갱신 완료");
  }
  return j.access_token;
}

async function api(pathname, token) {
  const res = await fetch("https://www.strava.com/api/v3" + pathname, {
    headers: { Authorization: "Bearer " + token },
  });
  if (res.status === 429) die("레이트리밋 초과(429). 15분 뒤 다시 시도하세요.");
  if (!res.ok) throw new Error("HTTP " + res.status + " " + pathname);
  return res.json();
}

/* ── 지오 유틸 ── */
function haversine(a, b) { // [lat,lng] m
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* 프라이버시 트리밍: 시작/끝에서 TRIM_METERS 이내 포인트 제거 */
function privacyTrim(latlng, aligned) {
  if (!TRIM_METERS || latlng.length < 10) return { latlng, aligned };
  let cum = 0, startIdx = 0;
  for (let i = 1; i < latlng.length; i++) {
    cum += haversine(latlng[i - 1], latlng[i]);
    if (cum >= TRIM_METERS) { startIdx = i; break; }
  }
  cum = 0; let endIdx = latlng.length - 1;
  for (let i = latlng.length - 1; i > 0; i--) {
    cum += haversine(latlng[i], latlng[i - 1]);
    if (cum >= TRIM_METERS) { endIdx = i; break; }
  }
  if (endIdx - startIdx < 5) return { latlng, aligned }; // 너무 짧으면 트리밍 포기
  const slice = arr => (arr ? arr.slice(startIdx, endIdx + 1) : arr);
  return {
    latlng: latlng.slice(startIdx, endIdx + 1),
    aligned: Object.fromEntries(Object.entries(aligned).map(([k, v]) => [k, slice(v)])),
  };
}

/* ── GeoJSON 변환 ── */
function toGeoJSON(act, streams) {
  const latlng = streams.latlng.data;
  const aligned = {
    hr: streams.heartrate ? streams.heartrate.data : null,
    time_s: streams.time ? streams.time.data : null,
    alt_m: streams.altitude ? streams.altitude.data : null,
  };
  const trimmed = privacyTrim(latlng, aligned);
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: trimmed.latlng.map(p => [Number(p[1].toFixed(6)), Number(p[0].toFixed(6))]), // [lon,lat]
    },
    properties: {
      id: String(act.id),
      name: act.name,
      sport_type: act.sport_type || act.type,
      start_date: act.start_date_local || act.start_date,
      distance_m: Math.round(act.distance),
      moving_time_s: act.moving_time,
      elapsed_time_s: act.elapsed_time,
      elev_gain_m: act.total_elevation_gain,
      avg_hr: act.average_heartrate || null,
      max_hr: act.max_heartrate || null,
      streams: {
        hr: trimmed.aligned.hr,
        time_s: trimmed.aligned.time_s,
        alt_m: trimmed.aligned.alt_m ? trimmed.aligned.alt_m.map(v => Math.round(v * 10) / 10) : null,
      },
    },
  };
}

function rebuildIndex() {
  const runs = [];
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith(".geojson")) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")).properties;
      runs.push({
        id: p.id, file: f, name: p.name, sport_type: p.sport_type, start_date: p.start_date,
        distance_m: p.distance_m, moving_time_s: p.moving_time_s, elev_gain_m: p.elev_gain_m,
        avg_hr: p.avg_hr, max_hr: p.max_hr, has_hr: !!(p.streams && p.streams.hr),
      });
    } catch { /* skip broken file */ }
  }
  runs.sort((a, b) => b.start_date.localeCompare(a.start_date));
  fs.writeFileSync(path.join(RUNS_DIR, "index.json"), JSON.stringify({ runs }, null, 1), "utf8");
  return runs.length;
}

/* ── 명령들 ── */
const args = process.argv.slice(2);

if (args[0] === "--auth") {
  requireApp();
  const url = "https://www.strava.com/oauth/authorize?client_id=" + CLIENT_ID +
    "&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all";
  console.log("1) 아래 URL을 브라우저에서 열고 [Authorize] 클릭:\n\n" + url +
    "\n\n2) localhost로 리다이렉트되면(페이지는 안 떠도 됨) 주소창의 code=XXXX 값을 복사해서:\n   node tools/strava_pull.js --token XXXX");
  process.exit(0);
}

if (args[0] === "--token") {
  if (!args[1]) die("사용법: node tools/strava_pull.js --token <code>");
  requireApp();
  (async () => {
    const j = await tokenRequest({ grant_type: "authorization_code", code: args[1] });
    saveEnvKey("STRAVA_REFRESH_TOKEN", j.refresh_token);
    console.log("✔ 인증 완료: " + (j.athlete ? j.athlete.firstname + " " + (j.athlete.lastname || "") : "") +
      "\n  refresh token 저장됨 → 이제 node tools/strava_pull.js --check 로 심박 동기화를 검증하세요.");
  })().catch(e => die(e.message));
  return;
}

if (args[0] === "--check") {
  /* Mi Fitness→Strava 파이프라인의 약한 고리(심박 누락) 검증 */
  (async () => {
    const token = await getAccessToken();
    const acts = await api("/athlete/activities?per_page=5", token);
    if (!acts.length) die("활동이 없습니다. 야외 러닝을 하나 기록하고 Mi Fitness→Strava 동기화 후 다시 실행하세요.");
    console.log("최근 활동 " + acts.length + "건:\n");
    for (const a of acts) {
      console.log("· [" + (a.start_date_local || "").slice(0, 16) + "] " + a.name +
        "  (" + (a.sport_type || a.type) + ", " + (a.distance / 1000).toFixed(1) + "km)");
      console.log("    요약 심박: " + (a.has_heartrate ? "✔ avg " + a.average_heartrate + " / max " + a.max_heartrate : "✖ 없음"));
    }
    const latest = acts.find(a => ACTIVITY_TYPES.includes(a.sport_type || a.type)) || acts[0];
    console.log("\n→ 최신 활동의 스트림 확인: " + latest.name);
    try {
      const st = await api("/activities/" + latest.id + "/streams?keys=latlng,heartrate,time,altitude&key_by_type=true", token);
      const rows = [["latlng", st.latlng], ["heartrate", st.heartrate], ["time", st.time], ["altitude", st.altitude]];
      for (const [k, v] of rows) console.log("    " + k.padEnd(10) + (v ? "✔ " + v.data.length + " samples" : "✖ 없음"));
      console.log(st.heartrate && st.latlng
        ? "\n✅ 심박+GPS 스트림 확인 — 지도에 심박 입히기 가능! 이제 `node tools/strava_pull.js` 로 동기화하세요."
        : st.latlng
          ? "\n⚠️ GPS는 오지만 심박 스트림이 없습니다. Mi Fitness 동기화가 심박을 누락 → 대안: Health Connect 경유 또는 공식 데이터 내보내기."
          : "\n⚠️ GPS 스트림이 없습니다 (실내 활동이거나 동기화 문제).");
    } catch (e) { console.log("    스트림 조회 실패: " + e.message); }
  })().catch(e => die(e.message));
  return;
}

/* 기본: 동기화 */
(async () => {
  const force = args.includes("--force");
  const token = await getAccessToken();
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  const existing = new Set(fs.readdirSync(RUNS_DIR).filter(f => f.endsWith(".geojson")).map(f => f.replace(".geojson", "")));
  let page = 1, fetched = 0, saved = 0, skipped = 0;

  while (fetched < MAX_ACTIVITIES) {
    const batch = await api("/athlete/activities?per_page=50&page=" + page, token);
    if (!batch.length) break;
    for (const act of batch) {
      if (fetched >= MAX_ACTIVITIES) break;
      fetched++;
      const type = act.sport_type || act.type;
      if (!ACTIVITY_TYPES.includes(type)) continue;
      if (!force && existing.has(String(act.id))) { skipped++; continue; }
      let st;
      try {
        st = await api("/activities/" + act.id + "/streams?keys=latlng,heartrate,time,altitude&key_by_type=true", token);
      } catch { console.log("  · " + act.name + " — 스트림 없음(실내?) 건너뜀"); continue; }
      if (!st.latlng) { console.log("  · " + act.name + " — GPS 없음 건너뜀"); continue; }
      const geo = toGeoJSON(act, st);
      fs.writeFileSync(path.join(RUNS_DIR, act.id + ".geojson"), JSON.stringify(geo), "utf8");
      saved++;
      console.log("  ✔ " + (act.start_date_local || "").slice(0, 10) + " " + act.name +
        " (" + (act.distance / 1000).toFixed(1) + "km" + (st.heartrate ? ", ♥" : ", 심박없음") + ")");
    }
    page++;
  }
  const total = rebuildIndex();
  console.log("\n완료: 신규 " + saved + "건 저장, " + skipped + "건 이미 있음 → 총 " + total + "건 (data/runs/)");
  console.log("대시보드에서 확인: 정적 서버로 index.html 열기");
})().catch(e => die(e.message));
