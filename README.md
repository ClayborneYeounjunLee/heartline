# 달리기 · Running Dashboard

내 러닝 기록(Strava)을 **심박수 색상 루트**로 지도에 그려주는 개인 대시보드.
마라톤 코스 GPX 오버레이 지원. moa 허브 자매 앱들과 같은 단일 파일 + 디자인 토큰 구조.

> 📄 전체 설계/로드맵: 상위 폴더의 `러닝_대시보드_구축_계획.md` (AWS Webhook 자동화는 그 문서의 Phase 2~)
> 이 저장소는 그 계획의 **로컬 우선 MVP** — 수동 당기기(pull) 방식으로 전체 데이터 파이프라인을 먼저 완성한 버전.

---

## ⚠️ 공개 금지 규칙 (Strava 약관 + 프라이버시)

Strava API 약관(2024 개정)상 **API로 받은 활동 데이터는 "본인에게만" 표시 가능**하다.
그래서 이 앱은 다른 자매 앱들과 달리 **GitHub Pages에 실데이터를 올리면 안 된다**:

| 항목 | 공개 여부 |
|---|---|
| 앱 코드 (`index.html`, `tools/`) | ✅ 공개 OK |
| 합성 샘플 (`data/samples/`) | ✅ 공개 OK (가짜 데이터) |
| **실제 기록 (`data/runs/`)** | ❌ **절대 공개 금지** — `.gitignore` 처리됨 |
| Strava 시크릿 (`tools/.env`) | ❌ **절대 공개 금지** — `.gitignore` 처리됨 |

- 실데이터 대시보드는 **로컬에서만** 열기 (또는 비공개 호스팅 + 인증 게이트).
- API 데이터를 **AI 모델 입력으로 사용 금지** (약관 명시).
- 공개 페이지를 만들려면: Strava **공식 임베드**(iframe) 또는 **직접 내보낸 GPX**만 사용 (계획 문서 3장).
- 추가 보호: 수집기가 루트 시작/끝 200m를 잘라냄 (`TRIM_METERS`) → 집 위치 노출 방지.

---

## 시작하기

### 0. 준비물
- Node 18+ (fetch 내장) — 이 PC에 이미 있음
- Strava 계정 + (미밴드라면) Mi Fitness ↔ Strava 연동 켜기
  - Mi Fitness 앱 → 프로필 → 연결된 앱 → Strava 로그인/승인
  - Strava 설정 → https://www.strava.com/settings/consent 에서 **건강 데이터 동의** 켜기 (안 켜면 심박이 잘림!)

> ⚠️ **2026-06-01 Strava 개발자 프로그램 개편**: Standard 티어 API 사용에 **유료 Strava 구독(월 ~$11.99)이 필수**가 됐다
> (신규 개발자는 즉시, 기존 개발자는 2026-06-30부터). 구독 없이 가려면 아래 "Strava 없이 가는 길" 참고.
> 또 2027-06-01부터 base URL이 `www.api-v3.strava.com` 으로 바뀜 — `strava_pull.js` 상단 URL 한 줄만 바꾸면 됨.

### Strava 없이 가는 길 (구독 안 할 경우)
이 대시보드의 데이터 계약(GeoJSON)은 소스 중립이라 Strava가 필수는 아니다:
1. **Mi Fitness 클라우드 직접 풀** — 커뮤니티 도구 `kevinkwee/Mi-Fitness-Sync` (2026-07 활발): 샤오미 클라우드에서 GPS+심박 샘플을 GPX/TCX/FIT로 추출 → 변환기만 짜면 이 대시보드에 바로 사용 가능
2. **샤오미 공식 데이터 내보내기** — account.xiaomi.com → 프라이버시 → 내 데이터 관리 → Mi Fitness 다운로드 (몇 분~15영업일, zip은 메일로 온 비번으로 해제; CSV 안에 심박 시계열 + 트랙 데이터 포함)

