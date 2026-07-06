# Heartline (하트라인)

A personal dashboard that draws my running records (Strava) on a map as **heart-rate-colored routes**.
**Google sign-in + Firestore cloud sync** lets me view my records from anywhere. Supports marathon course GPX overlays.
Same single-file + design-token structure as the sibling apps in the moa hub.

- Repository: https://github.com/ClayborneYeounjunLee/heartline
- Web: https://clayborneyeounjunlee.github.io/heartline/ (after enabling GitHub Pages)

> 📄 Full design/roadmap: `러닝_대시보드_구축_계획.md` in the parent folder (AWS Webhook automation is Phase 2+ of that document)
> This repository is the **local-first MVP** of that plan — a version that completes the entire data pipeline first, using a manual pull approach.

---

## ⚠️ No-Publish Rules (Strava Terms + Privacy)

Under the Strava API Agreement (2024 revision), **activity data obtained via the API may only be displayed "to the owner themselves."**
Therefore, unlike the other sibling apps, this app **must not publish real data to GitHub Pages**:

| Item | Public? |
|---|---|
| App code (`index.html`, `tools/`) | ✅ OK to publish |
| Synthetic samples (`data/samples/`) | ✅ OK to publish (fake data) |
| **Real records (`data/runs/`)** | ❌ **Never publish** — handled by `.gitignore` |
| Strava secrets (`tools/.env`) | ❌ **Never publish** — handled by `.gitignore` |
| My records in Firestore | ✅ OK — rules allow read/write **only for my own uid** → satisfies the "display only to the owner" requirement |

- Real data is visible **only behind Google sign-in** (Firestore rules = authentication gate). Anonymous visitors see samples only.
- API data **must not be used as input to AI models** (explicitly stated in the terms).
- To build a public page: use only Strava **official embeds** (iframe) or **self-exported GPX** (Chapter 3 of the plan document).
- Extra protection: the collector trims 200 m from the start/end of each route (`TRIM_METERS`) → prevents exposing my home location.

---

## Getting Started

### 0. Prerequisites
- Node 18+ (fetch built in) — already installed on this PC
- Strava account + (if using a Mi Band) enable Mi Fitness ↔ Strava sync
  - Mi Fitness app → Profile → Connected apps → Sign in to / authorize Strava
  - Strava settings → enable **health data consent** at https://www.strava.com/settings/consent (heart rate gets stripped otherwise!)

> ⚠️ **2026-06-01 Strava developer program overhaul**: a **paid Strava subscription (~$11.99/month) is now required** for Standard-tier API usage
> (immediately for new developers, from 2026-06-30 for existing ones). To avoid the subscription, see "Going Without Strava" below.
> Also, from 2027-06-01 the base URL changes to `www.api-v3.strava.com` — just update the single URL line at the top of `strava_pull.js`.

### Going Without Strava (if not subscribing)
This dashboard's data contract (GeoJSON) is source-neutral, so Strava is not required:
1. **Pull directly from the Mi Fitness cloud** — community tool `kevinkwee/Mi-Fitness-Sync` (active as of 2026-07): extracts GPS + heart-rate samples from the Xiaomi cloud as GPX/TCX/FIT → just write a converter and it can feed this dashboard directly
2. **Xiaomi official data export** — account.xiaomi.com → Privacy → Manage my data → download Mi Fitness (takes a few minutes to 15 business days; the zip is unlocked with a password sent by email; the CSVs include heart-rate time series + track data)

### 1. Register a Strava API App (one-time)
1. Go to https://www.strava.com/settings/api
2. Any app name, **Authorization Callback Domain = `localhost`**
3. Copy the issued **Client ID / Client Secret**

### 2. Configuration File
```bash
cd heartline
copy tools\.env.example tools\.env     # then fill in CLIENT_ID / SECRET
```

### 3. Authentication (one-time)
```bash
node tools/strava_pull.js --auth       # open the printed URL in a browser and authorize
node tools/strava_pull.js --token <code value from the address bar>
```