### 1. Strava API 앱 등록 (1회)
1. https://www.strava.com/settings/api 접속
2. 앱 이름 아무거나, **Authorization Callback Domain = `localhost`**
3. 발급된 **Client ID / Client Secret** 을 복사

### 2. 설정 파일
```bash
cd running
copy tools\.env.example tools\.env     # 그리고 CLIENT_ID / SECRET 채우기
```

### 3. 인증 (1회)
```bash
node tools/strava_pull.js --auth       # 나온 URL을 브라우저에서 열고 승인
node tools/strava_pull.js --token <주소창의 code 값>
```

### 4. ★ 약한 고리 검증 — 심박이 Strava까지 오는가
야외 러닝 1회 기록 → Mi Fitness→Strava 동기화 확인 후:
```bash
node tools/strava_pull.js --check
```
- `heartrate ✔` → 심박 지도 가능, 그대로 진행
- `heartrate ✖` → Mi Fitness 동기화가 심박 누락 → Health Connect 경유 또는 공식 데이터 내보내기로 우회 (계획 문서 참고)

### 5. 동기화 & 보기
```bash
node tools/strava_pull.js              # 새 러닝 → data/runs/*.geojson
npx serve . 또는 아무 정적 서버        # ES모듈 아님이라 file:// 도 되지만 fetch 때문에 서버 필요
```
데이터가 없으면 대시보드는 자동으로 `data/samples/` 합성 데이터를 보여준다 (📦 배지 표시).

---

## 기능

- **심박 존 색상 루트** — Z1(파랑)→Z5(빨강), 최대심박 기준 5존 (기본 190, localStorage `run-hrmax`)
- **런 목록/상세** — 거리·시간·페이스·고도·평균/최고 심박, 존 분포 바, 심박·고도 차트
- **전체 루트 오버레이** — 지금까지의 모든 러닝을 한 지도에 (축적 뷰)
- **코스 GPX 오버레이** — 대회 코스 파일을 점선으로 겹쳐 보기 (트랙 A, 클라이언트 처리라 약관 무관)
- **다크 모드 + 한/영** — moa 허브 공통 (`hub-theme`, `hub-lang`)

## 데이터 계약 (AWS 이관 대비)

`data/runs/{id}.geojson` — GeoJSON Feature:
```
geometry:   LineString [lon,lat][]
properties: id, name, sport_type, start_date, distance_m, moving_time_s,
            elapsed_time_s, elev_gain_m, avg_hr, max_hr,
            streams: { hr[], time_s[], alt_m[] }   ← 좌표와 인덱스 정렬
```
`data/runs/index.json` — `{ runs: [메타 요약] }` (날짜 내림차순)

이 계약은 계획 문서 7.6~7.7의 S3/DynamoDB 스키마와 동일한 모양 → 나중에 AWS Webhook 파이프라인(Lambda 워커)이 **같은 포맷을 S3에 쓰기만 하면** 프론트는 그대로 재사용.

## 파일 구조

```
running/
├─ index.html            # 대시보드 (단일 파일: 지도+패널+차트)
├─ data/
│  ├─ samples/           # 합성 데모 데이터 (커밋됨)
│  └─ runs/              # 실데이터 (gitignore — 생성 시 자동)
├─ tools/
│  ├─ strava_pull.js     # 수집기: --auth / --token / --check / 동기화 / --force
│  ├─ make_samples.js    # 샘플 재생성기
│  └─ .env.example       # 설정 템플릿 (.env 는 gitignore)
└─ .gitignore
```

## 로드맵 (계획 문서와 연결)

- [x] Phase A — 로컬 MVP: 수동 pull + 심박 지도 + GPX 코스 (**이 저장소**)
- [ ] Phase B — `--check` 로 Mi Fitness 심박 동기화 실증 (러닝 1회 필요)
- [ ] Phase C — AWS Webhook 자동화: API Gateway + Lambda + SQS + S3 (계획 문서 Phase 1~4, Python으로 이관)
- [ ] Phase D — 공개 페이지: 공식 임베드 or 자가발행 GPX 레이어 (약관 세이프 경로만)