### 4. ★ Weakest-Link Check — Does Heart Rate Reach Strava?
Record one outdoor run → confirm Mi Fitness→Strava sync, then:
```bash
node tools/strava_pull.js --check
```
- `heartrate ✔` → heart-rate map is possible, proceed as is
- `heartrate ✖` → Mi Fitness sync drops heart rate → work around via Health Connect or the official data export (see the plan document)

### 5. Sync & View
```bash
node tools/strava_pull.js              # new runs → data/runs/*.geojson
npx serve . or any static server       # not ES modules so file:// would work, but a server is needed because of fetch
```
If there is no data, the dashboard automatically shows the synthetic data in `data/samples/` (with a 📦 badge).

### 6. ☁ Cloud Sync (viewing online)

Reuses the same Firebase project as haru/jangbu (`haru-221ae`), only the collection is `heartline`.

**One-time setup (Firebase console):** Firestore → add the block below to the rules and publish:
```
match /heartline/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
  match /runs/{runId} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```
(The GitHub Pages domain was already authorized for haru/jangbu, so no extra work is needed.)

**Usage flow:**
1. On the local dashboard (this PC, where `data/runs/` lives), top-right 👤 → sign in with Google
2. Click "⬆ Upload N local records" → saved to Firestore (`heartline/{uid}` index + `runs/{id}` documents)
3. From then on, open https://clayborneyeounjunlee.github.io/heartline/ on any device and sign in → view my records

Data model: `heartline/{uid}` = `{ runs: [meta] }`, `heartline/{uid}/runs/{id}` = `{ ...meta, geo: GeoJSON string }`
(Why the GeoJSON is stored as a string: Firestore does not support nested arrays. One run ≈ 100–200 KB, well within the 1 MB document limit.)

---

## Features

- **Heart-rate zone colored routes** — Z1 (blue) → Z5 (red), 5 zones based on max heart rate (default 190, localStorage `run-hrmax`)
- **Run list/detail** — distance, time, pace, elevation, average/max heart rate, zone distribution bar, heart-rate and elevation charts
- **All-routes overlay** — every run so far on a single map (accumulated view)
- **Course GPX overlay** — overlay a race course file as a dotted line (Track A; processed client-side, so unaffected by the API terms)
- **Dark mode + Korean/English** — shared with the moa hub (`hub-theme`, `hub-lang`)

## Data Contract (in preparation for AWS migration)

`data/runs/{id}.geojson` — GeoJSON Feature:
```
geometry:   LineString [lon,lat][]
properties: id, name, sport_type, start_date, distance_m, moving_time_s,
            elapsed_time_s, elev_gain_m, avg_hr, max_hr,
            streams: { hr[], time_s[], alt_m[] }   ← index-aligned with the coordinates
```
`data/runs/index.json` — `{ runs: [meta summaries] }` (descending by date)

This contract has the same shape as the S3/DynamoDB schema in sections 7.6–7.7 of the plan document → later, the AWS Webhook pipeline (Lambda worker) **only needs to write the same format to S3** and the frontend is reused as is.

## File Structure

```
heartline/
├─ index.html            # dashboard (single file: map + panels + charts + cloud)
├─ data/
│  ├─ samples/           # synthetic demo data (committed)
│  └─ runs/              # real data (gitignored — created automatically)
├─ tools/
│  ├─ strava_pull.js     # collector: --auth / --token / --check / sync / --force
│  ├─ make_samples.js    # sample regenerator
│  └─ .env.example       # config template (.env is gitignored)
└─ .gitignore
```

## Roadmap (linked to the plan document)

- [x] Phase A — Local MVP: manual pull + heart-rate map + GPX courses
- [x] Phase A+ — Google sign-in + Firestore cloud sync (view from anywhere)
- [ ] Phase B — Verify Mi Fitness heart-rate sync with `--check` (requires one run)
- [ ] Phase C — AWS Webhook automation: API Gateway + Lambda + SQS + S3 (plan document Phases 1–4, migrating to Python)
- [ ] Phase D — Public page: official embeds or self-published GPX layer (terms-safe paths only)
